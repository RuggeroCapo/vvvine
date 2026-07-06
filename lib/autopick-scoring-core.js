/**
 * Shared autopick scoring primitives (browser + Node).
 * Keep in sync with managers/autopick-manager.js scoring defaults.
 */
(function initAutopickScoringCore(root, factory) {
  const api = factory();

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }

  root.AutopickScoringCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function createAutopickScoringCore() {
  const DEFAULT_SCORING_CONFIG = {
    thresholdPercent: 75,
    unknownAffinityScore: 0,
    unknownValueScore: 0,
    unknownQueueScore: 5,
    mustPickConfidenceFloor: 100,
    mustPickValueCeiling: 1000,
    affinityFloor: 6,
    weights: {
      affinity: 0.60,
      value: 0.25,
      queue: 0.15
    },
    typeWeights: {
      brand: 1.0,
      phrase: 0.95,
      regex: 0.9,
      keyword: 0.75
    },
    stackBonusPerLabel: 0.5,
    queueScores: {
      last_chance: 10,
      potluck: 9,
      encore: 7,
      search: 5,
      unknown: 5
    },
    valueCurve: [
      { value: 0, score: 1 },
      { value: 50, score: 4 },
      { value: 120, score: 10 },
      { value: 300, score: 10 },
      { value: 600, score: 8 },
      { value: 1000, score: 5 },
      { value: 1500, score: 2 }
    ],
    valueTiers: [
      { max: 50, score: 3 },
      { max: 300, score: 10 },
      { max: 1000, score: 7 },
      { max: Infinity, score: 2 }
    ]
  };

  function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Reject Italian/French contractions: dell'olio, dall'est, nell'acqua, etc. */
  function brandPatternRegex(pattern) {
    const escaped = escapeRegex(pattern);
    return new RegExp(`\\b${escaped}\\b(?![''’])`, 'i');
  }

  function keywordPatternRegex(pattern) {
    return new RegExp(`\\b${escapeRegex(pattern)}\\b`, 'i');
  }

  function phrasePatternRegex(pattern) {
    const parts = pattern.toLowerCase().trim().split(/\s+/).map((p) => escapeRegex(p));
    return new RegExp(`\\b${parts.join('\\s+')}\\b`, 'i');
  }

  function compilePatternList(patterns) {
    if (!patterns || patterns.length === 0) {
      return null;
    }
    return patterns.map((pattern) => phrasePatternRegex(pattern));
  }

  function compileRules(rawRules) {
    const compiled = (rawRules || []).map((rule) => {
      const patterns = [rule.pattern, ...(rule.aliases || [])].filter(Boolean);
      let regexes;

      if (rule.type === 'regex') {
        regexes = patterns.map((pattern) => new RegExp(pattern, 'i'));
      } else if (rule.type === 'phrase') {
        regexes = patterns.map((pattern) => phrasePatternRegex(pattern));
      } else if (rule.type === 'brand') {
        regexes = patterns.map((pattern) => brandPatternRegex(pattern));
      } else {
        regexes = patterns.map((pattern) => keywordPatternRegex(pattern));
      }

      return {
        ...rule,
        regexes,
        patterns,
        requiresAnyRegexes: compilePatternList(rule.requiresAny),
        excludeRegexes: compilePatternList(rule.exclude)
      };
    });

    return compiled.sort((a, b) => {
      if (a.mustPick !== b.mustPick) {
        return a.mustPick ? -1 : 1;
      }
      return (b.score || 0) - (a.score || 0);
    });
  }

  function normalizeTitle(title) {
    return (title || '')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/gi, "'")
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Guard clauses: requiresAny gates generic/mustPick rules on co-occurring evidence
  // (e.g. "filament" mustPick only fires alongside pla/petg/3d-printer words); exclude
  // vetoes known false-positive contexts (e.g. brand rules matching "compatible with X").
  function passesGuards(rule, normalized) {
    if (rule.excludeRegexes && rule.excludeRegexes.some((regex) => regex.test(normalized))) {
      return false;
    }
    if (rule.requiresAnyRegexes && !rule.requiresAnyRegexes.some((regex) => regex.test(normalized))) {
      return false;
    }
    return true;
  }

  function scanRuleMatches(title, compiledRules) {
    const normalized = normalizeTitle(title);
    const matches = [];

    for (const rule of compiledRules) {
      const patterns = rule.patterns || [rule.pattern, ...(rule.aliases || [])].filter(Boolean);

      for (let i = 0; i < rule.regexes.length; i++) {
        const regex = rule.regexes[i];
        if (regex.test(normalized)) {
          if (!passesGuards(rule, normalized)) {
            break;
          }
          matches.push({
            rule,
            matchedPattern: patterns[i] || rule.pattern,
            regexSource: regex.source
          });
          break;
        }
      }
    }

    return { normalized, matches };
  }

  // Precision weight of the rule's evidence type — a brand hit is stronger signal than a
  // generic keyword, so it should move the affinity score more.
  function weightedRuleScore(rule, config) {
    const typeWeight = config.typeWeights?.[rule.type] ?? 1;
    return (rule.score || 0) * typeWeight;
  }

  function pickBestRule(matches, config) {
    let best = null;

    for (const entry of matches) {
      const rule = entry.rule;
      if (
        !best ||
        rule.mustPick && !best.rule.mustPick ||
        (rule.mustPick === best.rule.mustPick && weightedRuleScore(rule, config) > weightedRuleScore(best.rule, config))
      ) {
        best = entry;
      }
    }

    return best;
  }

  function matchBestRule(title, compiledRules, config = DEFAULT_SCORING_CONFIG) {
    if (!title || !compiledRules?.length) {
      return null;
    }

    const { matches } = scanRuleMatches(title, compiledRules);
    const best = pickBestRule(matches, config);
    return best?.rule ?? null;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function scoreQueue(queue, config) {
    const scores = config.queueScores || {};
    return scores[queue] ?? scores.unknown ?? config.unknownQueueScore;
  }

  function scoreValueTier(value, config) {
    if (value == null || Number.isNaN(value)) {
      return { score: config.unknownValueScore, tier: null };
    }

    for (const tier of config.valueTiers || []) {
      if (value <= tier.max) {
        return { score: tier.score, tier };
      }
    }

    return { score: config.unknownValueScore, tier: null };
  }

  // Piecewise-linear interpolation over valueCurve control points — replaces the old step
  // tiers so two items a euro apart on either side of a boundary don't score 20+ points apart.
  function interpolateValueCurve(value, curve, config) {
    const points = [...curve].sort((a, b) => a.value - b.value);
    if (value <= points[0].value) {
      return points[0].score;
    }

    const last = points[points.length - 1];
    if (value >= last.value) {
      return last.score;
    }

    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      if (value >= p0.value && value <= p1.value) {
        const t = (value - p0.value) / (p1.value - p0.value);
        return p0.score + t * (p1.score - p0.score);
      }
    }

    return config.unknownValueScore;
  }

  function scoreValue(value, config) {
    if (value == null || Number.isNaN(value)) {
      return { score: config.unknownValueScore, tier: null };
    }

    const curve = config.valueCurve;
    if (Array.isArray(curve) && curve.length > 0) {
      return { score: interpolateValueCurve(value, curve, config), tier: null };
    }

    return scoreValueTier(value, config);
  }

  function maxValueTierScore(config) {
    return (config.valueTiers || []).reduce((max, tier) => Math.max(max, tier.score || 0), 0);
  }

  function maxValueScore(config) {
    const curve = config.valueCurve;
    if (Array.isArray(curve) && curve.length > 0) {
      return curve.reduce((max, point) => Math.max(max, point.score || 0), 0);
    }
    return maxValueTierScore(config);
  }

  // Weighted blend of the three pillars, 0-100. Affinity dominates by default so a generic
  // queue/value coincidence can no longer outvote "this item has nothing to do with my interests".
  function computeConfidence(affinityScore, valueScore, queueScore, config) {
    const weights = config.weights || { affinity: 1 / 3, value: 1 / 3, queue: 1 / 3 };
    const totalWeight = (weights.affinity || 0) + (weights.value || 0) + (weights.queue || 0);
    if (!totalWeight) {
      return 0;
    }

    const weighted = (
      clamp(affinityScore, 0, 10) * (weights.affinity || 0) +
      clamp(valueScore, 0, 10) * (weights.value || 0) +
      clamp(queueScore, 0, 10) * (weights.queue || 0)
    ) / totalWeight;

    return Math.round((weighted / 10) * 100);
  }

  function canBeDecisive({ valueScore, queueScore, valueKnown, config }) {
    const valueContribution = valueKnown ? valueScore : maxValueScore(config);
    const maxConfidence = computeConfidence(10, valueContribution, queueScore, config);
    return maxConfidence >= config.thresholdPercent;
  }

  function resolveAffinityFromMatches(matches, bestEntry, config) {
    if (!bestEntry) {
      return null;
    }

    const rule = bestEntry.rule;
    if (rule.mustPick) {
      return {
        score: 10,
        source: 'rule',
        rule,
        override: true,
        reason: rule.label || rule.pattern
      };
    }

    // Multi-signal titles (e.g. "Creality 3D printer PLA filament" hits both a brand rule and
    // a 3D-printing keyword) outrank a single coincidental keyword match.
    const base = clamp(weightedRuleScore(rule, config), 0, 10);
    const distinctLabels = new Set(matches.map((m) => m.rule.label || m.rule.pattern)).size;
    const stackBonus = Math.max(0, distinctLabels - 1) * (config.stackBonusPerLabel || 0);

    return {
      score: clamp(base + stackBonus, 0, 10),
      source: 'rule',
      rule,
      override: false,
      reason: rule.label || rule.pattern
    };
  }

  function computeScore({ title, queue, value, config = DEFAULT_SCORING_CONFIG, llmAffinity = null }) {
    const compiled = config._compiledRules || compileRules(config.rules || []);
    const { matches } = scanRuleMatches(title, compiled);
    const bestMatch = pickBestRule(matches, config);
    const rule = bestMatch?.rule ?? null;

    const queueScore = scoreQueue(queue, config);
    const { score: valueScore, tier: valueTier } = scoreValue(value, config);
    const valueKnown = value != null && !Number.isNaN(value);

    let affinity = resolveAffinityFromMatches(matches, bestMatch, config);
    if (!affinity) {
      if (llmAffinity != null) {
        affinity = {
          score: clamp(llmAffinity.score, 0, 10),
          source: 'llm',
          rule: null,
          override: false,
          reason: llmAffinity.reason || ''
        };
      } else {
        affinity = {
          score: config.unknownAffinityScore,
          source: 'unknown',
          rule: null,
          override: false,
          reason: ''
        };
      }
    }

    let override = false;
    let needsValue = false;
    let confidence;

    if (affinity.override) {
      if (config.mustPickValueCeiling && valueKnown && value > config.mustPickValueCeiling) {
        override = false;
        confidence = computeConfidence(affinity.score, valueScore, queueScore, config);
      } else if (config.mustPickValueCeiling && !valueKnown) {
        needsValue = true;
        confidence = computeConfidence(affinity.score, valueScore, queueScore, config);
      } else {
        override = true;
        confidence = config.mustPickConfidenceFloor;
      }
    } else {
      confidence = computeConfidence(affinity.score, valueScore, queueScore, config);
    }

    const decisive = canBeDecisive({
      valueScore,
      queueScore,
      valueKnown,
      config
    });

    const belowAffinityFloor = !override && affinity.score < (config.affinityFloor ?? 0);

    return {
      title,
      normalized: normalizeTitle(title),
      queue,
      value,
      valueKnown,
      valueTier,
      queueScore,
      valueScore,
      affinityScore: affinity.score,
      affinitySource: affinity.source,
      affinityReason: affinity.reason,
      rule: rule ? {
        type: rule.type,
        pattern: rule.pattern,
        label: rule.label,
        score: rule.score,
        mustPick: Boolean(rule.mustPick),
        matchedPattern: bestMatch.matchedPattern
      } : null,
      confidence,
      override,
      needsValue,
      belowAffinityFloor,
      wouldPick: override || (!belowAffinityFloor && confidence >= config.thresholdPercent),
      canBeDecisive: decisive,
      thresholdPercent: config.thresholdPercent
    };
  }

  function mergeConfig(partial) {
    return {
      ...DEFAULT_SCORING_CONFIG,
      ...partial,
      weights: { ...DEFAULT_SCORING_CONFIG.weights, ...(partial.weights || {}) },
      typeWeights: { ...DEFAULT_SCORING_CONFIG.typeWeights, ...(partial.typeWeights || {}) },
      queueScores: { ...DEFAULT_SCORING_CONFIG.queueScores, ...(partial.queueScores || {}) },
      valueCurve: (Array.isArray(partial.valueCurve) && partial.valueCurve.length > 0)
        ? partial.valueCurve
        : DEFAULT_SCORING_CONFIG.valueCurve,
      valueTiers: partial.valueTiers || DEFAULT_SCORING_CONFIG.valueTiers
    };
  }

  function explainScore(options) {
    const config = mergeConfig(options.config || {});
    const compiled = compileRules(options.rules || []);
    config._compiledRules = compiled;

    const { normalized, matches } = scanRuleMatches(options.title, compiled);
    const bestMatch = pickBestRule(matches, config);
    const result = computeScore({
      title: options.title,
      queue: options.queue || 'unknown',
      value: options.value ?? null,
      config,
      llmAffinity: options.llmAffinity ?? null
    });

    const logs = [];
    logs.push(`Title: ${options.title}`);
    logs.push(`Normalized: ${normalized}`);
    logs.push(`Queue: ${options.queue || 'unknown'} → ${result.queueScore}/10`);
    if (options.value != null && !Number.isNaN(options.value)) {
      const tierLabel = result.valueTier
        ? `≤ ${result.valueTier.max === Infinity ? '∞' : result.valueTier.max}`
        : 'interpolated curve';
      logs.push(`Value: ${options.value} (${tierLabel}) → ${result.valueScore.toFixed ? result.valueScore.toFixed(2) : result.valueScore}/10`);
    } else {
      logs.push(`Value: unknown → ${result.valueScore}/10 (unknownValueScore)`);
    }
    logs.push('');
    logs.push(`Rule scan (${compiled.length} rules, ${matches.length} match${matches.length === 1 ? '' : 'es'}):`);

    for (const rule of compiled) {
      const hit = matches.find((m) => m.rule === rule);
      if (hit) {
        const flags = [
          rule.mustPick ? 'mustPick' : null,
          `score ${rule.score}`,
          rule.label || null
        ].filter(Boolean).join(', ');
        logs.push(`  ✓ [${rule.type}] "${hit.matchedPattern}" (${flags})`);
        logs.push(`      regex: /${hit.regexSource}/i`);
      } else if (options.verbose) {
        logs.push(`  ✗ [${rule.type}] "${rule.pattern}"`);
      }
    }

    if (matches.length === 0) {
      logs.push('  (no rule matches)');
    }

    logs.push('');
    if (bestMatch) {
      const weighted = weightedRuleScore(bestMatch.rule, config);
      logs.push(`Best rule: [${bestMatch.rule.type}] "${bestMatch.matchedPattern}" → affinity ${bestMatch.rule.mustPick ? 10 : weighted.toFixed(2)}/10`);
      if (matches.length > 1) {
        const distinctLabels = new Set(matches.map((m) => m.rule.label || m.rule.pattern)).size;
        if (distinctLabels > 1) {
          logs.push(`  + stacking bonus: ${distinctLabels} distinct labels matched (${((distinctLabels - 1) * (config.stackBonusPerLabel || 0)).toFixed(2)} bonus)`);
        }
      }
      if (bestMatch.rule.mustPick) {
        logs.push('  mustPick override applies when value ceiling allows');
      }
    } else if (options.llmAffinity != null) {
      logs.push(`Affinity: LLM → ${result.affinityScore}/10 (${options.llmAffinity.reason || 'no reason'})`);
    } else {
      logs.push(`Affinity: unknown → ${result.affinityScore}/10`);
      logs.push(`  canBeDecisive (LLM gate): ${result.canBeDecisive ? 'yes' : 'no — even affinity 10 would not reach threshold'}`);
    }

    if (bestMatch) {
      logs.push(`Affinity source: rule (${result.affinityReason})`);
    }

    logs.push('');
    logs.push(`Weights: affinity ${config.weights.affinity}, value ${config.weights.value}, queue ${config.weights.queue}`);
    logs.push(`Breakdown: affinity ${result.affinityScore}/10, value ${result.valueScore}/10, queue ${result.queueScore}/10`);
    logs.push(`Confidence: ${result.confidence}% (threshold ${result.thresholdPercent}%)`);
    if (result.belowAffinityFloor) {
      logs.push(`Affinity floor: ${result.affinityScore} < ${config.affinityFloor} → blocked regardless of confidence`);
    }
    logs.push(`Decision: ${result.wouldPick ? 'WOULD PICK' : 'SKIP'}${result.override ? ' (mustPick override)' : ''}${result.needsValue ? ' (needs value for mustPick ceiling)' : ''}`);

    return { result, logs, matches, bestMatch };
  }

  return {
    DEFAULT_SCORING_CONFIG,
    escapeRegex,
    brandPatternRegex,
    compileRules,
    normalizeTitle,
    scanRuleMatches,
    pickBestRule,
    matchBestRule,
    clamp,
    scoreQueue,
    scoreValue,
    scoreValueTier,
    maxValueScore,
    maxValueTierScore,
    computeConfidence,
    canBeDecisive,
    mergeConfig,
    computeScore,
    explainScore
  };
});

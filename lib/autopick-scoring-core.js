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

  const HTML_ENTITIES = {
    '&quot;': '"', '&amp;': '&', '&lt;': '<', '&gt;': '>',
    '&apos;': "'", '&#39;': "'", '&nbsp;': ' '
  };

  function normalizeTitle(title) {
    let text = String(title || '');
    // 1. HTML entities (single pass so "&amp;quot;" is not double-decoded)
    text = text
      .replace(/&(?:quot|amp|lt|gt|apos|nbsp|#39);/gi, (m) => HTML_ENTITIES[m.toLowerCase()] ?? m)
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
    // 2. Trademark symbols → space BEFORE NFKD (NFKD would turn ™ into the letters "tm")
    text = text.replace(/[™®©]/g, ' ');
    // 3. Strip diacritics: "caffè" → "caffe", "für" → "fur"
    text = text.normalize('NFKD').replace(/[̀-ͯ]/g, '');
    // 4. Unicode dashes and quotes → ASCII (after NFKD, which can itself emit U+2010)
    text = text
      .replace(/[‐-―−]/g, '-')
      .replace(/[‘’‚′]/g, "'")
      .replace(/[“”„″]/g, '"');
    // 5. Case and whitespace
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function normalizePattern(pattern) {
    return normalizeTitle(pattern);
  }

  function escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /** Reject Italian/French contractions: dell'olio, dall'est, nell'acqua, etc. */
  function brandPatternRegex(pattern) {
    const escaped = escapeRegex(normalizePattern(pattern));
    return new RegExp(`\\b${escaped}\\b(?![''’])`, 'i');
  }

  // A brand mention that is only ever preceded by "per / for / compatibile con / …" describes a
  // third-party accessory, not the brand's own product.
  const COMPAT_PREFIX_REGEX = new RegExp(
    '\\b(?:' +
      'compatibil[ei]\\s+(?:con|per|a)|compatible\\s+with|' +
      'adatt[aoei]\\s+(?:a|per|al|alla|ai|agli|alle)|' +
      'pour|fur|passend\\s+fur|ersatz\\s+fur|' +
      'replacement\\s+for|ricambi[oi]\\s+(?:per|compatibil[ei]\\s+con)|' +
      'fits?|designed\\s+for|per|for' +
    ')\\s+' +
    '(?:(?:il|lo|la|le|i|gli|the|your|tutt[ei]|droni?|drone|stampant[ei]|modell[oi]|telefon[oi]|smartphones?|action\\s+cam(?:eras?)?)\\s+){0,3}$',
    'i'
  );

  // True when at least one occurrence of `regex` in `normalized` is NOT preceded by a
  // compatibility phrase. False when there is no occurrence or every occurrence is preceded by one.
  function hasNonCompatBrandOccurrence(normalized, regex) {
    const flags = regex.flags.includes('g') ? regex.flags : regex.flags + 'g';
    const global = new RegExp(regex.source, flags);
    let match;
    while ((match = global.exec(normalized)) !== null) {
      if (!COMPAT_PREFIX_REGEX.test(normalized.slice(0, match.index))) {
        return true;
      }
      if (match[0].length === 0) {
        global.lastIndex += 1;
      }
    }
    return false;
  }

  function keywordPatternRegex(pattern) {
    return new RegExp(`\\b${escapeRegex(normalizePattern(pattern))}\\b`, 'i');
  }

  function phrasePatternRegex(pattern) {
    const parts = normalizePattern(pattern).split(/\s+/).map((p) => escapeRegex(p));
    return new RegExp(`\\b${parts.join('\\s+')}\\b`, 'i');
  }

  function compilePatternList(patterns) {
    if (!patterns || patterns.length === 0) {
      return null;
    }
    return patterns.map((pattern) => phrasePatternRegex(pattern));
  }

  function mergeRuleExclude(rule, sharedExclude) {
    if (!sharedExclude || sharedExclude.length === 0) {
      return rule.exclude || [];
    }
    if (rule.veto || rule.type === 'regex') {
      return rule.exclude || [];
    }
    return [...new Set([...sharedExclude, ...(rule.exclude || [])])];
  }

  function compileRules(rawRules, options = {}) {
    const sharedExclude = options.sharedExclude || [];
    const compiled = (rawRules || []).map((rule) => {
      const patterns = [rule.pattern, ...(rule.aliases || [])].filter(Boolean);
      const exclude = mergeRuleExclude(rule, sharedExclude);
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
        exclude,
        requiresAnyRegexes: compilePatternList(rule.requiresAny),
        excludeRegexes: compilePatternList(exclude)
      };
    });

    return compiled.sort((a, b) => {
      if (a.mustPick !== b.mustPick) {
        return a.mustPick ? -1 : 1;
      }
      return (b.score || 0) - (a.score || 0);
    });
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

  function findVetoMatch(title, compiledRules) {
    const normalized = normalizeTitle(title);

    for (const rule of compiledRules) {
      if (!rule.veto) {
        continue;
      }
      if (rule.regexes.some((regex) => regex.test(normalized))) {
        return rule;
      }
    }

    return null;
  }

  function scanRuleMatches(title, compiledRules) {
    const normalized = normalizeTitle(title);
    const matches = [];

    for (const rule of compiledRules) {
      if (rule.veto) {
        continue;
      }

      const patterns = rule.patterns || [rule.pattern, ...(rule.aliases || [])].filter(Boolean);

      for (let i = 0; i < rule.regexes.length; i++) {
        const regex = rule.regexes[i];
        const hit = rule.type === 'brand'
          ? hasNonCompatBrandOccurrence(normalized, regex)
          : regex.test(normalized);
        if (hit) {
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

  // Weighted blend of the pillars, 0-100. When the value is unknown, the value pillar is removed
  // from both numerator and denominator (dynamic normalization) instead of counting as 0/10.
  function computeConfidence(affinityScore, valueScore, queueScore, config, options = {}) {
    const valueKnown = options.valueKnown !== false && valueScore != null && !Number.isNaN(valueScore);
    const weights = config.weights || { affinity: 1 / 3, value: 1 / 3, queue: 1 / 3 };
    const affinityWeight = weights.affinity || 0;
    const valueWeight = valueKnown ? (weights.value || 0) : 0;
    const queueWeight = weights.queue || 0;
    const totalWeight = affinityWeight + valueWeight + queueWeight;
    if (!totalWeight) {
      return 0;
    }

    const weighted = (
      clamp(affinityScore, 0, 10) * affinityWeight +
      (valueKnown ? clamp(valueScore, 0, 10) * valueWeight : 0) +
      clamp(queueScore, 0, 10) * queueWeight
    ) / totalWeight;

    return Math.round((weighted / 10) * 100);
  }

  function canBeDecisive({ valueScore, queueScore, valueKnown, config }) {
    const maxConfidence = computeConfidence(
      10,
      valueKnown ? valueScore : null,
      queueScore,
      config,
      { valueKnown }
    );
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
    const compiled = config._compiledRules || compileRules(config.rules || [], {
      sharedExclude: config.sharedExclude || []
    });
    const vetoRule = findVetoMatch(title, compiled);
    const { matches } = scanRuleMatches(title, compiled);
    const bestMatch = pickBestRule(matches, config);
    const rule = bestMatch?.rule ?? null;

    const queueScore = scoreQueue(queue, config);
    const { score: valueScore, tier: valueTier } = scoreValue(value, config);
    const valueKnown = value != null && !Number.isNaN(value);

    if (vetoRule) {
      const confidence = computeConfidence(0, valueScore, queueScore, config, { valueKnown });

      return {
        title,
        normalized: normalizeTitle(title),
        queue,
        value,
        valueKnown,
        valueTier,
        queueScore,
        valueScore,
        affinityScore: 0,
        affinitySource: 'veto',
        affinityReason: vetoRule.label || vetoRule.pattern,
        rule: {
          type: vetoRule.type,
          pattern: vetoRule.pattern,
          label: vetoRule.label,
          veto: true,
          matchedPattern: vetoRule.pattern
        },
        confidence,
        override: false,
        needsValue: false,
        belowAffinityFloor: true,
        wouldPick: false,
        canBeDecisive: false,
        thresholdPercent: config.thresholdPercent,
        veto: true
      };
    }

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
        confidence = computeConfidence(affinity.score, valueScore, queueScore, config, { valueKnown });
      } else if (config.mustPickValueCeiling && !valueKnown) {
        needsValue = true;
        confidence = computeConfidence(affinity.score, valueScore, queueScore, config, { valueKnown });
      } else {
        override = true;
        confidence = config.mustPickConfidenceFloor;
      }
    } else {
      confidence = computeConfidence(affinity.score, valueScore, queueScore, config, { valueKnown });
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
    const compiled = compileRules(options.rules || [], {
      sharedExclude: options.sharedExclude || config.sharedExclude || []
    });
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
      logs.push('Value: unknown → excluded from weighting (confidence normalized over affinity + queue)');
    }
    const vetoRule = findVetoMatch(options.title, compiled);
    const scorableRules = compiled.filter((rule) => !rule.veto);

    logs.push('');
    if (vetoRule) {
      logs.push(`VETO: [${vetoRule.type}] "${vetoRule.pattern}" (${vetoRule.label || 'accessory'})`);
      logs.push('  Printer consumables/accessories are always skipped regardless of brand match');
      logs.push('');
    }

    logs.push(`Rule scan (${scorableRules.length} rules, ${matches.length} match${matches.length === 1 ? '' : 'es'}):`);

    for (const rule of scorableRules) {
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

    if (result.affinitySource === 'veto') {
      logs.push(`Affinity source: veto (${result.affinityReason})`);
    } else if (bestMatch) {
      logs.push(`Affinity source: rule (${result.affinityReason})`);
    }

    logs.push('');
    logs.push(`Weights: affinity ${config.weights.affinity}, value ${config.weights.value}, queue ${config.weights.queue}`);
    if (!result.valueKnown) {
      logs.push(`Effective weights (value unknown): affinity ${config.weights.affinity}, queue ${config.weights.queue}`);
    }
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
    COMPAT_PREFIX_REGEX,
    hasNonCompatBrandOccurrence,
    normalizePattern,
    compileRules,
    normalizeTitle,
    findVetoMatch,
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

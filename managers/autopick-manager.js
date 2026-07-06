// Autopick Manager - Scores Vine items via JSON rules and optional Gemini LLM fallback
class AutopickManager extends BaseManager {
  constructor(config) {
    super(config);
    this.repository = window.vineItemsRepository;
    this.amazonDomain = window.location.hostname;
    this.rules = [];
    this.rulesLoaded = false;
    this.llmCache = new Map();
    this.scoringQueue = Promise.resolve();
    this.recentDecisions = [];
    this.config = this.getDefaultConfig();

    // Dedupe scoring work across the MutationObserver / scoreAllVisibleItems / evaluate triggers.
    this.scoredAsins = new Set();

    // Serial order pipeline (dry-run simulates; live awaits Rocket events).
    this.orderQueue = [];
    this.draining = false;
    this.rocket = null;

    // Persisted, day-scoped guardrail counters (loaded in setup()).
    this.runtime = { day: this.currentDay(), ordersToday: 0, lastOrderTs: 0, attemptedAsins: new Set(), llmCallsToday: 0 };
  }

  getDefaultConfig() {
    return {
      enabled: false,
      dryRun: true,
      thresholdPercent: 75,
      cooldownSeconds: 30,
      dailyCap: 5,
      globalValueCeiling: 1500,
      allowParentAutopick: false,
      unknownAffinityScore: 0,
      unknownValueScore: 0,
      unknownQueueScore: 5,
      mustPickConfidenceFloor: 100,
      mustPickValueCeiling: 1000,
      // Minimum affinity to be order-eligible: value+queue alone can never trigger an order.
      affinityFloor: 6,
      // Pillar weights — affinity dominates; queue is a constant per page so it barely discriminates.
      weights: {
        affinity: 0.60,
        value: 0.25,
        queue: 0.15
      },
      // Precision of the evidence by rule type: a brand hit is stronger than a generic keyword.
      typeWeights: {
        brand: 1.0,
        phrase: 0.95,
        regex: 0.9,
        keyword: 0.75
      },
      // Bonus per additional distinct rule label matched (multi-signal titles outrank coincidences).
      stackBonusPerLabel: 0.5,
      queueScores: {
        last_chance: 10,
        potluck: 9,
        encore: 7,
        search: 5,
        unknown: 5
      },
      // Piecewise-linear value curve (control points, interpolated). Replaces the old step tiers.
      valueCurve: [
        { value: 0, score: 1 },
        { value: 50, score: 4 },
        { value: 120, score: 10 },
        { value: 300, score: 10 },
        { value: 600, score: 8 },
        { value: 1000, score: 5 },
        { value: 1500, score: 2 }
      ],
      // Legacy step tiers — only used if valueCurve is absent/empty in a saved config.
      valueTiers: [
        { max: 50, score: 3 },
        { max: 300, score: 10 },
        { max: 1000, score: 7 },
        { max: Infinity, score: 2 }
      ],
      llm: {
        enabled: false,
        provider: 'gemini',
        model: 'gemini-2.0-flash',
        apiKey: '',
        preferencesPrompt: '',
        timeoutMs: 1200,
        dailyCallCap: 200
      }
    };
  }

  async setup() {
    if (!this.repository.isInitialized) {
      await this.repository.init();
    }

    await this.loadConfig();
    await this.loadRuntime();
    await this.loadRules();
    this.rocket = window.vineRocketManager || null;
    this.setupEventListeners();
    this.setupPageObserver();

    await this.waitForElement('#vvp-items-grid').catch(() => null);
    if (this.config.enabled) {
      this.scoreAllVisibleItems();
    }

    window.vineAutopickManager = this;
    console.log('[AutopickManager] Initialized', {
      rules: this.rules.length,
      enabled: this.config.enabled,
      llmEnabled: this.config.llm?.enabled
    });
  }

  setupEventListeners() {
    this.on('autopick:candidates', (data) => {
      if (this.config.enabled && data?.items?.length) {
        this.evaluate(data.items);
      }
    });

    this.on('autopick:configUpdated', (data) => {
      if (data?.config) {
        this.applyConfig(data.config);
      }
    });
  }

  setupPageObserver() {
    const grid = document.getElementById('vvp-items-grid');
    if (!grid) {
      return;
    }

    this.gridObserver = new MutationObserver((mutations) => {
      if (!this.config.enabled) {
        return;
      }

      const tiles = this.collectNewTilesFromMutations(mutations);
      if (tiles.length === 0) {
        return;
      }

      clearTimeout(this.processItemsTimeout);
      this.processItemsTimeout = setTimeout(() => {
        for (const tile of tiles) {
          this.scoreTile(tile);
        }
      }, 150);
    });

    this.gridObserver.observe(grid, { childList: true, subtree: false });
  }

  collectNewTilesFromMutations(mutations) {
    const seen = new Set();
    const out = [];

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) {
          continue;
        }

        if (node.classList?.contains('vvp-item-tile') && !seen.has(node)) {
          seen.add(node);
          out.push(node);
        }

        const nested = node.querySelectorAll?.('.vvp-item-tile');
        nested?.forEach((el) => {
          if (!seen.has(el)) {
            seen.add(el);
            out.push(el);
          }
        });
      }
    }

    return out;
  }

  async loadConfig() {
    try {
      const result = await chrome.storage.local.get(['vineAutopickConfig']);
      if (result.vineAutopickConfig) {
        this.config = this.mergeConfig(result.vineAutopickConfig);
      }
    } catch (error) {
      console.error('[AutopickManager] Failed to load config:', error);
    }
  }

  mergeConfig(partial) {
    const defaults = this.getDefaultConfig();
    return {
      ...defaults,
      ...partial,
      weights: { ...defaults.weights, ...(partial.weights || {}) },
      typeWeights: { ...defaults.typeWeights, ...(partial.typeWeights || {}) },
      queueScores: { ...defaults.queueScores, ...(partial.queueScores || {}) },
      valueCurve: (Array.isArray(partial.valueCurve) && partial.valueCurve.length > 0)
        ? partial.valueCurve
        : defaults.valueCurve,
      valueTiers: partial.valueTiers || defaults.valueTiers,
      llm: { ...defaults.llm, ...(partial.llm || {}) }
    };
  }

  async saveConfig() {
    try {
      await chrome.storage.local.set({ vineAutopickConfig: this.config });
    } catch (error) {
      console.error('[AutopickManager] Failed to save config:', error);
    }
  }

  applyConfig(partial) {
    this.config = this.mergeConfig(partial);
    if (this.config.enabled) {
      this.scoredAsins.clear();
      this.scoreAllVisibleItems();
    } else {
      this.clearAllScoreBadges();
    }
  }

  async loadRules() {
    try {
      const url = chrome.runtime.getURL('rules.json');
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const payload = await response.json();
      this.rules = this.compileRules(payload.rules || []);
      this.rulesLoaded = true;
      console.log(`[AutopickManager] Loaded ${this.rules.length} rules`);
    } catch (error) {
      console.error('[AutopickManager] Failed to load rules.json:', error);
      this.rules = [];
      this.rulesLoaded = false;
    }
  }

  escapeRegex(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // Word-boundary, whitespace-flexible phrase matcher — used for pattern lists (rule aliases
  // that aren't type:regex) and for requiresAny/exclude guards regardless of word count.
  compilePhraseRegex(pattern) {
    const parts = pattern.toLowerCase().trim().split(/\s+/).map((p) => this.escapeRegex(p));
    return new RegExp(`\\b${parts.join('\\s+')}\\b`, 'i');
  }

  compilePatternList(patterns) {
    if (!patterns || patterns.length === 0) {
      return null;
    }
    return patterns.map((pattern) => this.compilePhraseRegex(pattern));
  }

  compileRules(rawRules) {
    const compiled = rawRules.map((rule) => {
      const patterns = [rule.pattern, ...(rule.aliases || [])].filter(Boolean);
      let regexes;

      if (rule.type === 'regex') {
        regexes = patterns.map((pattern) => new RegExp(pattern, 'i'));
      } else if (rule.type === 'phrase') {
        regexes = patterns.map((pattern) => this.compilePhraseRegex(pattern));
      } else {
        regexes = patterns.map((pattern) => new RegExp(`\\b${this.escapeRegex(pattern)}\\b`, 'i'));
      }

      return {
        ...rule,
        regexes,
        // Guard clauses: requiresAny gates generic/mustPick rules on co-occurring evidence
        // (e.g. "filament" mustPick only fires alongside pla/petg/3d-printer words); exclude
        // vetoes known false-positive contexts (e.g. brand rules matching "compatible with X").
        requiresAnyRegexes: this.compilePatternList(rule.requiresAny),
        excludeRegexes: this.compilePatternList(rule.exclude)
      };
    });

    return compiled.sort((a, b) => {
      if (a.mustPick !== b.mustPick) {
        return a.mustPick ? -1 : 1;
      }
      return (b.score || 0) - (a.score || 0);
    });
  }

  // Precision weight of the rule's evidence type — a brand hit is stronger signal than a
  // generic keyword, so it should move the affinity score more.
  weightedRuleScore(rule) {
    const typeWeight = this.config.typeWeights?.[rule.type] ?? 1;
    return (rule.score || 0) * typeWeight;
  }

  // Returns every rule that matches title AND passes its requiresAny/exclude guards.
  matchAllRules(title) {
    if (!title || this.rules.length === 0) {
      return [];
    }

    const normalized = title.toLowerCase();
    const matched = [];

    for (const rule of this.rules) {
      const hit = rule.regexes.some((regex) => regex.test(normalized));
      if (!hit) {
        continue;
      }
      if (rule.excludeRegexes && rule.excludeRegexes.some((regex) => regex.test(normalized))) {
        continue;
      }
      if (rule.requiresAnyRegexes && !rule.requiresAnyRegexes.some((regex) => regex.test(normalized))) {
        continue;
      }
      matched.push(rule);
    }

    return matched;
  }

  selectBestRule(matches) {
    let best = null;

    for (const rule of matches) {
      if (
        !best ||
        rule.mustPick && !best.mustPick ||
        (rule.mustPick === best.mustPick && this.weightedRuleScore(rule) > this.weightedRuleScore(best))
      ) {
        best = rule;
      }
    }

    return best;
  }

  matchBestRule(title) {
    return this.selectBestRule(this.matchAllRules(title));
  }

  scoreQueue(queue) {
    const scores = this.config.queueScores || {};
    return scores[queue] ?? scores.unknown ?? this.config.unknownQueueScore;
  }

  scoreValueTier(value) {
    if (value == null || Number.isNaN(value)) {
      return this.config.unknownValueScore;
    }

    for (const tier of this.config.valueTiers || []) {
      if (value <= tier.max) {
        return tier.score;
      }
    }

    return this.config.unknownValueScore;
  }

  // Piecewise-linear interpolation over valueCurve control points — replaces the old step
  // tiers so two items a euro apart on either side of a boundary don't score 20+ points apart.
  interpolateValueCurve(value, curve) {
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

    return this.config.unknownValueScore;
  }

  scoreValue(value) {
    if (value == null || Number.isNaN(value)) {
      return this.config.unknownValueScore;
    }

    const curve = this.config.valueCurve;
    if (Array.isArray(curve) && curve.length > 0) {
      return this.interpolateValueCurve(value, curve);
    }

    return this.scoreValueTier(value);
  }

  clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  maxValueTierScore() {
    const tiers = this.config.valueTiers || [];
    return tiers.reduce((max, tier) => Math.max(max, tier.score || 0), 0);
  }

  maxValueScore() {
    const curve = this.config.valueCurve;
    if (Array.isArray(curve) && curve.length > 0) {
      return curve.reduce((max, point) => Math.max(max, point.score || 0), 0);
    }
    return this.maxValueTierScore();
  }

  // Weighted blend of the three pillars, 0-100. Affinity dominates by default (see
  // getDefaultConfig().weights) so a generic queue/value coincidence can no longer outvote
  // "this item has nothing to do with my interests".
  computeConfidence(affinityScore, valueScore, queueScore) {
    const weights = this.config.weights || { affinity: 1 / 3, value: 1 / 3, queue: 1 / 3 };
    const totalWeight = (weights.affinity || 0) + (weights.value || 0) + (weights.queue || 0);
    if (!totalWeight) {
      return 0;
    }

    const weighted = (
      this.clamp(affinityScore, 0, 10) * (weights.affinity || 0) +
      this.clamp(valueScore, 0, 10) * (weights.value || 0) +
      this.clamp(queueScore, 0, 10) * (weights.queue || 0)
    ) / totalWeight;

    return Math.round((weighted / 10) * 100);
  }

  canBeDecisive(ctx) {
    // When value is still unknown (unmatched items skip the fetch), assume the best-case value
    // score for the gate so "decisive-only" stays honest without starving the LLM fallback.
    const valueContribution = ctx.valueKnown ? ctx.valueScore : this.maxValueScore();
    const maxConfidence = this.computeConfidence(10, valueContribution, ctx.queueScore);
    return maxConfidence >= this.config.thresholdPercent;
  }

  normalizeTitle(title) {
    return (title || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  parsePriceText(text) {
    if (!text) {
      return null;
    }

    const match = String(text).match(/[\d.,]+/);
    if (!match) {
      return null;
    }

    let num = match[0];
    if (num.includes(',') && num.includes('.')) {
      num = num.replace(/\./g, '').replace(',', '.');
    } else if (num.includes(',')) {
      num = num.replace(',', '.');
    }

    const value = parseFloat(num);
    return Number.isFinite(value) ? value : null;
  }

  extractVisibleEtv(tile) {
    if (!tile) {
      return null;
    }

    const content = tile.querySelector('.vvp-item-tile-content');
    if (!content) {
      return null;
    }

    const etvElement = content.querySelector('.a-size-base.a-color-secondary') ||
      Array.from(content.querySelectorAll('span')).find((span) =>
        /€|\$|£|ETV|tax/i.test(span.textContent)
      );

    return this.parsePriceText(etvElement?.textContent);
  }

  async fetchItemValue(item) {
    if (!item.recommendationId || !item.asin) {
      return { value: null, valueSource: 'unknown' };
    }

    try {
      const response = await fetch(
        `https://${this.amazonDomain}/vine/api/recommendations/${encodeURIComponent(item.recommendationId)}/item/${item.asin}?imageSize=180`,
        { credentials: 'same-origin' }
      );

      if (!response.ok) {
        return { value: null, valueSource: 'detail-fetch-failed' };
      }

      const payload = await response.json();
      const result = payload?.result || payload || {};
      const taxValue = result.receiptData?.taxValue ||
        result.receiptData?.taxValueAmount?.amount ||
        result.taxValue ||
        result.etv;

      const value = typeof taxValue === 'number'
        ? taxValue
        : this.parsePriceText(taxValue?.amount ?? taxValue?.displayAmount ?? taxValue);

      return { value, valueSource: value != null ? 'detail-fetch' : 'unknown' };
    } catch (error) {
      console.warn('[AutopickManager] Value fetch failed:', error);
      return { value: null, valueSource: 'detail-fetch-failed' };
    }
  }

  async resolveValue(item, isRuleMatched) {
    if (item.price != null && !Number.isNaN(item.price)) {
      return { value: item.price, valueSource: item.priceSource || 'live' };
    }

    const visible = this.extractVisibleEtv(item.tileElement);
    if (visible != null) {
      return { value: visible, valueSource: 'tile-etv' };
    }

    if (isRuleMatched && item.recommendationId) {
      return this.fetchItemValue(item);
    }

    return { value: null, valueSource: 'unknown' };
  }

  sendMessageWithTimeout(message, timeoutMs) {
    return new Promise((resolve) => {
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          resolve({ ok: false, reason: 'timeout' });
        }
      }, timeoutMs);

      chrome.runtime.sendMessage(message, (response) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);

        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: chrome.runtime.lastError.message });
          return;
        }

        resolve(response || { ok: false, reason: 'empty-response' });
      });
    });
  }

  async scoreAffinityViaLlm(item) {
    const cacheKey = this.normalizeTitle(item.title);
    if (this.llmCache.has(cacheKey)) {
      return this.llmCache.get(cacheKey);
    }

    const llm = this.config.llm || {};

    await this.rolloverIfNeeded();
    if (llm.dailyCallCap && this.runtime.llmCallsToday >= llm.dailyCallCap) {
      return { ok: false, reason: 'llm-daily-cap' };
    }
    this.runtime.llmCallsToday += 1;
    this.saveRuntime();

    const response = await this.sendMessageWithTimeout(
      {
        action: 'autopickScoreAffinity',
        title: item.title,
        queue: item.queue,
        value: item.value ?? item.price ?? null
      },
      llm.timeoutMs || 1200
    );

    if (response.ok) {
      this.llmCache.set(cacheKey, response);
      if (this.llmCache.size > 500) {
        const firstKey = this.llmCache.keys().next().value;
        this.llmCache.delete(firstKey);
      }
    }

    return response;
  }

  async resolveAffinity(item, ctx) {
    const matches = ctx.matches || this.matchAllRules(item.title);
    const rule = ctx.rule || this.selectBestRule(matches);

    if (rule?.mustPick) {
      return {
        score: 10,
        source: 'rule',
        rule,
        override: true,
        reason: rule.label || rule.pattern
      };
    }

    if (rule) {
      // Multi-signal titles (e.g. "Creality 3D printer PLA filament" hits both a brand rule
      // and a 3D-printing keyword) outrank a single coincidental keyword match.
      const base = this.clamp(this.weightedRuleScore(rule), 0, 10);
      const distinctLabels = new Set(matches.map((m) => m.label || m.pattern)).size;
      const stackBonus = Math.max(0, distinctLabels - 1) * (this.config.stackBonusPerLabel || 0);

      return {
        score: this.clamp(base + stackBonus, 0, 10),
        source: 'rule',
        rule,
        override: false,
        reason: rule.label || rule.pattern
      };
    }

    const llm = this.config.llm || {};
    if (llm.enabled && this.canBeDecisive(ctx)) {
      const verdict = await this.scoreAffinityViaLlm(item);
      if (verdict.ok) {
        return {
          score: this.clamp(verdict.score, 0, 10),
          source: 'llm',
          rule: null,
          override: false,
          reason: verdict.reason || ''
        };
      }
    }

    return {
      score: this.config.unknownAffinityScore,
      source: 'unknown',
      rule: null,
      override: false,
      reason: ''
    };
  }

  // Pure scoring — produces the pillar breakdown plus override/needsValue flags.
  // The final decision (simulated/skipped/ordered/failed) is set later by decide()/drainOrderQueue().
  async scoreItem(item) {
    const queueScore = this.scoreQueue(item.queue);
    const matches = this.matchAllRules(item.title);
    const rule = this.selectBestRule(matches);
    let valueResult = await this.resolveValue(item, Boolean(rule));
    let valueScore = valueResult.value != null
      ? this.scoreValue(valueResult.value)
      : this.config.unknownValueScore;

    const affinity = await this.resolveAffinity(item, {
      valueScore,
      queueScore,
      valueKnown: valueResult.value != null,
      thresholdPercent: this.config.thresholdPercent,
      rule,
      matches
    });

    let override = false;
    let needsValue = false;
    let confidence;

    if (affinity.override) {
      // mustPick value-ceiling: a value above the ceiling cancels the override; an unobtainable
      // value (when a ceiling is set) means we cannot honor it → flag needs-value.
      if (valueResult.value == null && this.config.mustPickValueCeiling) {
        const fetched = await this.fetchItemValue(item);
        if (fetched.value != null) {
          valueResult = fetched;
          valueScore = this.scoreValue(fetched.value);
        }
      }

      if (
        this.config.mustPickValueCeiling &&
        valueResult.value != null &&
        valueResult.value > this.config.mustPickValueCeiling
      ) {
        override = false;
        confidence = this.computeConfidence(affinity.score, valueScore, queueScore);
      } else if (this.config.mustPickValueCeiling && valueResult.value == null) {
        needsValue = true;
        confidence = this.computeConfidence(affinity.score, valueScore, queueScore);
      } else {
        override = true;
        confidence = this.config.mustPickConfidenceFloor;
      }
    } else {
      confidence = this.computeConfidence(affinity.score, valueScore, queueScore);
    }

    return {
      scored: true,
      confidence,
      affinityScore: affinity.score,
      valueScore,
      queueScore,
      affinitySource: affinity.source,
      rule: affinity.rule ? {
        type: affinity.rule.type,
        pattern: affinity.rule.pattern,
        label: affinity.rule.label,
        mustPick: Boolean(affinity.rule.mustPick)
      } : null,
      llmReason: affinity.source === 'llm' ? affinity.reason : null,
      value: valueResult.value,
      valueSource: valueResult.valueSource,
      override,
      needsValue,
      decision: 'pending',
      reason: '',
      at: Date.now()
    };
  }

  recordDecision(item, scoreData) {
    const entry = {
      asin: item.asin,
      title: item.title || '',
      confidence: scoreData.confidence,
      affinitySource: scoreData.affinitySource,
      decision: scoreData.decision,
      reason: scoreData.reason,
      at: scoreData.at
    };

    this.recentDecisions.unshift(entry);
    if (this.recentDecisions.length > 50) {
      this.recentDecisions.length = 50;
    }

    this.emit('autopick:scored', { item, score: scoreData });
  }

  async persistScore(item, scoreData) {
    if (!item.asin) {
      return;
    }

    try {
      await this.repository.setAutopick(item.asin, scoreData);
    } catch (error) {
      console.warn('[AutopickManager] Failed to persist score:', error);
    }
  }

  getSourceLabel(source) {
    switch (source) {
      case 'rule':
        return 'Rules';
      case 'llm':
        return 'AI';
      default:
        return '—';
    }
  }

  // Fast rule-only score for notifications (no LLM, no value fetch).
  getQuickNotificationScore(item) {
    if (!this.rulesLoaded || !item?.title) {
      return null;
    }

    const matches = this.matchAllRules(item.title);
    const rule = this.selectBestRule(matches);
    if (!rule) {
      return null;
    }

    const queueScore = this.scoreQueue(item.queue);
    const valueScore = this.config.unknownValueScore;
    let affinityScore;
    let override = false;

    if (rule.mustPick) {
      affinityScore = 10;
      override = true;
    } else {
      const base = this.clamp(this.weightedRuleScore(rule), 0, 10);
      const distinctLabels = new Set(matches.map((m) => m.label || m.pattern)).size;
      const stackBonus = Math.max(0, distinctLabels - 1) * (this.config.stackBonusPerLabel || 0);
      affinityScore = this.clamp(base + stackBonus, 0, 10);
    }

    const confidence = override
      ? this.config.mustPickConfidenceFloor
      : this.computeConfidence(affinityScore, valueScore, queueScore);

    return {
      scored: true,
      affinityScore,
      confidence,
      affinitySource: 'rule',
      rule: {
        type: rule.type,
        pattern: rule.pattern,
        label: rule.label,
        mustPick: Boolean(rule.mustPick)
      }
    };
  }

  getScoreClass(confidence) {
    if (confidence >= 90) {
      return 'vine-autopick-high';
    }
    if (confidence >= 75) {
      return 'vine-autopick-mid';
    }
    if (confidence >= 50) {
      return 'vine-autopick-low';
    }
    return 'vine-autopick-min';
  }

  renderScoreBadge(tile, scoreData) {
    if (!tile || !scoreData) {
      return;
    }

    const content = tile.querySelector('.vvp-item-tile-content');
    if (!content) {
      return;
    }

    let badge = content.querySelector('.vine-autopick-score');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'vine-autopick-score';
      content.appendChild(badge);
    }

    badge.className = `vine-autopick-score ${this.getScoreClass(scoreData.confidence)} vine-autopick-source-${scoreData.affinitySource}`;
    badge.title = [
      `Confidence: ${scoreData.confidence}%`,
      `Affinity: ${scoreData.affinityScore}/10 (${this.getSourceLabel(scoreData.affinitySource)})`,
      `Value: ${scoreData.valueScore}/10`,
      `Queue: ${scoreData.queueScore}/10`,
      scoreData.rule ? `Rule: ${scoreData.rule.label || scoreData.rule.pattern}` : '',
      scoreData.llmReason ? `AI: ${scoreData.llmReason}` : ''
    ].filter(Boolean).join('\n');

    badge.innerHTML = `
      <span class="vine-autopick-confidence">${scoreData.confidence}%</span>
      <span class="vine-autopick-source">${this.getSourceLabel(scoreData.affinitySource)}</span>
    `;

    tile.dataset.vineAutopickConfidence = String(scoreData.confidence);
    tile.dataset.vineAutopickSource = scoreData.affinitySource;
  }

  clearScoreBadge(tile) {
    tile?.querySelector('.vine-autopick-score')?.remove();
    if (tile) {
      delete tile.dataset.vineAutopickConfidence;
      delete tile.dataset.vineAutopickSource;
    }
  }

  clearAllScoreBadges() {
    document.querySelectorAll('.vine-autopick-score').forEach((el) => el.remove());
  }

  extractItemFromTile(tile) {
    const input = tile.querySelector('.vvp-details-btn input[data-asin], input[data-asin]');
    if (!input?.dataset.asin) {
      return null;
    }

    const title = this.extractItemTitle(tile);
    const queueMatch = window.location.search.match(/[?&]queue=([^&]+)/);
    const queue = queueMatch?.[1] ||
      window.vinePageDetectionManager?.getCurrentQueue?.() ||
      'unknown';

    return {
      asin: input.dataset.asin,
      title,
      queue,
      recommendationId: input.dataset.recommendationId || tile.getAttribute('data-recommendation-id') || '',
      recommendationType: input.dataset.recommendationType || 'VINE_FOR_ALL',
      isParent: input.dataset.isParentAsin === 'true',
      price: this.extractVisibleEtv(tile),
      priceSource: 'tile-etv',
      tileElement: tile
    };
  }

  enqueueScore(task) {
    this.scoringQueue = this.scoringQueue
      .then(task)
      .catch((error) => console.error('[AutopickManager] Scoring error:', error));
    return this.scoringQueue;
  }

  async scoreTile(tile) {
    if (!this.config.enabled || !this.rulesLoaded) {
      return null;
    }

    return this.enqueueScore(async () => {
      const item = this.extractItemFromTile(tile);
      if (!item || this.scoredAsins.has(item.asin)) {
        return null;
      }

      this.scoredAsins.add(item.asin);
      const scoreData = await this.scoreItem(item);
      await this.processDecision(item, scoreData, tile);
      return scoreData;
    });
  }

  scoreAllVisibleItems() {
    if (!this.config.enabled || !this.rulesLoaded) {
      return;
    }

    document.querySelectorAll('.vvp-item-tile').forEach((tile) => {
      this.scoreTile(tile);
    });
  }

  async evaluate(items) {
    if (!this.config.enabled || !this.rulesLoaded || !Array.isArray(items)) {
      return;
    }

    for (const item of items) {
      if (!item.asin || this.scoredAsins.has(item.asin)) {
        continue;
      }

      this.scoredAsins.add(item.asin);
      await this.enqueueScore(async () => {
        const scoreData = await this.scoreItem(item);
        const tile = item.tileElement ||
          document.querySelector(`input[data-asin="${item.asin}"]`)?.closest('.vvp-item-tile') ||
          null;
        await this.processDecision(item, scoreData, tile);
      });
    }
  }

  // ---- Decision pipeline + guardrails -------------------------------------

  async processDecision(item, score, tile) {
    const verdict = this.decide(item, score);
    if (!verdict.eligible) {
      await this.finalize(item, score, tile, verdict.decision, verdict.reason);
      return;
    }

    this.enqueueOrder({ item, score, tile });
  }

  // Order-eligibility gates (override bypasses threshold but not the rest).
  decide(item, score) {
    if (score.needsValue) {
      return { eligible: false, decision: 'skipped', reason: 'needs-value' };
    }
    // Hard floor: no combination of value/queue can compensate for an item you're not
    // actually interested in. mustPick overrides bypass this by design.
    if (!score.override && score.affinityScore < this.config.affinityFloor) {
      return { eligible: false, decision: 'skipped', reason: 'low-affinity' };
    }
    if (!score.override && score.confidence < this.config.thresholdPercent) {
      return { eligible: false, decision: 'skipped', reason: 'below-threshold' };
    }
    if (item.asin && this.runtime.attemptedAsins.has(item.asin)) {
      return { eligible: false, decision: 'skipped', reason: 'duplicate' };
    }
    if (item.isParent && !this.config.allowParentAutopick) {
      return { eligible: false, decision: 'skipped', reason: 'parent-blocked' };
    }
    if (score.value != null && this.config.globalValueCeiling && score.value > this.config.globalValueCeiling) {
      return { eligible: false, decision: 'skipped', reason: 'value-ceiling' };
    }
    return { eligible: true };
  }

  enqueueOrder(job) {
    this.orderQueue.push(job);
    this.drainOrderQueue();
  }

  // Serial drain, highest-confidence first. Dry-run logs + credits counters; live awaits Rocket.
  async drainOrderQueue() {
    if (this.draining) {
      return;
    }

    this.draining = true;
    try {
      while (this.orderQueue.length) {
        this.orderQueue.sort((a, b) => (b.score.confidence || 0) - (a.score.confidence || 0));
        const job = this.orderQueue.shift();
        await this.processOrderJob(job);
      }
    } finally {
      this.draining = false;
    }
  }

  async processOrderJob(job) {
    const { item, score, tile } = job;
    await this.rolloverIfNeeded();

    if (this.runtime.ordersToday >= this.config.dailyCap) {
      await this.finalize(item, score, tile, 'skipped', 'daily-cap');
      return;
    }

    const cooldownMs = (this.config.cooldownSeconds || 0) * 1000;
    if (this.runtime.lastOrderTs && (Date.now() - this.runtime.lastOrderTs) < cooldownMs) {
      await this.finalize(item, score, tile, 'skipped', 'cooldown');
      return;
    }

    const rocket = this.getRocketManager();
    if (rocket?.isOrdering) {
      await this.finalize(item, score, tile, 'skipped', 'single-flight');
      return;
    }

    if (this.config.dryRun) {
      this.creditOrder(item);
      await this.finalize(item, score, tile, 'simulated', 'dry-run');
      return;
    }

    // Live ordering (default off) — requires master-enabled + session-armed.
    if (!this.isArmed()) {
      await this.finalize(item, score, tile, 'skipped', 'not-armed');
      return;
    }
    if (!rocket) {
      await this.finalize(item, score, tile, 'failed', 'no-rocket-manager');
      return;
    }

    this.runtime.attemptedAsins.add(item.asin);
    await this.saveRuntime();

    const result = await this.placeOrderAndAwait(item);
    if (result.ok) {
      this.creditOrder(item);
      await this.finalize(item, score, tile, 'ordered', 'placed');
    } else {
      await this.finalize(item, score, tile, 'failed', result.reason || 'order-failed');
    }
  }

  async finalize(item, score, tile, decision, reason) {
    score.decision = decision;
    score.reason = reason;

    if (tile) {
      this.renderScoreBadge(tile, score);
    }

    await this.persistScore(item, score);
    this.recordDecision(item, score);
    this.logDecision(item, score);
  }

  logDecision(item, score) {
    const breakdown = `${score.affinityScore}/${score.valueScore}/${score.queueScore}`;
    const valueText = score.value != null ? score.value : 'unknown';
    const title = (item.title || '').slice(0, 80);
    const base = `asin=${item.asin} "${title}" conf=${score.confidence}% (aff/val/queue ${breakdown}) src=${score.affinitySource} value=${valueText}`;

    if (score.decision === 'simulated') {
      console.log(`[Autopick] WOULD ORDER ${base}`);
    } else if (score.decision === 'ordered') {
      console.log(`[Autopick] ORDERED ${base}`);
    } else if (score.decision === 'failed') {
      console.warn(`[Autopick] FAILED ${base} reason=${score.reason}`);
    } else {
      console.log(`[Autopick] SKIP ${score.reason} ${base}`);
    }
  }

  placeOrderAndAwait(item) {
    return new Promise((resolve) => {
      const rocket = this.getRocketManager();
      let done = false;

      const finish = (result) => {
        if (done) {
          return;
        }
        done = true;
        clearTimeout(timer);
        this.off('rocketOrderSuccess', onSuccess);
        this.off('rocketOrderError', onError);
        resolve(result);
      };

      const onSuccess = (data) => {
        if (!data || data.asin === item.asin) {
          finish({ ok: true });
        }
      };
      const onError = (data) => {
        if (!data || data.asin === item.asin) {
          finish({ ok: false, reason: data?.reason || 'order-error' });
        }
      };

      const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), this.config.orderTimeoutMs || 60000);
      this.on('rocketOrderSuccess', onSuccess);
      this.on('rocketOrderError', onError);

      Promise.resolve(rocket.placeOrder(item, { source: 'autopick' }))
        .then((submitted) => {
          if (submitted === false) {
            finish({ ok: false, reason: 'not-submitted' });
          }
        })
        .catch((error) => finish({ ok: false, reason: error?.message || 'placeOrder-threw' }));
    });
  }

  getRocketManager() {
    if (!this.rocket) {
      this.rocket = window.vineRocketManager || null;
    }
    return this.rocket;
  }

  creditOrder(item) {
    this.runtime.ordersToday += 1;
    this.runtime.lastOrderTs = Date.now();
    if (item.asin) {
      this.runtime.attemptedAsins.add(item.asin);
    }
    this.saveRuntime();
  }

  // ---- Persisted day-scoped runtime ---------------------------------------

  currentDay() {
    return new Date().toDateString();
  }

  async loadRuntime() {
    try {
      const result = await chrome.storage.local.get(['vineAutopickRuntime']);
      const saved = result.vineAutopickRuntime;
      if (saved) {
        this.runtime = {
          day: saved.day || this.currentDay(),
          ordersToday: saved.ordersToday || 0,
          lastOrderTs: saved.lastOrderTs || 0,
          attemptedAsins: new Set(saved.attemptedAsins || []),
          llmCallsToday: saved.llmCallsToday || 0
        };
      }
      await this.rolloverIfNeeded();
    } catch (error) {
      console.error('[AutopickManager] Failed to load runtime:', error);
    }
  }

  async saveRuntime() {
    try {
      await chrome.storage.local.set({
        vineAutopickRuntime: {
          day: this.runtime.day,
          ordersToday: this.runtime.ordersToday,
          lastOrderTs: this.runtime.lastOrderTs,
          attemptedAsins: Array.from(this.runtime.attemptedAsins),
          llmCallsToday: this.runtime.llmCallsToday
        }
      });
    } catch (error) {
      console.warn('[AutopickManager] Failed to save runtime:', error);
    }
  }

  async rolloverIfNeeded() {
    const today = this.currentDay();
    if (this.runtime.day !== today) {
      this.runtime.day = today;
      this.runtime.ordersToday = 0;
      this.runtime.llmCallsToday = 0;
      // attemptedAsins intentionally persists across days.
      await this.saveRuntime();
    }
  }

  // ---- Arming / kill-switch (gate live ordering only) ----------------------

  arm() {
    try {
      sessionStorage.setItem('vineAutopickArmed', 'true');
    } catch (error) {
      // sessionStorage unavailable — leave disarmed.
    }
    console.log('[Autopick] Armed for this session');
  }

  disarm() {
    try {
      sessionStorage.removeItem('vineAutopickArmed');
    } catch (error) {
      // ignore
    }
    console.log('[Autopick] Disarmed');
  }

  isArmed() {
    try {
      return sessionStorage.getItem('vineAutopickArmed') === 'true';
    } catch (error) {
      return false;
    }
  }

  kill() {
    this.orderQueue = [];
    this.disarm();
    console.warn('[Autopick] Kill-switch: order queue flushed, disarmed');
  }

  async debugScore(title, queue = 'encore', value = null) {
    const item = { asin: 'DEBUG', title, queue, price: value, priceSource: value != null ? 'debug' : 'unknown' };
    const score = await this.scoreItem(item);
    console.log('[AutopickManager] debugScore:', score);
    return score;
  }

  getRecentDecisions() {
    return [...this.recentDecisions];
  }

  getConfiguration() {
    return JSON.parse(JSON.stringify(this.config));
  }

  async updateConfiguration(partial) {
    this.config = this.mergeConfig(partial);
    await this.saveConfig();

    if (this.config.enabled) {
      this.llmCache.clear();
      this.scoredAsins.clear();
      this.scoreAllVisibleItems();
    } else {
      this.clearAllScoreBadges();
    }
  }

  cleanup() {
    super.cleanup();

    this.orderQueue = [];

    if (this.gridObserver) {
      this.gridObserver.disconnect();
    }

    if (this.processItemsTimeout) {
      clearTimeout(this.processItemsTimeout);
    }
  }
}

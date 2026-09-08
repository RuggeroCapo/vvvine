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
    const scoring = window.AutopickScoringCore.mergeConfig({});
    return {
      ...scoring,
      enabled: false,
      // liveOrdering === true means real orders are placed (rocket triggered).
      // dryRun is kept as its mirror so older code/configs keep working.
      liveOrdering: false,
      dryRun: true,
      cooldownSeconds: 30,
      dailyCap: 5,
      globalValueCeiling: 1500,
      allowParentAutopick: false,
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
      mode: this.config.liveOrdering ? 'LIVE (real orders)' : 'dry-run (would-pick)',
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
    const merged = {
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

    // Single source of truth: liveOrdering. Legacy configs only carried dryRun.
    merged.liveOrdering = partial.liveOrdering !== undefined
      ? partial.liveOrdering === true
      : partial.dryRun === false;
    merged.dryRun = !merged.liveOrdering;

    return merged;
  }

  async saveConfig() {
    try {
      await chrome.storage.local.set({ vineAutopickConfig: this.config });
    } catch (error) {
      console.error('[AutopickManager] Failed to save config:', error);
    }
  }

  applyConfig(partial) {
    const wasLive = this.config.enabled && this.config.liveOrdering;
    this.config = this.mergeConfig(partial);
    this.announceModeChange(wasLive);
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
      this.rules = window.AutopickScoringCore.compileRules(payload.rules || [], {
        sharedExclude: payload.sharedExclude || []
      });
      this.rulesLoaded = true;
      console.log(`[AutopickManager] Loaded ${this.rules.length} rules`);
    } catch (error) {
      console.error('[AutopickManager] Failed to load rules.json:', error);
      this.rules = [];
      this.rulesLoaded = false;
    }
  }

  // Transient view of the config for the core. Compiled rules are attached here and only here:
  // this.config is persisted to chrome.storage and must never contain RegExp objects.
  getScoringConfig() {
    return { ...this.config, _compiledRules: this.rules };
  }

  parsePriceText(text) {
    // Careful: a real ETV of 0 (typical for Amazon-brand items) is falsy but valid,
    // so only null/undefined/'' count as "no value".
    if (text == null || text === '') {
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
      // First *present* candidate, not first truthy one: `||` would discard a legitimate ETV of 0.
      const taxValue = [
        result.receiptData?.taxValue,
        result.receiptData?.taxValueAmount?.amount,
        result.taxValue,
        result.etv
      ].find((candidate) => candidate != null && candidate !== '');

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
    const cacheKey = window.AutopickScoringCore.normalizeTitle(item.title);
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

  // Pure scoring — produces the pillar breakdown plus override/needsValue flags.
  // The final decision (simulated/skipped/ordered/failed) is set later by decide()/drainOrderQueue().
  async scoreItem(item) {
    const core = window.AutopickScoringCore;
    const config = this.getScoringConfig();
    const scoreWith = (value, llmAffinity = null) => core.computeScore({
      title: item.title,
      queue: item.queue,
      value,
      config,
      llmAffinity
    });

    // 1. Rule-only pass: a non-veto rule match is what justifies the cost of a detail fetch.
    const preliminary = scoreWith(null);
    const ruleMatched = preliminary.affinitySource === 'rule';

    // 2. Value: live price → tile ETV → detail fetch (rule-matched only) → unknown.
    let valueResult = await this.resolveValue(item, ruleMatched);
    let llmAffinity = null;
    let result = scoreWith(valueResult.value);

    // 3. LLM fallback only when rules said nothing and the gate says it could matter.
    if (result.affinitySource === 'unknown' && this.config.llm?.enabled && result.canBeDecisive) {
      const verdict = await this.scoreAffinityViaLlm(item);
      if (verdict.ok) {
        llmAffinity = { score: verdict.score, reason: verdict.reason || '' };
        result = scoreWith(valueResult.value, llmAffinity);
      }
    }

    // 4. mustPick with a value ceiling but no value: one more fetch attempt (unchanged behaviour).
    if (result.needsValue && valueResult.value == null) {
      const fetched = await this.fetchItemValue(item);
      if (fetched.value != null) {
        valueResult = fetched;
        result = scoreWith(fetched.value, llmAffinity);
      }
    }

    return {
      scored: true,
      confidence: result.confidence,
      affinityScore: result.affinityScore,
      valueScore: result.valueScore,
      queueScore: result.queueScore,
      affinitySource: result.affinitySource,
      rule: result.rule ? {
        type: result.rule.type,
        pattern: result.rule.pattern,
        label: result.rule.label,
        mustPick: Boolean(result.rule.mustPick)
      } : null,
      llmReason: result.affinitySource === 'llm' ? result.affinityReason : null,
      value: valueResult.value,
      valueSource: valueResult.valueSource,
      override: result.override,
      needsValue: result.needsValue,
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
      case 'veto':
        return 'Veto';
      default:
        return 'None';
    }
  }

  getPickVerdict(scoreData) {
    if (scoreData.override) {
      return { label: 'MUST PICK', className: 'vine-autopick-verdict-must' };
    }
    if (scoreData.confidence >= this.config.thresholdPercent) {
      return { label: 'PICK', className: 'vine-autopick-verdict-pick' };
    }
    return { label: 'SKIP', className: 'vine-autopick-verdict-skip' };
  }

  // Fast rule-only score for notifications (no LLM, no value fetch). Uses a value only if the item
  // already carries one; otherwise confidence is normalized over affinity + queue.
  getQuickNotificationScore(item) {
    if (!this.rulesLoaded || !item?.title) {
      return null;
    }

    const rawValue = item.price ?? item.value ?? null;
    const value = rawValue != null && !Number.isNaN(Number(rawValue)) ? Number(rawValue) : null;
    const result = window.AutopickScoringCore.computeScore({
      title: item.title,
      queue: item.queue,
      value,
      config: this.getScoringConfig()
    });

    if (result.affinitySource !== 'rule' && result.affinitySource !== 'veto') {
      return null;
    }

    // Keep today's notification semantics: a mustPick rule shows as 100%.
    const confidence = result.rule?.mustPick && result.affinitySource === 'rule'
      ? this.config.mustPickConfidenceFloor
      : result.confidence;

    return {
      scored: true,
      affinityScore: result.affinityScore,
      confidence,
      affinitySource: result.affinitySource,
      rule: result.rule ? {
        type: result.rule.type,
        pattern: result.rule.pattern,
        label: result.rule.label,
        mustPick: Boolean(result.rule.mustPick)
      } : null
    };
  }

  formatScoreDisplay(value) {
    if (value == null || Number.isNaN(Number(value))) {
      return '—';
    }
    const n = Number(value);
    if (Number.isInteger(n) || Math.abs(n - Math.round(n)) < 0.05) {
      return String(Math.round(n));
    }
    return n.toFixed(1);
  }

  escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  buildScoreTooltipHtml(scoreData, verdict, threshold) {
    const affinity = this.formatScoreDisplay(scoreData.affinityScore);
    const value = this.formatScoreDisplay(scoreData.valueScore);
    const queue = this.formatScoreDisplay(scoreData.queueScore);
    const confidence = this.formatScoreDisplay(scoreData.confidence);
    const valueLine = scoreData.value != null
      ? ` (${this.formatScoreDisplay(scoreData.value)} €)`
      : '';

    const rows = [
      ['Pick score', `${confidence}% (need ${threshold}%)`],
      ['Verdict', verdict.label],
      ['Affinity', `${affinity}/10 · ${this.getSourceLabel(scoreData.affinitySource)}`],
      ['Value', `${value}/10${valueLine}`],
      ['Queue', `${queue}/10`]
    ];

    if (scoreData.rule?.label || scoreData.rule?.pattern) {
      rows.push(['Matched rule', scoreData.rule.label || scoreData.rule.pattern]);
    }
    if (scoreData.llmReason) {
      rows.push(['AI reason', scoreData.llmReason]);
    }

    return rows.map(([label, detail]) => `
      <div class="vine-autopick-tooltip-row">
        <span class="vine-autopick-tooltip-label">${label}</span>
        <span class="vine-autopick-tooltip-value">${this.escapeHtml(detail)}</span>
      </div>
    `).join('');
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

  syncTileToolbarButtons(tile) {
    const slot = tile?.querySelector('.vine-autopick-actions');
    if (!slot) {
      return;
    }

    const rocket = tile.querySelector('.vine-rocket-btn');
    const seen = tile.querySelector('.vine-mark-seen');
    if (rocket && rocket.parentElement !== slot) {
      slot.appendChild(rocket);
    }
    if (seen && seen.parentElement !== slot) {
      slot.appendChild(seen);
    }
  }

  getTileActionHost(tile) {
    return tile?.querySelector('.vine-autopick-actions') ||
      tile?.querySelector('.vvp-item-tile-content');
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
      content.prepend(badge);
    }

    const verdict = this.getPickVerdict(scoreData);
    const threshold = this.config.thresholdPercent;
    const fillWidth = Math.max(0, Math.min(100, scoreData.confidence));
    const thresholdLeft = Math.max(0, Math.min(100, threshold));

    badge.className = `vine-autopick-score ${this.getScoreClass(scoreData.confidence)} vine-autopick-source-${scoreData.affinitySource}`;
    badge.innerHTML = `
      <div class="vine-autopick-score-row">
        <button type="button" class="vine-autopick-score-trigger" aria-label="Pick score ${this.formatScoreDisplay(scoreData.confidence)} percent, ${verdict.label}. Hover for breakdown.">
          <span class="vine-autopick-confidence">${this.formatScoreDisplay(scoreData.confidence)}</span>
          <span class="vine-autopick-pct">%</span>
          <span class="vine-autopick-verdict ${verdict.className}">${verdict.label}</span>
        </button>
        <div class="vine-autopick-meter" aria-hidden="true">
          <div class="vine-autopick-meter-fill" style="width:${fillWidth}%"></div>
          <div class="vine-autopick-meter-threshold" style="left:${thresholdLeft}%"></div>
        </div>
        <div class="vine-autopick-actions"></div>
      </div>
      <div class="vine-autopick-tooltip" role="tooltip">
        ${this.buildScoreTooltipHtml(scoreData, verdict, threshold)}
      </div>
    `;

    this.syncTileToolbarButtons(tile);

    tile.classList.add('vine-has-autopick-score');
    tile.dataset.vineAutopickConfidence = String(scoreData.confidence);
    tile.dataset.vineAutopickSource = scoreData.affinitySource;
    tile.dataset.vineAutopickVerdict = verdict.label;
  }

  clearScoreBadge(tile) {
    tile?.querySelector('.vine-autopick-score')?.remove();
    if (tile) {
      tile.classList.remove('vine-has-autopick-score');
      delete tile.dataset.vineAutopickConfidence;
      delete tile.dataset.vineAutopickSource;
      delete tile.dataset.vineAutopickVerdict;
    }
  }

  clearAllScoreBadges() {
    document.querySelectorAll('.vine-autopick-score').forEach((el) => {
      const tile = el.closest('.vvp-item-tile');
      el.remove();
      if (tile) {
        tile.classList.remove('vine-has-autopick-score');
        delete tile.dataset.vineAutopickConfidence;
        delete tile.dataset.vineAutopickSource;
        delete tile.dataset.vineAutopickVerdict;
      }
    });
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
    // Never order blind: the global value ceiling cannot be enforced without a value.
    if (!score.override && score.value == null && this.config.globalValueCeiling) {
      return { eligible: false, decision: 'skipped', reason: 'needs-value' };
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

    if (!this.config.liveOrdering) {
      this.creditOrder(item);
      await this.finalize(item, score, tile, 'simulated', 'dry-run');
      return;
    }

    // Live ordering (default off) — enabled from the popup, still killable per session.
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

    const result = await this.placeOrderAndAwait(item, tile);
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

  placeOrderAndAwait(item, tile = null) {
    return new Promise((resolve) => {
      const rocket = this.getRocketManager();
      // Drive the very same path as a manual rocket click, reusing the tile's
      // button (when rendered) so the user sees the pending state on the item.
      const button = tile?.querySelector?.('.vine-rocket-btn') || item.tileElement?.querySelector?.('.vine-rocket-btn') || null;
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

      Promise.resolve(rocket.placeOrder(item, { source: 'autopick', button }))
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
  //
  // Live ordering is armed by the popup toggle (config.liveOrdering). arm()/kill()
  // stay available from the console as a per-session override: the session kill
  // flag always wins over the persisted config so ordering can be stopped instantly.

  sessionFlag(key, value) {
    try {
      if (value === undefined) {
        return sessionStorage.getItem(key);
      }
      if (value === null) {
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, value);
      }
      return value;
    } catch (error) {
      // sessionStorage unavailable — treat as unset.
      return null;
    }
  }

  arm() {
    this.sessionFlag('vineAutopickKilled', null);
    this.sessionFlag('vineAutopickArmed', 'true');
    console.log('[Autopick] Armed for this session');
  }

  disarm() {
    this.sessionFlag('vineAutopickArmed', null);
    this.sessionFlag('vineAutopickKilled', 'true');
    console.log('[Autopick] Disarmed for this session (config live toggle overridden)');
  }

  isArmed() {
    if (this.sessionFlag('vineAutopickKilled') === 'true') {
      return false;
    }
    if (this.config.liveOrdering) {
      return true;
    }
    return this.sessionFlag('vineAutopickArmed') === 'true';
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

  // True when a qualifying item will actually trigger the rocket order.
  isLive() {
    return Boolean(this.config.enabled && this.config.liveOrdering && this.isArmed());
  }

  // Surface live/dry-run transitions so the mode is never a silent surprise.
  announceModeChange(wasLive) {
    const isLive = this.config.enabled && this.config.liveOrdering;
    if (isLive === wasLive) {
      return;
    }

    // A fresh live-ordering opt-in clears any earlier session kill-switch.
    if (isLive) {
      this.sessionFlag('vineAutopickKilled', null);
    }

    const message = isLive
      ? '🚀 Autopick LIVE: qualifying items will be ordered automatically'
      : 'Autopick back to dry-run (would-pick only)';
    console.warn(`[Autopick] ${message}`);
    this.getRocketManager()?.showToast?.(message, isLive ? 'warning' : 'success', 6000);
  }

  getConfiguration() {
    return JSON.parse(JSON.stringify(this.config));
  }

  async updateConfiguration(partial) {
    const wasLive = this.config.enabled && this.config.liveOrdering;
    this.config = this.mergeConfig(partial);
    this.announceModeChange(wasLive);
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

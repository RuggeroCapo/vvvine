// Monitoring Manager - Monitors for new items and sends notifications
// Uses ItemsRepository for data persistence
// Uses in-page fetch to check queues without navigation
// Live monitoring connects to a self-hosted Server-Sent Events (SSE) stream.
// Source: ../socket-monitor/web/app/api/live/route.ts (emits item_added,
// item_value_updated and collector_status events).
window.VINE_DEFAULT_LIVE_URL = window.VINE_DEFAULT_LIVE_URL
  || 'https://ita-vine-stats.duckdns.org/api/live';

class MonitoringManager extends BaseManager {
  constructor(config) {
    super(config);
    this.repository = window.vineItemsRepository;
    this.isMonitoring = false;
    this.notificationProvider = null;
    this.newItemsManager = null;
    this.pageDetectionManager = null;
    this.monitoringTimer = null;
    this.eventSource = null;
    this.liveReconnectTimer = null;

    // Configuration
    this.config = {
      queues: ['potluck', 'encore', 'last_chance'],  // Which queues to monitor
      searchQuery: '',                                // Search query (only for search mode)
      refreshIntervalSeconds: 300,                    // How often to check (default: 5 min)
      transportMode: 'polling',                       // polling | live
      liveUrl: window.VINE_DEFAULT_LIVE_URL           // SSE endpoint for live mode
    };

    // Base URL for Amazon Vine (detect from current page)
    this.baseUrl = this.detectBaseUrl();
  }

  detectBaseUrl() {
    // Extract base URL from current page (supports different Amazon domains)
    const match = window.location.href.match(/(https:\/\/www\.amazon\.[^/]+)/);
    return match ? `${match[1]}/vine/vine-items` : 'https://www.amazon.it/vine/vine-items';
  }

  setNotificationProvider(provider) {
    this.notificationProvider = provider;
  }

  setNewItemsManager(manager) {
    this.newItemsManager = manager;
  }

  setPageDetectionManager(manager) {
    this.pageDetectionManager = manager;
  }

  async setup() {
    console.log('[MonitoringManager] setup() called');

    // Initialize repository if not already initialized
    if (!this.repository.isInitialized) {
      console.log('[MonitoringManager] Initializing repository...');
      await this.repository.init();
    }

    await this.loadConfiguration();
    this.setupEventListeners();
    await this.loadMonitoringState();

    // Add diagnostic function to window for debugging
    window.vineMonitoringDiagnostics = () => {
      console.log('=== Vine Monitoring Diagnostics ===');
      console.log('Is Monitoring:', this.isMonitoring);
      console.log('Config:', this.config);
      console.log('Notification Provider:', this.notificationProvider ? 'Set' : 'NOT SET');
      console.log('New Items Manager:', this.newItemsManager ? 'Set' : 'NOT SET');
      console.log('Page Detection Manager:', this.pageDetectionManager ? 'Set' : 'NOT SET');
      console.log('Timer Active:', this.monitoringTimer ? 'Yes' : 'No');
      console.log('Repository Initialized:', this.repository?.isInitialized);
      console.log('Event Listeners:', window.vineEventBus?.events.has('startMonitoring') ?
        `${window.vineEventBus.events.get('startMonitoring').length} listener(s)` : 'None');
      console.log('===================================');
      return {
        isMonitoring: this.isMonitoring,
        config: this.config,
        hasNotificationProvider: !!this.notificationProvider,
        hasNewItemsManager: !!this.newItemsManager,
        hasTimer: !!this.monitoringTimer,
        repositoryInitialized: this.repository?.isInitialized
      };
    };

    console.log('[MonitoringManager] setup() complete. Run vineMonitoringDiagnostics() in console for status.');
  }

  async loadConfiguration() {
    try {
      // Use sessionStorage for per-tab independent monitoring config
      const configStr = sessionStorage.getItem('vineMonitoringConfig');
      if (configStr) {
        let config = JSON.parse(configStr);

        // Migrate old single-queue format to new multi-queue format
        if (config.queue && !config.queues) {
          config.queues = [config.queue];
          delete config.queue;
          sessionStorage.setItem('vineMonitoringConfig', JSON.stringify(config));
        }

        // Default to all three queues if not specified
        if (!config.queues || config.queues.length === 0) {
          config.queues = ['potluck', 'encore', 'last_chance'];
          sessionStorage.setItem('vineMonitoringConfig', JSON.stringify(config));
        }

        // Migrate the deprecated 'socket' transport to the new SSE 'live' mode
        if (config.transportMode === 'socket') {
          config.transportMode = 'live';
          sessionStorage.setItem('vineMonitoringConfig', JSON.stringify(config));
        }

        if (!config.transportMode || !['polling', 'live'].includes(config.transportMode)) {
          config.transportMode = 'polling';
          sessionStorage.setItem('vineMonitoringConfig', JSON.stringify(config));
        }

        // Migrate the deprecated socketUrl field and drop stale v-helper URLs
        if (typeof config.liveUrl !== 'string' || !config.liveUrl) {
          config.liveUrl = window.VINE_DEFAULT_LIVE_URL;
          delete config.socketUrl;
          sessionStorage.setItem('vineMonitoringConfig', JSON.stringify(config));
        }

        this.config = { ...this.config, ...config };
      }
    } catch (error) {
      console.error('MonitoringManager: Error loading configuration:', error);
    }
  }

  async saveConfiguration() {
    try {
      // Use sessionStorage for per-tab independent monitoring config
      sessionStorage.setItem('vineMonitoringConfig', JSON.stringify(this.config));
    } catch (error) {
      console.error('MonitoringManager: Error saving configuration:', error);
    }
  }

  setupEventListeners() {
    console.log('[MonitoringManager] Setting up event listeners');
    this.on('startMonitoring', (config) => {
      console.log('[MonitoringManager] Received startMonitoring event');
      this.startMonitoring(config);
    });
    this.on('stopMonitoring', () => {
      console.log('[MonitoringManager] Received stopMonitoring event');
      this.stopMonitoring();
    });
    this.on('manualRefresh', () => {
      console.log('[MonitoringManager] Received manualRefresh event');
      this.performManualRefresh();
    });
  }

  async loadMonitoringState() {
    // Use sessionStorage for per-tab independent monitoring state
    const monitoringEnabled = sessionStorage.getItem('vineMonitoringEnabled');
    this.isMonitoring = monitoringEnabled === 'true';

    if (this.isMonitoring) {
      // Emit event for UI update
      this.emit('monitoringStateChanged', { isMonitoring: true, config: this.config });
      if (this.isLiveMode()) {
        console.log('[MonitoringManager] Resuming live monitoring...');
        this.startLiveConnection();
      } else {
        // Start the timer to resume monitoring
        this.startMonitoringTimer();

        // Perform initial check on page load
        console.log('[MonitoringManager] Resuming monitoring, performing initial check...');
        await this.checkAllQueues();
      }
    } else {
      // Emit event for UI to show correct initial state
      this.emit('monitoringStateChanged', { isMonitoring: false, config: this.config });
    }
  }

  async startMonitoring(config = null) {
    console.log('[MonitoringManager] startMonitoring called with config:', config);

    if (this.isMonitoring) {
      console.log('[MonitoringManager] Already monitoring, ignoring start request');
      return;
    }

    // Update config if provided
    if (config) {
      console.log('[MonitoringManager] Updating config:', config);
      this.config = { ...this.config, ...config };
      await this.saveConfiguration();
    }

    // Validate dependencies
    if (!this.notificationProvider) {
      console.error('[MonitoringManager] Cannot start - notification provider not set');
      alert('Cannot start monitoring: Notification provider not configured. Please check your notification settings.');
      return;
    }

    if (!this.newItemsManager) {
      console.error('[MonitoringManager] Cannot start - new items manager not set');
      alert('Cannot start monitoring: New items manager not initialized. Please refresh the page.');
      return;
    }

    if (this.isLiveMode() && !this.config.liveUrl) {
      console.error('[MonitoringManager] Cannot start live monitoring without a live URL');
      alert('Cannot start live monitoring: live stream URL is missing.');
      return;
    }

    console.log('[MonitoringManager] All dependencies validated, starting monitoring...');
    this.isMonitoring = true;
    // Use sessionStorage for per-tab independent monitoring state
    sessionStorage.setItem('vineMonitoringEnabled', 'true');
    console.log('[MonitoringManager] Emitting monitoringStateChanged event');
    this.emit('monitoringStateChanged', { isMonitoring: true, config: this.config });

    // Send start notification
    const queueLabel = this.getQueueLabel();
    const monitoringModeLabel = this.getMonitoringModeLabel();
    console.log('[MonitoringManager] Sending start notification for:', queueLabel);
    try {
      await this.sendNotification({
        title: 'Vine Monitoring Started',
        message: this.isLiveMode()
          ? `Monitoring ${queueLabel} via ${monitoringModeLabel}`
          : `Monitoring ${queueLabel} via ${monitoringModeLabel} every ${this.config.refreshIntervalSeconds}s`,
        priority: 'low',
        tags: ['vine', 'monitoring', 'start']
      });
      console.log('[MonitoringManager] Start notification sent successfully');
    } catch (error) {
      console.error('[MonitoringManager] Failed to send start notification:', error);
    }

    if (this.isLiveMode()) {
      console.log('[MonitoringManager] Starting live monitoring...');
      this.startLiveConnection();
    } else {
      // Start in-page monitoring timer
      console.log('[MonitoringManager] Starting monitoring timer...');
      this.startMonitoringTimer();

      // Do an immediate check
      console.log('[MonitoringManager] Starting immediate check...');
      try {
        await this.checkAllQueues();
        console.log('[MonitoringManager] Immediate check completed');
      } catch (error) {
        console.error('[MonitoringManager] Error during immediate check:', error);
      }
    }
  }

  async stopMonitoring() {
    console.log('[MonitoringManager] stopMonitoring called');

    if (!this.isMonitoring) {
      console.log('[MonitoringManager] Not currently monitoring, ignoring stop request');
      return;
    }

    console.log('[MonitoringManager] Stopping monitoring...');
    this.isMonitoring = false;
    // Use sessionStorage for per-tab independent monitoring state
    sessionStorage.setItem('vineMonitoringEnabled', 'false');
    console.log('[MonitoringManager] Emitting monitoringStateChanged event');
    this.emit('monitoringStateChanged', { isMonitoring: false, config: this.config });

    // Stop the monitoring timer
    console.log('[MonitoringManager] Stopping monitoring timer...');
    this.stopMonitoringTimer();
    this.disconnectLive();

    console.log('[MonitoringManager] Monitoring stopped successfully');
  }

  startMonitoringTimer() {
    // Clear any existing timer
    this.stopMonitoringTimer();

    // Add ±10% random variation to interval
    const baseMs = this.config.refreshIntervalSeconds * 1000;
    const variation = 0.1;
    const randomizedMs = baseMs * (1 + (Math.random() * 2 - 1) * variation);

    console.log(`[MonitoringManager] Starting timer: ${Math.round(randomizedMs / 1000)}s (base: ${this.config.refreshIntervalSeconds}s)`);

    this.monitoringTimer = setInterval(() => {
      console.log('[MonitoringManager] Timer triggered, checking all queues...');
      this.checkAllQueues();
    }, randomizedMs);
  }

  stopMonitoringTimer() {
    if (this.monitoringTimer) {
      clearInterval(this.monitoringTimer);
      this.monitoringTimer = null;
      console.log('[MonitoringManager] Timer stopped');
    }
  }

  isLiveMode() {
    return this.config.transportMode === 'live';
  }

  getMonitoringModeLabel() {
    return this.isLiveMode() ? 'live stream' : 'polling';
  }

  async performManualRefresh() {
    console.log('[MonitoringManager] Manual refresh triggered');
    try {
      await this.checkAllQueues(true);
    } finally {
      this.emit('manualRefreshComplete');
    }
  }

  // Check all configured queues using fetch (no navigation)
  async checkAllQueues(force = false) {
    if (!this.isMonitoring && !force) {
      return;
    }

    console.log('[MonitoringManager] ========== checkAllQueues START ==========');
    console.log('[MonitoringManager] Queues to check:', this.config.queues);

    const queuesChecked = [];

    // Check all queues in parallel for speed
    const checkPromises = this.config.queues.map(async (queue) => {
      try {
        const queueUrl = this.getQueueUrlForQueue(queue);
        if (!queueUrl) {
          console.warn(`[MonitoringManager] No URL for queue ${queue}, skipping`);
          return { queue, items: [], error: null };
        }

        console.log(`[MonitoringManager] Fetching ${queue}: ${queueUrl}`);
        const html = await this.fetchQueueHtml(queueUrl);
        const items = this.parseItemsFromHtml(html, queue);
        console.log(`[MonitoringManager] Parsed ${items.length} items from ${queue}`);

        return { queue, items, error: null };
      } catch (error) {
        console.error(`[MonitoringManager] Error checking queue ${queue}:`, error);
        return { queue, items: [], error };
      }
    });

    const results = await Promise.all(checkPromises);

    const discoveredItems = [];

    // Process results and find new items
    for (const result of results) {
      if (result.error) continue;

      queuesChecked.push(result.queue);
      discoveredItems.push(...result.items.map(item => ({ ...item, queue: result.queue })));
    }

    const { newItems } = await this.processDetectedItems(discoveredItems, queuesChecked);

    console.log('[MonitoringManager] Total new items found:', newItems.length);
    console.log('[MonitoringManager] Queues checked:', queuesChecked);

    console.log('[MonitoringManager] ========== checkAllQueues END ==========');

    return { newItems, queuesChecked };
  }

  async processDetectedItems(items, queuesChecked = []) {
    if (!Array.isArray(items) || items.length === 0) {
      return { newItems: [], queuesChecked };
    }

    const allNewItems = [];
    const uniqueQueues = new Set((queuesChecked || []).filter(Boolean));
    let hasRepositoryChanges = false;

    for (const item of items) {
      if (!item?.asin) {
        continue;
      }

      const currentTime = Date.now();
      const itemQueue = item.queue || 'unknown';
      uniqueQueues.add(itemQueue);

      const existingDoc = this.repository.get(item.asin);

      if (!existingDoc) {
        const newDoc = {
          asin: item.asin,
          title: item.title || '',
          imageUrl: item.imageUrl || '',
          url: item.url || '',
          firstSeenOn: currentTime,
          lastSeenOn: currentTime,
          seen: true,
          hidden: false,
          notified: false,
          queue: itemQueue
        };

        this.repository.items.set(item.asin, newDoc);
        hasRepositoryChanges = true;
        allNewItems.push(this.buildAutopickCandidate(newDoc, item, itemQueue));
        continue;
      }

      let existingDocChanged = false;

      if (existingDoc.lastSeenOn !== currentTime) {
        existingDoc.lastSeenOn = currentTime;
        existingDocChanged = true;
      }
      if (existingDoc.seen !== true) {
        existingDoc.seen = true;
        existingDocChanged = true;
      }
      if (itemQueue && existingDoc.queue !== itemQueue) {
        existingDoc.queue = itemQueue;
        existingDocChanged = true;
      }
      if (item.title && existingDoc.title !== item.title) {
        existingDoc.title = item.title;
        existingDocChanged = true;
      }
      if (item.imageUrl && existingDoc.imageUrl !== item.imageUrl) {
        existingDoc.imageUrl = item.imageUrl;
        existingDocChanged = true;
      }
      if (item.url && existingDoc.url !== item.url) {
        existingDoc.url = item.url;
        existingDocChanged = true;
      }

      if (existingDocChanged) {
        hasRepositoryChanges = true;
      }

      if (!existingDoc.notified && !existingDoc.hidden) {
        allNewItems.push(this.buildAutopickCandidate(existingDoc, item, itemQueue));
      }
    }

    if (allNewItems.length > 0) {
      for (const item of allNewItems) {
        const doc = this.repository.get(item.asin);
        if (doc && !doc.notified) {
          doc.notified = true;
          hasRepositoryChanges = true;
        }
      }
    }

    if (hasRepositoryChanges) {
      await this.repository.save();
    }

    if (allNewItems.length > 0) {
      this.injectNewItemTiles(allNewItems);
      await this.notifyAboutNewItemsMultiQueue(allNewItems, Array.from(uniqueQueues));
      this.emit('autopick:candidates', { items: allNewItems });
    }

    return { newItems: allNewItems, queuesChecked: Array.from(uniqueQueues) };
  }

  buildAutopickCandidate(doc, item, itemQueue) {
    return {
      ...doc,
      queue: itemQueue,
      tileElement: item.tileElement,
      source: item.source || 'polling',
      reason: item.reason || '',
      price: item.price ?? null,
      priceSource: item.priceSource || null,
      recommendationId: item.recommendationId || '',
      recommendationType: item.recommendationType || '',
      isParent: Boolean(item.isParent || item.isParentAsin)
    };
  }

  parseTileEtv(tile) {
    const content = tile?.querySelector('.vvp-item-tile-content');
    if (!content) {
      return null;
    }

    const etvElement = content.querySelector('.a-size-base.a-color-secondary') ||
      Array.from(content.querySelectorAll('span')).find((span) =>
        /€|\$|£|ETV|tax/i.test(span.textContent)
      );

    if (!etvElement) {
      return null;
    }

    const match = etvElement.textContent.match(/[\d.,]+/);
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

  // Fetch HTML from a queue URL
  async fetchQueueHtml(url) {
    const response = await fetch(url, {
      credentials: 'include', // Include cookies for authentication
      headers: {
        'Accept': 'text/html'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return await response.text();
  }

  // Parse items from HTML string using DOMParser
  // Returns both item data and the raw tile DOM elements for injection
  parseItemsFromHtml(html, queue) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const items = [];
    const itemTiles = doc.querySelectorAll('.vvp-item-tile');

    for (const tile of itemTiles) {
      // Extract ASIN from input element
      const asinInput = tile.querySelector('input[data-asin]');
      const asin = asinInput?.getAttribute('data-asin');

      if (!asin) {
        continue;
      }

      // Extract title
      const titleElement = tile.querySelector('.vvp-item-product-title-container a');
      const title = titleElement?.textContent?.trim() || '';

      // Extract URL (make absolute if relative)
      let url = titleElement?.getAttribute('href') || '';
      if (url && !url.startsWith('http')) {
        const baseMatch = this.baseUrl.match(/(https:\/\/www\.amazon\.[^/]+)/);
        if (baseMatch) {
          url = baseMatch[1] + url;
        }
      }

      // Fix relative URLs in the tile element for injection
      if (titleElement && !titleElement.getAttribute('href')?.startsWith('http')) {
        const baseMatch = this.baseUrl.match(/(https:\/\/www\.amazon\.[^/]+)/);
        if (baseMatch) {
          titleElement.setAttribute('href', baseMatch[1] + titleElement.getAttribute('href'));
        }
      }

      // Extract image URL
      const imageUrl = tile.querySelector('img')?.getAttribute('src') || '';

      const recommendationId = asinInput?.getAttribute('data-recommendation-id') ||
        tile.getAttribute('data-recommendation-id') || '';
      const recommendationType = asinInput?.getAttribute('data-recommendation-type') || 'VINE_FOR_ALL';
      const isParent = asinInput?.getAttribute('data-is-parent-asin') === 'true';
      const price = this.parseTileEtv(tile);

      items.push({
        asin,
        title,
        url,
        imageUrl,
        queue,
        recommendationId,
        recommendationType,
        isParent,
        price,
        priceSource: price != null ? 'tile-etv' : null,
        tileElement: tile  // Keep reference to the parsed tile DOM element
      });
    }

    return items;
  }

  // Inject new item tiles into the current page's grid without refreshing
  injectNewItemTiles(newItems) {
    const grid = document.getElementById('vvp-items-grid');
    if (!grid) {
      console.log('[MonitoringManager] No grid found on page, cannot inject items');
      return;
    }

    let injectedCount = 0;

    for (const item of newItems) {
      // Skip if item is already on the page
      const existingTile = grid.querySelector(`input[data-asin="${item.asin}"]`);
      if (existingTile) {
        continue;
      }

      const sourceTile = item.tileElement || this.createTileElementFromItem(item);
      if (!sourceTile) {
        continue;
      }

      // Import the tile node into the current document and prepend to grid
      const importedTile = document.importNode(sourceTile, true);
      this.prepareInjectedTile(importedTile, item);
      grid.prepend(importedTile);
      this.processInjectedTile(importedTile);
      injectedCount++;
    }

    if (injectedCount > 0) {
      console.log(`[MonitoringManager] Injected ${injectedCount} new item tiles into the page`);
    }
  }

  prepareInjectedTile(tile, item) {
    if (!tile) {
      return;
    }

    tile.classList.add('vine-new-item');
    tile.dataset.vineLiveInjected = item?.source === 'live' ? 'true' : 'false';

    if (item?.source === 'live') {
      this.decorateLiveTile(tile, item);
    }
  }

  decorateLiveTile(tile, item) {
    const content = tile.querySelector('.vvp-item-tile-content');
    if (!content) {
      return;
    }

    const existingBadge = content.querySelector('.vine-new-item-badge');
    if (existingBadge) {
      existingBadge.remove();
    }

    const badge = document.createElement('div');
    badge.className = 'vine-new-item-badge';
    badge.textContent = 'LIVE';
    badge.title = 'Injected from live monitoring stream';
    content.appendChild(badge);

    const existingMeta = content.querySelector('.vine-live-meta');
    if (existingMeta) {
      existingMeta.remove();
    }

    const meta = document.createElement('div');
    meta.className = 'vine-live-meta';

    const sourceChip = document.createElement('span');
    sourceChip.className = 'vine-live-chip vine-live-chip-source';
    sourceChip.textContent = 'Live';
    meta.appendChild(sourceChip);

    if (item?.queue) {
      const queueChip = document.createElement('span');
      queueChip.className = 'vine-live-chip vine-live-chip-queue';
      queueChip.textContent = this.getQueueLabelFromValue(item.queue);
      meta.appendChild(queueChip);
    }

    if (item?.reason) {
      const reasonChip = document.createElement('span');
      reasonChip.className = 'vine-live-chip vine-live-chip-reason';
      reasonChip.textContent = item.reason;
      meta.appendChild(reasonChip);
    }

    const titleContainer = content.querySelector('.vvp-item-product-title-container');
    if (titleContainer) {
      titleContainer.before(meta);
    } else {
      content.appendChild(meta);
    }
  }

  processInjectedTile(tile) {
    const enhancer = window.vineEnhancer;
    if (!enhancer?.getManager) {
      return;
    }

    const seenItemsManager = enhancer.getManager('seenItems');
    if (seenItemsManager?.processItem && !tile.hasAttribute('data-vine-processed')) {
      seenItemsManager.processItem(tile);
    }

    const bookmarkManager = enhancer.getManager('bookmarks');
    if (bookmarkManager?.processItem && !tile.hasAttribute('data-vine-bookmark-processed')) {
      bookmarkManager.processItem(tile);
    }

    const rocketManager = enhancer.getManager('rocket');
    if (rocketManager?.processItem && !tile.hasAttribute('data-vine-rocket-processed')) {
      rocketManager.processItem(tile);
    }

    const autopickManager = enhancer.getManager('autopick');
    if (autopickManager?.scoreTile) {
      autopickManager.scoreTile(tile);
    }
  }

  parseLivePrice(rawItem) {
    const raw = rawItem.item_value ?? rawItem.itemValue ?? rawItem.value ?? rawItem.price;
    if (raw == null) {
      return null;
    }

    if (typeof raw === 'number' && Number.isFinite(raw)) {
      return raw;
    }

    if (typeof raw === 'object') {
      const amount = raw.amount ?? raw.displayAmount ?? raw.value;
      const parsed = parseFloat(String(amount).replace(/[^\d.,]/g, '').replace(',', '.'));
      return Number.isFinite(parsed) ? parsed : null;
    }

    const parsed = parseFloat(String(raw).replace(/[^\d.,]/g, '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  createTileElementFromItem(item) {
    if (!item?.asin) {
      return null;
    }

    const tile = document.createElement('div');
    tile.className = 'vvp-item-tile vine-new-item';
    tile.dataset.vineLiveInjected = 'true';
    if (item.recommendationId) {
      tile.dataset.recommendationId = item.recommendationId;
    }
    if (item.imageUrl) {
      tile.dataset.imgUrl = item.imageUrl;
    }

    const content = document.createElement('div');
    content.className = 'vvp-item-tile-content';

    const itemBadges = document.createElement('div');
    itemBadges.className = 'vvp-item-badges';
    content.appendChild(itemBadges);

    const asinInput = document.createElement('input');
    asinInput.type = 'hidden';
    asinInput.setAttribute('data-asin', item.asin);
    content.appendChild(asinInput);

    const badge = document.createElement('div');
    badge.className = 'vine-new-item-badge';
    badge.textContent = 'LIVE';
    badge.title = 'Injected from live monitoring stream';
    content.appendChild(badge);

    if (item.imageUrl) {
      const image = document.createElement('img');
      image.src = item.imageUrl;
      image.alt = item.title || item.asin;
      image.loading = 'lazy';
      content.appendChild(image);
    }

    const meta = document.createElement('div');
    meta.className = 'vine-live-meta';

    const sourceChip = document.createElement('span');
    sourceChip.className = 'vine-live-chip vine-live-chip-source';
    sourceChip.textContent = 'Live';
    meta.appendChild(sourceChip);

    if (item.queue) {
      const queueChip = document.createElement('span');
      queueChip.className = 'vine-live-chip vine-live-chip-queue';
      queueChip.textContent = this.getQueueLabelFromValue(item.queue);
      meta.appendChild(queueChip);
    }

    if (item.reason) {
      const reasonChip = document.createElement('span');
      reasonChip.className = 'vine-live-chip vine-live-chip-reason';
      reasonChip.textContent = item.reason;
      meta.appendChild(reasonChip);
    }

    content.appendChild(meta);

    const titleContainer = document.createElement('div');
    titleContainer.className = 'vvp-item-product-title-container';

    const titleLink = document.createElement('a');
    titleLink.className = 'a-link-normal';
    titleLink.target = '_blank';
    titleLink.rel = 'noopener';
    titleLink.href = item.url || this.buildProductUrl(item.asin);

    const truncate = document.createElement('span');
    truncate.className = 'a-truncate';

    const titleFull = document.createElement('span');
    titleFull.className = 'a-truncate-full';
    titleFull.textContent = item.title || item.asin;

    const titleCut = document.createElement('span');
    titleCut.className = 'a-truncate-cut';
    titleCut.textContent = item.title || item.asin;

    truncate.appendChild(titleFull);
    truncate.appendChild(titleCut);
    titleLink.appendChild(truncate);
    titleContainer.appendChild(titleLink);
    content.appendChild(titleContainer);

    const detailsButton = this.createDetailsButton(item);
    if (detailsButton) {
      content.appendChild(detailsButton);
    }

    tile.appendChild(content);

    return tile;
  }

  buildProductUrl(asin) {
    const baseMatch = this.baseUrl.match(/(https:\/\/www\.amazon\.[^/]+)/);
    const origin = baseMatch ? baseMatch[1] : window.location.origin;
    return `${origin}/dp/${asin}`;
  }

  createDetailsButton(item) {
    if (!item?.asin || !item.recommendationId) {
      return null;
    }

    const outer = document.createElement('span');
    outer.className = 'a-button a-button-primary vvp-details-btn';

    const inner = document.createElement('span');
    inner.className = 'a-button-inner';

    const input = document.createElement('input');
    input.className = 'a-button-input';
    input.type = 'submit';
    input.dataset.asin = item.asin;
    input.dataset.isParentAsin = item.isParentAsin ? 'true' : 'false';
    input.dataset.isPreRelease = item.isPreRelease ? 'true' : 'false';
    input.dataset.recommendationId = item.recommendationId;
    input.dataset.recommendationType = item.recommendationType || 'VINE_FOR_ALL';

    const text = document.createElement('span');
    text.className = 'a-button-text';
    text.setAttribute('aria-hidden', 'true');
    text.textContent = 'Visualizza dettagli';

    inner.appendChild(input);
    inner.appendChild(text);
    outer.appendChild(inner);

    return outer;
  }

  getVvpContext() {
    try {
      const stateScript = document.querySelector('script[data-a-state*="vvp-context"]');
      if (!stateScript?.textContent) {
        return null;
      }

      return JSON.parse(stateScript.textContent.trim());
    } catch (error) {
      console.warn('[MonitoringManager] Failed to parse vvp-context:', error);
      return null;
    }
  }

  inferRecommendationType(item) {
    if (item?.recommendationType) {
      return item.recommendationType;
    }

    switch (item?.queue) {
      case 'potluck':
        return 'VENDOR_TARGETED';
      case 'search':
        return 'SEARCH';
      case 'encore':
      case 'last_chance':
      default:
        return 'VINE_FOR_ALL';
    }
  }

  buildRecommendationId(item) {
    if (item?.recommendationId || !item?.asin || !item?.enrollmentGuid) {
      return item?.recommendationId || '';
    }

    const context = this.getVvpContext();
    const marketplaceId = context?.marketplaceId || '';
    if (!marketplaceId) {
      return '';
    }

    const parts = [marketplaceId, item.asin];

    if (this.inferRecommendationType(item) === 'VENDOR_TARGETED' && context?.customerId) {
      parts.push(context.customerId);
    }

    parts.push(`vine.enrollment.${item.enrollmentGuid}`);
    return parts.join('#');
  }

  shouldMonitorQueue(queue) {
    if (!queue) {
      return true;
    }

    if (!Array.isArray(this.config.queues) || this.config.queues.length === 0) {
      return true;
    }

    return this.config.queues.includes(queue);
  }

  startLiveConnection() {
    if (!this.isMonitoring || !this.isLiveMode()) {
      return;
    }

    if (this.eventSource
      && (this.eventSource.readyState === EventSource.OPEN
        || this.eventSource.readyState === EventSource.CONNECTING)) {
      return;
    }

    const liveUrl = (this.config.liveUrl || '').trim();
    if (!liveUrl) {
      this.emitLiveState('error', { message: 'Live stream URL is empty' });
      return;
    }

    this.clearLiveReconnectTimer();
    this.emitLiveState('connecting');

    try {
      // EventSource handles reconnection on transient drops automatically, but
      // we also schedule our own backoff for hard errors below.
      const source = new EventSource(liveUrl, { withCredentials: false });
      this.eventSource = source;

      source.addEventListener('open', () => {
        if (this.eventSource !== source) {
          return;
        }
        console.log('[MonitoringManager] Live stream connected');
        this.emitLiveState('connected');
      });

      source.addEventListener('message', async (event) => {
        if (this.eventSource !== source) {
          return;
        }
        await this.handleLiveMessage(event.data);
      });

      source.addEventListener('error', () => {
        if (this.eventSource !== source) {
          return;
        }

        // EventSource auto-reconnects while readyState is CONNECTING; only treat
        // a fully CLOSED stream as a hard failure that needs our own retry.
        if (source.readyState === EventSource.CLOSED) {
          console.warn('[MonitoringManager] Live stream closed, scheduling reconnect');
          this.eventSource = null;
          if (this.isMonitoring && this.isLiveMode()) {
            this.emitLiveState('reconnecting', { message: 'Live stream closed' });
            this.scheduleLiveReconnect();
          } else {
            this.emitLiveState('disconnected');
          }
        } else {
          this.emitLiveState('reconnecting', { message: 'Live stream interrupted' });
        }
      });
    } catch (error) {
      console.error('[MonitoringManager] Failed to open live stream:', error);
      this.emitLiveState('error', { message: error.message });
      this.scheduleLiveReconnect();
    }
  }

  disconnectLive() {
    this.clearLiveReconnectTimer();

    if (this.eventSource) {
      try {
        this.eventSource.close();
      } catch (error) {
        console.warn('[MonitoringManager] Failed to close live stream cleanly:', error);
      }
      this.eventSource = null;
    }

    this.emitLiveState(this.isLiveMode() ? 'disconnected' : 'hidden');
  }

  scheduleLiveReconnect() {
    if (!this.isMonitoring || !this.isLiveMode()) {
      return;
    }

    this.clearLiveReconnectTimer();
    this.liveReconnectTimer = setTimeout(() => {
      this.liveReconnectTimer = null;
      this.startLiveConnection();
    }, 5000);
  }

  clearLiveReconnectTimer() {
    if (this.liveReconnectTimer) {
      clearTimeout(this.liveReconnectTimer);
      this.liveReconnectTimer = null;
    }
  }

  emitLiveState(state, extra = {}) {
    this.emit('monitoringLiveStateChanged', { state, ...extra });
  }

  async handleLiveMessage(data) {
    if (typeof data !== 'string' || !data.trim()) {
      return;
    }

    let event;
    try {
      event = JSON.parse(data);
    } catch (error) {
      console.error('[MonitoringManager] Failed to parse live event payload:', error, data);
      return;
    }

    // The SSE stream emits a discriminated union of events; we only inject new
    // items. Value updates and collector status are ignored for now.
    if (!event || event.t !== 'item_added') {
      return;
    }

    await this.handleLiveItemAdded(event);
  }

  async handleLiveItemAdded(event) {
    const item = this.normalizeLiveItem(event);
    if (!item) {
      return;
    }

    if (!this.shouldMonitorQueue(item.queue)) {
      console.log('[MonitoringManager] Ignoring live item for non-monitored queue:', item.queue);
      return;
    }

    const { newItems } = await this.processDetectedItems([item], [item.queue]);
    if (newItems.length > 0) {
      console.log('[MonitoringManager] Processed live new item:', item.asin);
    }
  }

  // Maps an `item_added` SSE event (see ../socket-monitor/web/lib/live-bus.ts)
  // onto the internal item shape used by processDetectedItems.
  normalizeLiveItem(event) {
    const asin = event.a || event.asin;
    if (!asin) {
      return null;
    }

    const normalizedItem = {
      asin,
      title: event.title || '',
      imageUrl: event.image_url || event.imageUrl || '',
      url: this.buildProductUrl(asin),
      queue: event.queue || 'unknown',
      reason: '',
      enrollmentGuid: '',
      isParentAsin: false,
      isPreRelease: false,
      recommendationType: '',
      recommendationId: '',
      currency: event.currency || null,
      source: 'live'
    };

    const livePrice = this.parseLivePrice(event);
    normalizedItem.price = livePrice;
    normalizedItem.priceSource = livePrice != null ? 'live' : null;

    normalizedItem.recommendationType = this.inferRecommendationType(normalizedItem);
    normalizedItem.recommendationId = this.buildRecommendationId(normalizedItem);

    return normalizedItem;
  }

  // Get URL for a specific queue
  getQueueUrlForQueue(queue) {
    switch (queue) {
      case 'potluck':
        return `${this.baseUrl}?queue=potluck`;
      case 'encore':
        return `${this.baseUrl}?queue=encore`;
      case 'last_chance':
        return `${this.baseUrl}?queue=last_chance`;
      case 'search':
        if (this.config.searchQuery) {
          return `${this.baseUrl}?search=${encodeURIComponent(this.config.searchQuery)}`;
        }
        return null;
      default:
        return null;
    }
  }

  async checkForNewItems() {
    if (!this.isMonitoring) {
      return;
    }

    try {
      // Wait for grid to be available
      const grid = document.getElementById('vvp-items-grid');
      if (!grid) {
        return;
      }

      // Get all items on the page
      const items = grid.querySelectorAll('.vvp-item-tile');

      // Find new items to notify about
      // New items are: seen=true, notified=false, hidden=false
      const newItems = this.repository.getNewItems();

      if (newItems.length > 0) {
        // Mark all as notified before sending notification
        for (const doc of newItems) {
          await this.repository.setNotified(doc.asin, true);
        }

        // Send notifications
        await this.notifyAboutNewItems(newItems);
      }
    } catch (error) {
      console.error('MonitoringManager: Error checking for new items:', error);
    }
  }

  // Scan current page for new items without navigation (used by background script)
  async scanForNewItems() {
    console.log('[MonitoringManager] Scanning current page for new items');

    try {
      // Wait for grid to be available
      const grid = document.getElementById('vvp-items-grid');
      if (!grid) {
        console.log('[MonitoringManager] No grid found on page');
        return [];
      }

      // Get all items on the page
      const items = grid.querySelectorAll('.vvp-item-tile');
      console.log(`[MonitoringManager] Found ${items.length} items on page`);

      // Find new items to notify about
      // New items are: seen=true, notified=false, hidden=false
      const newItems = this.repository.getNewItems();
      console.log(`[MonitoringManager] Found ${newItems.length} new items`);

      if (newItems.length > 0) {
        // Mark all as notified before returning
        for (const doc of newItems) {
          await this.repository.setNotified(doc.asin, true);
        }
        console.log('[MonitoringManager] Marked all new items as notified');
      }

      return newItems;
    } catch (error) {
      console.error('MonitoringManager: Error scanning for new items:', error);
      throw error;
    }
  }

  // Play a beep sound notification
  playBeepSound() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Configure beep sound
      oscillator.frequency.value = 800; // Frequency in Hz (higher = higher pitch)
      oscillator.type = 'sine'; // Sine wave for a clean beep

      // Volume envelope (fade in/out to avoid clicks)
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.01); // Fade in
      gainNode.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.15); // Hold
      gainNode.gain.linearRampToValueAtTime(0, audioContext.currentTime + 0.2); // Fade out

      // Play the beep
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.2); // 200ms beep

      console.log('[MonitoringManager] Beep sound played');
    } catch (error) {
      console.error('[MonitoringManager] Error playing beep sound:', error);
    }
  }

  cleanNotificationTitle(title) {
    const cleaned = (title || 'Unknown item').replace(/…+$/g, '').trim();
    return cleaned || 'Unknown item';
  }

  getNotificationItemUrl(item) {
    if (item?.url) {
      return item.url;
    }
    if (item?.asin) {
      return this.buildProductUrl(item.asin);
    }
    return window.location.href;
  }

  formatNotificationItemBlock(item, index) {
    const asin = item.asin || '—';
    const title = this.cleanNotificationTitle(item.title);
    const url = this.getNotificationItemUrl(item);
    return `${index + 1}. ${asin}\n${title}\n${url}`;
  }

  buildNotificationItemsBody(items, options = {}) {
    const { itemsByQueue = null } = options;

    if (itemsByQueue) {
      let body = '';
      let itemIndex = 0;

      for (const queue of Object.keys(itemsByQueue)) {
        const queueItems = itemsByQueue[queue];
        const queueLabel = this.getQueueLabelFromValue(queue);
        body += `\n${queueLabel} (${queueItems.length}):\n`;

        for (const item of queueItems) {
          body += `${this.formatNotificationItemBlock(item, itemIndex)}\n\n`;
          itemIndex++;
        }
      }

      return body.trimEnd();
    }

    return items
      .map((item, index) => this.formatNotificationItemBlock(item, index))
      .join('\n\n');
  }

  groupItemsByQueue(items) {
    const itemsByQueue = {};
    for (const item of items) {
      const queue = item.queue || 'unknown';
      if (!itemsByQueue[queue]) {
        itemsByQueue[queue] = [];
      }
      itemsByQueue[queue].push(item);
    }
    return itemsByQueue;
  }

  // Send aggregated notification for multi-queue check
  async notifyAboutNewItemsMultiQueue(items, queuesChecked) {
    if (!items || items.length === 0) return;

    try {
      // Play beep sound for new items
      this.playBeepSound();
      const itemsByQueue = this.groupItemsByQueue(items);
      const queuesLabel = queuesChecked.map(q => this.getQueueLabelFromValue(q)).join(', ');
      const summary = `Found across ${queuesChecked.length} queue${queuesChecked.length > 1 ? 's' : ''}: ${queuesLabel}`;
      const itemsBody = this.buildNotificationItemsBody(items, { itemsByQueue });

      await this.sendNotification({
        title: `${items.length} New Vine Item${items.length > 1 ? 's' : ''}!`,
        message: `${summary}\n\n${itemsBody}`,
        items,
        itemsByQueue,
        priority: 'high',
        tags: ['vine', 'new-items', 'multi-queue'],
        url: window.location.href
      });

      this.emit('newItemsNotified', { count: items.length, items, queuesChecked });

    } catch (error) {
      console.error('MonitoringManager: Error sending multi-queue notification:', error);
    }
  }

  // Helper to get queue label from value
  getQueueLabelFromValue(queue) {
    switch (queue) {
      case 'potluck':
        return 'Potluck';
      case 'encore':
        return 'Encore';
      case 'last_chance':
        return 'Last Chance';
      case 'search':
        return 'Search';
      default:
        return queue || 'Unknown';
    }
  }

  async notifyAboutNewItems(items) {
    if (!items || items.length === 0) return;

    try {
      // Play beep sound for new items
      this.playBeepSound();
      const queueLabel = this.getQueueLabel();
      const itemsBody = this.buildNotificationItemsBody(items);

      await this.sendNotification({
        title: `${items.length} New Vine Item${items.length > 1 ? 's' : ''} on ${queueLabel}!`,
        message: itemsBody,
        items,
        priority: 'high',
        tags: ['vine', 'new-items'],
        url: window.location.href
      });

      this.emit('newItemsNotified', { count: items.length, items });

    } catch (error) {
      console.error('MonitoringManager: Error sending notifications:', error);
    }
  }

  async sendNotification(notification) {
    console.log('[MonitoringManager] sendNotification called:', notification);

    if (!this.notificationProvider) {
      console.error('[MonitoringManager] No notification provider available');
      return false;
    }

    console.log('[MonitoringManager] Notification provider available, sending...');
    try {
      await this.notificationProvider.sendNotification(notification);
      console.log('[MonitoringManager] Notification sent successfully');
      return true;
    } catch (error) {
      console.error('[MonitoringManager] Failed to send notification:', error);
      return false;
    }
  }

  // Configuration methods
  async updateConfiguration(newConfig) {
    // Merge new config with existing config
    this.config = { ...this.config, ...newConfig };
    await this.saveConfiguration();

    // Restart monitoring if active to apply new settings
    if (this.isMonitoring) {
      const wasMonitoring = this.isMonitoring;
      await this.stopMonitoring();
      if (wasMonitoring) {
        await this.startMonitoring();
      }
    }
  }

  getQueueUrl() {
    const baseUrl = 'https://www.amazon.it/vine/vine-items';

    // Use first queue from queues array
    const queue = this.config.queues && this.config.queues.length > 0
      ? this.config.queues[0]
      : this.config.queue || 'potluck';

    switch (queue) {
      case 'potluck':
        return `${baseUrl}?queue=potluck`;
      case 'encore':
        return `${baseUrl}?queue=encore`;
      case 'last_chance':
        return `${baseUrl}?queue=last_chance`;
      case 'search':
        if (this.config.searchQuery) {
          return `${baseUrl}?search=${encodeURIComponent(this.config.searchQuery)}`;
        }
        return null;
      default:
        return null;
    }
  }

  getQueueLabel() {
    // Handle multiple queues
    if (this.config.queues && this.config.queues.length > 0) {
      const labels = this.config.queues.map(q => this.getQueueLabelFromValue(q));
      return labels.join(', ');
    }

    // Fallback to old single queue format
    if (this.config.queue) {
      return this.getQueueLabelFromValue(this.config.queue);
    }

    return 'Unknown';
  }

  async clearNotifiedItems() {
    await this.repository.clearNotifiedFlags();
  }

  getConfiguration() {
    return { ...this.config };
  }

  getNotifiedItemsCount() {
    return this.repository.find(doc => doc.notified === true).length;
  }

  isActive() {
    return this.isMonitoring;
  }

  cleanup() {
    super.cleanup();
    this.stopMonitoringTimer();
    this.disconnectLive();
  }
}

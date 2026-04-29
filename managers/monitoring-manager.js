// Monitoring Manager - Monitors for new items and sends notifications
// Uses ItemsRepository for data persistence
// Uses in-page fetch to check queues without navigation
window.VINE_DEFAULT_SOCKET_URL = window.VINE_DEFAULT_SOCKET_URL || (
  'wss://api.v-helper.com/socket.io/'
  + '?app_version=3.10.10'
  + '&countryCode=it'
  + '&uuid=639e138a-0e43-11f1-9839-fa163effef06'
  + '&fid=58259'
  + '&cid=7f1cf6cd0ee4ee0339d1ae05ce67ffc9c95f414b46c987b46b8c3f49f53f2312'
  + '&device_name=Pumping%20Micro%20Zeppelin%20S-339'
  + '&EIO=4'
  + '&transport=websocket'
);

class MonitoringManager extends BaseManager {
  constructor(config) {
    super(config);
    this.repository = window.vineItemsRepository;
    this.isMonitoring = false;
    this.notificationProvider = null;
    this.newItemsManager = null;
    this.pageDetectionManager = null;
    this.monitoringTimer = null;
    this.socket = null;
    this.socketReconnectTimer = null;
    this.socketEngineConnected = false;
    this.socketNamespaceConnected = false;

    // Configuration
    this.config = {
      queues: ['potluck', 'encore', 'last_chance'],  // Which queues to monitor
      searchQuery: '',                                // Search query (only for search mode)
      refreshIntervalSeconds: 300,                    // How often to check (default: 5 min)
      transportMode: 'polling',                       // polling | socket
      socketUrl: window.VINE_DEFAULT_SOCKET_URL       // Socket endpoint for advanced mode
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

        if (!config.transportMode || !['polling', 'socket'].includes(config.transportMode)) {
          config.transportMode = 'polling';
          sessionStorage.setItem('vineMonitoringConfig', JSON.stringify(config));
        }

        if (typeof config.socketUrl !== 'string') {
          config.socketUrl = window.VINE_DEFAULT_SOCKET_URL;
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
      if (this.isSocketMode()) {
        console.log('[MonitoringManager] Resuming socket monitoring...');
        this.startSocketConnection();
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

    if (this.isSocketMode() && !this.config.socketUrl) {
      console.error('[MonitoringManager] Cannot start socket monitoring without socket URL');
      alert('Cannot start socket monitoring: socket URL is missing.');
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
        message: this.isSocketMode()
          ? `Monitoring ${queueLabel} via ${monitoringModeLabel}`
          : `Monitoring ${queueLabel} via ${monitoringModeLabel} every ${this.config.refreshIntervalSeconds}s`,
        priority: 'low',
        tags: ['vine', 'monitoring', 'start']
      });
      console.log('[MonitoringManager] Start notification sent successfully');
    } catch (error) {
      console.error('[MonitoringManager] Failed to send start notification:', error);
    }

    if (this.isSocketMode()) {
      console.log('[MonitoringManager] Starting socket monitoring...');
      this.startSocketConnection();
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
    this.disconnectSocket();

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

  isSocketMode() {
    return this.config.transportMode === 'socket';
  }

  getMonitoringModeLabel() {
    return this.isSocketMode() ? 'socket stream' : 'polling';
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
        allNewItems.push({ ...newDoc, queue: itemQueue, tileElement: item.tileElement, source: item.source || 'polling', reason: item.reason || '' });
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
        allNewItems.push({ ...existingDoc, queue: itemQueue, tileElement: item.tileElement, source: item.source || 'polling', reason: item.reason || '' });
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
    }

    return { newItems: allNewItems, queuesChecked: Array.from(uniqueQueues) };
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

      items.push({
        asin,
        title,
        url,
        imageUrl,
        queue,
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
    tile.dataset.vineSocketInjected = item?.source === 'socket' ? 'true' : 'false';

    if (item?.source === 'socket') {
      this.decorateSocketTile(tile, item);
    }
  }

  decorateSocketTile(tile, item) {
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
    badge.textContent = 'SOCKET';
    badge.title = 'Injected from live socket monitoring';
    content.appendChild(badge);

    const existingMeta = content.querySelector('.vine-socket-meta');
    if (existingMeta) {
      existingMeta.remove();
    }

    const meta = document.createElement('div');
    meta.className = 'vine-socket-meta';

    const sourceChip = document.createElement('span');
    sourceChip.className = 'vine-socket-chip vine-socket-chip-source';
    sourceChip.textContent = 'Live';
    meta.appendChild(sourceChip);

    if (item?.queue) {
      const queueChip = document.createElement('span');
      queueChip.className = 'vine-socket-chip vine-socket-chip-queue';
      queueChip.textContent = this.getQueueLabelFromValue(item.queue);
      meta.appendChild(queueChip);
    }

    if (item?.reason) {
      const reasonChip = document.createElement('span');
      reasonChip.className = 'vine-socket-chip vine-socket-chip-reason';
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
  }

  createTileElementFromItem(item) {
    if (!item?.asin) {
      return null;
    }

    const tile = document.createElement('div');
    tile.className = 'vvp-item-tile vine-new-item';
    tile.dataset.vineSocketInjected = 'true';
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
    badge.textContent = 'SOCKET';
    badge.title = 'Injected from live socket monitoring';
    content.appendChild(badge);

    if (item.imageUrl) {
      const image = document.createElement('img');
      image.src = item.imageUrl;
      image.alt = item.title || item.asin;
      image.loading = 'lazy';
      content.appendChild(image);
    }

    const meta = document.createElement('div');
    meta.className = 'vine-socket-meta';

    const sourceChip = document.createElement('span');
    sourceChip.className = 'vine-socket-chip vine-socket-chip-source';
    sourceChip.textContent = 'Live';
    meta.appendChild(sourceChip);

    if (item.queue) {
      const queueChip = document.createElement('span');
      queueChip.className = 'vine-socket-chip vine-socket-chip-queue';
      queueChip.textContent = this.getQueueLabelFromValue(item.queue);
      meta.appendChild(queueChip);
    }

    if (item.reason) {
      const reasonChip = document.createElement('span');
      reasonChip.className = 'vine-socket-chip vine-socket-chip-reason';
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

  startSocketConnection() {
    if (!this.isMonitoring || !this.isSocketMode()) {
      return;
    }

    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const socketUrl = (this.config.socketUrl || '').trim();
    if (!socketUrl) {
      this.emitSocketState('error', { message: 'Socket URL is empty' });
      return;
    }

    this.clearSocketReconnectTimer();
    this.socketEngineConnected = false;
    this.socketNamespaceConnected = false;
    this.emitSocketState('connecting');

    try {
      const socket = new WebSocket(socketUrl);
      this.socket = socket;

      socket.addEventListener('open', () => {
        if (this.socket !== socket) {
          return;
        }
        console.log('[MonitoringManager] Socket transport connected');
      });

      socket.addEventListener('message', async (event) => {
        if (this.socket !== socket) {
          return;
        }

        await this.handleSocketMessage(event.data, socket);
      });

      socket.addEventListener('error', () => {
        if (this.socket !== socket) {
          return;
        }

        console.error('[MonitoringManager] Socket connection error');
        this.emitSocketState('error', { message: 'Socket transport error' });
      });

      socket.addEventListener('close', (event) => {
        if (this.socket === socket) {
          this.socket = null;
        }

        this.socketEngineConnected = false;
        this.socketNamespaceConnected = false;

        if (!this.isMonitoring || !this.isSocketMode()) {
          this.emitSocketState('disconnected', { code: event.code, message: event.reason || 'Socket closed' });
          return;
        }

        console.warn('[MonitoringManager] Socket closed, scheduling reconnect', event.code, event.reason);
        this.emitSocketState('reconnecting', { code: event.code, message: event.reason || 'Socket closed' });
        this.scheduleSocketReconnect();
      });
    } catch (error) {
      console.error('[MonitoringManager] Failed to create socket:', error);
      this.emitSocketState('error', { message: error.message });
      this.scheduleSocketReconnect();
    }
  }

  disconnectSocket() {
    this.clearSocketReconnectTimer();
    this.socketEngineConnected = false;
    this.socketNamespaceConnected = false;

    if (this.socket) {
      try {
        this.socket.close(1000, 'Monitoring stopped');
      } catch (error) {
        console.warn('[MonitoringManager] Failed to close socket cleanly:', error);
      }
      this.socket = null;
    }

    this.emitSocketState(this.isSocketMode() ? 'disconnected' : 'hidden');
  }

  scheduleSocketReconnect() {
    if (!this.isMonitoring || !this.isSocketMode()) {
      return;
    }

    this.clearSocketReconnectTimer();
    this.socketReconnectTimer = setTimeout(() => {
      this.socketReconnectTimer = null;
      this.startSocketConnection();
    }, 5000);
  }

  clearSocketReconnectTimer() {
    if (this.socketReconnectTimer) {
      clearTimeout(this.socketReconnectTimer);
      this.socketReconnectTimer = null;
    }
  }

  emitSocketState(state, extra = {}) {
    this.emit('monitoringSocketStateChanged', { state, ...extra });
  }

  async handleSocketMessage(message, socket) {
    if (typeof message !== 'string') {
      return;
    }

    console.log('[MonitoringManager] Socket message received:', message);

    if (message.startsWith('0')) {
      this.socketEngineConnected = true;
      this.emitSocketState('engine_open');
      socket.send('40');
      return;
    }

    if (message === '2') {
      socket.send('3');
      return;
    }

    if (message.startsWith('40')) {
      this.socketNamespaceConnected = true;
      this.emitSocketState('connected');
      return;
    }

    if (!message.startsWith('42')) {
      return;
    }

    try {
      const payload = JSON.parse(message.slice(2));
      if (!Array.isArray(payload) || payload[0] !== 'newItem') {
        return;
      }

      await this.handleSocketNewItem(payload[1]?.item);
    } catch (error) {
      console.error('[MonitoringManager] Failed to parse socket event payload:', error);
    }
  }

  async handleSocketNewItem(rawItem) {
    const item = this.normalizeSocketItem(rawItem);
    if (!item) {
      return;
    }

    if (!this.shouldMonitorQueue(item.queue)) {
      console.log('[MonitoringManager] Ignoring socket item for non-monitored queue:', item.queue);
      return;
    }

    const { newItems } = await this.processDetectedItems([item], [item.queue]);
    if (newItems.length > 0) {
      console.log('[MonitoringManager] Processed socket new item:', item.asin);
    }
  }

  normalizeSocketItem(rawItem) {
    if (!rawItem?.asin) {
      return null;
    }

    const normalizedItem = {
      asin: rawItem.asin,
      title: rawItem.title || '',
      imageUrl: rawItem.img_url || rawItem.imageUrl || '',
      url: rawItem.url || this.buildProductUrl(rawItem.asin),
      queue: rawItem.queue || 'unknown',
      reason: rawItem.reason || '',
      enrollmentGuid: rawItem.enrollment_guid || rawItem.enrollmentGuid || '',
      isParentAsin: `${rawItem.is_parent_asin ?? rawItem.isParentAsin ?? 'false'}` === 'true',
      isPreRelease: `${rawItem.is_pre_release ?? rawItem.isPreRelease ?? 'false'}` === 'true',
      recommendationType: rawItem.recommendation_type || rawItem.recommendationType || '',
      recommendationId: rawItem.recommendation_id || rawItem.recommendationId || '',
      source: 'socket'
    };

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

  // Send aggregated notification for multi-queue check
  async notifyAboutNewItemsMultiQueue(items, queuesChecked) {
    if (!items || items.length === 0) return;

    try {
      // Play beep sound for new items
      this.playBeepSound();
      // Group items by queue
      const itemsByQueue = {};
      for (const item of items) {
        const queue = item.queue || 'unknown';
        if (!itemsByQueue[queue]) {
          itemsByQueue[queue] = [];
        }
        itemsByQueue[queue].push(item);
      }

      // Format items for notification
      const formatItemForNotification = (item, index) => {
        let title = item.title || 'Unknown item';

        // Remove trailing ellipsis added by Amazon (…)
        title = title.replace(/…+$/g, '').trim();

        // Truncate long titles (keep first 80 chars)
        const maxLength = 80;
        if (title.length > maxLength) {
          title = title.substring(0, maxLength).trim() + '…';
        }

        // Add numbered bullet for better readability
        return `${index + 1}. ${title}`;
      };

      // Build message with items grouped by queue
      let message = '';
      let itemIndex = 0;

      for (const queue of Object.keys(itemsByQueue)) {
        const queueItems = itemsByQueue[queue];
        const queueLabel = this.getQueueLabelFromValue(queue);

        message += `\n*${queueLabel}* (${queueItems.length}):\n`;

        const itemsToShow = queueItems.slice(0, 3); // Show first 3 items per queue
        for (const item of itemsToShow) {
          message += formatItemForNotification(item, itemIndex) + '\n';
          itemIndex++;
        }

        if (queueItems.length > 3) {
          message += `_... and ${queueItems.length - 3} more from ${queueLabel}_\n`;
        }
      }

      const queuesLabel = queuesChecked.map(q => this.getQueueLabelFromValue(q)).join(', ');

      await this.sendNotification({
        title: `${items.length} New Vine Item${items.length > 1 ? 's' : ''}!`,
        message: `Found across ${queuesChecked.length} queue${queuesChecked.length > 1 ? 's' : ''}: ${queuesLabel}\n${message}`,
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
      // Format items for notification with truncation and cleaning
      const formatItemForNotification = (item, index) => {
        let title = item.title || 'Unknown item';

        // Remove trailing ellipsis added by Amazon (…)
        title = title.replace(/…+$/g, '').trim();

        // Truncate long titles (keep first 80 chars)
        const maxLength = 80;
        if (title.length > maxLength) {
          title = title.substring(0, maxLength).trim() + '…';
        }

        // Add numbered bullet for better readability
        return `${index + 1}. ${title}`;
      };

      // Format list of items (limit to first 5)
      const itemsToShow = items.slice(0, 5);
      const itemsList = itemsToShow
        .map((item, index) => formatItemForNotification(item, index))
        .join('\n\n'); // Double newline for better spacing

      // Add "and X more" text if there are more items
      const moreText = items.length > 5
        ? `\n\n_... and ${items.length - 5} more item${items.length - 5 > 1 ? 's' : ''}_`
        : '';

      const queueLabel = this.getQueueLabel();

      await this.sendNotification({
        title: `${items.length} New Vine Item${items.length > 1 ? 's' : ''} on ${queueLabel}!`,
        message: `${itemsList}${moreText}`,
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
    this.disconnectSocket();
  }
}

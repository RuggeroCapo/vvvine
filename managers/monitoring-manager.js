// Monitoring Manager - Monitors for new items and sends notifications
// Uses ItemsRepository for data persistence
// Uses in-page fetch to check queues without navigation
class MonitoringManager extends BaseManager {
  constructor(config) {
    super(config);
    this.repository = window.vineItemsRepository;
    this.isMonitoring = false;
    this.notificationProvider = null;
    this.newItemsManager = null;
    this.pageDetectionManager = null;
    this.monitoringTimer = null;

    // Configuration
    this.config = {
      queues: ['potluck', 'encore', 'last_chance'],  // Which queues to monitor
      searchQuery: '',                                // Search query (only for search mode)
      refreshIntervalSeconds: 300                     // How often to check (default: 5 min)
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
    // Initialize repository if not already initialized
    if (!this.repository.isInitialized) {
      await this.repository.init();
    }

    await this.loadConfiguration();
    this.setupEventListeners();
    await this.loadMonitoringState();
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
    this.on('startMonitoring', (config) => this.startMonitoring(config));
    this.on('stopMonitoring', () => this.stopMonitoring());
  }

  async loadMonitoringState() {
    // Use sessionStorage for per-tab independent monitoring state
    const monitoringEnabled = sessionStorage.getItem('vineMonitoringEnabled');
    this.isMonitoring = monitoringEnabled === 'true';

    if (this.isMonitoring) {
      // Start the timer to resume monitoring
      this.startMonitoringTimer();

      // Emit event for UI update
      this.emit('monitoringStateChanged', { isMonitoring: true, config: this.config });

      // Perform initial check on page load
      console.log('[MonitoringManager] Resuming monitoring, performing initial check...');
      await this.checkAllQueues();
    } else {
      // Emit event for UI to show correct initial state
      this.emit('monitoringStateChanged', { isMonitoring: false, config: this.config });
    }
  }

  async startMonitoring(config = null) {
    if (this.isMonitoring) {
      return;
    }

    // Update config if provided
    if (config) {
      this.config = { ...this.config, ...config };
      await this.saveConfiguration();
    }

    // Validate dependencies
    if (!this.notificationProvider) {
      console.error('MonitoringManager: Cannot start - notification provider not set');
      return;
    }

    if (!this.newItemsManager) {
      console.error('MonitoringManager: Cannot start - new items manager not set');
      return;
    }

    this.isMonitoring = true;
    // Use sessionStorage for per-tab independent monitoring state
    sessionStorage.setItem('vineMonitoringEnabled', 'true');
    this.emit('monitoringStateChanged', { isMonitoring: true, config: this.config });

    // Send start notification
    const queueLabel = this.getQueueLabel();
    await this.sendNotification({
      title: 'Vine Monitoring Started',
      message: `Monitoring ${queueLabel} every ${this.config.refreshIntervalSeconds}s`,
      priority: 'low',
      tags: ['vine', 'monitoring', 'start']
    });

    // Start in-page monitoring timer
    this.startMonitoringTimer();

    // Do an immediate check
    console.log('[MonitoringManager] Starting immediate check...');
    await this.checkAllQueues();
  }

  async stopMonitoring() {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    // Use sessionStorage for per-tab independent monitoring state
    sessionStorage.setItem('vineMonitoringEnabled', 'false');
    this.emit('monitoringStateChanged', { isMonitoring: false, config: this.config });

    // Stop the monitoring timer
    this.stopMonitoringTimer();

    console.log('MonitoringManager: Monitoring stopped');
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

  // Check all configured queues using fetch (no navigation)
  async checkAllQueues() {
    if (!this.isMonitoring) {
      return;
    }

    console.log('[MonitoringManager] ========== checkAllQueues START ==========');
    console.log('[MonitoringManager] Queues to check:', this.config.queues);

    const allNewItems = [];
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

    // Process results and find new items
    for (const result of results) {
      if (result.error) continue;

      queuesChecked.push(result.queue);

      for (const item of result.items) {
        const existingDoc = this.repository.get(item.asin);

        if (!existingDoc) {
          // Brand new item
          const newDoc = {
            asin: item.asin,
            title: item.title || '',
            imageUrl: item.imageUrl || '',
            url: item.url || '',
            firstSeenOn: Date.now(),
            lastSeenOn: Date.now(),
            seen: true,
            hidden: false,
            notified: false,
            queue: result.queue
          };
          this.repository.items.set(item.asin, newDoc);
          allNewItems.push({ ...newDoc, queue: result.queue });
        } else {
          // Update existing item
          existingDoc.lastSeenOn = Date.now();
          existingDoc.seen = true;

          // Check if this is a "new" item (not notified, not hidden)
          if (!existingDoc.notified && !existingDoc.hidden) {
            allNewItems.push({ ...existingDoc, queue: result.queue });
          }
        }
      }
    }

    // Save repository changes
    if (allNewItems.length > 0 || queuesChecked.length > 0) {
      await this.repository.save();
    }

    console.log('[MonitoringManager] Total new items found:', allNewItems.length);
    console.log('[MonitoringManager] Queues checked:', queuesChecked);

    // Send notification if there are new items
    if (allNewItems.length > 0) {
      // Mark all as notified
      for (const item of allNewItems) {
        await this.repository.setNotified(item.asin, true);
      }

      // Send aggregated notification
      await this.notifyAboutNewItemsMultiQueue(allNewItems, queuesChecked);
    }

    console.log('[MonitoringManager] ========== checkAllQueues END ==========');

    return { newItems: allNewItems, queuesChecked };
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

      // Extract image URL
      const imageUrl = tile.querySelector('img')?.getAttribute('src') || '';

      items.push({
        asin,
        title,
        url,
        imageUrl,
        queue
      });
    }

    return items;
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

  // Send aggregated notification for multi-queue check
  async notifyAboutNewItemsMultiQueue(items, queuesChecked) {
    if (!items || items.length === 0) return;

    try {
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
    if (!this.notificationProvider) {
      return false;
    }

    try {
      await this.notificationProvider.sendNotification(notification);
      return true;
    } catch (error) {
      console.error('MonitoringManager: Failed to send notification:', error);
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
  }
}

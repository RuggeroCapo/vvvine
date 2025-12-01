// Monitoring Manager - Monitors for new items and sends notifications
// Uses ItemsRepository for data persistence
// Works in coordination with background service worker for persistent monitoring
class MonitoringManager extends BaseManager {
  constructor(config) {
    super(config);
    this.repository = window.vineItemsRepository;
    this.isMonitoring = false;
    this.notificationProvider = null;
    this.newItemsManager = null;
    this.pageDetectionManager = null;

    // Configuration
    this.config = {
      queue: 'potluck',              // Which queue to monitor: 'potluck', 'encore', 'last_chance', 'search'
      searchQuery: '',               // Search query (only for search mode)
      refreshIntervalSeconds: 300    // How often to refresh the page (default: 5 min)
    };
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
      const result = await chrome.storage.local.get(['vineMonitoringConfig']);
      if (result.vineMonitoringConfig) {
        this.config = { ...this.config, ...result.vineMonitoringConfig };
      }
    } catch (error) {
      console.error('MonitoringManager: Error loading configuration:', error);
    }
  }

  async saveConfiguration() {
    try {
      await chrome.storage.local.set({ vineMonitoringConfig: this.config });
    } catch (error) {
      console.error('MonitoringManager: Error saving configuration:', error);
    }
  }

  setupEventListeners() {
    this.on('startMonitoring', () => this.startMonitoring());
    this.on('stopMonitoring', () => this.stopMonitoring());

    // Listen for messages from background service worker
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'performItemCheck') {
        this.checkForNewItems()
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open for async response
      }
      return false;
    });
  }

  async loadMonitoringState() {
    const result = await chrome.storage.local.get(['vineMonitoringEnabled']);
    this.isMonitoring = result.vineMonitoringEnabled || false;

    if (this.isMonitoring) {
      // Perform initial check on page load
      await this.checkForNewItems();

      // Emit event for UI update
      this.emit('monitoringStateChanged', { isMonitoring: true });
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
    this.emit('monitoringStateChanged', { isMonitoring: true });

    // Send start notification
    const queueLabel = this.getQueueLabel();
    await this.sendNotification({
      title: 'Vine Monitoring Started',
      message: `Monitoring ${queueLabel} for new items`,
      priority: 'low',
      tags: ['vine', 'monitoring', 'start']
    });

    // Notify background service worker to start monitoring
    // The service worker will handle alarms and page refreshes
    await chrome.runtime.sendMessage({
      action: 'startMonitoring',
      config: this.config
    });
  }

  async stopMonitoring() {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    this.emit('monitoringStateChanged', { isMonitoring: false });

    // Notify background service worker to stop monitoring
    await chrome.runtime.sendMessage({
      action: 'stopMonitoring'
    });

    console.log('MonitoringManager: Background worker notified to stop monitoring');
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

  async notifyAboutNewItems(items) {
    if (!items || items.length === 0) return;

    try {
      // Send batch notification
      const itemsList = items
        .slice(0, 5) // Limit to first 5 items
        .map(item => `• ${item.title}`)
        .join('\n');

      const moreText = items.length > 5 ? `\n... and ${items.length - 5} more` : '';
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

    switch (this.config.queue) {
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
    switch (this.config.queue) {
      case 'potluck':
        return 'Potluck';
      case 'encore':
        return 'Encore';
      case 'last_chance':
        return 'Last Chance';
      case 'search':
        return this.config.searchQuery ? `Search: ${this.config.searchQuery}` : 'Search';
      default:
        return 'Unknown';
    }
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
    // No timers to clear - background service worker handles scheduling
  }
}

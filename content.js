// Amazon Vine Efficiency Enhancer - Main Controller
// Orchestrates all manager modules for enhanced Vine browsing

class AmazonVineEnhancer {
  constructor() {
    this.managers = {};
    this.isInitialized = false;
    
    this.setupMessageListener();
    this.init();
  }

  setupMessageListener() {
    // Listen for messages from popup and background
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'toggleAutoNavigation') {
        this.handleAutoNavigationToggle(request.enabled);
        sendResponse({ success: true });
      } else if (request.action === 'clearFilter') {
        this.handleClearFilter();
        sendResponse({ success: true });
      } else if (request.action === 'startMonitoring') {
        this.handleStartMonitoring(request.config);
        sendResponse({ success: true });
      } else if (request.action === 'stopMonitoring') {
        this.handleStopMonitoring();
        sendResponse({ success: true });
      } else if (request.action === 'testNotification') {
        // Handle async operation properly
        this.handleTestNotification()
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open for async response
      } else if (request.action === 'clearNotifiedItems') {
        // Handle async operation properly
        this.handleClearNotifiedItems()
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open for async response
      } else if (request.action === 'updateTelegramConfig') {
        // Handle async operation properly
        this.handleUpdateTelegramConfig(request.config)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true; // Keep channel open for async response
      }

      return false; // Close channel for sync responses
    });
  }

  handleAutoNavigationToggle(enabled) {
    const pageManager = this.managers.page;
    if (pageManager) {
      if (enabled) {
        pageManager.enableAutoNavigation();
      } else {
        pageManager.disableAutoNavigation();
      }
    }
  }

  handleClearFilter() {
    const filterManager = this.managers.filter;
    const uiManager = this.managers.ui;
    if (filterManager && uiManager) {
      filterManager.clearFilter();
      uiManager.clearFilter();
    }
  }

  handleStartMonitoring(config) {
    const monitoringManager = this.managers.monitoring;
    if (monitoringManager) {
      monitoringManager.startMonitoring(config);
    }
  }

  handleStopMonitoring() {
    const monitoringManager = this.managers.monitoring;
    if (monitoringManager) {
      monitoringManager.stopMonitoring();
    }
  }

  async handleTestNotification() {
    const notificationProvider = this.managers.notificationProvider;

    if (!notificationProvider) {
      console.error('NotificationProvider is not initialized yet. Please wait for initialization to complete.');
      throw new Error('NotificationProvider not initialized');
    }

    if (!notificationProvider.isInitialized) {
      console.error('NotificationProvider has not completed setup yet. Please wait.');
      throw new Error('NotificationProvider not ready');
    }

    try {
      await notificationProvider.testConnection();
    } catch (error) {
      console.error('Failed to send test notification:', error);
      throw error;
    }
  }

  async handleClearNotifiedItems() {
    const monitoringManager = this.managers.monitoring;
    if (monitoringManager) {
      await monitoringManager.clearNotifiedItems();
    }
  }

  async handleUpdateTelegramConfig(config) {
    const notificationProvider = this.managers.notificationProvider;
    if (notificationProvider) {
      await notificationProvider.saveTelegramConfig(config);
    }
  }

  waitForInitialization() {
    return new Promise((resolve) => {
      if (this.isInitialized) {
        resolve();
        return;
      }
      
      const checkInit = () => {
        if (this.isInitialized) {
          resolve();
        } else {
          setTimeout(checkInit, 100);
        }
      };
      checkInit();
    });
  }

  async init() {
    
    try {
      // Block NAVYAAN footer network requests immediately
      this.blockFooterRequests();
      
      // Hide footer elements immediately and continuously
      this.hideFooterElements();
      
      // Wait for the grid to be available
      await this.waitForGrid();
      
      // Initialize all managers in the correct order
      await this.initializeManagers();
      
      // Setup cross-manager communication
      this.setupManagerCommunication();
      
      // Start all managers
      await this.startManagers();
      
      this.isInitialized = true;
    } catch (error) {
      console.error('Failed to initialize Amazon Vine Enhancer:', error);
    }
  }

  waitForGrid() {
    return new Promise((resolve) => {
      const checkGrid = () => {
        // Check if we're on a Vine page (with or without products)
        const grid = document.getElementById('vvp-items-grid');
        const tabContent = document.querySelector('.vvp-tab-content');
        
        // Resolve if either the grid exists with items OR the tab content exists (even without items)
        if ((grid && grid.children.length > 0) || tabContent) {
          console.log('[Vine Enhancer] Page ready:', grid ? 'with products' : 'without products');
          resolve(grid || tabContent);
        } else {
          setTimeout(checkGrid, 100);
        }
      };
      checkGrid();
    });
  }

  blockFooterRequests() {
    // Block network requests to footer-related endpoints
    const originalFetch = window.fetch;
    const originalXHROpen = XMLHttpRequest.prototype.open;
    
    // Override fetch to block footer requests
    window.fetch = function(url, options) {
      if (typeof url === 'string' && (
        url.includes('slot=navFooter') ||
        url.includes('NAVYAAN') ||
        url.includes('footer') ||
        url.includes('rhf')
      )) {
        console.log('[Vine Enhancer] Blocked footer request:', url);
        return Promise.reject(new Error('Footer request blocked by Vine Enhancer'));
      }
      return originalFetch.apply(this, arguments);
    };
    
    // Override XMLHttpRequest to block footer requests
    XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
      if (typeof url === 'string' && (
        url.includes('slot=navFooter') ||
        url.includes('NAVYAAN') ||
        url.includes('footer') ||
        url.includes('rhf')
      )) {
        console.log('[Vine Enhancer] Blocked XHR footer request:', url);
        // Create a fake request that does nothing
        this._blocked = true;
        return;
      }
      return originalXHROpen.apply(this, arguments);
    };
    
    // Override send to handle blocked requests
    const originalXHRSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function(data) {
      if (this._blocked) {
        // Simulate a successful empty response
        setTimeout(() => {
          if (this.onreadystatechange) {
            this.readyState = 4;
            this.status = 200;
            this.responseText = '';
            this.onreadystatechange();
          }
        }, 1);
        return;
      }
      return originalXHRSend.apply(this, arguments);
    };
  }

  hideFooterElements() {
    // Function to hide footer elements
    const hideFooters = () => {
      const footerSelectors = [
        '#navFooter',
        '[id*="navFooter"]',
        '[class*="navFooter"]',
        '[data-testid*="footer"]',
        '.nav-footer',
        '.navFooter',
        'footer[role="contentinfo"]',
        '#footer',
        '.footer',
        '[aria-label*="footer" i]',
        '[aria-labelledby*="footer" i]',
        '[id*="NAVYAAN"]',
        '[class*="NAVYAAN"]',
        '[data-testid*="NAVYAAN"]',
        '#rhf',
        '#rhf-container',
        '.rhf-frame',
        '[id*="rhf"]',
        '[class*="rhf"]'
      ];
      
      footerSelectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach(element => {
            element.style.display = 'none';
            element.style.visibility = 'hidden';
            element.style.opacity = '0';
            element.style.height = '0';
            element.style.overflow = 'hidden';
            element.style.position = 'absolute';
            element.style.left = '-9999px';
            element.remove(); // Completely remove from DOM for better performance
          });
        } catch (e) {
          // Ignore selector errors
        }
      });
    };
    
    // Hide immediately
    hideFooters();
    
    // Hide continuously with MutationObserver for dynamic content
    const observer = new MutationObserver(() => {
      hideFooters();
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['id', 'class', 'data-testid']
    });
    
    // Also run periodically as a fallback
    setInterval(hideFooters, 1000);
  }

  async initializeManagers() {
    // Create managers in dependency order
    this.managers.storage = new StorageManager();
    this.managers.filter = new FilterManager();
    this.managers.seenItems = new SeenItemsManager();
    this.managers.bookmarks = new BookmarkManager();
    this.managers.newItems = new NewItemsManager();
    this.managers.pageDetection = new PageDetectionManager();
    this.managers.categoryTracker = new CategoryTrackerManager();
    this.managers.notificationProvider = new NotificationProviderManager();
    this.managers.monitoring = new MonitoringManager();
    this.managers.ui = new UIManager();
    this.managers.keyboard = new KeyboardManager();
    this.managers.page = new PageManager();
    setInterval(() => {
      const fullTitles = document.querySelectorAll('.a-truncate-full');
      if (fullTitles) {
      // Remove all truncation classes and attributes - always show full title
      fullTitles.forEach(title => {
        title.classList.remove('a-offscreen');
        title.style.clip = 'unset !important';
        title.style.clipPath = 'unset !important';
        title.style.position = 'static !important';
        title.style.display = 'block !important';
        title.style.position = 'relative !important';
      });
    }
  }, 300);
  }

  setupManagerCommunication() {
    // Setup dependencies between managers
    this.managers.seenItems.setStorageManager(this.managers.storage);
    this.managers.bookmarks.setStorageManager(this.managers.storage);
    this.managers.newItems.setStorageManager(this.managers.storage);

    // Setup monitoring dependencies
    if (this.managers.monitoring) {
      this.managers.monitoring.setNotificationProvider(this.managers.notificationProvider);
      this.managers.monitoring.setNewItemsManager(this.managers.newItems);
      this.managers.monitoring.setPageDetectionManager(this.managers.pageDetection);
    }

    // Expose managers globally for early access (before full initialization completes)
    // Note: These are exposed early but may not be fully initialized until startManagers() completes
    window.vineNotificationProvider = this.managers.notificationProvider;
    window.vineMonitoringManager = this.managers.monitoring;
    
    // Special keyboard manager event handling for seen items
    window.vineEventBus.on('toggleItemSeen', (data) => {
      this.managers.seenItems.toggleItemSeen(data.title, data.item);
    });

    // Special keyboard manager event handling for bookmarks
    window.vineEventBus.on('toggleItemBookmark', (data) => {
      this.managers.bookmarks.toggleItemBookmark(data.title, data.url, data.pageNumber, data.pageUrl, data.item);
    });

    // Table view event handlers - sync with card view
    window.vineEventBus.on('toggleSeenFromTable', (data) => {
      const item = document.querySelector(`.vvp-item-tile[data-vine-item-id="${data.itemId}"]`);
      if (item) {
        const title = item.querySelector('.vvp-item-product-title-container a')?.textContent.trim();
        if (title) {
          this.managers.seenItems.toggleItemSeen(title, item);
          // Update table row
          const isSeen = item.classList.contains('vine-seen');
          this.managers.ui.updateTableRow(data.itemId, { seen: isSeen });
        }
      }
    });

    window.vineEventBus.on('toggleBookmarkFromTable', (data) => {
      const item = document.querySelector(`.vvp-item-tile[data-vine-item-id="${data.itemId}"]`);
      if (item) {
        const title = item.querySelector('.vvp-item-product-title-container a')?.textContent.trim();
        const url = item.querySelector('.vvp-item-product-title-container a')?.href;
        const pageNumber = this.managers.ui.currentPage;
        const pageUrl = window.location.href;
        
        if (title && url) {
          this.managers.bookmarks.toggleItemBookmark(title, url, pageNumber, pageUrl, item);
          // Update table row
          const isBookmarked = item.classList.contains('vine-bookmarked');
          this.managers.ui.updateTableRow(data.itemId, { bookmarked: isBookmarked });
        }
      }
    });

    // Sync card changes to table view
    window.vineEventBus.on('itemMarkedSeen', (data) => {
      if (data.item && data.item.dataset.vineItemId) {
        this.managers.ui.updateTableRow(data.item.dataset.vineItemId, { seen: true });
      }
    });

    window.vineEventBus.on('itemMarkedUnseen', (data) => {
      if (data.item && data.item.dataset.vineItemId) {
        this.managers.ui.updateTableRow(data.item.dataset.vineItemId, { seen: false });
      }
    });

    window.vineEventBus.on('itemBookmarked', (data) => {
      if (data.item && data.item.dataset.vineItemId) {
        this.managers.ui.updateTableRow(data.item.dataset.vineItemId, { bookmarked: true });
      }
    });

    window.vineEventBus.on('itemUnbookmarked', (data) => {
      if (data.item && data.item.dataset.vineItemId) {
        this.managers.ui.updateTableRow(data.item.dataset.vineItemId, { bookmarked: false });
      }
    });
    
    // Expose some managers globally for advanced usage
    window.vinePageManager = this.managers.page;
    window.vineKeyboardManager = this.managers.keyboard;
    window.vineStorageManager = this.managers.storage;
    window.vineBookmarkManager = this.managers.bookmarks;
    window.vineNewItemsManager = this.managers.newItems;
    window.vineMonitoringManager = this.managers.monitoring;
    window.vineNotificationProvider = this.managers.notificationProvider;
  }

  async startManagers() {
    // Initialize managers in the correct order
    const initOrder = [
      'storage',             // Must be first to load seen items and bookmarks
      'filter',              // Independent
      'seenItems',           // Depends on storage
      'bookmarks',           // Depends on storage
      'newItems',            // Depends on storage
      'pageDetection',       // Independent
      'categoryTracker',     // Depends on storage, pageDetection
      'notificationProvider',// Independent
      'monitoring',          // Depends on storage, newItems, pageDetection, notificationProvider
      'ui',                  // Needs to be available for status updates
      'keyboard',            // Coordinates with other managers
      'page'                 // Independent
    ];

    for (const managerName of initOrder) {
      const manager = this.managers[managerName];
      if (manager) {
        try {
          await manager.init();

          // Check auto-navigation setting after page manager is initialized
          if (managerName === 'page') {
            await this.initializeAutoNavigation(manager);
          }
        } catch (error) {
          console.error(`✗ Failed to initialize ${managerName} manager:`, error);
        }
      }
    }
  }

  async initializeAutoNavigation(pageManager) {
    try {
      // Check if auto-navigation is enabled in storage
      const result = await chrome.storage.local.get(['vineAutoNavigationEnabled']);
      const autoNavigationEnabled = result.vineAutoNavigationEnabled !== false; // Default to true
      
      if (autoNavigationEnabled) {
        pageManager.enableAutoNavigation();
      } else {
        pageManager.disableAutoNavigation();
      }
    } catch (error) {
      console.error('Error checking auto-navigation setting:', error);
      // Default to enabled if there's an error
      pageManager.enableAutoNavigation();
    }
  }

  // Utility methods for external access
  getManager(name) {
    return this.managers[name];
  }

  getAllManagers() {
    return { ...this.managers };
  }

  async reinitialize() {
    if (this.isInitialized) {
      this.cleanup();
    }
    await this.init();
  }

  cleanup() {
    // Cleanup all managers
    Object.values(this.managers).forEach(manager => {
      if (manager && typeof manager.cleanup === 'function') {
        manager.cleanup();
      }
    });
    
    // Clear global references
    delete window.vinePageManager;
    delete window.vineKeyboardManager;
    delete window.vineStorageManager;
    delete window.vineBookmarkManager;
    delete window.vineNewItemsManager;
    
    this.managers = {};
    this.isInitialized = false;
  }

  // Debug and development helpers
  getStatus() {
    return {
      isInitialized: this.isInitialized,
      managers: Object.keys(this.managers),
      managerStates: this.getManagerStates()
    };
  }

  getManagerStates() {
    const states = {};
    
    Object.entries(this.managers).forEach(([name, manager]) => {
      if (manager) {
        states[name] = {
          initialized: manager.isInitialized || false,
          hasCleanup: typeof manager.cleanup === 'function'
        };
        
        // Add specific state information for each manager type
        switch (name) {
          case 'storage':
            states[name].seenCount = manager.getSeenItemsCount();
            break;
          case 'title':
            states[name].expanded = manager.isExpanded;
            break;
          case 'filter':
            states[name].currentFilter = manager.getCurrentFilter();
            break;
          case 'keyboard':
            states[name].navigationStatus = manager.getNavigationStatus();
            break;
          case 'page':
            states[name].pageInfo = manager.getPageInfo();
            break;
        }
      }
    });
    
    return states;
  }

  // Performance monitoring
  getPerformanceMetrics() {
    return {
      initializationTime: this.initializationTime,
      managerCount: Object.keys(this.managers).length,
      memoryUsage: this.getApproximateMemoryUsage(),
      pageMetrics: this.managers.page?.getPageLoadMetrics()
    };
  }

  getApproximateMemoryUsage() {
    // Rough estimate of memory usage
    if (performance.memory) {
      return {
        used: performance.memory.usedJSHeapSize,
        total: performance.memory.totalJSHeapSize,
        limit: performance.memory.jsHeapSizeLimit
      };
    }
    return null;
  }
}

// Global access for debugging
let vineEnhancer = null;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    vineEnhancer = new AmazonVineEnhancer();
    window.vineEnhancer = vineEnhancer; // Global access for debugging
  });
} else {
  vineEnhancer = new AmazonVineEnhancer();
  window.vineEnhancer = vineEnhancer; // Global access for debugging
} 
// Amazon Vine Efficiency Enhancer - Main Controller
// Orchestrates all manager modules for enhanced Vine browsing

class AmazonVineEnhancer {
  constructor() {
    this.managers = {};
    this.isInitialized = false;
    
    this.init();
  }

  async init() {
    console.log('Amazon Vine Efficiency Enhancer - Initializing...');
    
    try {
      // Wait for the grid to be available
      await this.waitForGrid();
      
      // Initialize all managers in the correct order
      await this.initializeManagers();
      
      // Setup cross-manager communication
      this.setupManagerCommunication();
      
      // Start all managers
      await this.startManagers();
      
      this.isInitialized = true;
      console.log('Amazon Vine Efficiency Enhancer - Fully initialized');
      
    } catch (error) {
      console.error('Failed to initialize Amazon Vine Enhancer:', error);
    }
  }

  waitForGrid() {
    return new Promise((resolve) => {
      const checkGrid = () => {
        const grid = document.getElementById('vvp-items-grid');
        if (grid && grid.children.length > 0) {
          resolve(grid);
        } else {
          setTimeout(checkGrid, 100);
        }
      };
      checkGrid();
    });
  }

  async initializeManagers() {
    // Create managers in dependency order
    this.managers.storage = new StorageManager();
    this.managers.filter = new FilterManager();
    this.managers.seenItems = new SeenItemsManager();
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
    
    // Special keyboard manager event handling for seen items
    window.vineEventBus.on('toggleItemSeen', (data) => {
      this.managers.seenItems.toggleItemSeen(data.title, data.item);
    });
    
    // Expose some managers globally for advanced usage
    window.vinePageManager = this.managers.page;
    window.vineKeyboardManager = this.managers.keyboard;
    window.vineStorageManager = this.managers.storage;
  }

  async startManagers() {
    // Initialize managers in the correct order
    const initOrder = [
      'storage',    // Must be first to load seen items
      'title',      // Independent
      'filter',     // Independent  
      'seenItems',  // Depends on storage
      'ui',         // Needs to be available for status updates
      'keyboard',   // Coordinates with other managers
      'page'        // Independent
    ];

    for (const managerName of initOrder) {
      const manager = this.managers[managerName];
      if (manager) {
        try {
          await manager.init();
          console.log(`✓ ${managerName} manager initialized`);
          
          // Enable auto-navigation after page manager is initialized
          if (managerName === 'page') {
            manager.enableAutoNavigation();
            console.log('✓ Auto-navigation enabled for infinite scroll');
          }
        } catch (error) {
          console.error(`✗ Failed to initialize ${managerName} manager:`, error);
        }
      }
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
    
    this.managers = {};
    this.isInitialized = false;
    
    console.log('Amazon Vine Enhancer - Cleaned up');
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
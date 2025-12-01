// Page Detection Manager - Identifies Amazon Vine page type
class PageDetectionManager extends BaseManager {
  constructor(config) {
    super(config);
    this.pageType = null;      // 'potluck' | 'encore' | 'search' | 'other'
    this.searchQuery = null;   // For search mode
    this.queueParam = null;    // Queue parameter value
  }

  async setup() {
    this.detectPageType();
    this.setupUrlObserver();
  }

  detectPageType() {

    try {
      const url = new URL(window.location.href);
      const queue = url.searchParams.get('queue');
      const search = url.searchParams.get('search');

      this.queueParam = queue;

      // First, try to detect from URL parameters
      if (search) {
        this.pageType = 'search';
        this.searchQuery = decodeURIComponent(search);
      } else if (queue === 'potluck') {
        this.pageType = 'potluck';
        this.searchQuery = null;
      } else if (queue === 'encore') {
        this.pageType = 'encore';
        this.searchQuery = null;
      } else if (queue === 'last_chance') {
        this.pageType = 'last_chance';
        this.searchQuery = null;
      } else {
        // Fallback: Try to detect from page state data (for pages without URL params)
        const queueFromState = this.detectQueueFromPageState();

        if (queueFromState === 'potluck') {
          this.pageType = 'potluck';
          this.searchQuery = null;
        } else if (queueFromState === 'encore') {
          this.pageType = 'encore';
          this.searchQuery = null;
        } else if (queueFromState === 'last_chance') {
          this.pageType = 'last_chance';
          this.searchQuery = null;
        } else {
          this.pageType = 'other';
          this.searchQuery = null;
        }
      }

      this.emit('pageTypeDetected', {
        pageType: this.pageType,
        searchQuery: this.searchQuery,
        queueParam: this.queueParam
      });

      return this.pageType;

    } catch (error) {
      console.error('PageDetectionManager: Error detecting page type:', error);
      this.pageType = 'other';
      this.searchQuery = null;
      return this.pageType;
    }
  }

  detectQueueFromPageState() {
    // Try to extract queue information from Amazon Vine page state
    // Amazon embeds this in a script tag with data-a-state attribute
    try {
      const stateScript = document.querySelector('script[data-a-state*="vvp-context"]');
      if (stateScript) {
        const stateContent = stateScript.textContent.trim();
        const stateData = JSON.parse(stateContent);

        if (stateData.queueKey) {
          return stateData.queueKey;
        }
      }
    } catch (error) {
      // Could not extract queue from page state
    }

    return null;
  }

  setupUrlObserver() {
    // Listen for URL changes via popstate (back/forward) and custom navigation
    window.addEventListener('popstate', () => {
      this.detectPageType();
    });

    // Listen for pushState/replaceState (modern SPA navigation)
    // Amazon Vine may use this for navigation
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      this.detectPageType();
    };

    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args);
      this.detectPageType();
    };
  }

  // Public API methods
  getPageType() {
    return this.pageType;
  }

  getSearchQuery() {
    return this.searchQuery;
  }

  getQueueParam() {
    return this.queueParam;
  }

  isMonitorablePage() {
    return ['potluck', 'encore', 'last_chance', 'search'].includes(this.pageType);
  }

  isPotluckPage() {
    return this.pageType === 'potluck';
  }

  isEncorePage() {
    return this.pageType === 'encore';
  }

  isLastChancePage() {
    return this.pageType === 'last_chance';
  }

  isSearchPage() {
    return this.pageType === 'search';
  }

  getPageLabel() {
    switch (this.pageType) {
      case 'potluck':
        return 'Potluck Queue';
      case 'encore':
        return 'Encore/Additional Items';
      case 'last_chance':
        return 'Last Chance';
      case 'search':
        return `Search: ${this.searchQuery}`;
      default:
        return 'Other';
    }
  }

  cleanup() {
    super.cleanup();
    // Note: Cannot remove history.pushState/replaceState overrides
    // as they're global modifications
  }
}

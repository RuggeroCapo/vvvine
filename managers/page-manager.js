// Page Manager - Handles page navigation and infinite scroll detection
class PageManager extends BaseManager {
  constructor(config) {
    super(config);
    this.currentPage = this.getCurrentPageNumber();
    this.isLoading = false;
    this.observer = null;
    this.infiniteScrollEnabled = false;
    this.autoNavigationEnabled = false;
    this.paginationObserver = null;
    this.autoNavigationDelay = 2000; // 2 seconds delay before auto-navigation
  }

  async setup() {
    this.setupEventListeners();
    this.setupInfiniteScrollDetection();
    this.setupAutoPaginationDetection();
    console.log(`PageManager: Initialized on page ${this.currentPage}`);
  }

  setupEventListeners() {
    this.on('navigateToPage', (data) => {
      this.navigateToPage(data.page);
    });

    this.on('navigateNext', () => {
      this.navigateToNextPage();
    });

    this.on('navigatePrevious', () => {
      this.navigateToPreviousPage();
    });

    this.on('enableInfiniteScroll', () => {
      this.enableInfiniteScroll();
    });

    this.on('disableInfiniteScroll', () => {
      this.disableInfiniteScroll();
    });

    this.on('enableAutoNavigation', () => {
      this.enableAutoNavigation();
    });

    this.on('disableAutoNavigation', () => {
      this.disableAutoNavigation();
    });
  }

  getCurrentPageNumber() {
    const urlParams = new URLSearchParams(window.location.search);
    return parseInt(urlParams.get('page')) || 1;
  }

  navigateToPage(pageNumber) {
    if (pageNumber <= 0) return;
    
    const url = new URL(window.location);
    url.searchParams.set('page', pageNumber);
    
    console.log(`PageManager: Navigating to page ${pageNumber}`);
    window.location.href = url.toString();
  }

  navigateToNextPage() {
    this.navigateToPage(this.currentPage + 1);
  }

  navigateToPreviousPage() {
    if (this.currentPage > 1) {
      this.navigateToPage(this.currentPage - 1);
    }
  }

  // Infinite scroll functionality
  setupInfiniteScrollDetection() {
    if (this.observer) {
      this.observer.disconnect();
    }

    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !this.isLoading && this.infiniteScrollEnabled) {
          this.handleInfiniteScrollTrigger();
        }
      });
    }, {
      rootMargin: '100px',
      threshold: 0.1
    });

    // Observe the last item on the page
    this.observeLastItem();
  }

  observeLastItem() {
    // Remove previous observations
    if (this.observer) {
      this.observer.disconnect();
    }

    const lastItem = document.querySelector('.vvp-item-tile:last-child');
    if (lastItem && this.observer) {
      this.observer.observe(lastItem);
      console.log('PageManager: Observing last item for infinite scroll');
    }
  }

  handleInfiniteScrollTrigger() {
    console.log('PageManager: Infinite scroll triggered - near end of page');
    
    this.isLoading = true;
    this.emit('infiniteScrollTriggered', {
      currentPage: this.currentPage,
      nextPage: this.currentPage + 1
    });

    // For now, just log the event. In the future, this could:
    // 1. Fetch next page content via AJAX
    // 2. Append new items to current page
    // 3. Update URL without full page reload
    
    // Reset loading state after a delay (simulating async operation)
    setTimeout(() => {
      this.isLoading = false;
    }, 2000);
  }

  enableInfiniteScroll() {
    this.infiniteScrollEnabled = true;
    this.observeLastItem();
    console.log('PageManager: Infinite scroll enabled');
    
    this.emit('infiniteScrollEnabled');
  }

  disableInfiniteScroll() {
    this.infiniteScrollEnabled = false;
    if (this.observer) {
      this.observer.disconnect();
    }
    console.log('PageManager: Infinite scroll disabled');
    
    this.emit('infiniteScrollDisabled');
  }

  // Auto-pagination functionality - automatically navigate to next page when pagination is visible
  setupAutoPaginationDetection() {
    if (this.paginationObserver) {
      this.paginationObserver.disconnect();
    }

    this.paginationObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !this.isLoading && this.autoNavigationEnabled) {
          this.handleAutoPaginationTrigger();
        }
      });
    }, {
      rootMargin: '50px',
      threshold: 0.5
    });

    this.observePagination();
  }

  observePagination() {
    if (this.paginationObserver) {
      this.paginationObserver.disconnect();
    }

    const paginationElement = document.querySelector('.a-pagination');
    if (paginationElement && this.paginationObserver) {
      this.paginationObserver.observe(paginationElement);
      console.log('PageManager: Observing pagination for auto-navigation');
    }
  }

  handleAutoPaginationTrigger() {
    console.log('PageManager: Pagination is visible - checking for next page');
    
    // Check if next page is available
    const nextButton = document.querySelector('.a-pagination .a-last:not(.a-disabled) a');
    
    if (nextButton) {
      console.log(`PageManager: Next page available - will navigate in ${this.autoNavigationDelay}ms`);
      
      this.isLoading = true;
      this.emit('autoNavigationTriggered', {
        currentPage: this.currentPage,
        nextPageUrl: nextButton.href,
        delay: this.autoNavigationDelay
      });

      // Add visual indicator that auto-navigation is happening
      this.addAutoNavigationIndicator();
      
      setTimeout(() => {
        if (this.autoNavigationEnabled && !document.hidden) {
          console.log('PageManager: Auto-navigating to next page');
          window.location.href = nextButton.href;
        } else {
          this.isLoading = false;
          this.removeAutoNavigationIndicator();
        }
      }, this.autoNavigationDelay);
    } else {
      console.log('PageManager: No next page available - reached end');
      this.emit('autoNavigationReachedEnd', {
        currentPage: this.currentPage
      });
    }
  }

  addAutoNavigationIndicator() {
    // Remove existing indicator if any
    this.removeAutoNavigationIndicator();
    
    const indicator = document.createElement('div');
    indicator.id = 'vine-auto-navigation-indicator';
    indicator.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #232f3e;
      color: white;
      padding: 10px 15px;
      border-radius: 5px;
      z-index: 9999;
      font-family: Arial, sans-serif;
      font-size: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      animation: vineSlideIn 0.3s ease-out;
    `;
    
    indicator.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <div style="width: 16px; height: 16px; border: 2px solid #fff; border-top: 2px solid transparent; border-radius: 50%; animation: vineSpin 1s linear infinite;"></div>
        Auto-navigating to next page...
      </div>
    `;
    
    // Add CSS animations if not already present
    if (!document.getElementById('vine-auto-navigation-styles')) {
      const style = document.createElement('style');
      style.id = 'vine-auto-navigation-styles';
      style.textContent = `
        @keyframes vineSlideIn {
          from { transform: translateX(100%); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes vineSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(indicator);
  }

  removeAutoNavigationIndicator() {
    const indicator = document.getElementById('vine-auto-navigation-indicator');
    if (indicator) {
      indicator.remove();
    }
  }

  enableAutoNavigation() {
    this.autoNavigationEnabled = true;
    this.observePagination();
    console.log('PageManager: Auto-navigation enabled');
    
    this.emit('autoNavigationEnabled');
  }

  disableAutoNavigation() {
    this.autoNavigationEnabled = false;
    this.removeAutoNavigationIndicator();
    if (this.paginationObserver) {
      this.paginationObserver.disconnect();
    }
    console.log('PageManager: Auto-navigation disabled');
    
    this.emit('autoNavigationDisabled');
  }

  // Page information and utilities
  getPageInfo() {
    return {
      currentPage: this.currentPage,
      isFirstPage: this.currentPage === 1,
      hasNextPage: this.checkIfHasNextPage(),
      infiniteScrollEnabled: this.infiniteScrollEnabled,
      autoNavigationEnabled: this.autoNavigationEnabled,
      isLoading: this.isLoading
    };
  }

  checkIfHasNextPage() {
    // Try to detect if there's a next page by looking for pagination elements
    const nextButton = document.querySelector('a[aria-label="Next page"], .a-pagination .a-last:not(.a-disabled)');
    return nextButton !== null;
  }

  // URL and history management
  updateUrlWithoutReload(page) {
    const url = new URL(window.location);
    url.searchParams.set('page', page);
    window.history.pushState({ page }, '', url.toString());
    this.currentPage = page;
    
    this.emit('pageUpdated', { page: this.currentPage });
  }

  // Enhanced navigation with options
  navigateWithOptions(page, options = {}) {
    const {
      openInNewTab = false,
      preserveFilters = true,
      addToHistory = true
    } = options;

    const url = new URL(window.location);
    url.searchParams.set('page', page);

    if (!preserveFilters) {
      // Remove filter parameters if not preserving
      url.searchParams.delete('search');
      url.searchParams.delete('filter');
    }

    if (openInNewTab) {
      window.open(url.toString(), '_blank');
    } else {
      if (addToHistory) {
        window.location.href = url.toString();
      } else {
        window.location.replace(url.toString());
      }
    }
  }

  // Batch navigation for quick page jumping
  getPageNavigationHTML() {
    const currentPage = this.currentPage;
    const hasNext = this.checkIfHasNextPage();
    
    return `
      <div class="vine-page-navigation">
        <button ${currentPage === 1 ? 'disabled' : ''} onclick="window.vinePageManager?.navigateToPreviousPage()">
          ← Previous
        </button>
        <span>Page ${currentPage}</span>
        <button ${!hasNext ? 'disabled' : ''} onclick="window.vinePageManager?.navigateToNextPage()">
          Next →
        </button>
        <input type="number" min="1" placeholder="Go to page..." 
               onkeypress="if(event.key==='Enter') window.vinePageManager?.navigateToPage(parseInt(this.value))">
      </div>
    `;
  }

  // Handle browser back/forward navigation
  setupHistoryNavigation() {
    window.addEventListener('popstate', (event) => {
      if (event.state && event.state.page) {
        this.currentPage = event.state.page;
        this.emit('pageChanged', { page: this.currentPage, fromHistory: true });
      }
    });
  }

  // Performance monitoring
  getPageLoadMetrics() {
    const navigation = performance.getEntriesByType('navigation')[0];
    if (navigation) {
      return {
        loadTime: navigation.loadEventEnd - navigation.loadEventStart,
        domContentLoaded: navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart,
        responseTime: navigation.responseEnd - navigation.requestStart
      };
    }
    return null;
  }

  cleanup() {
    super.cleanup();
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.paginationObserver) {
      this.paginationObserver.disconnect();
      this.paginationObserver = null;
    }
    this.removeAutoNavigationIndicator();
  }
} 
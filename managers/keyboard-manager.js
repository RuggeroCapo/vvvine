// Keyboard Manager - Handles keyboard shortcuts and navigation
class KeyboardManager extends BaseManager {
  constructor(config) {
    super(config);
    this.items = [];
    this.keyHandlers = new Map();
  }

  async setup() {
    this.setupKeyHandlers();
    this.setupEventListeners();
    this.updateItemsList();
    console.log('KeyboardManager: Initialized with navigation support');
  }

  setupKeyHandlers() {
    // Define keyboard shortcuts
    this.keyHandlers.set('a', this.handleToggleAutoNavigation.bind(this));
    this.keyHandlers.set('A', this.handleToggleAutoNavigation.bind(this));
    this.keyHandlers.set('Escape', this.handleEscapeKey.bind(this));
    this.keyHandlers.set('ArrowLeft', this.handleLeftArrowKey.bind(this));
    this.keyHandlers.set('ArrowRight', this.handleRightArrowKey.bind(this));

    // Setup main keyboard event listener
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
  }

  setupEventListeners() {
    // Listen for UI updates that might affect navigation
    this.on('itemsFiltered', () => {
      this.updateItemsList();
    });

    this.on('seenVisibilityChanged', () => {
      this.updateItemsList();
    });

    this.on('pageMarkedSeen', () => {
      this.updateItemsList();
    });
  }

  handleKeyDown(e) {
    // Ignore keystrokes when typing in inputs
    if (this.isInputActive(e.target)) return;

    // Check for specific key combinations and actions
    switch(e.code) {
      case 'KeyA':
        e.preventDefault();
        this.handleToggleAutoNavigation(e);
        break;
      case 'ArrowLeft':
        if (e.ctrlKey) {
          e.preventDefault();
          this.handleLeftArrowKey(e);
        }
        break;
      case 'ArrowRight':
        if (e.ctrlKey) {
          e.preventDefault();
          this.handleRightArrowKey(e);
        }
        break;
      case 'Escape':
        e.preventDefault();
        this.handleEscapeKey(e);
        break;
    }
  }

  isInputActive(target) {
    return target.tagName === 'INPUT' || 
           target.tagName === 'TEXTAREA' || 
           target.contentEditable === 'true';
  }

  // Key handler methods
  handleToggleAutoNavigation(e) {
    // Toggle auto-navigation through the page manager
    if (window.vinePageManager) {
      const pageInfo = window.vinePageManager.getPageInfo();
      if (pageInfo.autoNavigationEnabled) {
        window.vinePageManager.disableAutoNavigation();
        console.log('KeyboardManager: Auto-navigation disabled via keyboard shortcut');
        this.showAutoNavigationStatus('Auto-navigation disabled', '#ff6b6b');
      } else {
        window.vinePageManager.enableAutoNavigation();
        console.log('KeyboardManager: Auto-navigation enabled via keyboard shortcut');
        this.showAutoNavigationStatus('Auto-navigation enabled', '#51cf66');
      }
    }
  }

  showAutoNavigationStatus(message, color) {
    // Show a temporary status indicator
    const indicator = document.createElement('div');
    indicator.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: ${color};
      color: white;
      padding: 8px 16px;
      border-radius: 4px;
      z-index: 9999;
      font-family: Arial, sans-serif;
      font-size: 14px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      animation: vineSlideDown 0.3s ease-out;
    `;
    
    indicator.textContent = message;
    
    // Add animation if not already present
    if (!document.getElementById('vine-status-indicator-styles')) {
      const style = document.createElement('style');
      style.id = 'vine-status-indicator-styles';
      style.textContent = `
        @keyframes vineSlideDown {
          from { transform: translateX(-50%) translateY(-100%); opacity: 0; }
          to { transform: translateX(-50%) translateY(0); opacity: 1; }
        }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(indicator);
    
    // Remove indicator after 3 seconds
    setTimeout(() => {
      if (indicator.parentNode) {
        indicator.remove();
      }
    }, 3000);
  }

  handleLeftArrowKey(e) {
    if (e.ctrlKey) {
      this.navigatePages(-1);
    }
  }

  handleRightArrowKey(e) {
    if (e.ctrlKey) {
      this.navigatePages(1);
    }
  }

  handleEscapeKey(e) {
    // Clear filter and focus
    this.emit('clearFilter');
    const filterInput = document.getElementById('filter-input');
    if (filterInput) {
      filterInput.value = '';
      filterInput.blur();
    }
  }

  // Navigation methods
  updateItemsList() {
    this.items = Array.from(document.querySelectorAll('.vvp-item-tile:not([style*="display: none"])'));
    console.log(`KeyboardManager: Updated items list - ${this.items.length} visible items`);
  }

  navigatePages(direction) {
    const currentPageNumber = this.getCurrentPageNumber();
    const newPage = currentPageNumber + direction;
    
    if (newPage > 0) {
      const url = new URL(window.location);
      url.searchParams.set('page', newPage);
      window.location.href = url.toString();
    }
  }

  getCurrentPageNumber() {
    const urlParams = new URLSearchParams(window.location.search);
    return parseInt(urlParams.get('page')) || 1;
  }

  // Get navigation status
  getNavigationStatus() {
    return {
      totalItems: this.items.length,
      currentPage: this.getCurrentPageNumber()
    };
  }

  // Reset navigation state
  resetNavigation() {
    this.updateItemsList();
  }

  cleanup() {
    super.cleanup();
    document.removeEventListener('keydown', this.handleKeyDown.bind(this));
  }
} 
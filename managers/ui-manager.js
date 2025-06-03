// UI Manager - Handles control panel interface and UI interactions
class UIManager extends BaseManager {
  constructor(config) {
    super(config);
    this.controlPanel = null;
    this.currentPage = this.getCurrentPageNumber();
  }

  async setup() {
    await this.waitForElement('#vvp-items-grid');
    this.createControlPanel();
    this.setupControlListeners();
    this.setupStatusUpdates();
    console.log('UIManager: Interface created and ready');
  }

  getCurrentPageNumber() {
    const urlParams = new URLSearchParams(window.location.search);
    return parseInt(urlParams.get('page')) || 1;
  }

  createControlPanel() {
    this.controlPanel = document.createElement('div');
    this.controlPanel.id = 'vine-enhancer-panel';
    this.controlPanel.innerHTML = `
      <div class="vine-controls">
        <button id="mark-all-seen" title="Mark All as Seen">👁️ Mark All Seen</button>
        <div class="vine-slider-container">
          <span class="vine-slider-label">Show Seen:</span>
          <label class="vine-slider">
            <input type="checkbox" id="show-seen-slider" title="Toggle visibility of seen items">
            <span class="vine-slider-toggle"></span>
          </label>
        </div>
        <button id="clear-seen" title="Clear All Seen Items">🗑️ Clear Seen</button>
        <button id="toggle-bookmarks" title="Toggle Bookmarks Sidebar">📚 Bookmarks</button>
        <input type="text" id="filter-input" placeholder="Filter products..." title="Filter current page">
        <span id="status-info">Page ${this.currentPage} | Loading...</span>
      </div>
    `;

    // Insert control panel at the top of the page
    const grid = document.getElementById('vvp-items-grid');
    grid.parentNode.insertBefore(this.controlPanel, grid);
    
    // Add CSS for the slider
    this.addSliderStyles();
  }

  addSliderStyles() {
    if (document.getElementById('vine-slider-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'vine-slider-styles';
    style.textContent = `
      .vine-slider-container {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      
      .vine-slider-label {
        font-size: 12px;
        font-weight: 500;
        color: #333;
      }
      
      .vine-slider {
        position: relative;
        display: inline-block;
        width: 44px;
        height: 24px;
      }
      
      .vine-slider input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      
      .vine-slider-toggle {
        position: absolute;
        cursor: pointer;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: #ccc;
        transition: .4s;
        border-radius: 24px;
      }
      
      .vine-slider-toggle:before {
        position: absolute;
        content: "";
        height: 18px;
        width: 18px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        transition: .4s;
        border-radius: 50%;
      }
      
      .vine-slider input:checked + .vine-slider-toggle {
        background-color: #4CAF50;
      }
      
      .vine-slider input:checked + .vine-slider-toggle:before {
        transform: translateX(20px);
      }
      
      .vine-slider-toggle:hover {
        box-shadow: 0 0 1px #4CAF50;
      }
    `;
    document.head.appendChild(style);
  }

  setupControlListeners() {
    // Mark all seen
    document.getElementById('mark-all-seen').addEventListener('click', () => {
      this.emit('markAllSeen');
    });

    // Show/hide seen slider
    document.getElementById('show-seen-slider').addEventListener('change', (e) => {
      this.emit('setSeenVisibility', { visible: e.target.checked });
    });

    // Clear seen items
    document.getElementById('clear-seen').addEventListener('click', () => {
      if (confirm('Clear all seen items? This cannot be undone.')) {
        this.emit('clearAllSeen');
      }
    });

    // Toggle bookmarks sidebar
    document.getElementById('toggle-bookmarks').addEventListener('click', () => {
      this.emit('toggleBookmarkSidebar');
    });

    // Filter input
    const filterInput = document.getElementById('filter-input');
    filterInput.addEventListener('input', (e) => {
      this.emit('filterItems', { query: e.target.value });
    });

    // Clear filter on Escape
    filterInput.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.target.value = '';
        this.emit('filterItems', { query: '' });
      }
    });
    
    // Emit initial slider state to synchronize seen items manager
    this.syncSliderState();
  }

  syncSliderState() {
    const slider = document.getElementById('show-seen-slider');
    if (slider) {
      // Emit the initial state to synchronize with seen items manager
      this.emit('setSeenVisibility', { visible: slider.checked });
    }
  }

  // Get current slider state
  getSeenVisibilityState() {
    const slider = document.getElementById('show-seen-slider');
    return slider ? slider.checked : false;
  }

  // Set slider state programmatically
  setSliderState(visible) {
    const slider = document.getElementById('show-seen-slider');
    if (slider && slider.checked !== visible) {
      slider.checked = visible;
      this.emit('setSeenVisibility', { visible: visible });
    }
  }

  setupStatusUpdates() {
    // Listen for status updates from other managers
    this.on('seenItemsLoaded', (data) => {
      this.updateStatusInfo(data.seenItems.size);
    });

    this.on('itemMarkedSeen', (data) => {
      this.updateStatusInfo(data.seenItems.size);
    });

    this.on('itemMarkedUnseen', (data) => {
      this.updateStatusInfo(data.seenItems.size);
    });

    this.on('multipleItemsMarkedSeen', (data) => {
      this.updateStatusInfo(data.seenItems.size);
    });

    this.on('allSeenItemsCleared', (data) => {
      this.updateStatusInfo(data.seenItems.size);
    });

    this.on('filterLoaded', (data) => {
      this.restoreFilterInput(data.query);
    });

    this.on('itemsFiltered', (data) => {
      this.updateStatusInfo(null, data.visibleCount);
    });
  }

  updateStatusInfo(seenCount = null, visibleCount = null) {
    const statusElement = document.getElementById('status-info');
    if (!statusElement) return;

    // Get current values if not provided
    if (seenCount === null) {
      seenCount = this.getCurrentSeenCount();
    }
    
    if (visibleCount === null) {
      visibleCount = this.getCurrentVisibleCount();
    }

    statusElement.textContent = `Page ${this.currentPage} | ${seenCount} seen | ${visibleCount} visible`;
  }

  getCurrentSeenCount() {
    return document.querySelectorAll('.vine-seen').length;
  }

  getCurrentVisibleCount() {
    return document.querySelectorAll('.vvp-item-tile:not([style*="display: none"])').length;
  }

  // UI utility methods
  showNotification(message, type = 'info', duration = 3000) {
    const notification = document.createElement('div');
    notification.className = `vine-notification vine-notification-${type}`;
    notification.textContent = message;
    
    // Style the notification
    Object.assign(notification.style, {
      position: 'fixed',
      top: '20px',
      right: '20px',
      padding: '10px 15px',
      backgroundColor: type === 'error' ? '#f44336' : type === 'success' ? '#4caf50' : '#2196f3',
      color: 'white',
      borderRadius: '4px',
      zIndex: '10000',
      boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
    });

    document.body.appendChild(notification);

    // Auto-remove after duration
    setTimeout(() => {
      if (notification.parentNode) {
        notification.parentNode.removeChild(notification);
      }
    }, duration);
  }

  // Get current filter value
  getCurrentFilter() {
    const filterInput = document.getElementById('filter-input');
    return filterInput ? filterInput.value : '';
  }

  // Clear filter
  clearFilter() {
    const filterInput = document.getElementById('filter-input');
    if (filterInput) {
      filterInput.value = '';
      this.emit('filterItems', { query: '' });
    }
  }

  // Restore filter input value from stored query
  restoreFilterInput(query) {
    const filterInput = document.getElementById('filter-input');
    if (filterInput && query) {
      filterInput.value = query;
      console.log(`UIManager: Restored filter input: "${query}"`);
    }
  }

  cleanup() {
    super.cleanup();
    if (this.controlPanel && this.controlPanel.parentNode) {
      this.controlPanel.parentNode.removeChild(this.controlPanel);
    }
  }
} 
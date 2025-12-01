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
        <div class="vine-control-group vine-control-group-actions">
          <button id="mark-all-seen" title="Mark All as Seen">
            <span class="vine-btn-icon">👁️</span>
            <span class="vine-btn-text">Mark All</span>
          </button>
          <button id="clear-seen" title="Clear All Seen Items">
            <span class="vine-btn-icon">🗑️</span>
            <span class="vine-btn-text">Clear Seen</span>
          </button>
        </div>

        <div class="vine-control-separator"></div>

        <div class="vine-control-group vine-control-group-toggles">
          <div class="vine-slider-container">
            <span class="vine-slider-label">Show Seen</span>
            <label class="vine-slider">
              <input type="checkbox" id="show-seen-slider" title="Toggle visibility of seen items">
              <span class="vine-slider-toggle"></span>
            </label>
          </div>
        </div>

        <div class="vine-control-separator"></div>

        <div class="vine-control-group vine-control-group-view">
          <button id="toggle-view" title="Toggle Card/Table View">
            <span class="vine-btn-icon">📊</span>
            <span class="vine-btn-text">Table</span>
          </button>
          <button id="toggle-bookmarks" title="Toggle Bookmarks Sidebar">
            <span class="vine-btn-icon">📚</span>
            <span class="vine-btn-text">Bookmarks</span>
          </button>
        </div>

        <div class="vine-control-separator"></div>

        <div class="vine-control-group vine-control-group-filter">
          <input type="text" id="filter-input" placeholder="🔍 Filter products..." title="Filter current page">
        </div>

        <div class="vine-control-group vine-control-group-status">
          <span id="status-info">Page ${this.currentPage} | Loading...</span>
        </div>
      </div>
    `;

    // Insert control panel at the top of the page
    const grid = document.getElementById('vvp-items-grid');
    grid.parentNode.insertBefore(this.controlPanel, grid);
    
    // Add CSS for the slider
    this.addSliderStyles();
    
    // Initialize view mode
    this.currentView = 'card'; // 'card' or 'table'
    
    // Set initial view state on body
    document.body.setAttribute('data-vine-view', 'card');
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

    // Toggle view mode
    document.getElementById('toggle-view').addEventListener('click', () => {
      this.toggleView();
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
      this.updateStatusInfo();
    });

    this.on('itemMarkedSeen', (data) => {
      this.updateStatusInfo();
    });

    this.on('itemMarkedUnseen', (data) => {
      this.updateStatusInfo();
    });

    this.on('multipleItemsMarkedSeen', (data) => {
      this.updateStatusInfo();
    });

    this.on('allSeenItemsCleared', (data) => {
      this.updateStatusInfo();
    });

    // Listen for new items updates
    this.on('newItemsStatsUpdated', (data) => {
      this.updateStatusInfo();
    });

    this.on('newItemsDetected', (data) => {
      this.updateStatusInfo();
    });

    this.on('filterLoaded', (data) => {
      this.restoreFilterInput(data.query);
    });

    this.on('itemsFiltered', (data) => {
      this.updateStatusInfo();
    });

    // Listen for table row visibility updates
    this.on('updateTableRowVisibility', (data) => {
      this.updateTableRow(data.itemId, { visible: data.visible });
    });
  }

  updateStatusInfo() {
    const statusElement = document.getElementById('status-info');
    if (!statusElement) return;

    const seenCount = this.getCurrentSeenCount();
    const newCount = this.getCurrentNewItemsCount();
    const visibleCount = this.getCurrentVisibleCount();

    statusElement.textContent = `Page ${this.currentPage} | ${seenCount} seen | ${newCount} NEW | ${visibleCount} visible`;
  }

  getCurrentSeenCount() {
    return document.querySelectorAll('.vine-seen').length;
  }

  getCurrentNewItemsCount() {
    return document.querySelectorAll('.vine-new-item').length;
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
    }
  }

  toggleView() {
    this.currentView = this.currentView === 'card' ? 'table' : 'card';
    const button = document.getElementById('toggle-view');

    // Set data attribute on body for CSS targeting
    document.body.setAttribute('data-vine-view', this.currentView);

    if (this.currentView === 'table') {
      button.innerHTML = '<span class="vine-btn-icon">🃏</span><span class="vine-btn-text">Cards</span>';
      this.showTableView();
    } else {
      button.innerHTML = '<span class="vine-btn-icon">📊</span><span class="vine-btn-text">Table</span>';
      this.showCardView();
    }
  }

  showTableView() {
    const grid = document.getElementById('vvp-items-grid');
    if (!grid) {
      return;
    }

    // Create or show table container
    let tableContainer = document.getElementById('vine-table-container');
    if (!tableContainer) {
      tableContainer = document.createElement('div');
      tableContainer.id = 'vine-table-container';
      tableContainer.className = 'vine-table-container';
      grid.parentNode.insertBefore(tableContainer, grid.nextSibling);
    }

    // Build table from grid items
    const items = Array.from(grid.querySelectorAll('.vvp-item-tile'));
    
    const tableHTML = this.buildTableHTML(items);
    tableContainer.innerHTML = tableHTML;

    // Attach event listeners to table actions
    this.attachTableEventListeners(tableContainer);
  }

  showCardView() {
    // CSS will handle the display via data-vine-view attribute
  }

  buildTableHTML(items) {
    const rows = items.map(item => {
      // Extract title and link
      const titleElement = item.querySelector('.vvp-item-product-title-container a');
      const title = titleElement?.textContent.trim() || 'N/A';
      const link = titleElement?.href || '#';
      
      // Extract image
      const image = item.querySelector('img')?.src || '';
      
      // Extract ETV - look for the tax value in the content
      let etv = 'N/A';
      const content = item.querySelector('.vvp-item-tile-content');
      if (content) {
        // Try to find ETV in various possible locations
        const etvElement = content.querySelector('.a-size-base.a-color-secondary') || 
                          content.querySelector('[class*="tax"]') ||
                          Array.from(content.querySelectorAll('span')).find(span => 
                            span.textContent.includes('$') || span.textContent.includes('ETV')
                          );
        if (etvElement) {
          etv = etvElement.textContent.trim();
        }
      }
      
      // Get item states
      const isSeen = item.classList.contains('vine-seen');
      const isBookmarked = item.classList.contains('vine-bookmarked');
      const isNew = item.classList.contains('vine-new-item');
      const itemId = item.dataset.vineItemId || '';
      const isHidden = item.style.display === 'none';

      return `
        <tr class="vine-table-row ${isSeen ? 'vine-table-row-seen' : ''} ${isBookmarked ? 'vine-table-row-bookmarked' : ''} ${isNew ? 'vine-table-row-new' : ''}" 
            data-item-id="${itemId}" 
            style="${isHidden ? 'display: none;' : ''}">
          <td class="vine-table-cell vine-table-cell-image">
            <img src="${image}" alt="Product" class="vine-table-image">
          </td>
          <td class="vine-table-cell vine-table-cell-title">
            <a href="${link}" target="_blank" class="vine-table-link">${title}</a>
            ${isNew ? '<span class="vine-table-badge-new">NEW</span>' : ''}
          </td>
          <td class="vine-table-cell vine-table-cell-etv">${etv}</td>
          <td class="vine-table-cell vine-table-cell-status">
            ${isSeen ? '<span class="vine-table-badge vine-table-badge-seen">✓ Seen</span>' : '<span class="vine-table-badge">Not Seen</span>'}
            ${isBookmarked ? '<span class="vine-table-badge vine-table-badge-bookmarked">⭐ Bookmarked</span>' : ''}
          </td>
          <td class="vine-table-cell vine-table-cell-actions">
            <button class="vine-table-btn vine-table-btn-seen" data-action="toggle-seen" data-item-id="${itemId}" title="${isSeen ? 'Mark as Unseen' : 'Mark as Seen'}">
              ${isSeen ? '👁️' : '👁️‍🗨️'}
            </button>
            <button class="vine-table-btn vine-table-btn-bookmark" data-action="toggle-bookmark" data-item-id="${itemId}" title="${isBookmarked ? 'Remove Bookmark' : 'Add Bookmark'}">
              ${isBookmarked ? '⭐' : '☆'}
            </button>
          </td>
        </tr>
      `;
    }).join('');

    return `
      <table class="vine-table">
        <thead class="vine-table-header">
          <tr>
            <th class="vine-table-header-cell">Image</th>
            <th class="vine-table-header-cell">Product Title</th>
            <th class="vine-table-header-cell">ETV</th>
            <th class="vine-table-header-cell">Status</th>
            <th class="vine-table-header-cell">Actions</th>
          </tr>
        </thead>
        <tbody class="vine-table-body">
          ${rows}
        </tbody>
      </table>
    `;
  }

  attachTableEventListeners(tableContainer) {
    // Handle action buttons
    tableContainer.addEventListener('click', (e) => {
      const button = e.target.closest('[data-action]');
      if (!button) return;

      const action = button.dataset.action;
      const itemId = button.dataset.itemId;

      if (action === 'toggle-seen') {
        this.emit('toggleSeenFromTable', { itemId });
      } else if (action === 'toggle-bookmark') {
        this.emit('toggleBookmarkFromTable', { itemId });
      }
    });
  }

  // Update table row when item state changes
  updateTableRow(itemId, updates) {
    const tableContainer = document.getElementById('vine-table-container');
    if (!tableContainer || this.currentView !== 'table') return;

    const row = tableContainer.querySelector(`tr[data-item-id="${itemId}"]`);
    if (!row) return;

    if (updates.seen !== undefined) {
      row.classList.toggle('vine-table-row-seen', updates.seen);
      const statusCell = row.querySelector('.vine-table-cell-status');
      const seenBtn = row.querySelector('[data-action="toggle-seen"]');
      
      if (statusCell) {
        const seenBadge = statusCell.querySelector('.vine-table-badge-seen');
        if (updates.seen && !seenBadge) {
          statusCell.insertAdjacentHTML('afterbegin', '<span class="vine-table-badge vine-table-badge-seen">✓ Seen</span>');
        } else if (!updates.seen && seenBadge) {
          seenBadge.remove();
        }
      }
      
      if (seenBtn) {
        seenBtn.textContent = updates.seen ? '👁️' : '👁️‍🗨️';
        seenBtn.title = updates.seen ? 'Mark as Unseen' : 'Mark as Seen';
      }
    }

    if (updates.bookmarked !== undefined) {
      row.classList.toggle('vine-table-row-bookmarked', updates.bookmarked);
      const statusCell = row.querySelector('.vine-table-cell-status');
      const bookmarkBtn = row.querySelector('[data-action="toggle-bookmark"]');
      
      if (statusCell) {
        const bookmarkBadge = statusCell.querySelector('.vine-table-badge-bookmarked');
        if (updates.bookmarked && !bookmarkBadge) {
          statusCell.insertAdjacentHTML('beforeend', '<span class="vine-table-badge vine-table-badge-bookmarked">⭐ Bookmarked</span>');
        } else if (!updates.bookmarked && bookmarkBadge) {
          bookmarkBadge.remove();
        }
      }
      
      if (bookmarkBtn) {
        bookmarkBtn.textContent = updates.bookmarked ? '⭐' : '☆';
        bookmarkBtn.title = updates.bookmarked ? 'Remove Bookmark' : 'Add Bookmark';
      }
    }

    if (updates.visible !== undefined) {
      row.style.display = updates.visible ? '' : 'none';
    }
  }

  cleanup() {
    super.cleanup();
    if (this.controlPanel && this.controlPanel.parentNode) {
      this.controlPanel.parentNode.removeChild(this.controlPanel);
    }
    const tableContainer = document.getElementById('vine-table-container');
    if (tableContainer && tableContainer.parentNode) {
      tableContainer.parentNode.removeChild(tableContainer);
    }
  }
} 
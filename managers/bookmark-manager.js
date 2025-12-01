// Bookmark Manager - Handles bookmarking items and sidebar display
class BookmarkManager extends BaseManager {
  constructor(config) {
    super(config);
    this.storageManager = null;
    this.sidebarVisible = false;
    this.sidebar = null;
  }

  async setup() {
    this.setupEventListeners();
    await this.waitForElement('#vvp-items-grid');
    this.createSidebar();
    this.processAllItems();
  }

  setStorageManager(storageManager) {
    this.storageManager = storageManager;
  }

  setupEventListeners() {
    // Listen for storage events
    this.on('bookmarksLoaded', () => {
      this.processAllItems();
      this.updateSidebar();
    });

    this.on('itemBookmarked', (data) => {
      this.updateItemVisualState(data.title, true);
      this.updateSidebar();
    });

    this.on('itemUnbookmarked', (data) => {
      this.updateItemVisualState(data.title, false);
      this.updateSidebar();
    });

    this.on('allBookmarksCleared', () => {
      this.clearAllVisualStates();
      this.updateSidebar();
    });

    // Listen for UI events
    this.on('toggleBookmarkSidebar', () => {
      this.toggleSidebar();
    });

    this.on('clearAllBookmarks', () => {
      if (this.storageManager) {
        this.storageManager.clearAllBookmarks();
      }
    });
  }

  createSidebar() {
    this.sidebar = document.createElement('div');
    this.sidebar.id = 'vine-bookmark-sidebar';
    this.sidebar.className = 'vine-sidebar';
    this.sidebar.innerHTML = `
      <div class="vine-sidebar-header">
        <h3>📚 Bookmarks</h3>
        <button id="close-bookmark-sidebar" title="Close sidebar">✕</button>
      </div>
      <div class="vine-sidebar-content">
        <div id="bookmark-list">
          <p class="vine-empty-message">No bookmarks yet</p>
        </div>
      </div>
      <div class="vine-sidebar-footer">
        <button id="clear-all-bookmarks" title="Clear all bookmarks">🗑️ Clear All</button>
      </div>
    `;

    document.body.appendChild(this.sidebar);
    this.setupSidebarListeners();
    this.addSidebarStyles();
  }

  addSidebarStyles() {
    if (document.getElementById('vine-bookmark-sidebar-styles')) return;
    
    const style = document.createElement('style');
    style.id = 'vine-bookmark-sidebar-styles';
    style.textContent = `
      .vine-sidebar {
        position: fixed;
        top: 0;
        right: -350px;
        width: 350px;
        height: 100vh;
        background: white;
        border-left: 2px solid #ddd;
        box-shadow: -2px 0 10px rgba(0,0,0,0.1);
        z-index: 10000;
        transition: right 0.3s ease;
        display: flex;
        flex-direction: column;
      }
      
      .vine-sidebar.visible {
        right: 0;
      }
      
      .vine-sidebar-header {
        padding: 15px;
        border-bottom: 1px solid #eee;
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: #f8f9fa;
      }
      
      .vine-sidebar-header h3 {
        margin: 0;
        font-size: 16px;
        color: #333;
      }
      
      .vine-sidebar-content {
        flex: 1;
        overflow-y: auto;
        padding: 10px;
      }
      
      .vine-sidebar-footer {
        padding: 15px;
        border-top: 1px solid #eee;
        background: #f8f9fa;
      }
      
      #bookmark-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
      }
      
      .bookmark-item {
        padding: 12px;
        border: 1px solid #ddd;
        border-radius: 6px;
        background: #fafafa;
        cursor: pointer;
        transition: background-color 0.2s;
      }
      
      .bookmark-item:hover {
        background: #f0f0f0;
      }
      
      .bookmark-title {
        font-weight: 500;
        font-size: 14px;
        color: #333;
        margin-bottom: 5px;
        line-height: 1.3;
      }
      
      .bookmark-url {
        font-size: 12px;
        color: #666;
        text-decoration: none;
      }
      
      .bookmark-page-info {
        font-size: 11px;
        color: #888;
        font-weight: 500;
        margin-top: 3px;
        padding: 2px 6px;
        background: #f0f0f0;
        border-radius: 3px;
        display: inline-block;
        width: fit-content;
      }
      
      .bookmark-actions {
        margin-top: 8px;
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      
      .bookmark-action {
        padding: 4px 8px;
        font-size: 11px;
        border: 1px solid #ccc;
        background: white;
        border-radius: 3px;
        cursor: pointer;
        transition: background-color 0.2s;
      }
      
      .bookmark-action:hover {
        background: #e9ecef;
      }
      
      .vine-empty-message {
        text-align: center;
        color: #666;
        font-style: italic;
        margin: 20px 0;
      }
      
      #close-bookmark-sidebar, #clear-all-bookmarks {
        background: none;
        border: 1px solid #ccc;
        padding: 6px 12px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        transition: background-color 0.2s;
      }
      
      #close-bookmark-sidebar:hover, #clear-all-bookmarks:hover {
        background: #e9ecef;
      }
      
      #clear-all-bookmarks {
        width: 100%;
      }
    `;
    document.head.appendChild(style);
  }

  setupSidebarListeners() {
    // Close sidebar
    document.getElementById('close-bookmark-sidebar').addEventListener('click', () => {
      this.hideSidebar();
    });

    // Clear all bookmarks
    document.getElementById('clear-all-bookmarks').addEventListener('click', () => {
      if (confirm('Clear all bookmarks? This cannot be undone.')) {
        this.emit('clearAllBookmarks');
      }
    });

    // Close sidebar when clicking outside
    document.addEventListener('click', (e) => {
      if (this.sidebarVisible && 
          !this.sidebar.contains(e.target) && 
          !e.target.classList.contains('vine-bookmark-btn') &&
          !e.target.closest('#vine-enhancer-panel')) {
        this.hideSidebar();
      }
    });
  }

  processAllItems() {
    const items = document.querySelectorAll('.vvp-item-tile');
    let processedCount = 0;
    
    items.forEach(item => {
      if (!item.hasAttribute('data-vine-bookmark-processed')) {
        this.processItem(item);
        processedCount++;
      }
    });
  }

  processItem(item) {
    const title = this.extractItemTitle(item);
    const url = this.extractItemUrl(item);
    const pageNumber = this.getCurrentPageNumber();
    const pageUrl = this.getCurrentPageUrl();
    
    // Check if item is already bookmarked
    if (this.storageManager && this.storageManager.isItemBookmarked(title)) {
      item.classList.add('vine-bookmarked');
    }
    
    // Add bookmark button
    this.addBookmarkButton(item, title, url, pageNumber, pageUrl);
    
    // Mark as processed
    item.setAttribute('data-vine-bookmark-processed', 'true');
  }

  extractItemUrl(item) {
    const link = item.querySelector('.vvp-item-product-title-container a');
    if (link) {
      const href = link.getAttribute('href');
      // Convert relative URL to absolute
      if (href && href.startsWith('/')) {
        return window.location.origin + href;
      }
      return href || '';
    }
    return '';
  }

  getCurrentPageNumber() {
    const urlParams = new URLSearchParams(window.location.search);
    return parseInt(urlParams.get('page')) || 1;
  }

  getCurrentPageUrl() {
    return window.location.href;
  }

  addBookmarkButton(item, title, url, pageNumber, pageUrl) {
    // Check if button already exists
    if (item.querySelector('.vine-bookmark-btn')) return;

    const button = document.createElement('button');
    button.className = 'vine-bookmark-btn';
    button.innerHTML = this.storageManager && this.storageManager.isItemBookmarked(title) ? '📚' : '📖';
    button.title = 'Toggle bookmark (B)';
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleItemBookmark(title, url, pageNumber, pageUrl, item);
    });

    const content = item.querySelector('.vvp-item-tile-content');
    if (content) {
      content.appendChild(button);
    }
  }

  toggleItemBookmark(title, url, pageNumber, pageUrl, item) {
    if (!this.storageManager) return;

    const wasToggled = this.storageManager.toggleBookmark(title, url, pageNumber, pageUrl);
    if (wasToggled) {
      const isBookmarked = this.storageManager.isItemBookmarked(title);
      this.updateItemVisualState(title, isBookmarked, item);
    }
  }

  updateItemVisualState(title, isBookmarked, specificItem = null) {
    // Find the item(s) to update
    const items = specificItem ? [specificItem] : this.findItemsByTitle(title);
    
    items.forEach(item => {
      const button = item.querySelector('.vine-bookmark-btn');
      
      if (isBookmarked) {
        item.classList.add('vine-bookmarked');
        if (button) button.innerHTML = '📚';
      } else {
        item.classList.remove('vine-bookmarked');
        if (button) button.innerHTML = '📖';
      }
    });
  }

  findItemsByTitle(title) {
    const items = document.querySelectorAll('.vvp-item-tile');
    return Array.from(items).filter(item => {
      return this.extractItemTitle(item) === title;
    });
  }

  clearAllVisualStates() {
    const bookmarkedItems = document.querySelectorAll('.vine-bookmarked');
    bookmarkedItems.forEach(item => {
      item.classList.remove('vine-bookmarked');
      const button = item.querySelector('.vine-bookmark-btn');
      if (button) button.innerHTML = '📖';
    });
  }

  updateSidebar() {
    if (!this.storageManager) return;

    const bookmarks = this.storageManager.getBookmarksArray();
    const bookmarkList = document.getElementById('bookmark-list');
    
    if (bookmarks.length === 0) {
      bookmarkList.innerHTML = '<p class="vine-empty-message">No bookmarks yet</p>';
      return;
    }

    bookmarkList.innerHTML = bookmarks.map(bookmark => `
      <div class="bookmark-item" data-title="${this.escapeHtml(bookmark.title)}">
        <div class="bookmark-title">${this.escapeHtml(bookmark.title)}</div>
        <div class="bookmark-url">${this.escapeHtml(bookmark.url)}</div>
        <div class="bookmark-page-info">Page ${bookmark.pageNumber || 1}</div>
        <div class="bookmark-actions">
          <button class="bookmark-action bookmark-visit" data-url="${this.escapeHtml(bookmark.url)}">Visit Item</button>
          <button class="bookmark-action bookmark-visit-page" data-page-url="${this.escapeHtml(bookmark.pageUrl || '')}">Visit Page</button>
          <button class="bookmark-action bookmark-remove" data-title="${this.escapeHtml(bookmark.title)}">Remove</button>
        </div>
      </div>
    `).join('');

    // Add event listeners to bookmark actions
    bookmarkList.querySelectorAll('.bookmark-visit').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const url = btn.getAttribute('data-url');
        window.open(url, '_blank');
      });
    });

    bookmarkList.querySelectorAll('.bookmark-visit-page').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const pageUrl = btn.getAttribute('data-page-url');
        if (pageUrl) {
          window.open(pageUrl, '_blank');
        }
      });
    });

    bookmarkList.querySelectorAll('.bookmark-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const title = btn.getAttribute('data-title');
        this.storageManager.removeBookmark(title);
      });
    });

    // Add click to visit page functionality for the whole item
    bookmarkList.querySelectorAll('.bookmark-item').forEach(item => {
      item.addEventListener('click', (e) => {
        if (!e.target.classList.contains('bookmark-action')) {
          const title = item.getAttribute('data-title');
          const bookmark = bookmarks.find(b => b.title === title);
          if (bookmark) {
            // Prefer visiting the page where the item was found
            const targetUrl = bookmark.pageUrl || bookmark.url;
            window.open(targetUrl, '_blank');
          }
        }
      });
    });
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showSidebar() {
    this.sidebarVisible = true;
    this.sidebar.classList.add('visible');
    this.updateSidebar();
  }

  hideSidebar() {
    this.sidebarVisible = false;
    this.sidebar.classList.remove('visible');
  }

  toggleSidebar() {
    if (this.sidebarVisible) {
      this.hideSidebar();
    } else {
      this.showSidebar();
    }
  }

  // Handle new items added to the page (for infinite scroll)
  processNewItems(items) {
    items.forEach(item => {
      if (!item.hasAttribute('data-vine-bookmark-processed')) {
        this.processItem(item);
      }
    });
  }

  getCurrentBookmarkCount() {
    return document.querySelectorAll('.vine-bookmarked').length;
  }

  getBookmarkedItemsOnCurrentPage() {
    const bookmarkedItems = document.querySelectorAll('.vine-bookmarked');
    return Array.from(bookmarkedItems).map(item => this.extractItemTitle(item));
  }
} 
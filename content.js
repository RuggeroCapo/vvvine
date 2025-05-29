// Amazon Vine Efficiency Enhancer - Content Script
// Implements: Title expansion, mark as seen, filtering, keyboard navigation, infinite scroll

class AmazonVineEnhancer {
  constructor() {
    this.seenItems = new Set();
    this.currentPage = this.getCurrentPageNumber();
    this.isLoading = false;
    this.keyboardMode = false;
    this.currentItemIndex = 0;
    this.items = [];
    
    this.init();
  }

  async init() {
    console.log('Amazon Vine Efficiency Enhancer - Initializing...');
    
    // Load saved data
    await this.loadSeenItems();
    
    // Wait for grid to be available
    this.waitForGrid().then(() => {
      this.setupInterface();
      this.expandAllTitles();
      this.markSeenItems();
      this.setupKeyboardNavigation();
      this.setupInfiniteScroll();
      this.updateItemsList();
    });
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

  getCurrentPageNumber() {
    const urlParams = new URLSearchParams(window.location.search);
    return parseInt(urlParams.get('page')) || 1;
  }

  // Helper method to extract item title consistently
  extractItemTitle(item) {
    const title = item.querySelector('.a-truncate-full')?.textContent || 
                 item.querySelector('.a-truncate-cut')?.textContent || '';
    return title.trim(); // Normalize by trimming whitespace
  }

  async loadSeenItems() {
    try {
      // First, try to load title-based seen items
      const result = await chrome.storage.local.get(['vineSeenTitles']);
      this.seenItems = new Set(result.vineSeenTitles || []);
      
      
      console.log(`Loaded ${this.seenItems.size} seen items`);
    } catch (error) {
      console.error('Error loading seen items:', error);
    }
  }

  async saveSeenItems() {
    try {
      await chrome.storage.local.set({
        vineSeenTitles: Array.from(this.seenItems)
      });
    } catch (error) {
      console.error('Error saving seen items:', error);
    }
  }

  setupInterface() {
    // Create control panel
    const controlPanel = document.createElement('div');
    controlPanel.id = 'vine-enhancer-panel';
    controlPanel.innerHTML = `
      <div class="vine-controls">
        <button id="toggle-titles" title="Toggle Full Titles (Space)">📄 Full Titles</button>
        <button id="mark-all-seen" title="Mark All as Seen">👁️ Mark All Seen</button>
        <button id="hide-seen" title="Hide/Show Seen Items">🙈 Toggle Seen</button>
        <button id="clear-seen" title="Clear All Seen Items">🗑️ Clear Seen</button>
        <input type="text" id="filter-input" placeholder="Filter products..." title="Filter current page">
        <span id="status-info">Page ${this.currentPage} | ${this.seenItems.size} seen</span>
      </div>
    `;

    // Insert control panel at the top of the page
    const grid = document.getElementById('vvp-items-grid');
    grid.parentNode.insertBefore(controlPanel, grid);

    // Setup event listeners
    this.setupControlListeners();
  }

  setupControlListeners() {
    document.getElementById('toggle-titles').addEventListener('click', () => {
      this.toggleAllTitles();
    });

    document.getElementById('mark-all-seen').addEventListener('click', () => {
      this.markAllCurrentPageAsSeen();
    });

    document.getElementById('hide-seen').addEventListener('click', () => {
      this.toggleSeenItems();
    });

    document.getElementById('clear-seen').addEventListener('click', () => {
      this.clearAllSeenItems();
    });

    document.getElementById('filter-input').addEventListener('input', (e) => {
      this.filterItems(e.target.value);
    });
  }

  // Feature 1: Full Title Expander
  expandAllTitles() {
    const titles = document.querySelectorAll('.a-truncate');
    titles.forEach(titleContainer => {
      const fullTitle = titleContainer.querySelector('.a-truncate-full');
      const cutTitle = titleContainer.querySelector('.a-truncate-cut');
      
      if (fullTitle && cutTitle) {
        // Show full title
        fullTitle.classList.remove('a-offscreen');
        cutTitle.style.display = 'none';
      }
    });
  }

  toggleAllTitles() {
    const titles = document.querySelectorAll('.a-truncate');
    const isExpanded = !document.querySelector('.a-truncate-full.a-offscreen');
    
    titles.forEach(titleContainer => {
      const fullTitle = titleContainer.querySelector('.a-truncate-full');
      const cutTitle = titleContainer.querySelector('.a-truncate-cut');
      
      if (fullTitle && cutTitle) {
        if (isExpanded) {
          // Collapse
          fullTitle.classList.add('a-offscreen');
          cutTitle.style.display = '';
        } else {
          // Expand
          fullTitle.classList.remove('a-offscreen');
          cutTitle.style.display = 'none';
        }
      }
    });
  }

  // Feature 2: Mark as Seen / Hide Item
  markSeenItems() {
    const items = document.querySelectorAll('.vvp-item-tile');
    items.forEach(item => {
      const title = this.extractItemTitle(item);
      if (this.seenItems.has(title)) {
        item.classList.add('vine-seen');
      }
      
      // Add click handler to mark as seen
      item.addEventListener('click', (e) => {
        if (e.ctrlKey || e.target.classList.contains('vine-mark-seen')) {
          e.preventDefault();
          this.toggleItemSeen(title, item);
        }
      });

      // Add mark as seen button
      this.addMarkSeenButton(item, title);
    });
  }

  addMarkSeenButton(item, title) {
    const button = document.createElement('button');
    button.className = 'vine-mark-seen';
    button.innerHTML = this.seenItems.has(title) ? '👁️' : '👀';
    button.title = 'Toggle seen status (H)';
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleItemSeen(title, item);
    });

    const content = item.querySelector('.vvp-item-tile-content');
    content.appendChild(button);
  }

  toggleItemSeen(title, item) {
    if (this.seenItems.has(title)) {
      this.seenItems.delete(title);
      item.classList.remove('vine-seen');
      item.querySelector('.vine-mark-seen').innerHTML = '👀';
    } else {
      this.seenItems.add(title);
      item.classList.add('vine-seen');
      item.querySelector('.vine-mark-seen').innerHTML = '👁️';
    }
    
    this.saveSeenItems();
    this.updateStatusInfo();
  }

  markAllCurrentPageAsSeen() {
    const items = document.querySelectorAll('.vvp-item-tile');
    items.forEach(item => {
      const title = this.extractItemTitle(item);
      this.seenItems.add(title);
      item.classList.add('vine-seen');
      const button = item.querySelector('.vine-mark-seen');
      if (button) button.innerHTML = '👁️';
    });
    
    this.saveSeenItems();
    this.updateStatusInfo();
  }

  toggleSeenItems() {
    const seenItems = document.querySelectorAll('.vine-seen');
    const isHidden = seenItems.length > 0 && seenItems[0].style.display === 'none';
    
    seenItems.forEach(item => {
      item.style.display = isHidden ? '' : 'none';
    });
  }

  clearAllSeenItems() {
    if (confirm('Clear all seen items? This cannot be undone.')) {
      this.seenItems.clear();
      document.querySelectorAll('.vine-seen').forEach(item => {
        item.classList.remove('vine-seen');
        const button = item.querySelector('.vine-mark-seen');
        if (button) button.innerHTML = '👀';
      });
      this.saveSeenItems();
      this.updateStatusInfo();
    }
  }

  // Feature 3: Client-Side Filtering
  filterItems(query) {
    const items = document.querySelectorAll('.vvp-item-tile');
    const lowerQuery = query.toLowerCase();
    
    items.forEach(item => {
      const title = this.extractItemTitle(item);
      
      const matches = title.toLowerCase().includes(lowerQuery);
      item.style.display = matches || !query ? '' : 'none';
    });
  }

  // Feature 4: Keyboard Navigation
  setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
      // Only handle when not in input fields
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      switch(e.key) {
        case ' ':
          e.preventDefault();
          this.toggleAllTitles();
          break;
        case 'h':
        case 'H':
          e.preventDefault();
          if (this.items[this.currentItemIndex]) {
            const item = this.items[this.currentItemIndex];
            const title = this.extractItemTitle(item);
            this.toggleItemSeen(title, item);
          }
          break;
        case 'j':
        case 'J':
          e.preventDefault();
          this.navigateItems(1);
          break;
        case 'k':
        case 'K':
          e.preventDefault();
          this.navigateItems(-1);
          break;
        case 'Escape':
          e.preventDefault();
          document.getElementById('filter-input').value = '';
          this.filterItems('');
          break;
        case 'ArrowLeft':
          if (e.ctrlKey) {
            e.preventDefault();
            this.navigatePages(-1);
          }
          break;
        case 'ArrowRight':
          if (e.ctrlKey) {
            e.preventDefault();
            this.navigatePages(1);
          }
          break;
      }
    });
  }

  updateItemsList() {
    this.items = Array.from(document.querySelectorAll('.vvp-item-tile:not([style*="display: none"])'));
  }

  navigateItems(direction) {
    this.updateItemsList();
    
    // Remove previous highlight
    document.querySelectorAll('.vine-current-item').forEach(item => {
      item.classList.remove('vine-current-item');
    });

    // Update index
    this.currentItemIndex = Math.max(0, Math.min(this.items.length - 1, this.currentItemIndex + direction));
    
    // Highlight current item
    if (this.items[this.currentItemIndex]) {
      const currentItem = this.items[this.currentItemIndex];
      currentItem.classList.add('vine-current-item');
      currentItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  navigatePages(direction) {
    const newPage = this.currentPage + direction;
    if (newPage > 0) {
      const url = new URL(window.location);
      url.searchParams.set('page', newPage);
      window.location.href = url.toString();
    }
  }

  // Feature 5: Infinite Scroll (Optional)
  setupInfiniteScroll() {
    // For now, just setup the detection for future implementation
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !this.isLoading) {
          // Future: Auto-load next page
          console.log('Near end of page - could auto-load next page');
        }
      });
    });

    // Observe the last item
    const lastItem = document.querySelector('.vvp-item-tile:last-child');
    if (lastItem) {
      observer.observe(lastItem);
    }
  }

  updateStatusInfo() {
    const statusElement = document.getElementById('status-info');
    if (statusElement) {
      const visibleItems = document.querySelectorAll('.vvp-item-tile:not([style*="display: none"])').length;
      statusElement.textContent = `Page ${this.currentPage} | ${this.seenItems.size} seen | ${visibleItems} visible`;
    }
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new AmazonVineEnhancer();
  });
} else {
  new AmazonVineEnhancer();
} 
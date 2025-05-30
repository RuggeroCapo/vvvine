// Seen Items Manager - Handles visual marking and interaction with seen items
class SeenItemsManager extends BaseManager {
  constructor(config) {
    super(config);
    this.storageManager = null;
    this.seenItemsVisible = false; // Default to hiding seen items
  }

  async setup() {
    this.setupEventListeners();
    await this.waitForElement('#vvp-items-grid');
    this.processAllItems();
    console.log('SeenItemsManager: Initialized and items processed');
  }

  setStorageManager(storageManager) {
    this.storageManager = storageManager;
  }

  setupEventListeners() {
    // Listen for storage events
    this.on('seenItemsLoaded', () => {
      this.processAllItems();
    });

    this.on('itemMarkedSeen', (data) => {
      this.updateItemVisualState(data.title, true);
    });

    this.on('itemMarkedUnseen', (data) => {
      this.updateItemVisualState(data.title, false);
    });

    this.on('allSeenItemsCleared', () => {
      this.clearAllVisualStates();
    });

    // Listen for UI events
    this.on('markAllSeen', () => {
      this.markAllCurrentPageAsSeen();
    });

    this.on('setSeenVisibility', (data) => {
      this.setSeenItemsVisibility(data.visible);
    });

    this.on('clearAllSeen', () => {
      if (this.storageManager) {
        this.storageManager.clearAllSeenItems();
      }
    });
  }

  processAllItems() {
    const items = document.querySelectorAll('.vvp-item-tile');
    let processedCount = 0;
    
    items.forEach(item => {
      if (!item.hasAttribute('data-vine-processed')) {
        this.processItem(item);
        processedCount++;
      }
    });

    console.log(`SeenItemsManager: Processed ${processedCount} new items`);
  }

  processItem(item) {
    const title = this.extractItemTitle(item);
    
    // Check if item is already seen
    if (this.storageManager && this.storageManager.isItemSeen(title)) {
      item.classList.add('vine-seen');
    }
    
    // Add click handler for Ctrl+click to mark as seen
    item.addEventListener('click', (e) => {
      if (e.ctrlKey || e.target.classList.contains('vine-mark-seen')) {
        e.preventDefault();
        this.toggleItemSeen(title, item);
      }
    });

    // Add mark as seen button
    this.addMarkSeenButton(item, title);
    
    // Mark as processed
    item.setAttribute('data-vine-processed', 'true');
  }

  addMarkSeenButton(item, title) {
    // Check if button already exists
    if (item.querySelector('.vine-mark-seen')) return;

    const button = document.createElement('button');
    button.className = 'vine-mark-seen';
    button.innerHTML = this.storageManager && this.storageManager.isItemSeen(title) ? '👁️' : '👀';
    button.title = 'Toggle seen status (H)';
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleItemSeen(title, item);
    });

    const content = item.querySelector('.vvp-item-tile-content');
    if (content) {
      content.appendChild(button);
    }
  }

  toggleItemSeen(title, item) {
    if (!this.storageManager) return;

    const wasToggled = this.storageManager.toggleSeenItem(title);
    if (wasToggled) {
      const isSeen = this.storageManager.isItemSeen(title);
      this.updateItemVisualState(title, isSeen, item);
      
      // If item was marked as seen and slider is set to hide, hide it immediately
      if (isSeen && !this.seenItemsVisible) {
        this.hideSeenItem(item);
      }
    }
  }

  updateItemVisualState(title, isSeen, specificItem = null) {
    // Find the item(s) to update
    const items = specificItem ? [specificItem] : this.findItemsByTitle(title);
    
    items.forEach(item => {
      const button = item.querySelector('.vine-mark-seen');
      
      if (isSeen) {
        item.classList.add('vine-seen');
        if (button) button.innerHTML = '👁️';
        
        // Auto-hide if slider is set to hide seen items
        if (!this.seenItemsVisible) {
          this.hideSeenItem(item);
        }
      } else {
        item.classList.remove('vine-seen');
        if (button) button.innerHTML = '👀';
        // Always show when unmarked as seen
        item.style.display = '';
      }
    });
  }

  findItemsByTitle(title) {
    const items = document.querySelectorAll('.vvp-item-tile');
    return Array.from(items).filter(item => {
      return this.extractItemTitle(item) === title;
    });
  }

  markAllCurrentPageAsSeen() {
    if (!this.storageManager) return;

    const items = document.querySelectorAll('.vvp-item-tile');
    const titles = Array.from(items).map(item => this.extractItemTitle(item));
    
    const addedCount = this.storageManager.addMultipleSeenItems(titles);
    
    // Update visual states
    items.forEach(item => {
      const title = this.extractItemTitle(item);
      this.updateItemVisualState(title, true, item);
    });

    this.emit('pageMarkedSeen', { count: addedCount, total: items.length });
    console.log(`SeenItemsManager: Marked ${addedCount} new items as seen`);
  }

  setSeenItemsVisibility(visible) {
    this.seenItemsVisible = visible;
    const seenItems = document.querySelectorAll('.vine-seen');
    
    seenItems.forEach(item => {
      if (visible) {
        item.style.display = '';
      } else {
        this.hideSeenItem(item);
      }
    });

    this.emit('seenVisibilityChanged', { 
      visible: visible, 
      count: seenItems.length 
    });
    
    console.log(`SeenItemsManager: ${visible ? 'Showing' : 'Hiding'} ${seenItems.length} seen items`);
  }

  hideSeenItem(item) {
    item.style.display = 'none';
  }

  // Remove the old toggle method and replace with the new visibility control
  toggleSeenItemsVisibility() {
    // Deprecated - kept for backward compatibility
    this.setSeenItemsVisibility(!this.seenItemsVisible);
  }

  clearAllVisualStates() {
    const seenItems = document.querySelectorAll('.vine-seen');
    seenItems.forEach(item => {
      item.classList.remove('vine-seen');
      const button = item.querySelector('.vine-mark-seen');
      if (button) button.innerHTML = '👀';
    });

    console.log(`SeenItemsManager: Cleared visual states for ${seenItems.length} items`);
  }

  // Handle new items added to the page (for infinite scroll)
  processNewItems(items) {
    items.forEach(item => {
      if (!item.hasAttribute('data-vine-processed')) {
        this.processItem(item);
      }
    });
  }

  getCurrentSeenCount() {
    return document.querySelectorAll('.vine-seen').length;
  }

  getSeenItemsOnCurrentPage() {
    const seenItems = document.querySelectorAll('.vine-seen');
    return Array.from(seenItems).map(item => this.extractItemTitle(item));
  }
} 
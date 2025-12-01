// Seen Items Manager - Handles visual marking of hidden items
// "Hidden" items are products the user wants to hide from view
// Uses ItemsRepository for data persistence
class SeenItemsManager extends BaseManager {
  constructor(config) {
    super(config);
    this.repository = window.vineItemsRepository;
    this.storageManager = null; // Deprecated - kept for compatibility
    this.hiddenItemsVisible = false; // Default to hiding hidden items
  }

  async setup() {
    // Initialize repository if not already initialized
    if (!this.repository.isInitialized) {
      await this.repository.init();
    }

    this.setupEventListeners();
    await this.waitForElement('#vvp-items-grid');
    this.processAllItems();
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
      this.updateItemVisualState(data.asin, true);
    });

    this.on('itemMarkedUnseen', (data) => {
      this.updateItemVisualState(data.asin, false);
    });

    this.on('allSeenItemsCleared', () => {
      this.clearAllVisualStates();
    });

    // Listen for UI events
    this.on('markAllSeen', () => {
      this.markAllCurrentPageAsHidden();
    });

    this.on('setSeenVisibility', (data) => {
      this.setHiddenItemsVisibility(data.visible);
    });

    this.on('clearAllSeen', () => {
      this.clearAllHiddenItems();
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
  }

  processItem(item) {
    // ASIN is on an input element inside the tile
    const asinInput = item.querySelector('input[data-asin]');
    const asin = asinInput?.getAttribute('data-asin');
    if (!asin) return;

    // Add unique item ID for table/card sync
    if (!item.dataset.vineItemId) {
      item.dataset.vineItemId = this.generateItemId(asin);
    }

    // Check if item is hidden
    const doc = this.repository.get(asin);
    if (doc && doc.hidden) {
      item.classList.add('vine-seen'); // Keep old class name for CSS compatibility
    }

    // Add click handler for Ctrl+click to mark as hidden
    item.addEventListener('click', (e) => {
      if (e.ctrlKey || e.target.classList.contains('vine-mark-seen')) {
        e.preventDefault();
        this.toggleItemHidden(asin, item);
      }
    });

    // Add mark as hidden button
    this.addMarkHiddenButton(item, asin);

    // Mark as processed
    item.setAttribute('data-vine-processed', 'true');
  }

  generateItemId(asin) {
    // Use ASIN as the unique ID
    return `vine-item-${asin}`;
  }

  addMarkHiddenButton(item, asin) {
    // Check if button already exists
    if (item.querySelector('.vine-mark-seen')) {
      return;
    }

    const button = document.createElement('button');
    button.className = 'vine-mark-seen';
    button.innerHTML = '👁️';
    button.title = 'Mark as hidden/seen (or Ctrl+Click item)';

    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggleItemHidden(asin, item);
    });

    // Position relative to the item
    const content = item.querySelector('.vvp-item-tile-content');
    if (content) {
      content.appendChild(button);
    }
  }

  async toggleItemHidden(asin, item) {
    const doc = this.repository.get(asin);
    const isCurrentlyHidden = doc ? doc.hidden : false;
    const newHiddenState = !isCurrentlyHidden;

    // Update in repository
    if (doc) {
      await this.repository.setHidden(asin, newHiddenState);
    } else {
      // Item doesn't exist in DB yet - this shouldn't happen in normal flow
      // but handle it gracefully
      const itemData = this.extractItemDataFromElement(item);
      itemData.hidden = newHiddenState;
      await this.repository.upsert(itemData);
    }

    // Update visual state
    this.updateItemVisualState(asin, newHiddenState);

    // Emit event for other managers
    if (newHiddenState) {
      window.vineEventBus.emit('itemMarkedSeen', { asin, item });
    } else {
      window.vineEventBus.emit('itemMarkedUnseen', { asin, item });
    }

    console.log(`SeenItemsManager: Item ${asin} marked as ${newHiddenState ? 'hidden' : 'visible'}`);
  }

  // Legacy compatibility - redirect to ASIN-based method
  toggleItemSeen(title, item) {
    const asinInput = item.querySelector('input[data-asin]');
    const asin = asinInput?.getAttribute('data-asin');
    if (asin) {
      this.toggleItemHidden(asin, item);
    }
  }

  extractItemDataFromElement(item) {
    // ASIN is on an input element inside the tile
    const asinInput = item.querySelector('input[data-asin]');
    const asin = asinInput?.getAttribute('data-asin');
    const titleElement = item.querySelector('.vvp-item-product-title-container a');
    const title = titleElement?.textContent.trim() || '';
    const url = titleElement?.href || '';
    const imageUrl = item.querySelector('img')?.src || '';

    return {
      asin,
      title,
      url,
      imageUrl,
      queue: 'unknown',
      firstSeenOn: Date.now(),
      lastSeenOn: Date.now(),
      seen: true,
      hidden: false,
      notified: false
    };
  }

  updateItemVisualState(asin, isHidden) {
    // Find the tile containing an input with this ASIN
    const asinInput = document.querySelector(`input[data-asin="${asin}"]`);
    const item = asinInput?.closest('.vvp-item-tile');
    if (!item) return;

    if (isHidden) {
      item.classList.add('vine-seen');
    } else {
      item.classList.remove('vine-seen');
    }

    // Update visibility based on current filter
    this.updateItemVisibility(item, isHidden);
  }

  updateItemVisibility(item, isHidden) {
    if (!this.hiddenItemsVisible && isHidden) {
      item.style.display = 'none';
    } else {
      item.style.display = '';
    }
  }

  setHiddenItemsVisibility(visible) {
    this.hiddenItemsVisible = visible;

    // Update all items
    const items = document.querySelectorAll('.vvp-item-tile');
    items.forEach(item => {
      // ASIN is on an input element inside the tile
      const asinInput = item.querySelector('input[data-asin]');
      const asin = asinInput?.getAttribute('data-asin');
      if (!asin) return;

      const doc = this.repository.get(asin);
      const isHidden = doc ? doc.hidden : false;

      this.updateItemVisibility(item, isHidden);
    });
  }

  // Legacy compatibility
  setSeenItemsVisibility(visible) {
    this.setHiddenItemsVisibility(visible);
  }

  async markAllCurrentPageAsHidden() {
    const items = document.querySelectorAll('.vvp-item-tile');
    let count = 0;

    for (const item of items) {
      // ASIN is on an input element inside the tile
      const asinInput = item.querySelector('input[data-asin]');
      const asin = asinInput?.getAttribute('data-asin');
      if (!asin) continue;

      const doc = this.repository.get(asin);
      if (!doc || !doc.hidden) {
        await this.repository.setHidden(asin, true);
        this.updateItemVisualState(asin, true);
        count++;
      }
    }

    this.emit('markedAllSeen', { count });
  }

  async clearAllHiddenItems() {
    await this.repository.clearHiddenFlags();
    this.clearAllVisualStates();
  }

  clearAllVisualStates() {
    const items = document.querySelectorAll('.vvp-item-tile');
    items.forEach(item => {
      item.classList.remove('vine-seen');
      item.style.display = '';
    });
  }

  extractItemTitle(item) {
    const titleElement = item.querySelector('.vvp-item-product-title-container a');
    if (titleElement) {
      return titleElement.textContent.trim();
    }

    const altTitleElement = item.querySelector('.vvp-item-product-title');
    if (altTitleElement) {
      return altTitleElement.textContent.trim();
    }

    return '';
  }

  cleanup() {
    super.cleanup();
  }
}

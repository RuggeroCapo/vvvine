// New Items Manager - Highlights items that haven't been seen before
// Uses ItemsRepository for data persistence
class NewItemsManager extends BaseManager {
  constructor(config) {
    super(config);
    this.repository = window.vineItemsRepository;
    this.storageManager = null; // Deprecated - kept for compatibility
  }

  setStorageManager(storageManager) {
    this.storageManager = storageManager;
  }

  async setup() {
    // Initialize repository if not already initialized
    if (!this.repository.isInitialized) {
      await this.repository.init();
    }

    this.setupPageObserver();
    await this.scanAndProcessItems();

    const stats = this.repository.getStats();
  }

  setupPageObserver() {
    // Watch for dynamically added items (infinite scroll, etc.)
    const grid = document.getElementById('vvp-items-grid');
    if (grid) {
      const observer = new MutationObserver((mutations) => {
        let hasNewItems = false;
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === 1 && node.classList?.contains('vvp-item-tile')) {
              hasNewItems = true;
            }
          });
        });

        if (hasNewItems) {
          // Debounce to avoid excessive processing
          clearTimeout(this.processItemsTimeout);
          this.processItemsTimeout = setTimeout(() => {
            this.scanAndProcessItems();
          }, 300);
        }
      });

      observer.observe(grid, {
        childList: true,
        subtree: true
      });

      this.gridObserver = observer;
    }
  }

  async scanAndProcessItems() {
    const items = document.querySelectorAll('.vvp-item-tile');
    const currentTime = Date.now();
    const currentQueue = this.getCurrentQueue();

    let newItemsCount = 0;
    let updatedItems = 0;
    const currentASINs = new Set();
    let hasChanges = false;

    // Process all visible items
    for (const item of items) {
      // ASIN is on an input element inside the tile, not on the tile itself
      const asinInput = item.querySelector('input[data-asin]');
      const asin = asinInput?.getAttribute('data-asin');

      if (!asin) {
        console.warn('NewItemsManager: Item without ASIN found', item);
        continue;
      }

      currentASINs.add(asin);
      const existingDoc = this.repository.get(asin);

      if (!existingDoc) {
        // Brand new item - create document
        const itemData = this.extractItemData(item, currentQueue);

        // Add to repository without saving yet
        const newDoc = {
          asin: itemData.asin,
          title: itemData.title || '',
          imageUrl: itemData.imageUrl || '',
          url: itemData.url || '',
          firstSeenOn: Date.now(),
          lastSeenOn: Date.now(),
          seen: true,
          hidden: false,
          notified: false,
          queue: itemData.queue || null
        };
        this.repository.items.set(asin, newDoc);
        hasChanges = true;

        // Highlight if not hidden
        this.highlightNewItem(item);
        newItemsCount++;
      } else {
        // Existing item - update lastSeenOn and mark as seen
        const needsUpdate = existingDoc.lastSeenOn !== currentTime ||
                           existingDoc.seen !== true ||
                           existingDoc.queue !== currentQueue;

        if (needsUpdate) {
          existingDoc.lastSeenOn = currentTime;
          existingDoc.seen = true;
          existingDoc.queue = currentQueue;
          hasChanges = true;
          updatedItems++;
        }

        // Update visual state based on document
        if (existingDoc.hidden) {
          this.removeNewItemHighlight(item);
        } else if (!existingDoc.notified) {
          // Item not notified yet - show NEW badge
          this.highlightNewItem(item);
        } else {
          // Item already notified - remove badge
          this.removeNewItemHighlight(item);
        }
      }
    }

    // Save all changes in one batch
    if (hasChanges) {
      try {
        await this.repository.save();
        console.log(`NewItemsManager: Processed ${newItemsCount} new items, updated ${updatedItems} existing items`);
        console.log(`NewItemsManager: Repository now has ${this.repository.items.size} items`);
      } catch (error) {
        console.error('NewItemsManager: Error saving items:', error);
      }
    } else {
      console.log(`NewItemsManager: No changes to save (${items.length} items on page, ${this.repository.items.size} in DB)`);
    }

    // Mark items not on current page as unseen (no longer visible)
    // Do this after save to avoid conflicts
    await this.markMissingItemsAsUnseen(currentASINs);

    if (newItemsCount > 0) {
      this.emit('newItemsDetected', {
        count: newItemsCount,
        total: items.length,
        stats: this.repository.getStats()
      });
    }

    // Update statistics
    this.updateStatistics();
  }

  async markMissingItemsAsUnseen(currentASINs) {
    // Get all items marked as seen
    const seenItems = this.repository.getSeenItems();

    // Find items that are marked as seen but not on current page
    const missingASINs = seenItems
      .filter(doc => !currentASINs.has(doc.asin))
      .map(doc => doc.asin);

    if (missingASINs.length > 0) {
      // Update all items to unseen without saving each time
      for (const asin of missingASINs) {
        const doc = this.repository.get(asin);
        if (doc) {
          doc.seen = false;
        }
      }
      // Save once at the end
      await this.repository.save();
    }
  }

  extractItemData(item, queue) {
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
      queue,
      firstSeenOn: Date.now(),
      lastSeenOn: Date.now(),
      seen: true,
      hidden: false,
      notified: false
    };
  }

  getCurrentQueue() {
    // Try to get queue from page detection manager
    if (window.vineEnhancer) {
      const pageDetection = window.vineEnhancer.getManager('pageDetection');
      if (pageDetection) {
        return pageDetection.getPageType();
      }
    }

    // Fallback: detect from URL
    try {
      const url = new URL(window.location.href);
      return url.searchParams.get('queue') || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  highlightNewItem(item) {
    if (!item.classList.contains('vine-new-item')) {
      item.classList.add('vine-new-item');
      this.addNewItemBadge(item);
    }
  }

  removeNewItemHighlight(item) {
    item.classList.remove('vine-new-item');
    this.removeNewItemBadge(item);
  }

  addNewItemBadge(item) {
    // Remove existing badge if present
    this.removeNewItemBadge(item);

    const badge = document.createElement('div');
    badge.className = 'vine-new-item-badge';
    badge.innerHTML = '✨ NEW';
    badge.title = 'This item is new and hasn\'t been seen before';

    // Position relative to the item
    const content = item.querySelector('.vvp-item-tile-content');
    if (content) {
      content.appendChild(badge);
    }
  }

  removeNewItemBadge(item) {
    const existingBadge = item.querySelector('.vine-new-item-badge');
    if (existingBadge) {
      existingBadge.remove();
    }
  }

  updateStatistics() {
    // Emit statistics for UI updates
    const stats = this.repository.getStats();

    this.emit('newItemsStatsUpdated', {
      totalKnownItems: stats.total,
      newItemsOnPage: stats.new,
      totalItemsOnPage: document.querySelectorAll('.vvp-item-tile').length,
      seenItems: stats.seen,
      hiddenItems: stats.hidden
    });
  }

  // Public API methods
  getKnownItemsCount() {
    return this.repository.getStats().total;
  }

  getNewItemsOnPageCount() {
    return this.repository.getNewItems().length;
  }

  isItemNew(asin) {
    const doc = this.repository.get(asin);
    // Item is "new" if it doesn't exist OR if it exists but hasn't been notified
    return !doc || (!doc.notified && !doc.hidden);
  }

  markItemAsKnown(asin) {
    if (asin) {
      this.repository.setNotified(asin, true);

      // Update visual state
      const item = document.querySelector(`[data-asin="${asin}"]`);
      if (item) {
        this.removeNewItemHighlight(item);
      }

      this.updateStatistics();
      return true;
    }
    return false;
  }

  async clearAllKnownItems() {
    await this.repository.clear();

    // Remove all highlights
    document.querySelectorAll('.vine-new-item').forEach(item => {
      this.removeNewItemHighlight(item);
    });

    this.updateStatistics();
    this.emit('allKnownItemsCleared', { stats: this.repository.getStats() });
  }

  getStatistics() {
    const stats = this.repository.getStats();
    return {
      totalKnownItems: stats.total,
      newItemsOnPage: stats.new,
      totalItemsOnPage: document.querySelectorAll('.vvp-item-tile').length,
      seenItems: stats.seen,
      hiddenItems: stats.hidden,
      garbageCollectionDays: this.repository.GARBAGE_COLLECTION_DAYS
    };
  }

  cleanup() {
    super.cleanup();

    if (this.gridObserver) {
      this.gridObserver.disconnect();
    }

    if (this.processItemsTimeout) {
      clearTimeout(this.processItemsTimeout);
    }

    // Remove all highlights
    document.querySelectorAll('.vine-new-item').forEach(item => {
      this.removeNewItemHighlight(item);
    });
  }
}

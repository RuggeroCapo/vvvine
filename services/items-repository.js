// Items Repository - Centralized data access layer for Vine items
// Isolates storage operations to enable future migration to actual database

class ItemsRepository {
  constructor() {
    this.items = new Map(); // ASIN -> ItemDocument
    this.isInitialized = false;
    this.STORAGE_KEY = 'vineItems';
    this.GARBAGE_COLLECTION_DAYS = 30;
  }

  /**
   * Initialize repository by loading data from storage
   */
  async init() {
    await this.load();
    this.isInitialized = true;
    console.log(`ItemsRepository: Initialized with ${this.items.size} items`);
  }

  /**
   * Load items from storage
   */
  async load() {
    try {
      const result = await chrome.storage.local.get([this.STORAGE_KEY]);
      const itemsData = result[this.STORAGE_KEY] || {};

      // Convert object to Map
      this.items = new Map();
      Object.entries(itemsData).forEach(([asin, doc]) => {
        this.items.set(asin, doc);
      });

      // Perform garbage collection on load
      await this.garbageCollect();

      return this.items;
    } catch (error) {
      console.error('ItemsRepository: Error loading items:', error);
      throw error;
    }
  }

  /**
   * Save items to storage
   */
  async save() {
    try {
      const itemsData = Object.fromEntries(this.items);
      console.log(`ItemsRepository: Saving ${this.items.size} items to storage`);
      await chrome.storage.local.set({
        [this.STORAGE_KEY]: itemsData
      });
      console.log(`ItemsRepository: Successfully saved to ${this.STORAGE_KEY}`);
      return true;
    } catch (error) {
      console.error('ItemsRepository: Error saving items:', error);
      throw error;
    }
  }

  /**
   * Create or update an item
   * @param {Object} itemData - Item data to upsert
   * @returns {Object} The created/updated document
   */
  async upsert(itemData) {
    const { asin } = itemData;

    if (!asin) {
      throw new Error('ItemsRepository: ASIN is required for upsert');
    }

    const existingDoc = this.items.get(asin);

    if (existingDoc) {
      // Update existing document
      const updatedDoc = { ...existingDoc, ...itemData };
      this.items.set(asin, updatedDoc);
      await this.save();
      return updatedDoc;
    } else {
      // Create new document with defaults
      const newDoc = {
        asin,
        title: itemData.title || '',
        imageUrl: itemData.imageUrl || '',
        url: itemData.url || '',
        firstSeenOn: Date.now(),
        lastSeenOn: Date.now(),
        seen: true,
        hidden: false,
        notified: false,
        queue: itemData.queue || null,
        ...itemData
      };

      this.items.set(asin, newDoc);
      await this.save();
      return newDoc;
    }
  }

  /**
   * Get item by ASIN
   */
  get(asin) {
    return this.items.get(asin) || null;
  }

  /**
   * Check if item exists
   */
  has(asin) {
    return this.items.has(asin);
  }

  /**
   * Get all items
   */
  getAll() {
    return Array.from(this.items.values());
  }

  /**
   * Get items matching filter criteria
   * @param {Function} filterFn - Filter function (doc) => boolean
   */
  find(filterFn) {
    return this.getAll().filter(filterFn);
  }

  /**
   * Update item properties
   */
  async update(asin, updates) {
    const doc = this.items.get(asin);
    if (!doc) {
      console.warn(`ItemsRepository: Item ${asin} not found for update`);
      return null;
    }

    const updatedDoc = { ...doc, ...updates };
    this.items.set(asin, updatedDoc);
    await this.save();
    return updatedDoc;
  }

  /**
   * Update lastSeenOn timestamp for an item
   */
  async touch(asin) {
    return this.update(asin, {
      lastSeenOn: Date.now(),
      seen: true
    });
  }

  /**
   * Mark item as hidden (user action)
   */
  async setHidden(asin, hidden = true) {
    return this.update(asin, { hidden });
  }

  /**
   * Toggle hidden state
   */
  async toggleHidden(asin) {
    const doc = this.get(asin);
    if (!doc) return null;
    return this.update(asin, { hidden: !doc.hidden });
  }

  /**
   * Mark item as notified
   */
  async setNotified(asin, notified = true) {
    return this.update(asin, { notified });
  }

  /**
   * Mark item as seen (visible on platform)
   */
  async setSeen(asin, seen = true) {
    return this.update(asin, { seen });
  }

  /**
   * Mark multiple items as unseen (not currently on platform)
   */
  async markAsUnseen(asins) {
    const updates = asins.map(asin =>
      this.update(asin, { seen: false })
    );
    await Promise.all(updates);
  }

  /**
   * Get all currently visible (seen) items
   */
  getSeenItems() {
    return this.find(doc => doc.seen === true);
  }

  /**
   * Get all hidden items
   */
  getHiddenItems() {
    return this.find(doc => doc.hidden === true);
  }

  /**
   * Get all new items (seen but not notified)
   */
  getNewItems() {
    return this.find(doc => doc.seen === true && doc.notified === false && doc.hidden === false);
  }

  /**
   * Get items for a specific queue
   */
  getItemsForQueue(queueName) {
    return this.find(doc => doc.queue === queueName);
  }

  /**
   * Delete item by ASIN
   */
  async delete(asin) {
    const existed = this.items.delete(asin);
    if (existed) {
      await this.save();
    }
    return existed;
  }

  /**
   * Clear all items
   */
  async clear() {
    this.items.clear();
    await this.save();
    console.log('ItemsRepository: All items cleared');
  }

  /**
   * Clear all notified flags
   */
  async clearNotifiedFlags() {
    for (let [asin, doc] of this.items) {
      if (doc.notified) {
        doc.notified = false;
      }
    }
    await this.save();
    console.log('ItemsRepository: All notified flags cleared');
  }

  /**
   * Clear all hidden flags
   */
  async clearHiddenFlags() {
    for (let [asin, doc] of this.items) {
      if (doc.hidden) {
        doc.hidden = false;
      }
    }
    await this.save();
    console.log('ItemsRepository: All hidden flags cleared');
  }

  /**
   * Garbage collection - remove old items
   */
  async garbageCollect() {
    const cutoff = Date.now() - (this.GARBAGE_COLLECTION_DAYS * 24 * 60 * 60 * 1000);
    let removedCount = 0;

    for (let [asin, doc] of this.items) {
      // Remove if: not seen recently AND not hidden (keep hidden items forever)
      if (doc.lastSeenOn < cutoff && !doc.hidden) {
        this.items.delete(asin);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      await this.save();
      console.log(`ItemsRepository: Garbage collected ${removedCount} old items`);
    }

    return removedCount;
  }

  /**
   * Get repository statistics
   */
  getStats() {
    const all = this.getAll();
    return {
      total: all.length,
      seen: all.filter(doc => doc.seen).length,
      hidden: all.filter(doc => doc.hidden).length,
      notified: all.filter(doc => doc.notified).length,
      new: this.getNewItems().length,
      byQueue: this.getQueueStats()
    };
  }

  /**
   * Get statistics by queue
   */
  getQueueStats() {
    const stats = {};
    for (let doc of this.getAll()) {
      if (doc.queue) {
        stats[doc.queue] = (stats[doc.queue] || 0) + 1;
      }
    }
    return stats;
  }

  /**
   * Debug: Export all data
   */
  exportData() {
    return Object.fromEntries(this.items);
  }

  /**
   * Debug: Import data
   */
  async importData(data) {
    this.items = new Map(Object.entries(data));
    await this.save();
    console.log(`ItemsRepository: Imported ${this.items.size} items`);
  }
}

// Create singleton instance
window.vineItemsRepository = window.vineItemsRepository || new ItemsRepository();

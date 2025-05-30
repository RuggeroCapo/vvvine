// Storage Manager - Handles Chrome storage operations
class StorageManager extends BaseManager {
  constructor(config) {
    super(config);
    this.seenItems = new Set();
  }

  async setup() {
    await this.loadSeenItems();
    console.log(`StorageManager: Loaded ${this.seenItems.size} seen items`);
  }

  async loadSeenItems() {
    try {
      const result = await chrome.storage.local.get(['vineSeenTitles']);
      this.seenItems = new Set(result.vineSeenTitles || []);
      this.emit('seenItemsLoaded', { seenItems: this.seenItems });
      return this.seenItems;
    } catch (error) {
      console.error('StorageManager: Error loading seen items:', error);
      throw error;
    }
  }

  async saveSeenItems() {
    try {
      await chrome.storage.local.set({
        vineSeenTitles: Array.from(this.seenItems)
      });
      this.emit('seenItemsSaved', { seenItems: this.seenItems });
    } catch (error) {
      console.error('StorageManager: Error saving seen items:', error);
      throw error;
    }
  }

  addSeenItem(title) {
    if (!this.seenItems.has(title)) {
      this.seenItems.add(title);
      this.saveSeenItems();
      this.emit('itemMarkedSeen', { title, seenItems: this.seenItems });
      return true;
    }
    return false;
  }

  removeSeenItem(title) {
    if (this.seenItems.has(title)) {
      this.seenItems.delete(title);
      this.saveSeenItems();
      this.emit('itemMarkedUnseen', { title, seenItems: this.seenItems });
      return true;
    }
    return false;
  }

  isItemSeen(title) {
    return this.seenItems.has(title);
  }

  toggleSeenItem(title) {
    if (this.isItemSeen(title)) {
      return this.removeSeenItem(title);
    } else {
      return this.addSeenItem(title);
    }
  }

  addMultipleSeenItems(titles) {
    let added = 0;
    titles.forEach(title => {
      if (!this.seenItems.has(title)) {
        this.seenItems.add(title);
        added++;
      }
    });
    
    if (added > 0) {
      this.saveSeenItems();
      this.emit('multipleItemsMarkedSeen', { titles, seenItems: this.seenItems });
    }
    
    return added;
  }

  clearAllSeenItems() {
    this.seenItems.clear();
    this.saveSeenItems();
    this.emit('allSeenItemsCleared', { seenItems: this.seenItems });
  }

  getSeenItemsCount() {
    return this.seenItems.size;
  }

  getSeenItemsArray() {
    return Array.from(this.seenItems);
  }
} 
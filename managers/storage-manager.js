// Storage Manager - Handles Chrome storage operations
class StorageManager extends BaseManager {
  constructor(config) {
    super(config);
    this.seenItems = new Set();
    this.bookmarks = new Map(); // Map of title -> {title, url, timestamp}
  }

  async setup() {
    await this.loadSeenItems();
    await this.loadBookmarks();
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

  // Bookmark management methods
  async loadBookmarks() {
    try {
      const result = await chrome.storage.local.get(['vineBookmarks']);
      const bookmarkArray = result.vineBookmarks || [];
      this.bookmarks = new Map(bookmarkArray.map(bookmark => [bookmark.title, bookmark]));
      this.emit('bookmarksLoaded', { bookmarks: this.bookmarks });
      return this.bookmarks;
    } catch (error) {
      console.error('StorageManager: Error loading bookmarks:', error);
      throw error;
    }
  }

  async saveBookmarks() {
    try {
      const bookmarkArray = Array.from(this.bookmarks.values());
      await chrome.storage.local.set({
        vineBookmarks: bookmarkArray
      });
      this.emit('bookmarksSaved', { bookmarks: this.bookmarks });
    } catch (error) {
      console.error('StorageManager: Error saving bookmarks:', error);
      throw error;
    }
  }

  addBookmark(title, url, pageNumber = 1, pageUrl = '') {
    if (!this.bookmarks.has(title)) {
      const bookmark = {
        title: title,
        url: url,
        pageNumber: pageNumber,
        pageUrl: pageUrl,
        timestamp: Date.now()
      };
      this.bookmarks.set(title, bookmark);
      this.saveBookmarks();
      this.emit('itemBookmarked', { title, url, pageNumber, pageUrl, bookmark, bookmarks: this.bookmarks });
      return true;
    }
    return false;
  }

  removeBookmark(title) {
    if (this.bookmarks.has(title)) {
      const bookmark = this.bookmarks.get(title);
      this.bookmarks.delete(title);
      this.saveBookmarks();
      this.emit('itemUnbookmarked', { title, bookmark, bookmarks: this.bookmarks });
      return true;
    }
    return false;
  }

  isItemBookmarked(title) {
    return this.bookmarks.has(title);
  }

  toggleBookmark(title, url, pageNumber = 1, pageUrl = '') {
    if (this.isItemBookmarked(title)) {
      return this.removeBookmark(title);
    } else {
      return this.addBookmark(title, url, pageNumber, pageUrl);
    }
  }

  clearAllBookmarks() {
    this.bookmarks.clear();
    this.saveBookmarks();
    this.emit('allBookmarksCleared', { bookmarks: this.bookmarks });
  }

  getBookmarksCount() {
    return this.bookmarks.size;
  }

  getBookmarksArray() {
    return Array.from(this.bookmarks.values()).sort((a, b) => b.timestamp - a.timestamp);
  }

  getBookmark(title) {
    return this.bookmarks.get(title);
  }
} 
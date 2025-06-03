// Filter Manager - Handles client-side filtering of items
class FilterManager extends BaseManager {
  constructor(config) {
    super(config);
    this.currentFilter = '';
    this.filteredItems = new Set();
  }

  async setup() {
    this.setupEventListeners();
    await this.loadStoredFilter();
    console.log('FilterManager: Initialized');
  }

  async loadStoredFilter() {
    try {
      const result = await chrome.storage.local.get(['vineSearchQuery']);
      const storedQuery = result.vineSearchQuery || '';
      
      if (storedQuery) {
        this.currentFilter = storedQuery;
        console.log(`FilterManager: Loaded stored filter: "${storedQuery}"`);
        
        // Apply the filter after a short delay to ensure DOM is ready
        setTimeout(() => {
          this.filterItems(storedQuery);
          this.emit('filterLoaded', { query: storedQuery });
        }, 100);
      }
    } catch (error) {
      console.error('FilterManager: Error loading stored filter:', error);
    }
  }

  setupEventListeners() {
    this.on('filterItems', (data) => {
      this.filterItems(data.query);
    });

    this.on('clearFilter', () => {
      this.clearFilter();
    });
  }

  async filterItems(query) {
    const items = document.querySelectorAll('.vvp-item-tile');
    const lowerQuery = query.toLowerCase().trim();
    this.currentFilter = query;
    
    // Save the query to storage for persistence across pages
    try {
      await chrome.storage.local.set({ vineSearchQuery: query });
    } catch (error) {
      console.error('FilterManager: Error saving search query:', error);
    }
    
    let visibleCount = 0;
    let filteredCount = 0;

    items.forEach(item => {
      const title = this.extractItemTitle(item);
      const matches = this.itemMatchesQuery(title, lowerQuery);
      
      if (matches || !query) {
        item.style.display = '';
        visibleCount++;
        this.filteredItems.delete(item);
      } else {
        item.style.display = 'none';
        filteredCount++;
        this.filteredItems.add(item);
      }
    });

    this.emit('itemsFiltered', {
      query: query,
      visibleCount: visibleCount,
      filteredCount: filteredCount,
      totalCount: items.length
    });

    console.log(`FilterManager: Filtered "${query}" - ${visibleCount} visible, ${filteredCount} hidden`);
  }

  itemMatchesQuery(title, lowerQuery) {
    if (!lowerQuery) return true;
    
    const lowerTitle = title.toLowerCase();
    
    // Support multiple search strategies
    return this.basicTextMatch(lowerTitle, lowerQuery) ||
           this.wordMatch(lowerTitle, lowerQuery) ||
           this.partialWordMatch(lowerTitle, lowerQuery);
  }

  basicTextMatch(title, query) {
    return title.includes(query);
  }

  wordMatch(title, query) {
    const titleWords = title.split(/\s+/);
    const queryWords = query.split(/\s+/);
    
    return queryWords.every(queryWord => 
      titleWords.some(titleWord => 
        titleWord.includes(queryWord)
      )
    );
  }

  partialWordMatch(title, query) {
    // Check if query words match partial words in title
    const queryWords = query.split(/\s+/);
    
    return queryWords.every(queryWord => {
      if (queryWord.length < 3) return title.includes(queryWord);
      
      // For longer words, allow partial matching from the beginning
      return title.split(/\s+/).some(titleWord => 
        titleWord.startsWith(queryWord)
      );
    });
  }

  async clearFilter() {
    await this.filterItems('');
  }

  getCurrentFilter() {
    return this.currentFilter;
  }

  getFilteredItems() {
    return Array.from(this.filteredItems);
  }

  getVisibleItems() {
    const items = document.querySelectorAll('.vvp-item-tile');
    return Array.from(items).filter(item => 
      item.style.display !== 'none'
    );
  }

  // Advanced filtering methods
  filterBySeenStatus(showSeen = true, showUnseen = true) {
    const items = document.querySelectorAll('.vvp-item-tile');
    let visibleCount = 0;
    
    items.forEach(item => {
      const isSeen = item.classList.contains('vine-seen');
      const shouldShow = (isSeen && showSeen) || (!isSeen && showUnseen);
      
      if (shouldShow) {
        item.style.display = '';
        visibleCount++;
      } else {
        item.style.display = 'none';
      }
    });

    this.emit('itemsFilteredByStatus', {
      showSeen,
      showUnseen,
      visibleCount
    });
  }

  filterByCategory(category) {
    // Future enhancement: filter by product category
    // This would require extracting category information from items
    console.log(`FilterManager: Category filtering for "${category}" not yet implemented`);
  }

  // Combined filtering - applies text filter while respecting other filters
  applyAllFilters() {
    this.filterItems(this.currentFilter);
  }

  // Statistics about current filter state
  getFilterStats() {
    const items = document.querySelectorAll('.vvp-item-tile');
    const visible = this.getVisibleItems();
    const filtered = this.getFilteredItems();
    
    return {
      total: items.length,
      visible: visible.length,
      filtered: filtered.length,
      currentFilter: this.currentFilter,
      hasActiveFilter: this.currentFilter.length > 0
    };
  }

  // Reset all filters and show all items
  async resetAllFilters() {
    this.currentFilter = '';
    this.filteredItems.clear();
    
    // Clear stored query
    try {
      await chrome.storage.local.remove(['vineSearchQuery']);
    } catch (error) {
      console.error('FilterManager: Error clearing stored search query:', error);
    }
    
    const items = document.querySelectorAll('.vvp-item-tile');
    items.forEach(item => {
      item.style.display = '';
    });

    this.emit('filtersReset', {
      visibleCount: items.length
    });

    console.log('FilterManager: All filters reset');
  }
} 
// Category Tracker Manager - Tracks category count changes on Encore page
class CategoryTrackerManager extends BaseManager {
  constructor(config) {
    super(config);
    this.previousCounts = new Map(); // Map of category name -> count
    this.storageManager = null;
    this.isTracking = false;
  }

  async setup() {
    // Wait for storage manager to be available
    await this.waitForStorageManager();
    
    // Load previous counts from storage
    await this.loadPreviousCounts();
    
    // Only track on Encore page
    if (this.isEncorePage()) {
      // Debounce to ensure DOM is fully loaded
      setTimeout(() => {
        this.trackCategories();
      }, 500);
    }
  }

  async waitForStorageManager() {
    return new Promise((resolve) => {
      const checkStorage = () => {
        if (window.vineStorageManager) {
          this.storageManager = window.vineStorageManager;
          resolve();
        } else {
          setTimeout(checkStorage, 100);
        }
      };
      checkStorage();
    });
  }

  isEncorePage() {
    const url = new URL(window.location.href);
    return url.searchParams.get('queue') === 'encore';
  }

  async trackCategories() {
    if (this.isTracking) {
      console.log('CategoryTrackerManager: Already tracking, skipping');
      return;
    }

    this.isTracking = true;
    console.log('CategoryTrackerManager: Starting category tracking');

    try {
      // Extract current category counts from DOM
      const currentCounts = this.extractCategoryCounts();
      
      if (currentCounts.size === 0) {
        console.log('CategoryTrackerManager: No categories found in DOM');
        this.isTracking = false;
        return;
      }

      console.log('CategoryTrackerManager: Current counts:', Object.fromEntries(currentCounts));
      console.log('CategoryTrackerManager: Previous counts:', Object.fromEntries(this.previousCounts));

      // Detect increments
      const increments = this.detectIncrements(currentCounts, this.previousCounts);
      
      if (increments.size > 0) {
        console.log('CategoryTrackerManager: Increments detected:', Object.fromEntries(increments));
        
        // Update DOM to show increments
        this.displayIncrements(increments, currentCounts);
        
        // Emit event for other managers (e.g., popup notifications)
        this.emit('categoryIncrementsDetected', {
          increments: Object.fromEntries(increments),
          currentCounts: Object.fromEntries(currentCounts)
        });
      } else {
        // Still update DOM to show (0) for all categories
        this.displayIncrements(new Map(), currentCounts);
      }

      // Save current counts as previous for next comparison
      await this.saveCounts(currentCounts);

    } catch (error) {
      console.error('CategoryTrackerManager: Error tracking categories:', error);
    } finally {
      this.isTracking = false;
    }
  }

  extractCategoryCounts() {
    const counts = new Map();
    
    try {
      // Find the category container
      const container = document.getElementById('vvp-browse-nodes-container');
      if (!container) {
        console.log('CategoryTrackerManager: Category container not found');
        return counts;
      }

      // Find all parent-node elements
      const parentNodes = container.querySelectorAll('.parent-node');
      
      parentNodes.forEach(node => {
        try {
          // Extract category name from link
          const link = node.querySelector('a.a-link-normal');
          const countSpan = node.querySelector('span');
          
          if (link && countSpan) {
            const categoryName = link.textContent.trim();
            const countText = countSpan.textContent.trim();
            
            // Parse count - extract number from text like " (209)"
            const countMatch = countText.match(/\((\d+)\)/);
            if (countMatch) {
              const count = parseInt(countMatch[1], 10);
              counts.set(categoryName, count);
            }
          }
        } catch (error) {
          console.error('CategoryTrackerManager: Error parsing category node:', error);
        }
      });
    } catch (error) {
      console.error('CategoryTrackerManager: Error extracting category counts:', error);
    }

    return counts;
  }

  async loadPreviousCounts() {
    try {
      const result = await chrome.storage.local.get(['vineCategoryCounts']);
      const storedCounts = result.vineCategoryCounts || {};
      
      this.previousCounts = new Map(Object.entries(storedCounts));
    } catch (error) {
      console.error('CategoryTrackerManager: Error loading previous counts:', error);
      this.previousCounts = new Map();
    }
  }

  async saveCounts(counts) {
    try {
      const countsObject = Object.fromEntries(counts);
      await chrome.storage.local.set({ vineCategoryCounts: countsObject });
      this.previousCounts = new Map(counts);
    } catch (error) {
      console.error('CategoryTrackerManager: Error saving counts:', error);
    }
  }

  detectIncrements(currentCounts, previousCounts) {
    const increments = new Map();

    currentCounts.forEach((currentCount, categoryName) => {
      const previousCount = previousCounts.get(categoryName) || 0;
      const increment = currentCount - previousCount;
      
      if (increment > 0) {
        increments.set(categoryName, increment);
      }
    });

    return increments;
  }

  displayIncrements(increments, currentCounts) {
    try {
      const container = document.getElementById('vvp-browse-nodes-container');
      if (!container) return;

      const parentNodes = container.querySelectorAll('.parent-node');
      
      parentNodes.forEach(node => {
        try {
          const link = node.querySelector('a.a-link-normal');
          const countSpan = node.querySelector('span');
          
          if (link && countSpan) {
            const categoryName = link.textContent.trim();
            const currentCount = currentCounts.get(categoryName);
            const increment = increments.get(categoryName) || 0;
            
            // Remove any existing increment display
            const existingIncrement = node.querySelector('.vine-category-increment');
            if (existingIncrement) {
              existingIncrement.remove();
            }

            // Create increment display element
            const incrementSpan = document.createElement('span');
            incrementSpan.className = 'vine-category-increment';
            
            if (increment > 0) {
              incrementSpan.textContent = ` (+${increment})`;
              incrementSpan.style.cssText = 'color: #00BFFF; font-weight: bold; margin-left: 4px; font-size: 0.9em;';
            } else {
              incrementSpan.textContent = ` (0)`;
              incrementSpan.style.cssText = 'color: #888; margin-left: 4px; font-size: 0.9em;';
            }
            
            // Insert after the count span
            countSpan.parentNode.insertBefore(incrementSpan, countSpan.nextSibling);
          }
        } catch (error) {
          console.error('CategoryTrackerManager: Error displaying increment for node:', error);
        }
      });
    } catch (error) {
      console.error('CategoryTrackerManager: Error displaying increments:', error);
    }
  }

  // Public API methods
  async resetCounts() {
    try {
      await chrome.storage.local.remove(['vineCategoryCounts']);
      this.previousCounts = new Map();
      
      // Re-track to show all as (0)
      if (this.isEncorePage()) {
        this.trackCategories();
      }
      
      this.emit('categoryCountsReset');
      
    } catch (error) {
      console.error('CategoryTrackerManager: Error resetting counts:', error);
    }
  }

  getPreviousCounts() {
    return new Map(this.previousCounts);
  }

  getCurrentCounts() {
    return this.extractCategoryCounts();
  }

  cleanup() {
    super.cleanup();
    this.isTracking = false;
  }
}

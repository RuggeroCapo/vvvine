// Base Manager Class - Common functionality for all managers
class BaseManager {
  constructor(config = {}) {
    this.config = config;
    this.eventListeners = new Map();
    this.isInitialized = false;
  }

  // Event system for manager communication
  emit(eventName, data) {
    if (window.vineEventBus) {
      console.log(`[BaseManager] Emitting event: ${eventName}`, data);
      window.vineEventBus.emit(eventName, data);
    } else {
      console.error(`[BaseManager] Cannot emit ${eventName}: vineEventBus not available`);
    }
  }

  on(eventName, callback) {
    if (window.vineEventBus) {
      console.log(`[BaseManager] Registering listener for event: ${eventName}`);
      window.vineEventBus.on(eventName, callback);
    } else {
      console.error(`[BaseManager] Cannot register listener for ${eventName}: vineEventBus not available`);
    }
  }

  off(eventName, callback) {
    if (window.vineEventBus) {
      window.vineEventBus.off(eventName, callback);
    }
  }

  // Lifecycle methods
  async init() {
    if (this.isInitialized) return;
    await this.setup();
    this.isInitialized = true;
  }

  async setup() {
    // Override in child classes
  }

  cleanup() {
    // Clean up event listeners and resources
    this.eventListeners.clear();
  }

  // Utility methods
  extractItemTitle(item) {
    const title = item.querySelector('.a-truncate-full')?.textContent || 
                 item.querySelector('.a-truncate-cut')?.textContent || '';
    return title.trim();
  }

  waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true
      });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);
    });
  }
}

// Simple event bus for manager communication
class EventBus {
  constructor() {
    this.events = new Map();
  }

  on(eventName, callback) {
    if (!this.events.has(eventName)) {
      this.events.set(eventName, []);
    }
    this.events.get(eventName).push(callback);
  }

  off(eventName, callback) {
    if (this.events.has(eventName)) {
      const callbacks = this.events.get(eventName);
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  emit(eventName, data) {
    const listenerCount = this.events.has(eventName) ? this.events.get(eventName).length : 0;
    console.log(`[EventBus] Emitting ${eventName} to ${listenerCount} listener(s)`, data);
    
    if (this.events.has(eventName)) {
      this.events.get(eventName).forEach((callback, index) => {
        try {
          console.log(`[EventBus] Calling listener ${index + 1} for ${eventName}`);
          callback(data);
        } catch (error) {
          console.error(`[EventBus] Error in event handler ${index + 1} for ${eventName}:`, error);
        }
      });
    } else {
      console.warn(`[EventBus] No listeners registered for event: ${eventName}`);
    }
  }
}

// Initialize global event bus
window.vineEventBus = new EventBus(); 
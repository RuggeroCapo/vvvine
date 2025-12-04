# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Amazon Vine Efficiency Enhancer - A Chrome extension (Manifest V3) that dramatically improves efficiency when browsing Amazon Vine products. The extension provides title expansion, item tracking, filtering, keyboard navigation, auto-navigation, bookmarking, and monitoring with notifications.

## Architecture

This is a modular Chrome extension built using a **manager-based architecture** with a centralized repository pattern for data persistence.

### Core Components

1. **content.js** - Main orchestrator (`AmazonVineEnhancer` class)
   - Initializes all managers in dependency order
   - Sets up cross-manager communication via event bus
   - Handles messages from popup and background script
   - Exposes global debug interfaces

2. **background.js** - Service worker
   - Manages persistent monitoring using Chrome Alarms API
   - Coordinates with content script for item checks
   - Handles page refresh scheduling with ±10% random variation

3. **popup.js/popup.html** - Extension popup UI
   - Provides statistics and data management
   - Controls monitoring configuration
   - Handles export/import of user data

4. **services/items-repository.js** - Data access layer
   - Singleton pattern (`window.vineItemsRepository`)
   - Centralizes all Chrome storage operations
   - Unified document structure using ASIN as primary key
   - Prepares for future database migration

5. **managers/** - Feature modules (all extend `BaseManager`)
   - Each manager handles a single responsibility
   - Communicate via global event bus (`window.vineEventBus`)
   - See "Manager System" section below

### Manager System

All managers extend `BaseManager` and follow a consistent lifecycle:

**Initialization Order** (critical - managers depend on this sequence):
1. `storage` - Must be first (loads persisted data)
2. `filter` - Independent
3. `seenItems` - Depends on storage
4. `bookmarks` - Depends on storage
5. `newItems` - Depends on storage
6. `pageDetection` - Independent
7. `categoryTracker` - Depends on storage, pageDetection
8. `notificationProvider` - Independent
9. `monitoring` - Depends on storage, newItems, pageDetection, notificationProvider
10. `ui` - Needs other managers ready for status updates
11. `keyboard` - Coordinates with all managers
12. `page` - Independent (handles navigation and infinite scroll)

**Key Managers**:
- **new-items-manager.js** - Tracks item lifecycle (seen/unseen/notified states)
- **seen-items-manager.js** - Handles user-hidden items (visual state)
- **bookmark-manager.js** - Manages bookmarked items with page tracking
- **monitoring-manager.js** - Coordinates periodic checks for new items
- **notification-provider-manager.js** - Sends notifications via configured provider
- **ui-manager.js** - Creates control panel, manages table/card view switching
- **keyboard-manager.js** - Handles all keyboard shortcuts (j/k/h/b/a/space/etc)
- **page-manager.js** - Auto-navigation (infinite scroll) and page navigation
- **page-detection-manager.js** - Detects current queue (potluck/encore/last_chance)
- **category-tracker-manager.js** - Tracks item categories for filtering

### Data Model

**Storage Key**: `vineItems` (unified document store)

**Document Schema**:
```javascript
{
  "B0ABC123": {  // ASIN is the key
    asin: "B0ABC123",
    title: "Product Title",
    url: "https://amazon.../dp/B0ABC123",
    imageUrl: "https://...",

    // Tracking
    firstSeenOn: 1748380990505,    // Timestamp when first discovered
    lastSeenOn: 1748385000000,     // Timestamp when last seen on platform

    // State flags
    seen: true,      // Currently visible on Amazon Vine
    hidden: false,   // User manually hid this item
    notified: false, // Notification sent for this item

    // Metadata
    queue: "potluck"  // Which queue: potluck, encore, last_chance
  }
}
```

**Terminology** (important distinctions):
- `seen: true` = Item is currently visible on Amazon Vine platform
- `hidden: true` = User manually marked to hide (old "seen items" concept)
- `notified: true` = Notification already sent for this item
- "New item" = `seen=true AND notified=false AND hidden=false`

**Legacy Migration**:
- Old storage keys (`vineKnownItems`, `vineSeenTitles`, `vineLastNotifiedItems`) are deprecated
- Automatic migration runs once on first load with new system
- See `REFACTORING_SUMMARY.md` for migration details

### Event System

Cross-manager communication uses a global event bus pattern:

```javascript
// Emit events
window.vineEventBus.emit('eventName', data);

// Listen to events
window.vineEventBus.on('eventName', (data) => { /* handle */ });

// Remove listener
window.vineEventBus.off('eventName', callback);
```

**Key Events**:
- `itemMarkedSeen` / `itemMarkedUnseen` - Item hidden/unhidden by user
- `itemBookmarked` / `itemUnbookmarked` - Item bookmark state changed
- `toggleItemSeen` - Request to toggle item hidden state
- `toggleItemBookmark` - Request to toggle bookmark
- `toggleSeenFromTable` / `toggleBookmarkFromTable` - Table view interactions

## Development Commands

### Loading the Extension

```bash
# 1. Navigate to chrome://extensions/
# 2. Enable "Developer mode" (toggle in top right)
# 3. Click "Load unpacked"
# 4. Select the project root directory (containing manifest.json)
```

### Reloading After Changes

```bash
# After making changes:
# 1. Go to chrome://extensions/
# 2. Click the reload icon on the extension card
# OR
# Use the keyboard shortcut Ctrl+R on the extensions page
```

### Testing

This project was recently refactored to add comprehensive testing infrastructure:
- Test files: Look for `*.test.js` files (to be created)
- See `.kiro/specs/chrome-extension-testing/` for test strategy documentation

### Debugging

**Console Access** - All managers are exposed globally for debugging:
```javascript
// Main controller
window.vineEnhancer

// Individual managers
window.vineItemsRepository       // Data access layer
window.vinePageManager           // Navigation
window.vineKeyboardManager       // Keyboard shortcuts
window.vineStorageManager        // Storage ops
window.vineBookmarkManager       // Bookmarks
window.vineNewItemsManager       // New items tracking
window.vineMonitoringManager     // Monitoring
window.vineNotificationProvider  // Notifications

// Get all managers
window.vineEnhancer.getAllManagers()

// Get specific manager
window.vineEnhancer.getManager('storage')

// Get status
window.vineEnhancer.getStatus()

// Get performance metrics
window.vineEnhancer.getPerformanceMetrics()

// Repository statistics
window.vineItemsRepository.getStats()
```

**Checking Item State**:
```javascript
// Get item by ASIN
window.vineItemsRepository.get('B0ABC123')

// Get all new items (need notification)
window.vineItemsRepository.getNewItems()

// Get all hidden items
window.vineItemsRepository.getHiddenItems()

// Export all data
window.vineItemsRepository.exportData()
```

## Code Structure and Patterns

### Adding a New Manager

1. Create file in `managers/` directory
2. Extend `BaseManager` class
3. Implement `async setup()` method
4. Use event bus for communication
5. Add to manifest.json content_scripts.js array (order matters!)
6. Add to content.js initialization

**Template**:
```javascript
class NewManager extends BaseManager {
  constructor(config) {
    super(config);
    // Initialize properties
  }

  async setup() {
    this.setupEventListeners();
    console.log('NewManager: Initialized');
  }

  setupEventListeners() {
    this.on('eventName', (data) => {
      // Handle events
    });
  }

  // Feature methods
  someFeature() {
    this.emit('featureCompleted', { data });
  }

  cleanup() {
    super.cleanup();
    // Cleanup logic
  }
}
```

### Accessing Repository

Always use `ItemsRepository` for data operations (never access Chrome storage directly):

```javascript
// Get singleton instance
const repo = window.vineItemsRepository;

// CRUD operations
await repo.upsert({ asin, title, url, ... });  // Create or update
const item = repo.get(asin);                     // Read
await repo.update(asin, { hidden: true });       // Update
await repo.delete(asin);                         // Delete

// State management
await repo.setHidden(asin, true);
await repo.setNotified(asin, true);
await repo.setSeen(asin, false);
await repo.touch(asin);  // Update lastSeenOn

// Queries
repo.getNewItems();           // Items needing notification
repo.getHiddenItems();        // User-hidden items
repo.getSeenItems();          // Currently on platform
repo.find(doc => ...);        // Custom filter
```

### Message Passing

**Content Script → Background**:
```javascript
chrome.runtime.sendMessage({
  action: 'startMonitoring',
  config: { queue: 'potluck', refreshIntervalSeconds: 300 }
}, response => {
  console.log(response);
});
```

**Background → Content Script**:
```javascript
chrome.tabs.sendMessage(tabId, {
  action: 'performItemCheck'
}, response => {
  console.log(response);
});
```

**Popup ↔ Content Script**:
```javascript
// Popup sends to active tab's content script
chrome.tabs.query({active: true, currentWindow: true}, tabs => {
  chrome.tabs.sendMessage(tabs[0].id, { action: 'getData' });
});
```

## Key Features and Implementation

### Title Expansion
- Automatically shows full titles (no truncation)
- Removes `.a-offscreen` class and CSS clip properties
- Runs continuously every 300ms to handle dynamic content

### Item Tracking
- Uses ASIN (Amazon Standard Identification Number) as unique identifier
- Tracks lifecycle: first seen → last seen → missing (garbage collected after 30 days)
- Separate concepts: seen (on platform) vs hidden (user action) vs notified

### Monitoring System
- Background worker uses Chrome Alarms API (every 30 seconds for checks)
- Page refresh with random ±10% variation to avoid detection
- Content script performs actual item scanning
- Notifications sent only for: `seen=true AND notified=false AND hidden=false`

### Keyboard Navigation
- j/k - Navigate items (vim-style)
- h - Hide/unhide current item
- b - Toggle bookmark sidebar
- a - Toggle auto-navigation
- Space - Toggle title expansion
- Ctrl+←/→ - Previous/next page
- Escape - Clear filter

### Bookmarking
- Stores item title, URL, page number, and page URL
- Slide-out sidebar for viewing bookmarks
- Two navigation modes: visit item directly or return to original page

### Page Detection
- Detects queue from URL parameter: `?queue=potluck`
- Fallback: Reads Amazon's embedded page state from `data-a-state="vvp-context"`
- Important for monitoring to target correct queue

## Important Files

- **REFACTORING_README.md** - Architecture documentation and manager system
- **REFACTORING_SUMMARY.md** - Storage system refactoring and data migration
- **README.md** - User-facing documentation and feature descriptions
- **.kiro/specs/** - Implementation specifications and design documents
- **manifest.json** - Chrome extension configuration (contains script load order!)

## Common Tasks

### Modifying Item State Logic
- Edit: `services/items-repository.js` for data operations
- Edit: `managers/new-items-manager.js` for lifecycle tracking
- Edit: `managers/seen-items-manager.js` for visual states

### Changing Notification Behavior
- Edit: `managers/monitoring-manager.js` for trigger logic
- Edit: `managers/notification-provider-manager.js` for delivery

### Adding Keyboard Shortcuts
- Edit: `managers/keyboard-manager.js`
- Add key handler in `handleKeyPress` method
- Update help text if needed

### Modifying UI
- Edit: `managers/ui-manager.js` for control panel
- Edit: `styles.css` for styling
- Edit: `popup.html` / `popup.js` for extension popup

### Debugging Monitoring
1. Open DevTools console on Amazon Vine page
2. Check: `window.vineMonitoringManager.isMonitoring`
3. Check: `window.vineItemsRepository.getNewItems()`
4. Check: `chrome.alarms.getAll()` in background service worker console

## Testing Strategy

The extension now has a comprehensive testing infrastructure. Key testing areas:

1. **Manager Lifecycle** - Initialization order, event handling, cleanup
2. **Repository Operations** - CRUD, queries, garbage collection
3. **Event Bus** - Cross-manager communication
4. **Chrome APIs** - Storage, alarms, tabs, notifications (requires mocking)
5. **DOM Interactions** - Item scanning, UI updates, keyboard events

See `.kiro/specs/chrome-extension-testing/` for detailed test requirements.

## Notes for AI Assistants

- **Critical**: Always maintain manager initialization order in content.js
- **Critical**: Use ItemsRepository for all data operations (never access Chrome storage directly)
- When adding features, consider which manager should own the functionality
- Test changes by loading extension in Chrome (no build process required)
- Console access is available via `window.vineEnhancer` and individual manager globals
- The extension uses Chrome Manifest V3 (service workers, not background pages)
- Amazon Vine page structure may change - selectors may need updates
- ASIN extraction is critical - always validate ASIN format (B0XXXXXX pattern)

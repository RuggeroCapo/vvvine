# Storage Refactoring Summary

## Overview
Refactored the storage system from multiple fragmented storage keys to a unified document-based structure, preparing for future database migration.

## Changes Made

### 1. New Unified Document Structure

**Storage Key:** `vineItems`

**Document Schema:**
```javascript
{
  "B0ABC123": {
    asin: "B0ABC123",
    title: "Product Title",
    url: "https://amazon.../dp/B0ABC123",
    imageUrl: "https://...",

    // Tracking
    firstSeenOn: 1748380990505,    // Timestamp when first discovered
    lastSeenOn: 1748385000000,     // Timestamp when last seen on platform

    // State flags
    seen: true,                     // Currently visible on Amazon Vine
    hidden: false,                  // User manually hid this item (was "seen")
    notified: false,                // Notification sent for this item

    // Metadata
    queue: "potluck"               // Which queue: potluck, encore, last_chance
  }
}
```

### 2. New Service Layer

#### `services/items-repository.js`
Centralized data access layer that isolates all storage operations. Key methods:

**CRUD Operations:**
- `upsert(itemData)` - Create or update item
- `get(asin)` - Get item by ASIN
- `update(asin, updates)` - Update item properties
- `delete(asin)` - Delete item

**State Management:**
- `setHidden(asin, hidden)` - Mark item as hidden/visible
- `setNotified(asin, notified)` - Mark item as notified
- `setSeen(asin, seen)` - Mark item as seen/unseen on platform
- `touch(asin)` - Update lastSeenOn timestamp

**Queries:**
- `getSeenItems()` - Get all currently visible items
- `getHiddenItems()` - Get all user-hidden items
- `getNewItems()` - Get items that need notification (seen=true, notified=false, hidden=false)
- `find(filterFn)` - Custom filter queries

**Housekeeping:**
- `garbageCollect()` - Remove items not seen in 30+ days
- `getStats()` - Get repository statistics

#### `services/data-migration.js`
Handles one-time migration from old storage format to new format.

**Old Storage Keys (deprecated):**
- ❌ `vineKnownItems` - Map of ASIN → timestamp
- ❌ `vineSeenTitles` - Map of title → boolean (hidden items)
- ❌ `vineLastNotifiedItems` - Array of notified ASINs

**New Storage Key:**
- ✅ `vineItems` - Unified document store

**Migration Process:**
1. Converts `vineKnownItems` to new document format
2. Saves `vineSeenTitles` as `vineLegacyHiddenTitles` for later matching
3. Marks notified items from `vineLastNotifiedItems`
4. Matches legacy titles to ASINs as items appear on page
5. Cleans up old storage keys after full migration

### 3. Refactored Managers

#### `managers/new-items-manager.js`
**Before:** Tracked items in `vineKnownItems`, marked ALL items as "known" immediately

**After:**
- Uses `ItemsRepository` for all data operations
- Continuously updates item states:
  - New items: `seen=true, notified=false, hidden=false` → Shows "NEW" badge
  - Existing items: Updates `lastSeenOn` timestamp
  - Missing items: Sets `seen=false` (no longer on platform)
- Highlights items based on state (new but not notified)

#### `managers/seen-items-manager.js`
**Before:** Managed "seen items" (items to hide) using titles in `vineSeenTitles`

**After:**
- Renamed conceptually to handle "hidden items"
- Uses `repository.setHidden()` to mark items user wants to hide
- Uses ASIN-based identification instead of title-based
- Maintains backward compatibility with legacy `toggleItemSeen()` method

#### `managers/monitoring-manager.js`
**Before:**
- Tracked notified items separately in `vineLastNotifiedItems`
- Used `newItemsManager.isItemNew()` which had timing issues

**After:**
- Uses `repository.getNewItems()` to find items needing notification
- Query: `seen=true AND notified=false AND hidden=false`
- Marks items as notified using `repository.setNotified()`
- No separate tracking needed - all state in unified document

### 4. Fixed Issues

#### ✅ Page Detection Bug
**File:** `managers/page-detection-manager.js`

**Problem:** Potluck pages without `?queue=potluck` URL parameter weren't detected

**Solution:** Added fallback detection using Amazon's embedded page state:
```javascript
detectQueueFromPageState() {
  const stateScript = document.querySelector('script[data-a-state*="vvp-context"]');
  const stateData = JSON.parse(stateScript.textContent);
  return stateData.queueKey; // Returns "potluck", "encore", etc.
}
```

#### ✅ Monitoring Timing Issue
**Problem:** Items marked as "known" immediately when page loads, so monitoring never found them as "new"

**Solution:**
- Separate concepts: `seen` (on platform) vs `notified` (notification sent)
- Items can be `seen=true` but `notified=false` → Will trigger notification
- User hiding items sets `hidden=true` → Won't trigger notification

## Terminology Clarification

| Term | Meaning | Storage Field |
|------|---------|---------------|
| **Seen** | Currently visible on Amazon Vine platform | `seen: true/false` |
| **Hidden** | User manually marked to hide (old "seen items") | `hidden: true/false` |
| **Notified** | Notification already sent for this item | `notified: true/false` |
| **New** | Item that should trigger notification | `seen=true AND notified=false AND hidden=false` |

## How It Works Now

### Scenario 1: First Time Seeing Items
1. User opens potluck page with 10 items
2. `NewItemsManager.scanAndProcessItems()` runs
3. Creates documents for all 10 items: `seen=true, notified=false, hidden=false`
4. All 10 items show "NEW" badge (not notified yet)
5. If monitoring is ON:
   - `MonitoringManager.checkForNewItems()` finds all 10 items
   - Sends notification about 10 new items
   - Marks all as `notified=true`
   - Badges disappear

### Scenario 2: Monitoring Detects New Item
1. Monitoring is ON, user already saw 10 items (all `notified=true`)
2. Background worker refreshes page after 5 minutes
3. Amazon added 1 new item (#11)
4. `NewItemsManager` creates document: `seen=true, notified=false, hidden=false`
5. `MonitoringManager` finds 1 new item via `getNewItems()`
6. Sends notification about 1 new item
7. Marks item #11 as `notified=true`

### Scenario 3: User Hides Items
1. User presses 'S' or clicks eye button on item #5
2. `SeenItemsManager.toggleItemHidden()` sets `hidden=true`
3. Item #5 is visually dimmed/hidden
4. Even if monitoring is ON, item #5 won't trigger notifications (hidden=true)

### Scenario 4: Item Disappears from Platform
1. Item #3 was available yesterday (`seen=true`)
2. Today, page loads without item #3
3. `NewItemsManager.markMissingItemsAsUnseen()` sets `seen=false`
4. Item #3 won't trigger notifications (seen=false)
5. After 30 days of `seen=false`, garbage collection removes it

## Migration Strategy

The refactoring includes automatic migration:

1. **On First Load:** `DataMigration.migrate()` runs
   - Converts `vineKnownItems` to new format
   - Saves hidden titles temporarily
   - Migrates notified status

2. **As Items Appear:** `DataMigration.matchLegacyHiddenTitles()` runs
   - Matches saved title → ASIN
   - Sets `hidden=true` on matched items
   - Removes matched titles from temporary storage

3. **Cleanup:** After all titles matched
   - Removes old storage keys
   - Cleans up temporary migration data

## Benefits of New Structure

1. **Single Source of Truth:** One `vineItems` object instead of 3 separate keys
2. **ASIN-based:** Uses Amazon's unique ID instead of fragile title matching
3. **Database-Ready:** Document structure easily maps to NoSQL databases
4. **Isolated Logic:** All storage operations in `ItemsRepository` service
5. **Better State Tracking:** Separate flags for different states (seen, hidden, notified)
6. **Automatic Cleanup:** Garbage collection removes stale data
7. **Migration Support:** Automatic data migration from old format

## Future Database Migration

The repository pattern makes it easy to swap storage backends:

```javascript
// Current: Chrome storage
class ItemsRepository {
  async save() {
    await chrome.storage.local.set({ vineItems: ... });
  }
}

// Future: IndexedDB, PouchDB, or remote database
class ItemsRepository {
  async save() {
    await db.vineItems.put(...);
  }
}
```

## Testing

To test the refactored system:

1. **Fresh Install:** Load extension → Should work with empty storage
2. **Migration:** Load with old data → Should migrate automatically
3. **Monitoring:** Start monitoring → Should detect new items correctly
4. **Hide Items:** Press 'S' → Items should hide
5. **Page Detection:** Test potluck.html files → Should detect as potluck

## Rollback Plan

If issues occur, rollback is possible:

1. Revert to previous commit
2. Old storage keys still exist (migration doesn't delete immediately)
3. Data is preserved

## Notes

- Old storage keys are NOT deleted immediately (for safety)
- Migration runs only once (flagged with `vineMigrationCompleted`)
- Legacy title matching happens progressively as items appear
- Repository is a singleton (`window.vineItemsRepository`)

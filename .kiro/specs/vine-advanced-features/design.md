# Vine Advanced Features - Design

## Architecture Overview

### New Components

```
managers/
├── target-filter-manager.js     # Manages target brands/ASINs
├── color-coding-manager.js      # Applies color highlights
├── category-tracker-manager.js  # Tracks category increments (already implemented)
└── popup-notification-manager.js # Shows visual popups
```

### Component Interactions

```
content.js
    ├─> TargetFilterManager
    │   ├─> StorageManager (target lists)
    │   └─> ColorCodingManager (blue highlight)
    │
    ├─> ColorCodingManager
    │   ├─> SeenItemsManager (seen status)
    │   ├─> NewItemsManager (new status)
    │   └─> TargetFilterManager (target status)
    │
    ├─> CategoryTrackerManager (already implemented)
    │   ├─> StorageManager (previous counts)
    │   └─> PopupNotificationManager (increment alerts)
    │
    └─> PopupNotificationManager
        └─> UIManager (positioning)
```

## Detailed Design

### 1. Target Filter Manager

**Responsibilities:**
- Store and manage target brands/ASINs
- Check if items match targets
- Emit events for target matches

**Key Methods:**
```javascript
class TargetFilterManager extends BaseManager {
  async setup()
  async loadTargets()
  async saveTargets(brands, asins)
  isTargetItem(title, asin)
  matchesBrand(title)
  matchesAsin(asin)
  getTargetBrands()
  getTargetAsins()
}
```

**Storage Keys:**
- `vineTargetBrands`: Array of target brand names
- `vineTargetAsins`: Array of target ASINs

**Matching Logic:**
- Brand matching: Check first 3 words of title (case-insensitive)
- ASIN matching: Exact match

### 2. Color Coding Manager

**Responsibilities:**
- Apply background colors to items based on status
- Coordinate with other managers for status
- Handle color priority (blue > green > yellow > gray)

**Key Methods:**
```javascript
class ColorCodingManager extends BaseManager {
  async setup()
  processAllItems()
  processItem(item)
  determineItemColor(item)
  applyColor(item, color)
  getItemStatus(item)
}
```

**Color Priority:**
1. Blue (#00BFFF) - Target items (highest priority)
2. Green (#38FEA7) - New items
3. Yellow (#FFF44D) - Recent items (< 60s)
4. Default - Seen items

**CSS Classes:**
- `.vine-target-item` - Blue background
- `.vine-new-item` - Green background (already exists)
- `.vine-recent-item` - Yellow background
- `.vine-seen` - Default/gray (already exists)

### 3. Category Tracker Manager (Already Implemented)

**Responsibilities:**
- Extract category counts from page
- Compare with stored values
- Detect increments
- Emit events for changes

**Key Methods:**
```javascript
class CategoryTrackerManager extends BaseManager {
  async setup()
  async trackCategories()
  extractCategoryCounts()
  async loadPreviousCounts()
  async saveCounts(counts)
  detectIncrements(current, previous)
  getMonitoredCategories()
}
```

**Monitored Categories:**
```javascript
const MONITORED_CATEGORIES = [
  { name: "Commercio, Industria e Scienza", emoji: "🤖" },
  { nameStart: "Alimentari", emoji: "🍏" }
];
```

**Storage Keys:**
- `vineCategoryPrevious_🤖`: Previous count for CSI
- `vineCategoryPrevious_🍏`: Previous count for Alimentari

**Timing:**
- Run on page load (Encore page only)
- Independent of monitoring mode
- Non-blocking

### 4. Popup Notification Manager

**Responsibilities:**
- Show visual popups for counts and alerts
- Auto-dismiss after timeout
- Position popups correctly
- Handle multiple popup types

**Key Methods:**
```javascript
class PopupNotificationManager extends BaseManager {
  async setup()
  showNewItemsPopup(newCount, targetCount)
  showCategoryPopup(increments)
  showPurchaseResult(success, message)
  createPopup(content, position, duration, style)
  removePopup(popupId)
}
```

**Popup Types:**
1. **New Items Popup**
   - Position: Top-center (270px from top)
   - Content: "🟩 {count} 🟦 {count}"
   - Duration: 5 seconds
   - Background: #38FEA7

2. **Category Popup**
   - Position: Top-center (330px from top)
   - Content: "{emoji} {count} {emoji} {count}"
   - Duration: 5 seconds
   - Background: #ffa8f7

## Data Flow
```
Page loads
    ↓
ColorCodingManager processes items
    ↓
For each item:
    ├─> Check if target (TargetFilterManager)
    ├─> Check if new (NewItemsManager)
    ├─> Check if recent (SeenItemsManager + timestamp)
    └─> Check if seen (SeenItemsManager)
    ↓
Apply color based on priority
    ↓
Emit events for counts
    ↓
PopupNotificationManager shows popup
```

### Category Tracking Flow
```
Page loads (Encore only)
    ↓
CategoryTrackerManager extracts counts
    ↓
Load previous counts from storage
    ↓
Compare current vs previous
    ↓
If increments detected:
    ├─> Save new counts
    └─> Show category popup
```

## Configuration UI

### Popup Settings Addition

Add new section to `popup.html`:

```html
<div class="settings-section">
  <h3>Target Filtering</h3>
  
  <label>Target Brands (comma-separated):</label>
  <textarea id="target-brands" rows="3"></textarea>
  
  <label>Target ASINs (comma-separated):</label>
  <textarea id="target-asins" rows="3"></textarea>
  
  <button id="save-targets">Save Targets</button>
</div>

<div class="settings-section">
  <h3>Category Tracking</h3>
  
  <label>Monitored Categories:</label>
  <ul id="monitored-categories">
    <li>🤖 Commercio, Industria e Scienza</li>
    <li>🍏 Alimentari</li>
  </ul>
  
  <button id="reset-category-counts">Reset Category Counts</button>
</div>
```

## Error Handling
- DOM structure changed: Log error, skip tracking
- Storage error: Log error, use empty previous counts

### Color Coding Errors
- Manager not available: Skip that color check
- DOM manipulation fails: Log error, continue with other items

## Performance Considerations

### Optimization Strategies
1. **Batch DOM updates**: Apply all colors in single pass
2. **Debounce category tracking**: Wait 500ms after page load
3. **Throttle popup creation**: Max 1 popup per type at a time

### Memory Management
- Clear old timestamps from recent items (> 5 minutes)
- Limit stored category history to last 10 values
- Remove event listeners on cleanup

## Testing Strategy

### Unit Tests
- TargetFilterManager: Brand/ASIN matching logic
- ColorCodingManager: Priority determination
- CategoryTrackerManager: Increment detection

### Integration Tests
- Color coding with multiple managers
- Category tracking with storage
- Popup display and dismissal

### Manual Tests
- Target matching with various brands
- Category increments on Encore
- Popup positioning and timing

## Rollout Plan

### Phase 1: Foundation
- Implement TargetFilterManager
- Implement ColorCodingManager
- Add basic color coding

### Phase 2: Visual Feedback
- Implement PopupNotificationManager
- Add new items popup
- Add category tracking popup

### Phase 3: Polish
- Add configuration UI
- Optimize performance
- Add error handling

## Accessibility

### Color Coding
- Add text indicators in addition to colors
- Use patterns or icons for colorblind users
- Ensure sufficient contrast

### Keyboard Navigation
- All buttons keyboard accessible
- Escape to dismiss popups

### Screen Readers
- Add aria-labels to interactive elements
- Announce status changes

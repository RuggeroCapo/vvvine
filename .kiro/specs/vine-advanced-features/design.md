# Vine Advanced Features - Design

## Architecture Overview

### New Components

```
managers/
├── purchase-manager.js          # Handles one-click purchases
├── target-filter-manager.js     # Manages target brands/ASINs
├── color-coding-manager.js      # Applies color highlights
├── category-tracker-manager.js  # Tracks category increments
└── popup-notification-manager.js # Shows visual popups
```

### Component Interactions

```
content.js
    ├─> PurchaseManager
    │   ├─> StorageManager (address, CSRF)
    │   └─> PopupNotificationManager (feedback)
    │
    ├─> TargetFilterManager
    │   ├─> StorageManager (target lists)
    │   └─> ColorCodingManager (blue highlight)
    │
    ├─> ColorCodingManager
    │   ├─> SeenItemsManager (seen status)
    │   ├─> NewItemsManager (new status)
    │   └─> TargetFilterManager (target status)
    │
    ├─> CategoryTrackerManager
    │   ├─> StorageManager (previous counts)
    │   └─> PopupNotificationManager (increment alerts)
    │
    └─> PopupNotificationManager
        └─> UIManager (positioning)
```

## Detailed Design

### 1. Purchase Manager

**Responsibilities:**
- Add rocket button to item tiles
- Handle purchase confirmation dialog
- Make API calls to Amazon Vine
- Manage CSRF tokens
- Handle address selection

**Key Methods:**
```javascript
class PurchaseManager extends BaseManager {
  async setup()
  createRocketButton(tile, asin, recommendationId, isParent)
  showConfirmationDialog(title, asin)
  async executePurchase(recommendationId, asin, isParent)
  async resolveParentAsin(recommendationId)
  getCsrfToken()
  getSelectedAddress()
  setSelectedAddress(addressId, legacyAddressId)
}
```

**Storage Keys:**
- `vinePurchaseAddressId`: Selected address ID
- `vinePurchaseLegacyAddressId`: Legacy address ID
- `vineTargetBrands`: Array of target brand names
- `vineTargetAsins`: Array of target ASINs

**API Endpoints:**
- GET `/vine/api/recommendations/{id}` - Resolve parent ASIN
- POST `/vine/api/voiceOrders` - Execute purchase

### 2. Target Filter Manager

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

**Matching Logic:**
- Brand matching: Check first 3 words of title (case-insensitive)
- ASIN matching: Exact match

### 3. Color Coding Manager

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

### 4. Category Tracker Manager

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

### 5. Popup Notification Manager

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

3. **Purchase Result Popup**
   - Position: Bottom-right
   - Content: Success/error message
   - Duration: 5 seconds
   - Background: #333 (dark)

### 6. Confirmation Dialog

**Design:**
```html
<div class="vine-purchase-dialog">
  <div class="vine-purchase-dialog-content">
    <h3>Confirm Purchase</h3>
    <p class="vine-purchase-item-title">{first 4 words of title}</p>
    <p class="vine-purchase-item-asin">ASIN: {asin}</p>
    <div class="vine-purchase-dialog-actions">
      <button class="vine-btn-confirm">Confirm (Enter)</button>
      <button class="vine-btn-cancel">Cancel (Esc)</button>
    </div>
  </div>
</div>
```

**Keyboard Shortcuts:**
- Enter: Confirm purchase
- Escape: Cancel

**Styling:**
- Modal overlay with backdrop
- Centered on screen
- Fast animation (100ms)
- Focus trap

### 7. Rocket Button Design

**Visual:**
- Position: Absolute, top-right of tile (10px, 10px)
- Size: 35px × 35px circle
- Icon: 🚀 emoji
- Background: #d7f540 (child ASIN) or #f5a52f (parent ASIN)
- Border: 2px solid matching background
- Shadow: 0 0 6px rgba(0, 255, 255, 0.5)

**States:**
- Hover: Scale 1.1, brighter shadow
- Active: Scale 0.95
- Disabled: Opacity 0.5, no pointer events

**Visibility:**
- Only on Potluck, Encore, Last Chance queues
- Hidden on search results
- Hidden if purchase already made

## Data Flow

### Purchase Flow
```
User clicks rocket
    ↓
Show confirmation dialog
    ↓
User confirms
    ↓
Get CSRF token from page
    ↓
Get selected address from storage
    ↓
If parent ASIN: Resolve to child ASIN
    ↓
POST to /vine/api/voiceOrders
    ↓
Check response for orderId
    ↓
Show success/failure popup
    ↓
Update UI (disable button)
```

### Color Coding Flow
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
  <h3>Purchase Settings</h3>
  
  <label>Delivery Address:</label>
  <select id="purchase-address">
    <!-- Populated from page -->
  </select>
  
  <label>
    <input type="checkbox" id="enable-rocket">
    Enable Rocket Button (One-Click Purchase)
  </label>
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

### Purchase Errors
- Network failure: Show error popup, don't mark as purchased
- CSRF token invalid: Refresh token and retry once
- Address not selected: Show error, prompt to select address
- Parent ASIN resolution fails: Show error, don't proceed
- Order API returns error: Show error message from response

### Category Tracking Errors
- DOM structure changed: Log error, skip tracking
- Storage error: Log error, use empty previous counts

### Color Coding Errors
- Manager not available: Skip that color check
- DOM manipulation fails: Log error, continue with other items

## Performance Considerations

### Optimization Strategies
1. **Batch DOM updates**: Apply all colors in single pass
2. **Debounce category tracking**: Wait 500ms after page load
3. **Cache CSRF token**: Reuse for multiple purchases
4. **Lazy load rocket buttons**: Only create when visible
5. **Throttle popup creation**: Max 1 popup per type at a time

### Memory Management
- Clear old timestamps from recent items (> 5 minutes)
- Limit stored category history to last 10 values
- Remove event listeners on cleanup

## Testing Strategy

### Unit Tests
- TargetFilterManager: Brand/ASIN matching logic
- ColorCodingManager: Priority determination
- CategoryTrackerManager: Increment detection
- PurchaseManager: ASIN resolution

### Integration Tests
- Purchase flow end-to-end
- Color coding with multiple managers
- Category tracking with storage
- Popup display and dismissal

### Manual Tests
- Purchase on different queues
- Target matching with various brands
- Category increments on Encore
- Popup positioning and timing
- Keyboard shortcuts in dialog

## Rollout Plan

### Phase 1: Foundation
- Implement TargetFilterManager
- Implement ColorCodingManager
- Add basic color coding (no purchase yet)

### Phase 2: Visual Feedback
- Implement PopupNotificationManager
- Add new items popup
- Add category tracking popup

### Phase 3: Category Tracking
- Implement CategoryTrackerManager
- Add Encore page detection
- Add category increment detection

### Phase 4: Purchase Feature
- Implement PurchaseManager
- Add rocket button
- Add confirmation dialog
- Add address selection

### Phase 5: Polish
- Add configuration UI
- Add keyboard shortcuts
- Optimize performance
- Add error handling

## Security Considerations

### CSRF Protection
- Always use fresh CSRF token from page
- Validate token format before use
- Never log or expose token

### Address Data
- Store only IDs, not full addresses
- Clear on logout (if detectable)
- Validate before use

### API Calls
- Validate all responses
- Check for error codes
- Handle rate limiting
- Don't retry indefinitely

## Accessibility

### Color Coding
- Add text indicators in addition to colors
- Use patterns or icons for colorblind users
- Ensure sufficient contrast

### Keyboard Navigation
- All buttons keyboard accessible
- Dialog focus trap
- Escape to dismiss

### Screen Readers
- Add aria-labels to rocket buttons
- Announce purchase results
- Label confirmation dialog properly

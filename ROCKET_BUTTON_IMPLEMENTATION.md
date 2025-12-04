# Rocket Button Implementation

## Overview
The rocket button feature enables one-click purchasing of Amazon Vine items directly from the queue pages (Potluck, Encore, Last Chance).

## Features Implemented

### 1. Rocket Button
- **Location**: Top-right corner of each item tile (10px from top and right)
- **Visual**: 🚀 emoji in a circular button
- **Colors**:
  - Yellow (#d7f540) for child ASINs
  - Orange (#f5a52f) for parent ASINs
- **Effects**: Hover animation (scale 1.1) with glowing cyan shadow
- **Z-index**: 25 (above other elements but below dialogs)

### 2. Confirmation Dialog
- **Trigger**: Clicking the rocket button
- **Content**:
  - Title: "Confirm Purchase"
  - Item title (first 4 words + "...")
  - ASIN display
  - Confirm and Cancel buttons
- **Keyboard Shortcuts**:
  - Enter: Confirm purchase
  - Escape: Cancel
- **Click outside**: Cancels the dialog

### 3. Purchase Flow
1. User clicks rocket button
2. Confirmation dialog appears
3. User confirms (Enter or click)
4. Extension retrieves CSRF token from page
5. Extension gets selected delivery address from storage
6. If parent ASIN, resolves to child ASIN via API
7. Makes POST request to `/vine/api/voiceOrders`
8. Shows success/failure popup
9. Disables rocket button on success

### 4. Purchase Result Popup
- **Location**: Bottom-right corner
- **Duration**: 5 seconds auto-dismiss
- **Colors**:
  - Green (#10b981) for success
  - Red (#ef4444) for failure
- **Animation**: Slide in from right

## API Endpoints Used

### Purchase API
```
POST https://www.amazon.it/vine/api/voiceOrders
Headers:
  - Content-Type: application/json
  - anti-csrftoken-a2z: <token>
Body:
  {
    "recommendationId": "...",
    "asin": "...",
    "addressId": "...",
    "legacyAddressId": "..."
  }
```

### Parent ASIN Resolution
```
GET https://www.amazon.it/vine/api/recommendations/{recommendationId}
```

## Storage Keys

- `vinePurchaseAddressId`: Selected delivery address ID
- `vinePurchaseLegacyAddressId`: Legacy address ID for compatibility
- `vineRocketEnabled`: Boolean to enable/disable rocket buttons (default: true)

## Manager Integration

### PurchaseManager
- **File**: `managers/purchase-manager.js`
- **Dependencies**: StorageManager
- **Events Emitted**: `itemPurchased` (when purchase succeeds)

### Integration in content.js
```javascript
// Manager initialization order
'purchase',  // After monitoring, before ui

// Dependencies setup
this.managers.purchase.setStorageManager(this.managers.storage);

// Global access
window.vinePurchaseManager = this.managers.purchase;
```

## Error Handling

### CSRF Token Errors
- Tries to get from meta tag first
- Falls back to window.ue_csm.token
- Shows error if not found

### Address Not Selected
- Shows error message: "No delivery address selected. Please configure in popup settings."

### Parent ASIN Resolution Failure
- Shows error and doesn't proceed with purchase

### Network Errors
- Catches and displays error message
- Doesn't mark item as purchased

## Security Considerations

1. **CSRF Protection**: Always uses fresh token from page
2. **Address Storage**: Only stores IDs, not full addresses
3. **API Validation**: Checks response for orderId before marking success
4. **No Token Logging**: CSRF tokens are never logged

## Testing

### Manual Testing Steps
1. Navigate to a Vine queue page (Potluck, Encore, or Last Chance)
2. Verify rocket buttons appear on all items
3. Click a rocket button
4. Verify confirmation dialog appears
5. Test keyboard shortcuts (Enter/Escape)
6. Confirm purchase
7. Verify success popup appears
8. Verify rocket button is disabled after purchase

### Edge Cases to Test
- Parent ASIN items (should show orange button)
- Items without CSRF token
- Items without selected address
- Network failures
- API errors

## Future Enhancements

### Planned Features (from design.md)
1. Address selection UI in popup
2. Enable/disable toggle in popup settings
3. Target brand/ASIN filtering integration
4. Color coding for target items (blue background)
5. Visual popups for new/target item counts

### Not Yet Implemented
- Popup settings UI for address selection
- Enable/disable toggle
- Integration with target filtering
- Integration with color coding system
- Category tracking popups

## Usage

### For Users
1. Install the extension
2. Navigate to Amazon Vine queue pages
3. Click the rocket button on any item
4. Confirm the purchase
5. Item will be ordered to your default address

### For Developers
```javascript
// Access the manager
const purchaseManager = window.vinePurchaseManager;

// Set delivery address
await purchaseManager.setSelectedAddress(addressId, legacyAddressId);

// Enable/disable rocket buttons
await purchaseManager.setRocketEnabled(true);

// Listen for purchase events
window.vineEventBus.on('itemPurchased', (data) => {
  console.log('Item purchased:', data.asin);
});
```

## Known Limitations

1. **Address Selection**: Currently requires manual configuration via storage
2. **No Popup UI**: Settings UI not yet implemented
3. **Italian Amazon Only**: Hardcoded to amazon.it domain
4. **No Rate Limiting**: User can click multiple rockets quickly
5. **No Purchase History**: Doesn't track purchase history

## Files Modified

1. `managers/purchase-manager.js` - New file
2. `content.js` - Added purchase manager initialization
3. `styles.css` - Added rocket button and dialog styles
4. `manifest.json` - Added purchase-manager.js to content scripts

## CSS Classes Added

- `.vine-rocket-btn` - Rocket button styling
- `.vine-purchase-dialog` - Dialog overlay
- `.vine-purchase-dialog-content` - Dialog content box
- `.vine-purchase-item-title` - Item title in dialog
- `.vine-purchase-item-asin` - ASIN display in dialog
- `.vine-purchase-dialog-actions` - Button container
- `.vine-btn-confirm` - Confirm button
- `.vine-btn-cancel` - Cancel button
- `.vine-purchase-result-popup` - Success/failure popup

## Animations

- `vineFadeIn` - Dialog overlay fade in (0.1s)
- `vineScaleIn` - Dialog content scale in (0.1s)
- `vineSlideIn` - Result popup slide in (0.3s)

# Address Selection - Quick Summary

## How It Works (Simple Version)

### For Users:

1. **Visit a Vine page** - The extension automatically scans for your delivery addresses
2. **Open the popup** - Click the extension icon
3. **Select your address** - In the "One-Click Purchase" section, choose from the dropdown
4. **Done!** - All rocket button purchases will use this address

### If you don't see addresses:
- Click the "Refresh Addresses" button
- Make sure you're on an Amazon Vine page
- The page needs to be fully loaded

## Technical Flow:

```
User visits Vine page
    ↓
PurchaseManager.extractAndStoreAddresses()
    ↓
Scans page for address data (3 methods)
    ↓
Stores addresses in chrome.storage.local
    ↓
User opens popup
    ↓
Popup loads addresses from storage
    ↓
Populates dropdown
    ↓
User selects address
    ↓
Saves vinePurchaseAddressId to storage
    ↓
User clicks rocket button
    ↓
PurchaseManager uses stored address ID
    ↓
Makes API call with address
    ↓
Purchase complete!
```

## Key Components:

### Storage:
- `vineAvailableAddresses` - Array of address objects
- `vinePurchaseAddressId` - Selected address ID
- `vinePurchaseLegacyAddressId` - Legacy ID for compatibility

### UI:
- Toggle to enable/disable rocket button
- Dropdown to select delivery address
- "Refresh Addresses" button
- Status messages

### Functions:
- `extractAndStoreAddresses()` - Extracts from page
- `loadRocketButtonSettings()` - Loads in popup
- `savePurchaseAddress()` - Saves selection
- `refreshAddresses()` - Manual refresh

## Address Extraction Methods:

1. **Dropdown selector** - Looks for `<select name="addressId">`
2. **Script scanning** - Searches JavaScript for address patterns
3. **Window object** - Checks `window.VineConfig.addresses`

## Error Messages:

- **"No delivery address selected"** → Select an address in popup
- **"Visit a Vine page to load addresses"** → Navigate to Vine page first
- **"No addresses found on page"** → Try refreshing or different page

## Quick Test:

```javascript
// In browser console on Vine page:
window.vinePurchaseManager.extractAddressesFromPage()
// Should return array of addresses

// Check storage:
chrome.storage.local.get(['vinePurchaseAddressId'], console.log)
```

## Files:
- `managers/purchase-manager.js` - Address extraction logic
- `popup.html` - Address selection UI
- `popup.js` - Address handling functions
- `popup-styles.css` - Dropdown styles

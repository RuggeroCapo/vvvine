# Address Selection Guide for Rocket Button

## Overview
The rocket button requires a delivery address to be selected before purchases can be made. This guide explains how the address selection system works.

## How It Works

### 1. Address Extraction (Automatic)
When you visit an Amazon Vine page, the extension automatically:
- Scans the page for available delivery addresses
- Extracts address IDs and display text
- Stores them in Chrome storage for later use

### 2. Address Selection (Manual)
In the extension popup:
1. Open the popup (click the extension icon)
2. Scroll to the "One-Click Purchase" section
3. Select your preferred delivery address from the dropdown
4. The selection is saved automatically

### 3. Purchase Flow
When you click a rocket button:
1. Extension retrieves your selected address from storage
2. Makes the purchase API call with that address
3. Item is ordered to your selected address

## Address Extraction Methods

The extension tries multiple methods to find addresses:

### Method 1: Address Selector Dropdown
Looks for address selection dropdowns on the page:
```javascript
select[name="addressId"]
#address-select
[data-address-select]
```

### Method 2: Page Scripts
Scans JavaScript on the page for address data patterns:
```javascript
"addressId": "..."
```

### Method 3: Window Object
Checks for address data in `window.VineConfig.addresses`

## Storage Keys

### `vineAvailableAddresses`
Array of address objects:
```javascript
[
  {
    id: "amzn1.address.xxx",           // Address ID for API
    legacyId: "legacy-id",              // Legacy ID (optional)
    text: "John Doe, 123 Main St...",   // Display text
    isDefault: true                     // Whether it's the default
  }
]
```

### `vinePurchaseAddressId`
The selected address ID (string)

### `vinePurchaseLegacyAddressId`
The legacy address ID for compatibility (string or null)

### `vineAddressesLastUpdated`
Timestamp of last address extraction (number)

## UI Components

### Popup Settings Section
```html
<div class="card">
  <div class="card-header">
    <div class="card-icon">🚀</div>
    <h2 class="card-title">One-Click Purchase</h2>
  </div>
  <div class="card-content">
    <!-- Enable/Disable Toggle -->
    <div class="toggle-container">
      <input type="checkbox" id="rocket-enabled-toggle">
    </div>
    
    <!-- Address Dropdown -->
    <select id="purchase-address">
      <option value="">Select an address...</option>
      <!-- Populated dynamically -->
    </select>
    
    <!-- Refresh Button -->
    <button id="refresh-addresses">Refresh Addresses</button>
    
    <!-- Status Message -->
    <div id="address-status"></div>
  </div>
</div>
```

## User Workflow

### First Time Setup
1. Install the extension
2. Navigate to any Amazon Vine page (Potluck, Encore, Last Chance)
3. Wait for page to load (addresses are extracted automatically)
4. Open the extension popup
5. Go to "One-Click Purchase" section
6. Select your delivery address from the dropdown
7. Rocket buttons are now ready to use!

### If No Addresses Appear
1. Make sure you're on an Amazon Vine page
2. Click "Refresh Addresses" button
3. If still no addresses, the page might not have address data
4. Try navigating to a different Vine page or the checkout page

### Changing Address
1. Open the extension popup
2. Select a different address from the dropdown
3. New selection is saved automatically
4. All future purchases will use the new address

## Error Handling

### No Address Selected
**Error**: "No delivery address selected. Please configure in popup settings."

**Solution**: 
1. Open popup
2. Select an address
3. Try purchase again

### No Addresses Found
**Message**: "Visit a Vine page to load your addresses"

**Solution**:
1. Navigate to a Vine queue page
2. Wait for page to load
3. Click "Refresh Addresses" in popup
4. Addresses should appear

### Address Extraction Failed
**Message**: "No addresses found on page"

**Possible Causes**:
- Not on a Vine page
- Page hasn't fully loaded
- Amazon changed their page structure

**Solution**:
1. Refresh the Vine page
2. Try a different Vine page
3. Check browser console for errors

## API Integration

### Purchase API Call
```javascript
POST https://www.amazon.it/vine/api/voiceOrders
Headers:
  Content-Type: application/json
  anti-csrftoken-a2z: <token>
Body:
  {
    "recommendationId": "...",
    "asin": "...",
    "addressId": "amzn1.address.xxx",      // From selection
    "legacyAddressId": "legacy-id"         // From selection
  }
```

## Message Passing

### Content Script → Popup
```javascript
// Get addresses
chrome.runtime.sendMessage({
  action: 'getAddresses'
}, (response) => {
  console.log(response.addresses);
});
```

### Popup → Content Script
```javascript
// Refresh addresses
chrome.tabs.sendMessage(tabId, {
  action: 'refreshAddresses'
}, (response) => {
  console.log(response.success);
});

// Set rocket enabled
chrome.tabs.sendMessage(tabId, {
  action: 'setRocketEnabled',
  enabled: true
});
```

## Functions Reference

### PurchaseManager Methods

#### `extractAndStoreAddresses()`
Extracts addresses from page and stores them
```javascript
await purchaseManager.extractAndStoreAddresses();
```

#### `extractAddressesFromPage()`
Returns array of address objects from current page
```javascript
const addresses = purchaseManager.extractAddressesFromPage();
```

#### `getStoredAddresses()`
Returns addresses from storage
```javascript
const addresses = await purchaseManager.getStoredAddresses();
```

#### `setSelectedAddress(addressId, legacyAddressId)`
Sets the selected address
```javascript
await purchaseManager.setSelectedAddress(
  'amzn1.address.xxx',
  'legacy-id'
);
```

### Popup Functions

#### `loadRocketButtonSettings()`
Loads settings on popup open
```javascript
await loadRocketButtonSettings();
```

#### `populateAddressDropdown(addresses, selectedId)`
Populates the address dropdown
```javascript
populateAddressDropdown(addresses, 'amzn1.address.xxx');
```

#### `refreshAddresses()`
Refreshes addresses from active tab
```javascript
await refreshAddresses();
```

#### `savePurchaseAddress(event)`
Saves selected address from dropdown
```javascript
select.addEventListener('change', savePurchaseAddress);
```

#### `showAddressStatus(message, type)`
Shows status message
```javascript
showAddressStatus('Address saved', 'success');
showAddressStatus('Error occurred', 'error');
showAddressStatus('Loading...', 'info');
```

## Testing

### Manual Testing Steps
1. **Test Address Extraction**
   - Navigate to Vine page
   - Open browser console
   - Run: `window.vinePurchaseManager.extractAddressesFromPage()`
   - Should return array of addresses

2. **Test Address Storage**
   - Open popup
   - Click "Refresh Addresses"
   - Check that dropdown is populated
   - Select an address
   - Reopen popup - selection should persist

3. **Test Purchase with Address**
   - Select an address in popup
   - Click a rocket button on a Vine page
   - Confirm purchase
   - Should succeed without address error

4. **Test No Address Error**
   - Clear storage: `chrome.storage.local.remove(['vinePurchaseAddressId'])`
   - Try to purchase
   - Should show "No delivery address selected" error

### Console Testing
```javascript
// Get purchase manager
const pm = window.vinePurchaseManager;

// Extract addresses
const addresses = pm.extractAddressesFromPage();
console.log('Found addresses:', addresses);

// Get stored addresses
pm.getStoredAddresses().then(console.log);

// Set address manually
pm.setSelectedAddress('amzn1.address.xxx', null);
```

## Troubleshooting

### Problem: Dropdown is empty
**Check**:
1. Are you on a Vine page?
2. Has the page fully loaded?
3. Check console for errors
4. Try clicking "Refresh Addresses"

### Problem: Selected address not saving
**Check**:
1. Check browser console for errors
2. Verify Chrome storage permissions
3. Try selecting again

### Problem: Purchase fails with address error
**Check**:
1. Is an address selected in popup?
2. Is the address ID valid?
3. Check storage: `chrome.storage.local.get(['vinePurchaseAddressId'])`

### Problem: Addresses not extracting
**Check**:
1. Amazon may have changed page structure
2. Check browser console for errors
3. Inspect page HTML for address selectors
4. Update extraction methods if needed

## Future Enhancements

### Planned Features
1. **Auto-select default address** - Automatically select the default address
2. **Address validation** - Verify address is still valid before purchase
3. **Multiple address profiles** - Save different addresses for different queues
4. **Address nickname** - Let users add custom names to addresses
5. **Address refresh on page change** - Auto-refresh when navigating between pages

### Not Yet Implemented
- Address editing
- Address deletion
- Address verification
- Address history
- Multi-account support

## Security Considerations

1. **Address IDs Only**: Only stores address IDs, not full addresses
2. **No PII**: Display text is from Amazon, no additional PII stored
3. **Local Storage**: All data stored locally in Chrome storage
4. **No External Calls**: Address data never sent to external servers
5. **Secure API**: Uses Amazon's official API with CSRF protection

## Files Modified

1. `managers/purchase-manager.js` - Added address extraction methods
2. `popup.html` - Added address selection UI
3. `popup.js` - Added address handling functions
4. `popup-styles.css` - Added address dropdown styles

## Related Documentation

- [ROCKET_BUTTON_IMPLEMENTATION.md](./ROCKET_BUTTON_IMPLEMENTATION.md) - Main rocket button docs
- [.kiro/specs/vine-advanced-features/design.md](./.kiro/specs/vine-advanced-features/design.md) - Original design spec

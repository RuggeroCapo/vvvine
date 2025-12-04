# Address Handling Comparison: Reference Script vs Our Implementation

## Overview
This document compares how the reference Tampermonkey script (riferimento (1).js) handles addresses versus our Chrome extension implementation.

## Key Differences

### 1. Address Extraction

#### Reference Script (Tampermonkey):
```javascript
const addressElements = document.body.querySelectorAll(".vvp-address-option");

addressElements.forEach((element) => {
  const addressId = element.getAttribute("data-address-id");
  const legacyAddressId = element.getAttribute("data-legacy-address-id");
  const streetAddress = element.querySelector(".a-radio-label > span:nth-of-type(1)")?.textContent.trim();
  // ...
});
```

**Looks for:** `.vvp-address-option` elements (Amazon's address radio buttons)

#### Our Implementation:
```javascript
// Method 1: Same as reference script
const addressElements = document.querySelectorAll('.vvp-address-option');

// Method 2: Fallback to dropdown selectors
const addressSelect = document.querySelector('select[name="addressId"]');

// Method 3: Fallback to script scanning
// Searches JavaScript for address patterns
```

**Advantage:** Multiple fallback methods for better compatibility

---

### 2. Storage Location

#### Reference Script:
```javascript
localStorage.setItem("selectedAddressId", selectedAddressId);
localStorage.setItem("selectedLegacyAddressId", selectedLegacyAddressId);
```

**Uses:** Browser's `localStorage` (domain-specific)

#### Our Implementation:
```javascript
await chrome.storage.local.set({
  vinePurchaseAddressId: addressId,
  vinePurchaseLegacyAddressId: legacyAddressId
});
```

**Uses:** Chrome extension storage (extension-specific)

**Advantage:** 
- Persists across all Amazon domains
- More secure (isolated from page scripts)
- Syncs with Chrome account if using `chrome.storage.sync`

---

### 3. UI Location

#### Reference Script:
```javascript
document.body.querySelector(".a-section.vvp-container-right-align")?.prepend(dropdown);
```

**Location:** Directly on the Vine page, top-right section

**UI:** Simple `<select>` dropdown prepended to page

#### Our Implementation:
**Location:** Extension popup (separate UI)

**UI:** Full settings card with:
- Enable/disable toggle
- Address dropdown
- Refresh button
- Status messages

**Advantage:**
- Doesn't modify Amazon's page layout
- More organized settings interface
- Can be accessed from any page

---

### 4. Purchase API Payload

#### Reference Script:
```javascript
const payload = JSON.stringify({
  recommendationId,
  recommendationType: "SEARCH",     // ← Includes this
  itemAsin: asin,                   // ← Called "itemAsin"
  addressId: selectedAddressId,
  legacyAddressId: selectedLegacyAddressId
});
```

#### Our Implementation (Updated):
```javascript
body: JSON.stringify({
  recommendationId: recommendationId,
  recommendationType: 'SEARCH',     // ← Now matches!
  itemAsin: targetAsin,             // ← Now matches!
  addressId: this.selectedAddressId,
  legacyAddressId: this.selectedLegacyAddressId
})
```

**Status:** ✅ Now identical to reference script

---

### 5. CSRF Token Extraction

#### Reference Script:
```javascript
const csrfToken = document.body.querySelector('input[name="csrf-token"]')?.value ||
  (JSON.parse(document.querySelector(".vvp-body > [type='a-state']")?.innerText || "{}").csrfToken);
```

**Methods:**
1. Input field: `input[name="csrf-token"]`
2. JSON state: `.vvp-body > [type="a-state"]`

#### Our Implementation (Updated):
```javascript
getCsrfToken() {
  // Method 1: Input field (same as reference)
  const csrfInput = document.querySelector('input[name="csrf-token"]');
  
  // Method 2: a-state JSON (same as reference)
  const stateElement = document.querySelector('.vvp-body > [type="a-state"]');
  
  // Method 3: Meta tag (fallback)
  const metaTag = document.querySelector('meta[name="anti-csrftoken-a2z"]');
  
  // Method 4: Window object (fallback)
  if (window.ue_csm && window.ue_csm.token) return window.ue_csm.token;
}
```

**Status:** ✅ Now includes reference script methods + fallbacks

---

### 6. Address Dropdown Creation

#### Reference Script:
```javascript
function createAddressDropdown() {
  const addressElements = document.body.querySelectorAll(".vvp-address-option");
  if (!addressElements.length) return;
  if (document.getElementById("address-selector")) return;

  const dropdown = document.createElement("select");
  dropdown.style.marginRight = "10px";
  dropdown.id = "address-selector";

  // Populate dropdown...
  
  dropdown.onchange = function () {
    selectedAddressId = this.value;
    selectedLegacyAddressId = this.options[this.selectedIndex].dataset.legacyAddressId;
    localStorage.setItem("selectedAddressId", selectedAddressId);
    localStorage.setItem("selectedLegacyAddressId", selectedLegacyAddressId);
  };

  document.body.querySelector(".a-section.vvp-container-right-align")?.prepend(dropdown);
}
```

**Approach:** 
- Creates dropdown on page load
- Adds directly to Vine page
- Saves on change

#### Our Implementation:
```javascript
// In popup.js
async function loadRocketButtonSettings() {
  const addresses = result.vineAvailableAddresses || [];
  populateAddressDropdown(addresses, selectedAddressId);
}

function populateAddressDropdown(addresses, selectedId) {
  const select = document.getElementById('purchase-address');
  // Populate from stored addresses...
}

async function savePurchaseAddress(event) {
  await chrome.storage.local.set({
    vinePurchaseAddressId: addressId,
    vinePurchaseLegacyAddressId: legacyAddressId
  });
}
```

**Approach:**
- Loads addresses from storage
- Shows in popup UI
- Saves to Chrome storage

---

## Similarities

### Both implementations:
1. ✅ Extract `data-address-id` and `data-legacy-address-id`
2. ✅ Store selected address for reuse
3. ✅ Use same purchase API endpoint
4. ✅ Handle parent ASIN resolution
5. ✅ Show visual feedback on success/failure
6. ✅ Send Telegram notifications (reference script only, but we have the infrastructure)

---

## Advantages of Each Approach

### Reference Script (Tampermonkey):
✅ **Simpler** - All code in one file  
✅ **Visible** - Dropdown always visible on page  
✅ **Direct** - No popup needed to change address  
✅ **Lightweight** - Minimal UI overhead  

❌ **Page-specific** - Only works on current page  
❌ **localStorage** - Domain-specific storage  
❌ **No fallbacks** - Single extraction method  

### Our Implementation (Chrome Extension):
✅ **Organized** - Separate settings UI  
✅ **Persistent** - Chrome storage across domains  
✅ **Multiple methods** - Fallback extraction strategies  
✅ **Non-invasive** - Doesn't modify page layout  
✅ **Extensible** - Easy to add more settings  

❌ **More complex** - Multiple files and managers  
❌ **Extra step** - Need to open popup to change address  
❌ **Heavier** - More code and UI components  

---

## Updated Implementation Status

After analyzing the reference script, we've updated our implementation to:

1. ✅ **Primary extraction method** - Now uses `.vvp-address-option` (same as reference)
2. ✅ **Purchase payload** - Now includes `recommendationType: 'SEARCH'` and uses `itemAsin`
3. ✅ **CSRF token** - Now tries `input[name="csrf-token"]` and `.vvp-body > [type="a-state"]` first
4. ✅ **Fallback methods** - Added multiple fallbacks for better reliability

---

## Testing Recommendations

### To verify address extraction works:
```javascript
// In browser console on Vine page:
document.querySelectorAll('.vvp-address-option').forEach(el => {
  console.log({
    id: el.getAttribute('data-address-id'),
    legacyId: el.getAttribute('data-legacy-address-id'),
    text: el.querySelector('.a-radio-label > span:nth-of-type(1)')?.textContent.trim()
  });
});
```

### To verify CSRF token extraction:
```javascript
// Method 1:
document.querySelector('input[name="csrf-token"]')?.value

// Method 2:
JSON.parse(document.querySelector('.vvp-body > [type="a-state"]')?.innerText || '{}').csrfToken
```

### To verify purchase payload:
```javascript
// Should match reference script format:
{
  recommendationId: "...",
  recommendationType: "SEARCH",
  itemAsin: "B0XXXXXXXX",
  addressId: "amzn1.address.xxx",
  legacyAddressId: "legacy-id"
}
```

---

## Conclusion

Our implementation now uses the **same core methods** as the reference Tampermonkey script for:
- Address extraction (`.vvp-address-option`)
- CSRF token retrieval
- Purchase API payload structure

**Key differences:**
- We use Chrome extension storage instead of localStorage
- We show settings in popup instead of on-page dropdown
- We have multiple fallback methods for better reliability

Both approaches are valid - the reference script is simpler and more direct, while our implementation is more organized and extensible for a full Chrome extension.

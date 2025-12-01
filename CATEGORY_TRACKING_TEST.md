# Category Tracking - Testing Guide

## Quick Test

### 1. Load the Extension
1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the extension directory
4. Verify no errors in the console

### 2. Visit Encore Page
1. Go to Amazon Vine Encore page: `https://www.amazon.it/vine/vine-items?queue=encore`
2. Open browser console (F12)
3. Look for these log messages:
   ```
   CategoryTrackerManager: setup() called
   CategoryTrackerManager: Starting category tracking
   CategoryTrackerManager: Extracted X categories
   CategoryTrackerManager: Current counts: {...}
   CategoryTrackerManager: Previous counts: {...}
   ```

### 3. First Visit (No Previous Data)
On first visit, you should see:
- All categories show `(count) (0)` - indicating no previous data
- Console shows: "No increments detected"
- Counts are saved to storage

### 4. Simulate Category Change
To test increment detection:

**Option A: Wait for Real Changes**
1. Note current counts
2. Wait for Amazon to add items to categories
3. Refresh the page
4. You should see increments: `(new_count) (+increment)`

**Option B: Manual Storage Manipulation (for testing)**
1. Open browser console on Encore page
2. Run this to simulate previous counts:
   ```javascript
   chrome.storage.local.set({
     vineCategoryCounts: {
       "Elettronica": 200,
       "Sport e tempo libero": 40,
       "Giardino e giardinaggio": 4
     }
   });
   ```
3. Refresh the page
4. You should see increments if current counts are higher

### 5. Verify Visual Display
Check that each category shows:
- Current count in parentheses: `(209)`
- Increment in green if positive: `(+9)` in green
- Zero in gray if no change: `(0)` in gray

### 6. Test Reset Function
1. Click the extension icon to open popup
2. Scroll to "Actions" section
3. Click "Reset Category Counts" button
4. Button should show "✅ Counts Reset!" briefly
5. Refresh Encore page
6. All categories should now show `(0)`

## Expected Console Output

### Successful Initialization
```
CategoryTrackerManager: setup() called
CategoryTrackerManager: Starting category tracking
CategoryTrackerManager: Extracted 15 categories
CategoryTrackerManager: Current counts: {Elettronica: 209, ...}
CategoryTrackerManager: Previous counts: {Elettronica: 200, ...}
CategoryTrackerManager: Increments detected: {Elettronica: 9, ...}
CategoryTrackerManager: Increments displayed in DOM
CategoryTrackerManager: Saved counts to storage
```

### No Changes
```
CategoryTrackerManager: No increments detected
CategoryTrackerManager: Increments displayed in DOM
CategoryTrackerManager: Saved counts to storage
```

### First Visit
```
CategoryTrackerManager: Loaded 0 previous counts
CategoryTrackerManager: No increments detected
CategoryTrackerManager: Saved counts to storage
```

## Troubleshooting

### Categories Not Showing Increments
1. Check console for errors
2. Verify you're on Encore page (URL contains `queue=encore`)
3. Check that `#vvp-browse-nodes-container` exists in DOM
4. Verify storage has data: `chrome.storage.local.get(['vineCategoryCounts'])`

### Manager Not Initializing
1. Check manifest.json includes `category-tracker-manager.js`
2. Verify content.js includes manager in initialization
3. Check for JavaScript errors in console
4. Reload extension

### Increments Not Updating
1. Clear storage: `chrome.storage.local.remove(['vineCategoryCounts'])`
2. Refresh page
3. Check console logs

## Manual Testing Commands

Open console on Encore page and try:

```javascript
// Get the manager instance
const manager = window.vineEnhancer.managers.categoryTracker;

// Check if initialized
console.log('Initialized:', manager.isInitialized);

// Get current counts
console.log('Current:', manager.getCurrentCounts());

// Get previous counts
console.log('Previous:', manager.getPreviousCounts());

// Manually trigger tracking
manager.trackCategories();

// Reset counts
manager.resetCounts();
```

## Success Criteria

✅ Manager initializes without errors
✅ Categories are extracted from DOM
✅ Counts are saved to storage
✅ Increments are displayed inline
✅ Green color for positive increments
✅ Gray color for zero increments
✅ Reset button clears storage
✅ Works only on Encore page
✅ No performance impact (< 100ms)

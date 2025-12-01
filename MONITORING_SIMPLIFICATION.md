# Monitoring Mode Simplification

## Summary of Changes

The monitoring mode has been simplified to provide a cleaner user experience with a single queue selection and streamlined configuration.

## Key Changes

### 1. UI Changes (popup.html)

**Before:**
- Toggle switch to enable/disable monitoring
- Multiple checkboxes for page types (Potluck, Encore, Search)
- Two separate intervals: Check Interval and Refresh Interval
- Optional search query filter
- Notification options (batch vs individual)
- Save Configuration button

**After:**
- Radio buttons for queue selection:
  - Potluck: `https://www.amazon.it/vine/vine-items?queue=potluck`
  - Encore: `https://www.amazon.it/vine/vine-items?queue=encore`
  - Last Chance: `https://www.amazon.it/vine/vine-items?queue=last_chance`
  - Search: `https://www.amazon.it/vine/vine-items?search=xxxx`
- Search query textbox (shown only when Search is selected)
- Single Refresh Interval slider (removed Check Interval)
- Start/Stop Monitoring button (replaces toggle + save)

### 2. Configuration Changes

**Old Config Structure:**
```javascript
{
  checkIntervalSeconds: 30,
  refreshIntervalSeconds: 300,
  searchQuery: '',
  monitorPotluck: true,
  monitorEncore: true,
  monitorSearch: false,
  notifyOnEachItem: false
}
```

**New Config Structure:**
```javascript
{
  queue: 'potluck',           // 'potluck' | 'encore' | 'last_chance' | 'search'
  searchQuery: '',            // Only used when queue === 'search'
  refreshIntervalSeconds: 300 // How often to refresh the page
}
```

### 3. User Flow

**Before:**
1. Toggle monitoring ON
2. Configure intervals and page types
3. Click "Save Configuration"
4. Monitoring starts automatically

**After:**
1. Select queue to monitor (radio button)
2. If Search selected, enter search query
3. Adjust refresh interval if needed
4. Click "Start Monitoring" button
5. Extension navigates to selected queue and starts monitoring
6. Click "Stop Monitoring" to stop

### 4. Monitoring Behavior

**Before:**
- Checked for new items every X seconds (checkInterval)
- Refreshed page every Y seconds (refreshInterval)
- Monitored multiple page types simultaneously

**After:**
- Monitors a single queue at a time
- Automatically navigates to the selected queue URL
- Checks for new items on page load
- Refreshes page at the configured interval
- Simpler, more predictable behavior

### 5. Files Modified

1. **popup.html**
   - Replaced checkboxes with radio buttons
   - Added conditional search query input
   - Replaced toggle + save with single Start/Stop button
   - Removed check interval slider
   - Added monitoring queue display in status

2. **popup.js**
   - Simplified config loading/saving
   - Updated event listeners for radio buttons
   - Changed toggle behavior to start/stop with config
   - Updated status display to show current queue

3. **managers/monitoring-manager.js**
   - Simplified config structure
   - Removed checkInterval logic
   - Added queue URL generation
   - Auto-navigation to selected queue
   - Removed page type filtering (now monitors single queue)
   - Simplified notification messages

4. **managers/page-detection-manager.js**
   - Added support for 'last_chance' page type
   - Updated isMonitorablePage() to include last_chance
   - Added isLastChancePage() method

5. **content.js**
   - Changed message handlers from toggleMonitoring to startMonitoring/stopMonitoring
   - Removed updateMonitoringConfig handler (config now passed with start)

## Benefits

1. **Simpler UX**: One queue at a time, clear selection with radio buttons
2. **Clearer behavior**: Extension navigates to the selected queue automatically
3. **Less configuration**: Removed redundant checkInterval, single refresh interval
4. **Better user control**: Explicit Start/Stop button instead of auto-start
5. **More predictable**: Users know exactly which queue is being monitored

## Migration Notes

Existing users with old config will automatically migrate to the new structure:
- If `monitorPotluck` was true → defaults to `queue: 'potluck'`
- If `monitorEncore` was true → defaults to `queue: 'encore'`
- If `monitorSearch` was true → defaults to `queue: 'search'`
- `checkIntervalSeconds` is removed (no longer needed)
- `refreshIntervalSeconds` is preserved

# Monitoring Debug Logs Added

## Problems Fixed

### 1. Monitor Button Sometimes Doesn't Work
The monitor button sometimes doesn't work with no visible errors, making it difficult to diagnose the issue.

### 2. Extension Context Invalidated Error
When the extension is reloaded while the page is open, chrome.storage API calls fail with "Extension context invalidated" error.

### 3. Syntax Error in content.js
Missing closing brace in the message listener caused a syntax error.

## Solutions

### 1. Comprehensive Logging
Added detailed logging throughout the monitoring system to track:

1. **Button Click Flow**
   - When the monitor button is clicked
   - What state it's in (monitoring/stopped)
   - What config is being used

2. **Event System**
   - When events are emitted
   - How many listeners are registered
   - When listeners are called
   - Any errors in event handlers

3. **Manager Initialization**
   - When managers are set up
   - What dependencies are available
   - Configuration loading

4. **Monitoring Operations**
   - When monitoring starts/stops
   - Timer creation/destruction
   - Queue checking operations
   - Notification sending

### 2. Extension Context Error Handling
Added proper error handling for "Extension context invalidated" errors:
- Gracefully handles the error without spamming console
- Provides helpful warning messages
- Continues operation with in-memory data when possible
- Added `isExtensionContextInvalidated()` helper method

### 3. Fixed Syntax Error
Fixed missing closing brace in content.js message listener.

## How to Debug

### Console Logs
When you click the monitor button, you should now see detailed logs like:

```
[UIManager] Monitor button clicked
[UIManager] Current monitoring state: false
[UIManager] Monitoring config: {queues: ["potluck"], refreshIntervalSeconds: 300}
[UIManager] Emitting startMonitoring event
[BaseManager] Emitting event: startMonitoring
[EventBus] Emitting startMonitoring to 1 listener(s)
[MonitoringManager] Received startMonitoring event
[MonitoringManager] startMonitoring called with config: {...}
[MonitoringManager] All dependencies validated, starting monitoring...
```

### Diagnostic Function
Run this in the browser console to check the monitoring state:

```javascript
vineMonitoringDiagnostics()
```

This will show:
- Is monitoring active
- Current configuration
- Whether dependencies are set (notification provider, new items manager)
- Whether the timer is running
- How many event listeners are registered

### Common Issues to Look For

1. **No event listeners**: If diagnostics shows "None" for event listeners, the monitoring manager wasn't properly initialized

2. **Missing dependencies**: If notification provider or new items manager is "NOT SET", monitoring can't start (you'll now see an alert)

3. **No timer**: If monitoring is true but timer is not active, the timer failed to start

4. **Event not emitted**: If you don't see "[EventBus] Emitting startMonitoring", the UI manager isn't properly emitting events

5. **Extension reloaded**: If you see "Extension context invalidated" warnings, just refresh the page

## Files Modified

- `content.js` - Fixed syntax error (missing closing brace)
- `managers/monitoring-manager.js` - Added detailed logging for all operations
- `managers/ui-manager.js` - Added logging for button clicks and UI updates
- `managers/base-manager.js` - Added logging to event system (emit/on)
- `managers/category-tracker-manager.js` - Added extension context error handling
- Added `vineMonitoringDiagnostics()` function for runtime debugging

## Next Steps

After testing with these logs, we can:
1. Identify exactly where the flow breaks
2. Add proper error messages to the UI
3. Fix any initialization order issues
4. Add recovery mechanisms for failed states

// Background Service Worker for Amazon Vine Efficiency Enhancer
// Handles persistent monitoring using Chrome Alarms API

// Alarm names
const ALARM_CHECK_ITEMS = 'vine-check-items';
const ALARM_REFRESH_PAGE = 'vine-refresh-page';

// Initialize on installation
chrome.runtime.onInstalled.addListener(() => {
  checkMonitoringState();
});

// Initialize on startup
chrome.runtime.onStartup.addListener(() => {
  checkMonitoringState();
});

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'startMonitoring') {
    handleStartMonitoring(request.config)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Keep channel open for async response
  } else if (request.action === 'stopMonitoring') {
    handleStopMonitoring()
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === 'checkForNewItems') {
    // Content script is ready and requesting a check
    handleCheckForNewItems(sender.tab.id)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (request.action === 'newItemsFound') {
    // Content script found new items
    handleNewItemsFound(request.items)
      .then(() => sendResponse({ success: true }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  return false;
});

// Handle alarm events
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_CHECK_ITEMS) {
    handleCheckItemsAlarm();
  } else if (alarm.name === ALARM_REFRESH_PAGE) {
    handleRefreshPageAlarm();
  }
});

// Check if monitoring should be active on startup
async function checkMonitoringState() {
  try {
    const result = await chrome.storage.local.get(['vineMonitoringEnabled', 'vineMonitoringConfig']);
    const isEnabled = result.vineMonitoringEnabled || false;
    const config = result.vineMonitoringConfig || {
      queue: 'potluck',
      refreshIntervalSeconds: 300,
      searchQuery: ''
    };

    if (isEnabled) {
      await setupAlarms(config);
    } else {
      await clearAlarms();
    }
  } catch (error) {
    console.error('Error checking monitoring state:', error);
  }
}

// Start monitoring
async function handleStartMonitoring(config) {
  try {
    // Save monitoring state
    await chrome.storage.local.set({
      vineMonitoringEnabled: true,
      vineMonitoringConfig: config
    });

    // Setup alarms
    await setupAlarms(config);

    // Navigate to the target page
    const targetUrl = getQueueUrl(config);
    if (targetUrl) {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tabs[0]) {
        await chrome.tabs.update(tabs[0].id, { url: targetUrl });
      }
    }
  } catch (error) {
    console.error('Error starting monitoring:', error);
    throw error;
  }
}

// Stop monitoring
async function handleStopMonitoring() {
  try {
    // Save monitoring state
    await chrome.storage.local.set({
      vineMonitoringEnabled: false
    });

    // Clear all alarms
    await clearAlarms();
  } catch (error) {
    console.error('Error stopping monitoring:', error);
    throw error;
  }
}

// Add random variation to interval (±10%)
function addRandomDelay(seconds) {
  const variation = 0.1; // 10%
  const randomFactor = 1 + (Math.random() * 2 - 1) * variation; // Random between 0.9 and 1.1
  return seconds * randomFactor;
}

// Setup alarms for monitoring
async function setupAlarms(config) {
  // Clear existing alarms first
  await clearAlarms();

  // Create alarm to check for new items every 30 seconds
  await chrome.alarms.create(ALARM_CHECK_ITEMS, {
    delayInMinutes: 0.5, // 30 seconds
    periodInMinutes: 0.5
  });

  // Create alarm to refresh the page with random variation (±10%)
  const baseRefreshSeconds = config.refreshIntervalSeconds;
  const randomizedRefreshSeconds = addRandomDelay(baseRefreshSeconds);
  const refreshMinutes = randomizedRefreshSeconds / 60;
  
  await chrome.alarms.create(ALARM_REFRESH_PAGE, {
    delayInMinutes: refreshMinutes,
    periodInMinutes: refreshMinutes
  });
}

// Clear all monitoring alarms
async function clearAlarms() {
  await chrome.alarms.clear(ALARM_CHECK_ITEMS);
  await chrome.alarms.clear(ALARM_REFRESH_PAGE);
}

// Handle check items alarm
async function handleCheckItemsAlarm() {
  try {
    const result = await chrome.storage.local.get(['vineMonitoringEnabled', 'vineMonitoringConfig']);
    if (!result.vineMonitoringEnabled) {
      return;
    }

    // Find the Vine tab
    const vineTab = await findVineTab(result.vineMonitoringConfig);
    if (!vineTab) {
      return;
    }

    // Send message to content script to check for new items
    try {
      await chrome.tabs.sendMessage(vineTab.id, {
        action: 'performItemCheck'
      });
    } catch (error) {
      // Tab may not be ready, will retry on next alarm
    }
  } catch (error) {
    console.error('Error in check items alarm:', error);
  }
}

// Handle refresh page alarm
async function handleRefreshPageAlarm() {
  try {
    const result = await chrome.storage.local.get(['vineMonitoringEnabled', 'vineMonitoringConfig']);
    if (!result.vineMonitoringEnabled) {
      return;
    }

    // Find the Vine tab
    const vineTab = await findVineTab(result.vineMonitoringConfig);
    if (!vineTab) {
      return;
    }

    // Navigate to the queue URL without page parameter to reset to page 1
    const targetUrl = getQueueUrl(result.vineMonitoringConfig);
    if (targetUrl) {
      await chrome.tabs.update(vineTab.id, { url: targetUrl });
    }
  } catch (error) {
    console.error('Error in refresh page alarm:', error);
  }
}

// Handle check request from content script
async function handleCheckForNewItems(tabId) {
  // This is called when content script is ready to perform a check
  // The actual check logic remains in the content script
}

// Handle new items found notification
async function handleNewItemsFound(items) {
  // The notification is sent by the content script
  // We could add additional logic here if needed
}

// Find the active Vine monitoring tab
async function findVineTab(config) {
  const targetUrl = getQueueUrl(config);
  if (!targetUrl) return null;

  // Query all tabs and filter manually (wildcard in domain middle not supported)
  const allTabs = await chrome.tabs.query({});

  const vineTabs = allTabs.filter(tab => {
    if (!tab.url) return false;
    return tab.url.includes('/vine/') &&
           (tab.url.includes('amazon.com') ||
            tab.url.includes('amazon.co.uk') ||
            tab.url.includes('amazon.de') ||
            tab.url.includes('amazon.fr') ||
            tab.url.includes('amazon.es') ||
            tab.url.includes('amazon.it') ||
            tab.url.includes('amazon.ca') ||
            tab.url.includes('amazon.com.au') ||
            tab.url.includes('amazon.co.jp'));
  });

  // Prefer the active tab if it matches
  const activeTabs = vineTabs.filter(tab => tab.active);
  if (activeTabs.length > 0) {
    return activeTabs[0];
  }

  // Otherwise return the first matching tab
  return vineTabs.length > 0 ? vineTabs[0] : null;
}

// Get queue URL from config
function getQueueUrl(config) {
  const baseUrl = 'https://www.amazon.it/vine/vine-items';

  switch (config.queue) {
    case 'potluck':
      return `${baseUrl}?queue=potluck`;
    case 'encore':
      return `${baseUrl}?queue=encore`;
    case 'last_chance':
      return `${baseUrl}?queue=last_chance`;
    case 'search':
      if (config.searchQuery) {
        return `${baseUrl}?search=${encodeURIComponent(config.searchQuery)}`;
      }
      return null;
    default:
      return null;
  }
}

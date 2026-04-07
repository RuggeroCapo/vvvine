// Amazon Vine Efficiency Enhancer - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  await loadStats();
  setupEventListeners();
});

async function loadStats() {
  try {
    const result = await chrome.storage.local.get([
      'vineSeenTitles',
      'vineKnownItems',
      'vineInstallDate',
      'vineAutoNavigationEnabled',
      'vineSearchQuery'
    ]);
    const seenItems = result.vineSeenTitles || [];
    const knownItems = result.vineKnownItems || {};
    const installDate = result.vineInstallDate || Date.now();
    const autoNavigationEnabled = result.vineAutoNavigationEnabled !== false; // Default to true
    const searchQuery = result.vineSearchQuery || '';

    // Update seen count
    document.getElementById('seen-count').textContent = seenItems.length;

    // Update known items count
    document.getElementById('known-items-count').textContent = Object.keys(knownItems).length;

    // Update install date
    const installDateObj = new Date(installDate);
    document.getElementById('install-date').textContent = installDateObj.toLocaleDateString();

    // Update auto-navigation toggle
    document.getElementById('auto-navigation-toggle').checked = autoNavigationEnabled;

    // Update search filter display
    const searchFilterElement = document.getElementById('search-filter');
    if (searchQuery) {
      searchFilterElement.textContent = searchQuery.length > 20 ? searchQuery.substring(0, 20) + '...' : searchQuery;
      searchFilterElement.title = searchQuery; // Show full query on hover
    } else {
      searchFilterElement.textContent = 'None';
      searchFilterElement.title = '';
    }

    // Get current page if on Vine
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('/vine/')) {
      const url = new URL(tab.url);
      const page = url.searchParams.get('page') || '1';
      document.getElementById('current-page').textContent = page;
    } else {
      document.getElementById('current-page').textContent = 'Not on Vine';
    }

    // Set install date if first time
    if (!result.vineInstallDate) {
      await chrome.storage.local.set({ vineInstallDate: Date.now() });
    }

  } catch (error) {
    console.error('Error loading stats:', error);
  }
}

function setupEventListeners() {
  document.getElementById('export-data').addEventListener('click', exportData);
  document.getElementById('import-data').addEventListener('click', importData);
  document.getElementById('clear-filter').addEventListener('click', clearSearchFilter);
  document.getElementById('reset-category-counts').addEventListener('click', resetCategoryCounts);
  document.getElementById('clear-all').addEventListener('click', clearAllData);
  document.getElementById('auto-navigation-toggle').addEventListener('change', toggleAutoNavigation);
  document.getElementById('test-notification').addEventListener('click', testNotification);
  document.getElementById('clear-notified').addEventListener('click', clearNotifiedItems);
  document.getElementById('save-telegram-config').addEventListener('click', saveTelegramConfig);
  document.getElementById('test-telegram').addEventListener('click', testTelegramConnection);

  // Load Telegram config on startup
  loadTelegramConfig();
}

async function exportData() {
  try {
    const result = await chrome.storage.local.get(['vineSeenTitles', 'vineKnownItems', 'vineSearchQuery', 'vineAutoNavigationEnabled']);
    const seenItems = result.vineSeenTitles || [];
    const knownItems = result.vineKnownItems || {};
    const searchQuery = result.vineSearchQuery || '';
    const autoNavigationEnabled = result.vineAutoNavigationEnabled !== false;
    
    const data = {
      seenItems: seenItems,
      knownItems: knownItems,
      searchQuery: searchQuery,
      autoNavigationEnabled: autoNavigationEnabled,
      exportDate: new Date().toISOString(),
      version: '2.1.0'
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `vine-enhancer-data-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    
    URL.revokeObjectURL(url);
    
    // Show success feedback
    const button = document.getElementById('export-data');
    const originalText = button.textContent;
    button.textContent = '✅ Exported!';
    setTimeout(() => {
      button.textContent = originalText;
    }, 2000);
    
  } catch (error) {
    console.error('Error exporting data:', error);
    alert('Error exporting data. Please try again.');
  }
}

function importData() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', handleFileImport);
  input.click();
}

async function handleFileImport(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    
    if (!data.seenItems || !Array.isArray(data.seenItems)) {
      throw new Error('Invalid file format');
    }
    
    const currentResult = await chrome.storage.local.get(['vineSeenTitles', 'vineKnownItems']);
    const currentItems = new Set(currentResult.vineSeenTitles || []);
    const currentKnownItems = currentResult.vineKnownItems || {};
    
    // Merge with existing data
    data.seenItems.forEach(item => currentItems.add(item));
    
    // Merge known items if available
    if (data.knownItems && typeof data.knownItems === 'object') {
      Object.assign(currentKnownItems, data.knownItems);
    }
    
    // Prepare data to save
    const dataToSave = {
      vineSeenTitles: Array.from(currentItems),
      vineKnownItems: currentKnownItems
    };
    
    // Import search query if available
    if (data.searchQuery !== undefined) {
      dataToSave.vineSearchQuery = data.searchQuery;
    }
    
    // Import auto-navigation setting if available
    if (data.autoNavigationEnabled !== undefined) {
      dataToSave.vineAutoNavigationEnabled = data.autoNavigationEnabled;
    }
    
    await chrome.storage.local.set(dataToSave);
    
    // Refresh stats
    await loadStats();
    
    // Show success feedback
    const button = document.getElementById('import-data');
    const originalText = button.textContent;
    button.textContent = '✅ Imported!';
    setTimeout(() => {
      button.textContent = originalText;
    }, 2000);
    
  } catch (error) {
    console.error('Error importing data:', error);
    alert('Error importing data. Please check the file format.');
  }
}

async function clearAllData() {
  if (confirm('Are you sure you want to clear all data (seen items, tracked items, search query, settings)? This cannot be undone.')) {
    try {
      await chrome.storage.local.remove(['vineSeenTitles', 'vineKnownItems', 'vineSearchQuery', 'vineAutoNavigationEnabled']);
      await loadStats();
      
      // Show success feedback
      const button = document.getElementById('clear-all');
      const originalText = button.textContent;
      button.textContent = '✅ Cleared!';
      setTimeout(() => {
        button.textContent = originalText;
      }, 2000);
      
    } catch (error) {
      console.error('Error clearing data:', error);
      alert('Error clearing data. Please try again.');
    }
  }
}

async function clearSearchFilter() {
  try {
    // Clear the search query from storage
    await chrome.storage.local.remove(['vineSearchQuery']);
    
    // Send message to content script to clear the filter
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('/vine/')) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'clearFilter'
        });
      } catch (error) {
        // Content script might not be loaded yet, that's okay
      }
    }
    
    // Refresh stats to update the display
    await loadStats();
    
    // Show success feedback
    const button = document.getElementById('clear-filter');
    const originalText = button.textContent;
    button.textContent = '✅ Filter Cleared!';
    setTimeout(() => {
      button.textContent = originalText;
    }, 2000);
    
  } catch (error) {
    console.error('Error clearing search filter:', error);
    alert('Error clearing search filter. Please try again.');
  }
}

async function resetCategoryCounts() {
  try {
    // Clear the category counts from storage
    await chrome.storage.local.remove(['vineCategoryCounts']);
    
    // Show success feedback
    const button = document.getElementById('reset-category-counts');
    const originalText = button.innerHTML;
    button.innerHTML = '<span class="btn-icon">✅</span> Counts Reset!';
    setTimeout(() => {
      button.innerHTML = originalText;
    }, 2000);
  } catch (error) {
    console.error('Error resetting category counts:', error);
    alert('Error resetting category counts. Please try again.');
  }
}

async function toggleAutoNavigation() {
  try {
    const toggle = document.getElementById('auto-navigation-toggle');
    const isEnabled = toggle.checked;

    // Save the setting to storage
    await chrome.storage.local.set({ vineAutoNavigationEnabled: isEnabled });

    // Send message to content script to update auto-navigation state
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('/vine/')) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'toggleAutoNavigation',
          enabled: isEnabled
        });
      } catch (error) {
        // Content script might not be loaded yet, that's okay
      }
    }
  } catch (error) {
    console.error('Error toggling auto-navigation:', error);
    // Revert toggle state on error
    const toggle = document.getElementById('auto-navigation-toggle');
    toggle.checked = !toggle.checked;
  }
}

async function testNotification() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('/vine/')) {
      try {
        // Send message to content script to trigger test notification
        const response = await chrome.tabs.sendMessage(tab.id, {
          action: 'testNotification'
        });

        if (response && response.success) {
          // Show success feedback
          const button = document.getElementById('test-notification');
          const originalText = button.textContent;
          button.textContent = '✅ Sent!';
          setTimeout(() => {
            button.textContent = originalText;
          }, 2000);
        } else {
          throw new Error(response?.error || 'Unknown error');
        }
      } catch (error) {
        console.error('Error sending test notification:', error);

        // Better error message based on the error
        let errorMsg = 'Error sending test notification:\n';
        if (error.message.includes('not initialized')) {
          errorMsg += 'The notification system is still initializing. Please wait a moment and try again.';
        } else if (error.message.includes('not ready')) {
          errorMsg += 'The notification provider is not ready yet. Please wait a moment and try again.';
        } else if (error.message.includes('Receiving end does not exist')) {
          errorMsg += 'Extension not fully loaded. Please refresh the page and try again.';
        } else {
          errorMsg += error.message || 'Make sure you are on a Vine page and the extension is loaded.';
        }

        alert(errorMsg);
      }
    } else {
      alert('Please navigate to an Amazon Vine page first.');
    }
  } catch (error) {
    console.error('Error testing notification:', error);
    alert('An unexpected error occurred. Please check the console for details.');
  }
}

async function clearNotifiedItems() {
  if (confirm('Clear the list of notified items? You may receive duplicate notifications for items you\'ve already been notified about.')) {
    try {
      await chrome.storage.local.set({ vineLastNotifiedItems: [] });

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab && tab.url && tab.url.includes('/vine/')) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            action: 'clearNotifiedItems'
          });
        } catch (error) {
          // Content script not available, items cleared in storage
        }
      }

      // Update display
      document.getElementById('monitoring-notified-count').textContent = '0';

      // Show success feedback
      const button = document.getElementById('clear-notified');
      const originalText = button.textContent;
      button.textContent = '✅ Cleared!';
      setTimeout(() => {
        button.textContent = originalText;
      }, 2000);

    } catch (error) {
      console.error('Error clearing notified items:', error);
      alert('Error clearing notified items. Please try again.');
    }
  }
}

async function loadTelegramConfig() {
  try {
    const result = await chrome.storage.local.get(['vineTelegramConfig']);
    const config = result.vineTelegramConfig || {};
    
    if (config.botToken) {
      document.getElementById('telegram-bot-token').value = config.botToken;
    }
    if (config.chatId) {
      document.getElementById('telegram-chat-id').value = config.chatId;
    }
  } catch (error) {
    console.error('Error loading Telegram config:', error);
  }
}

async function saveTelegramConfig() {
  try {
    const botToken = document.getElementById('telegram-bot-token').value.trim();
    const chatId = document.getElementById('telegram-chat-id').value.trim();
    
    if (!botToken || !chatId) {
      showTelegramStatus('Please enter both Bot Token and Chat ID', 'error');
      return;
    }
    
    await chrome.storage.local.set({
      vineTelegramConfig: { botToken, chatId }
    });
    
    // Notify content script to update the provider
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && tab.url.includes('/vine/')) {
      try {
        await chrome.tabs.sendMessage(tab.id, {
          action: 'updateTelegramConfig',
          config: { botToken, chatId }
        });
      } catch (error) {
        // Content script not available, config saved to storage
      }
    }
    
    showTelegramStatus('Configuration saved!', 'success');
    
    // Update button feedback
    const button = document.getElementById('save-telegram-config');
    const originalHTML = button.innerHTML;
    button.innerHTML = '<span class="btn-icon">✅</span> Saved!';
    setTimeout(() => {
      button.innerHTML = originalHTML;
    }, 2000);
    
  } catch (error) {
    console.error('Error saving Telegram config:', error);
    showTelegramStatus('Error saving configuration', 'error');
  }
}

async function testTelegramConnection() {
  try {
    const botToken = document.getElementById('telegram-bot-token').value.trim();
    const chatId = document.getElementById('telegram-chat-id').value.trim();
    
    if (!botToken || !chatId) {
      showTelegramStatus('Please enter both Bot Token and Chat ID', 'error');
      return;
    }
    
    showTelegramStatus('Testing connection...', 'info');
    
    // First verify the bot token
    const getMeResponse = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
    if (!getMeResponse.ok) {
      const errorData = await getMeResponse.json();
      throw new Error(`Invalid bot token: ${errorData.description || 'Unknown error'}`);
    }
    
    const botData = await getMeResponse.json();
    
    // Send a test message
    const sendResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: '🍇 *Test Notification*\n\nAmazon Vine monitoring is working!',
        parse_mode: 'Markdown'
      })
    });
    
    if (!sendResponse.ok) {
      const errorData = await sendResponse.json();
      throw new Error(`Failed to send message: ${errorData.description || 'Unknown error'}`);
    }
    
    showTelegramStatus(`✅ Connected to @${botData.result.username}`, 'success');
    
    // Update button feedback
    const button = document.getElementById('test-telegram');
    const originalHTML = button.innerHTML;
    button.innerHTML = '<span class="btn-icon">✅</span> Success!';
    setTimeout(() => {
      button.innerHTML = originalHTML;
    }, 2000);
    
  } catch (error) {
    console.error('Error testing Telegram:', error);
    showTelegramStatus(`❌ ${error.message}`, 'error');
  }
}

function showTelegramStatus(message, type) {
  const statusElement = document.getElementById('telegram-status');
  statusElement.textContent = message;
  statusElement.style.display = 'block';
  
  // Set color based on type
  switch (type) {
    case 'success':
      statusElement.style.color = '#10b981';
      statusElement.style.background = 'rgba(16, 185, 129, 0.1)';
      break;
    case 'error':
      statusElement.style.color = '#ef4444';
      statusElement.style.background = 'rgba(239, 68, 68, 0.1)';
      break;
    case 'info':
    default:
      statusElement.style.color = '#3b82f6';
      statusElement.style.background = 'rgba(59, 130, 246, 0.1)';
      break;
  }
  
  // Auto-hide after 5 seconds for success/info
  if (type !== 'error') {
    setTimeout(() => {
      statusElement.style.display = 'none';
    }, 5000);
  }
}

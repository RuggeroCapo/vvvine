// Amazon Vine Efficiency Enhancer - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  await loadStats();
  setupEventListeners();
});

async function loadStats() {
  try {
    const result = await chrome.storage.local.get(['vineSeenTitles', 'vineInstallDate', 'vineAutoNavigationEnabled', 'vineSearchQuery']);
    const seenItems = result.vineSeenTitles || [];
    const installDate = result.vineInstallDate || Date.now();
    const autoNavigationEnabled = result.vineAutoNavigationEnabled !== false; // Default to true
    const searchQuery = result.vineSearchQuery || '';
    
    // Update seen count
    document.getElementById('seen-count').textContent = seenItems.length;
    
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
  document.getElementById('clear-all').addEventListener('click', clearAllData);
  document.getElementById('auto-navigation-toggle').addEventListener('change', toggleAutoNavigation);
}

async function exportData() {
  try {
    const result = await chrome.storage.local.get(['vineSeenTitles', 'vineSearchQuery', 'vineAutoNavigationEnabled']);
    const seenItems = result.vineSeenTitles || [];
    const searchQuery = result.vineSearchQuery || '';
    const autoNavigationEnabled = result.vineAutoNavigationEnabled !== false;
    
    const data = {
      seenItems: seenItems,
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
    
    const currentResult = await chrome.storage.local.get(['vineSeenTitles']);
    const currentItems = new Set(currentResult.vineSeenTitles || []);
    
    // Merge with existing data
    data.seenItems.forEach(item => currentItems.add(item));
    
    // Prepare data to save
    const dataToSave = {
      vineSeenTitles: Array.from(currentItems)
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
  if (confirm('Are you sure you want to clear all data (seen items, search query, settings)? This cannot be undone.')) {
    try {
      await chrome.storage.local.remove(['vineSeenTitles', 'vineSearchQuery', 'vineAutoNavigationEnabled']);
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
        console.log('Content script not available, filter will be cleared on next page load');
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
        console.log('Content script not available, setting will be applied on next page load');
      }
    }
    
    console.log(`Auto-navigation ${isEnabled ? 'enabled' : 'disabled'}`);
    
  } catch (error) {
    console.error('Error toggling auto-navigation:', error);
    // Revert toggle state on error
    const toggle = document.getElementById('auto-navigation-toggle');
    toggle.checked = !toggle.checked;
  }
} 
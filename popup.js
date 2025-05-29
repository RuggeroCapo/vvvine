// Amazon Vine Efficiency Enhancer - Popup Script

document.addEventListener('DOMContentLoaded', async () => {
  await loadStats();
  setupEventListeners();
});

async function loadStats() {
  try {
    const result = await chrome.storage.local.get(['vineSeenTitles', 'vineInstallDate']);
    const seenItems = result.vineSeenTitles || [];
    const installDate = result.vineInstallDate || Date.now();
    
    // Update seen count
    document.getElementById('seen-count').textContent = seenItems.length;
    
    // Update install date
    const installDateObj = new Date(installDate);
    document.getElementById('install-date').textContent = installDateObj.toLocaleDateString();
    
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
  document.getElementById('clear-all').addEventListener('click', clearAllData);
}

async function exportData() {
  try {
    const result = await chrome.storage.local.get(['vineSeenTitles']);
    const seenItems = result.vineSeenTitles || [];
    
    const data = {
      seenItems: seenItems,
      exportDate: new Date().toISOString(),
      version: '2.0.0'
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
    
    await chrome.storage.local.set({
      vineSeenTitles: Array.from(currentItems)
    });
    
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
  if (confirm('Are you sure you want to clear all seen items? This cannot be undone.')) {
    try {
      await chrome.storage.local.remove(['vineSeenTitles']);
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
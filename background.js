// Background Service Worker for Amazon Vine Efficiency Enhancer
// Minimal service worker - monitoring is now handled in-page by content script

// Initialize on installation
chrome.runtime.onInstalled.addListener(() => {
  setupFooterBlocking();
});

// Initialize on startup
chrome.runtime.onStartup.addListener(() => {
  setupFooterBlocking();
});

// Setup network request blocking for footer requests
function setupFooterBlocking() {
  // Block requests to footer-related endpoints
  if (chrome.webRequest && chrome.webRequest.onBeforeRequest) {
    chrome.webRequest.onBeforeRequest.addListener(
      function(details) {
        const url = details.url;

        // Check if this is a footer-related request
        if (url.includes('slot=navFooter') ||
            url.includes('NAVYAAN') ||
            url.includes('a1=Pa0tdxubLhyRU6hrno-XCzjow') ||
            url.includes('a2=01010d77297bfd634b6d152ad89cb4275e46e3745af9bb8f08476b5ea31aca5a136b') ||
            (url.includes('footer') && url.includes('amazon'))) {

          console.log('[Vine Enhancer] Blocked footer request:', url);
          return { cancel: true };
        }

        return { cancel: false };
      },
      {
        urls: [
          "*://*.amazon.com/*",
          "*://*.amazon.co.uk/*",
          "*://*.amazon.de/*",
          "*://*.amazon.fr/*",
          "*://*.amazon.es/*",
          "*://*.amazon.it/*",
          "*://*.amazon.ca/*",
          "*://*.amazon.com.au/*",
          "*://*.amazon.co.jp/*"
        ]
      },
      ["blocking"]
    );
  }
}

// Listen for messages from content script and popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Monitoring is handled directly by content script via chrome.tabs.sendMessage
  // This listener remains for any future background-specific actions
  return false;
});

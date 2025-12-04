// Purchase Manager - Handles one-click purchases with rocket button
class PurchaseManager extends BaseManager {
  constructor(config = {}) {
    super(config);
    this.storageManager = null;
    this.selectedAddressId = null;
    this.selectedLegacyAddressId = null;
    this.rocketEnabled = true;
    this.activeDialog = null;
  }

  async setup() {
    await this.loadSettings();
    await this.extractAndStoreAddresses();
    this.addRocketButtons();
    this.observeNewItems();
    this.setupMessageListener();
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.local.get([
        'vinePurchaseAddressId',
        'vinePurchaseLegacyAddressId',
        'vineRocketEnabled'
      ]);
      
      this.selectedAddressId = result.vinePurchaseAddressId || null;
      this.selectedLegacyAddressId = result.vinePurchaseLegacyAddressId || null;
      this.rocketEnabled = result.vineRocketEnabled !== false; // Default to true
    } catch (error) {
      console.error('Failed to load purchase settings:', error);
    }
  }

  setStorageManager(storageManager) {
    this.storageManager = storageManager;
  }

  addRocketButtons() {
    // Only add on queue pages (Potluck, Encore, Last Chance)
    if (!this.isQueuePage()) {
      return;
    }

    if (!this.rocketEnabled) {
      return;
    }

    const items = document.querySelectorAll('.vvp-item-tile');
    items.forEach(item => this.addRocketButton(item));
  }

  isQueuePage() {
    const url = window.location.href;
    return url.includes('queue=potluck') || 
           url.includes('queue=encore') || 
           url.includes('queue=last_chance');
  }

  addRocketButton(tile) {
    if (tile.querySelector('.vine-rocket-btn')) return;

    const asin = this.extractAsin(tile);
    const recommendationId = this.extractRecommendationId(tile);
    const isParent = this.isParentAsin(tile);
    
    if (!asin || !recommendationId) return;

    const button = this.createRocketButton(tile, asin, recommendationId, isParent);
    const content = tile.querySelector('.vvp-item-tile-content');
    
    if (content) {
      content.style.position = 'relative';
      content.appendChild(button);
    }
  }

  createRocketButton(tile, asin, recommendationId, isParent) {
    const button = document.createElement('button');
    button.className = 'vine-rocket-btn';
    button.innerHTML = '🚀';
    button.title = 'One-click purchase';
    button.dataset.asin = asin;
    button.dataset.recommendationId = recommendationId;
    button.dataset.isParent = isParent;
    
    Object.assign(button.style, {
      position: 'absolute',
      top: '12px',
      right: '96px',
      width: '35px',
      height: '35px',
      borderRadius: '50%',
      background: isParent ? '#f5a52f' : '#d7f540',
      border: `2px solid ${isParent ? '#f5a52f' : '#d7f540'}`,
      cursor: 'pointer',
      fontSize: '18px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 0 6px rgba(0, 255, 255, 0.5)',
      transition: 'all 0.2s ease',
      zIndex: '35',
      padding: '0'
    });
    
    button.addEventListener('mouseenter', () => {
      button.style.transform = 'scale(1.1)';
      button.style.boxShadow = '0 0 12px rgba(0, 255, 255, 0.7)';
    });
    
    button.addEventListener('mouseleave', () => {
      button.style.transform = 'scale(1)';
      button.style.boxShadow = '0 0 6px rgba(0, 255, 255, 0.5)';
    });
    
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleRocketClick(tile, asin, recommendationId, isParent);
    });
    
    return button;
  }

  extractAsin(tile) {
    // Method 1: Try to get from details button data-asin attribute (Tampermonkey method)
    const detailsBtn = tile.querySelector('.vvp-details-btn .a-button-input');
    if (detailsBtn && detailsBtn.dataset.asin) {
      return detailsBtn.dataset.asin;
    }
    
    // Method 2: Try any a-button-input with data-asin
    const buttonInput = tile.querySelector('.a-button-input');
    if (buttonInput && buttonInput.dataset.asin) {
      return buttonInput.dataset.asin;
    }
    
    // Method 3: Extract from recommendationId (format: queue#ASIN)
    const recommendationId = tile.getAttribute('data-recommendation-id');
    if (recommendationId) {
      const parts = recommendationId.split('#');
      if (parts.length > 1 && parts[1]) {
        return parts[1];
      }
    }
    
    // Method 4: Extract from product title link href (fallback)
    const link = tile.querySelector('.vvp-item-product-title-container a');
    if (!link) return null;
    
    const href = link.href || link.getAttribute('href');
    if (!href) return null;
    
    const match = href.match(/\/dp\/([A-Z0-9]{10})/);
    return match ? match[1] : null;
  }

  extractRecommendationId(tile) {
    return tile.getAttribute('data-recommendation-id');
  }

  isParentAsin(tile) {
    const input = tile.querySelector('input');
    return input?.getAttribute('data-is-parent-asin') === 'true';
  }

  extractItemTitle(tile) {
    const titleElement = tile.querySelector('.vvp-item-product-title-container a');
    return titleElement ? titleElement.textContent.trim() : 'Unknown Item';
  }

  async handleRocketClick(tile, asin, recommendationId, isParent) {
    const title = this.extractItemTitle(tile);
    
    // Show confirmation dialog
    const confirmed = await this.showConfirmationDialog(title, asin);
    
    if (confirmed) {
      await this.executePurchase(recommendationId, asin, isParent, tile);
    }
  }

  showConfirmationDialog(title, asin) {
    return new Promise((resolve) => {
      // Create dialog overlay
      const overlay = document.createElement('div');
      overlay.className = 'vine-purchase-dialog';
      
      // Get first 4 words of title
      const shortTitle = title.split(' ').slice(0, 4).join(' ') + '...';
      
      overlay.innerHTML = `
        <div class="vine-purchase-dialog-content">
          <h3>Confirm Purchase</h3>
          <p class="vine-purchase-item-title">${shortTitle}</p>
          <p class="vine-purchase-item-asin">ASIN: ${asin}</p>
          <div class="vine-purchase-dialog-actions">
            <button class="vine-btn-confirm">Confirm (Enter)</button>
            <button class="vine-btn-cancel">Cancel (Esc)</button>
          </div>
        </div>
      `;
      
      // Style the dialog
      this.styleDialog(overlay);
      
      // Add to page
      document.body.appendChild(overlay);
      this.activeDialog = overlay;
      
      // Focus the confirm button
      const confirmBtn = overlay.querySelector('.vine-btn-confirm');
      const cancelBtn = overlay.querySelector('.vine-btn-cancel');
      confirmBtn.focus();
      
      // Handle button clicks
      confirmBtn.addEventListener('click', () => {
        this.closeDialog(overlay);
        resolve(true);
      });
      
      cancelBtn.addEventListener('click', () => {
        this.closeDialog(overlay);
        resolve(false);
      });
      
      // Handle keyboard shortcuts
      const keyHandler = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          this.closeDialog(overlay);
          resolve(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          this.closeDialog(overlay);
          resolve(false);
        }
      };
      
      overlay.addEventListener('keydown', keyHandler);
      
      // Click outside to cancel
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          this.closeDialog(overlay);
          resolve(false);
        }
      });
    });
  }

  styleDialog(overlay) {
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      background: 'rgba(0, 0, 0, 0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: '10000',
      animation: 'vineFadeIn 0.1s ease'
    });
    
    const content = overlay.querySelector('.vine-purchase-dialog-content');
    Object.assign(content.style, {
      background: 'white',
      padding: '24px',
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
      maxWidth: '400px',
      width: '90%',
      animation: 'vineScaleIn 0.1s ease'
    });
    
    const h3 = content.querySelector('h3');
    Object.assign(h3.style, {
      margin: '0 0 16px 0',
      fontSize: '20px',
      fontWeight: '700',
      color: '#1f2937'
    });
    
    const titleP = content.querySelector('.vine-purchase-item-title');
    Object.assign(titleP.style, {
      margin: '0 0 8px 0',
      fontSize: '14px',
      color: '#374151',
      fontWeight: '500'
    });
    
    const asinP = content.querySelector('.vine-purchase-item-asin');
    Object.assign(asinP.style, {
      margin: '0 0 20px 0',
      fontSize: '12px',
      color: '#6b7280',
      fontFamily: 'monospace'
    });
    
    const actions = content.querySelector('.vine-purchase-dialog-actions');
    Object.assign(actions.style, {
      display: 'flex',
      gap: '12px',
      justifyContent: 'flex-end'
    });
    
    const confirmBtn = content.querySelector('.vine-btn-confirm');
    Object.assign(confirmBtn.style, {
      background: 'linear-gradient(135deg, #667eea, #764ba2)',
      color: 'white',
      border: 'none',
      padding: '10px 20px',
      borderRadius: '8px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '600',
      transition: 'all 0.2s ease'
    });
    
    const cancelBtn = content.querySelector('.vine-btn-cancel');
    Object.assign(cancelBtn.style, {
      background: '#e5e7eb',
      color: '#374151',
      border: 'none',
      padding: '10px 20px',
      borderRadius: '8px',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '600',
      transition: 'all 0.2s ease'
    });
  }

  closeDialog(overlay) {
    if (overlay && overlay.parentNode) {
      overlay.remove();
    }
    this.activeDialog = null;
  }

  async executePurchase(recommendationId, asin, isParent, tile) {
    try {
      // Get CSRF token
      const csrfToken = this.getCsrfToken();
      if (!csrfToken) {
        throw new Error('CSRF token not found');
      }
      
      // Check if address is selected
      if (!this.selectedAddressId) {
        throw new Error('No delivery address selected. Please configure in popup settings.');
      }
      
      // If parent ASIN, resolve to child ASIN first
      let targetAsin = asin;
      if (isParent) {
        targetAsin = await this.resolveParentAsin(recommendationId);
      }
      
      // Make purchase API call
      // Using the same payload structure as the reference Tampermonkey script
      const response = await fetch('https://www.amazon.it/vine/api/voiceOrders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'anti-csrftoken-a2z': csrfToken
        },
        body: JSON.stringify({
          recommendationId: recommendationId,
          recommendationType: 'SEARCH',
          itemAsin: targetAsin,
          addressId: this.selectedAddressId,
          legacyAddressId: this.selectedLegacyAddressId
        })
      });
      
      const data = await response.json();
      
      if (data.orderId) {
        // Success
        this.showPurchaseResult(true, 'Purchase successful! 🎉');
        this.disableRocketButton(tile);
        this.emit('itemPurchased', { asin: targetAsin, recommendationId });
      } else {
        throw new Error(data.error || 'Purchase failed');
      }
    } catch (error) {
      console.error('Purchase error:', error);
      this.showPurchaseResult(false, error.message);
    }
  }

  async resolveParentAsin(recommendationId) {
    try {
      const response = await fetch(`https://www.amazon.it/vine/api/recommendations/${recommendationId}`);
      const data = await response.json();
      
      if (data.asin) {
        return data.asin;
      }
      
      throw new Error('Could not resolve parent ASIN');
    } catch (error) {
      console.error('Failed to resolve parent ASIN:', error);
      throw error;
    }
  }

  getCsrfToken() {
    // Method 1: Try to get from input field (reference script method)
    const csrfInput = document.querySelector('input[name="csrf-token"]');
    if (csrfInput) {
      return csrfInput.value;
    }
    
    // Method 2: Try to get from a-state JSON (reference script method)
    try {
      const stateElement = document.querySelector('.vvp-body > [type="a-state"]');
      if (stateElement) {
        const stateData = JSON.parse(stateElement.innerText || '{}');
        if (stateData.csrfToken) {
          return stateData.csrfToken;
        }
      }
    } catch (e) {
      console.error('Failed to parse a-state:', e);
    }
    
    // Method 3: Try to get from meta tag (fallback)
    const metaTag = document.querySelector('meta[name="anti-csrftoken-a2z"]');
    if (metaTag) {
      return metaTag.getAttribute('content');
    }
    
    // Method 4: Try to get from window object (fallback)
    if (window.ue_csm && window.ue_csm.token) {
      return window.ue_csm.token;
    }
    
    return null;
  }

  showPurchaseResult(success, message) {
    const popup = document.createElement('div');
    popup.className = 'vine-purchase-result-popup';
    popup.textContent = message;
    
    Object.assign(popup.style, {
      position: 'fixed',
      bottom: '20px',
      right: '20px',
      background: success ? '#10b981' : '#ef4444',
      color: 'white',
      padding: '16px 24px',
      borderRadius: '12px',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.2)',
      zIndex: '10001',
      fontSize: '14px',
      fontWeight: '600',
      animation: 'vineSlideIn 0.3s ease'
    });
    
    document.body.appendChild(popup);
    
    setTimeout(() => {
      popup.remove();
    }, 5000);
  }

  disableRocketButton(tile) {
    const button = tile.querySelector('.vine-rocket-btn');
    if (button) {
      button.disabled = true;
      button.style.opacity = '0.5';
      button.style.cursor = 'not-allowed';
      button.style.pointerEvents = 'none';
    }
  }

  observeNewItems() {
    const grid = document.getElementById('vvp-items-grid');
    if (!grid) return;
    
    const observer = new MutationObserver((mutations) => {
      mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1 && node.classList.contains('vvp-item-tile')) {
            this.addRocketButton(node);
          }
        });
      });
    });
    
    observer.observe(grid, {
      childList: true,
      subtree: true
    });
  }

  async setSelectedAddress(addressId, legacyAddressId) {
    this.selectedAddressId = addressId;
    this.selectedLegacyAddressId = legacyAddressId;
    
    await chrome.storage.local.set({
      vinePurchaseAddressId: addressId,
      vinePurchaseLegacyAddressId: legacyAddressId
    });
  }

  async setRocketEnabled(enabled) {
    this.rocketEnabled = enabled;
    
    await chrome.storage.local.set({
      vineRocketEnabled: enabled
    });
    
    if (enabled) {
      this.addRocketButtons();
    } else {
      this.removeAllRocketButtons();
    }
  }

  removeAllRocketButtons() {
    const buttons = document.querySelectorAll('.vine-rocket-btn');
    buttons.forEach(btn => btn.remove());
  }

  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
      if (request.action === 'refreshAddresses') {
        this.extractAndStoreAddresses()
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
      } else if (request.action === 'getAddresses') {
        this.getStoredAddresses()
          .then(addresses => sendResponse({ success: true, addresses }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
      } else if (request.action === 'setRocketEnabled') {
        this.setRocketEnabled(request.enabled)
          .then(() => sendResponse({ success: true }))
          .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
      }
      return false;
    });
  }

  async extractAndStoreAddresses() {
    try {
      // Look for address data in the page
      const addresses = this.extractAddressesFromPage();
      
      if (addresses.length > 0) {
        await chrome.storage.local.set({
          vineAvailableAddresses: addresses,
          vineAddressesLastUpdated: Date.now()
        });
        console.log(`Extracted ${addresses.length} addresses from page`);
      }
      
      return addresses;
    } catch (error) {
      console.error('Failed to extract addresses:', error);
      return [];
    }
  }

  extractAddressesFromPage() {
    const addresses = [];
    
    // Method 1: Look for .vvp-address-option elements (Amazon Vine's address radio buttons)
    // This is the method used by the reference Tampermonkey script
    const addressElements = document.querySelectorAll('.vvp-address-option');
    
    if (addressElements.length > 0) {
      addressElements.forEach(element => {
        const addressId = element.getAttribute('data-address-id');
        const legacyAddressId = element.getAttribute('data-legacy-address-id');
        const streetAddress = element.querySelector('.a-radio-label > span:nth-of-type(1)')?.textContent.trim();
        
        if (addressId && streetAddress) {
          addresses.push({
            id: addressId,
            legacyId: legacyAddressId || null,
            text: streetAddress,
            isDefault: element.querySelector('input[type="radio"]')?.checked || false
          });
        }
      });
    }
    
    // Method 2: Try to find address selector dropdown (fallback)
    if (addresses.length === 0) {
      const addressSelect = document.querySelector('select[name="addressId"]') || 
                           document.querySelector('#address-select') ||
                           document.querySelector('[data-address-select]');
      
      if (addressSelect) {
        const options = addressSelect.querySelectorAll('option');
        options.forEach(option => {
          const addressId = option.value;
          const addressText = option.textContent.trim();
          
          if (addressId && addressText && addressId !== '') {
            addresses.push({
              id: addressId,
              legacyId: option.dataset.legacyId || null,
              text: addressText,
              isDefault: option.selected
            });
          }
        });
      }
    }
    
    // Method 3: Try to find address data in page scripts (fallback)
    if (addresses.length === 0) {
      const scripts = document.querySelectorAll('script');
      scripts.forEach(script => {
        const content = script.textContent;
        
        // Look for address data patterns
        const addressPattern = /"addressId"\s*:\s*"([^"]+)"/g;
        let match;
        
        while ((match = addressPattern.exec(content)) !== null) {
          const addressId = match[1];
          if (!addresses.find(a => a.id === addressId)) {
            addresses.push({
              id: addressId,
              legacyId: null,
              text: `Address ${addressId.substring(0, 8)}...`,
              isDefault: false
            });
          }
        }
      });
    }
    
    return addresses;
  }

  async getStoredAddresses() {
    try {
      const result = await chrome.storage.local.get(['vineAvailableAddresses']);
      return result.vineAvailableAddresses || [];
    } catch (error) {
      console.error('Failed to get stored addresses:', error);
      return [];
    }
  }

  cleanup() {
    super.cleanup();
    this.removeAllRocketButtons();
    if (this.activeDialog) {
      this.closeDialog(this.activeDialog);
    }
  }
}

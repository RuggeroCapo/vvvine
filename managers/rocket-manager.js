class RocketManager extends BaseManager {
  constructor(config) {
    super(config);
    this.amazonDomain = window.location.hostname;
    this.addressStorageKeys = {
      addressId: 'vineRocketSelectedAddressId',
      legacyAddressId: 'vineRocketSelectedLegacyAddressId'
    };
    this.selectedAddressId =
      localStorage.getItem(this.addressStorageKeys.addressId) ||
      localStorage.getItem('selectedAddressId') ||
      null;
    this.selectedLegacyAddressId =
      localStorage.getItem(this.addressStorageKeys.legacyAddressId) ||
      localStorage.getItem('selectedLegacyAddressId') ||
      null;
    this.csrfToken = '';
    this.orderStartTime = 0;
    this.isOrdering = false;
    this.activeButton = null;
    this.activeOrder = null;
    this.addressListenersAttached = false;
    this.handleWindowMessage = this.handleWindowMessage.bind(this);
  }

  async setup() {
    await this.waitForElement('#vvp-items-grid');
    this.csrfToken = this.getCsrfToken();
    this.syncSelectedAddress();
    this.attachAddressListeners();
    this.createOverlay();
    this.processAllItems();
    this.setupPageObserver();
    window.addEventListener('message', this.handleWindowMessage);
  }

  setupPageObserver() {
    const grid = document.getElementById('vvp-items-grid');
    if (!grid) {
      return;
    }

    this.gridObserver = new MutationObserver((mutations) => {
      const tiles = this.collectNewTilesFromMutations(mutations);
      if (tiles.length === 0) {
        return;
      }

      clearTimeout(this.processItemsTimeout);
      this.processItemsTimeout = setTimeout(() => {
        this.csrfToken = this.getCsrfToken();
        this.syncSelectedAddress();
        this.attachAddressListeners();
        for (const tile of tiles) {
          this.processItem(tile);
        }
      }, 100);
    });

    this.gridObserver.observe(grid, {
      childList: true,
      subtree: true
    });
  }

  collectNewTilesFromMutations(mutations) {
    const seen = new Set();
    const out = [];

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) {
          continue;
        }

        if (node.classList?.contains('vvp-item-tile')) {
          if (!seen.has(node)) {
            seen.add(node);
            out.push(node);
          }
        }

        const nested = node.querySelectorAll?.('.vvp-item-tile');
        if (nested?.length) {
          nested.forEach((el) => {
            if (!seen.has(el)) {
              seen.add(el);
              out.push(el);
            }
          });
        }
      }
    }

    return out;
  }

  processAllItems() {
    const items = document.querySelectorAll('.vvp-item-tile');

    items.forEach((item) => {
      if (item.hasAttribute('data-vine-rocket-processed')) {
        return;
      }

      this.processItem(item);
    });
  }

  processItem(item) {
    const itemData = this.extractItemData(item);
    if (!itemData) {
      return;
    }

    this.addRocketButton(item, itemData);
    item.setAttribute('data-vine-rocket-processed', 'true');
  }

  extractItemData(item) {
    const input = item.querySelector('.vvp-details-btn input[data-asin], input[data-asin]');
    if (!input) {
      return null;
    }

    const asin = input.dataset.asin;
    const recommendationId = input.dataset.recommendationId || item.getAttribute('data-recommendation-id');

    if (!asin || !recommendationId) {
      return null;
    }

    return {
      asin,
      recommendationId,
      recommendationType: input.dataset.recommendationType || 'VINE_FOR_ALL',
      isParent: input.dataset.isParentAsin === 'true',
      title: this.extractItemTitle(item)
    };
  }

  addRocketButton(item, itemData) {
    if (item.querySelector('.vine-rocket-btn')) {
      return;
    }

    const button = document.createElement('button');
    button.className = 'vine-rocket-btn';
    if (itemData.isParent) {
      button.classList.add('vine-rocket-parent');
    }
    button.innerHTML = '🚀';
    button.title = itemData.isParent
      ? 'Rocket pick this parent ASIN (first resolved variation)'
      : 'Rocket pick this item';
    button.setAttribute('aria-label', button.title);

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await this.handleRocketClick(button, itemData);
    });

    const content = item.querySelector('.vvp-item-tile-content');
    if (content) {
      content.appendChild(button);
    }
  }

  async handleRocketClick(button, itemData) {
    if (this.isOrdering) {
      this.showToast('Order already in progress', 'warning');
      return;
    }

    this.csrfToken = this.getCsrfToken();
    this.syncSelectedAddress();

    if (!this.csrfToken) {
      this.showToast('Missing CSRF token on page', 'error');
      return;
    }

    if (!this.selectedAddressId || !this.selectedLegacyAddressId) {
      this.showToast('No Vine address detected', 'error');
      return;
    }

    this.isOrdering = true;
    this.activeButton = button;
    this.activeOrder = itemData;
    this.orderStartTime = Date.now();

    button.disabled = true;
    button.classList.add('vine-rocket-pending');

    this.showOverlay('Initializing order...');

    try {
      const submitted = await this.performOrder(itemData);
      if (!submitted) {
        this.resetActiveOrderState();
      }
    } catch (error) {
      console.error('[Vine Rocket] Failed to start order:', error);
      this.updateOverlayMessage('Error starting order');
      this.showIframe();
      this.resetActiveOrderState();
    }
  }

  getCsrfToken() {
    try {
      const oldCsrf = document.querySelector('input[name="csrf-token"]');
      if (oldCsrf?.value) {
        return oldCsrf.value;
      }

      const stateElement = document.querySelector('.vvp-body > [type="a-state"], .vvp-body [type="a-state"]');
      if (!stateElement?.textContent) {
        return '';
      }

      const parsed = JSON.parse(stateElement.textContent);
      return parsed?.csrfToken || '';
    } catch (error) {
      console.error('[Vine Rocket] Failed to read CSRF token:', error);
      return '';
    }
  }

  syncSelectedAddress() {
    const addressElements = document.querySelectorAll('.vvp-address-option');
    if (addressElements.length === 0) {
      return;
    }

    const matchingStoredElement = Array.from(addressElements).find((element) => {
      return element.getAttribute('data-address-id') === this.selectedAddressId;
    });

    const selectedElement = Array.from(addressElements).find((element) => {
      const radio = element.querySelector('input[type="radio"]');
      return radio?.checked;
    }) || matchingStoredElement || addressElements[0];

    this.selectedAddressId = selectedElement.getAttribute('data-address-id') || this.selectedAddressId;
    this.selectedLegacyAddressId =
      selectedElement.getAttribute('data-legacy-address-id') || this.selectedLegacyAddressId;
    this.persistSelectedAddress();
  }

  attachAddressListeners() {
    if (this.addressListenersAttached) {
      return;
    }

    const addressElements = document.querySelectorAll('.vvp-address-option');
    if (addressElements.length === 0) {
      return;
    }

    addressElements.forEach((element) => {
      const radio = element.querySelector('input[type="radio"]');
      if (!radio) {
        return;
      }

      radio.addEventListener('change', () => {
        if (!radio.checked) {
          return;
        }

        this.selectedAddressId = element.getAttribute('data-address-id') || this.selectedAddressId;
        this.selectedLegacyAddressId =
          element.getAttribute('data-legacy-address-id') || this.selectedLegacyAddressId;
        this.persistSelectedAddress();
      });
    });

    this.addressListenersAttached = true;
  }

  persistSelectedAddress() {
    if (this.selectedAddressId) {
      localStorage.setItem(this.addressStorageKeys.addressId, this.selectedAddressId);
    }

    if (this.selectedLegacyAddressId) {
      localStorage.setItem(this.addressStorageKeys.legacyAddressId, this.selectedLegacyAddressId);
    }
  }

  async performOrder(itemData) {
    const resolvedItem = await this.resolveOrderTarget(itemData);

    const [promotionId, offerResult] = await Promise.all([
      this.fetchPromotionId(resolvedItem.recommendationId, resolvedItem.asin),
      this.fetchOfferId(
        resolvedItem.recommendationId,
        resolvedItem.asin,
        resolvedItem.recommendationType
      )
    ]);

    if (!offerResult.success || !offerResult.id || !promotionId) {
      const errorText = !offerResult.success && offerResult.error
        ? offerResult.error.replace(/_/g, ' ')
        : 'Missing offer or promotion data';

      this.updateOverlayMessage(`Error: ${errorText}`);
      this.showIframe();
      return false;
    }

    this.submitCheckoutForm({
      asin: resolvedItem.asin,
      offerListingID: offerResult.id,
      vinePromotionId: promotionId
    });

    return true;
  }

  async resolveOrderTarget(itemData) {
    if (!itemData.isParent) {
      return itemData;
    }

    const response = await fetch(
      `https://${this.amazonDomain}/vine/api/recommendations/${encodeURIComponent(itemData.recommendationId)}`,
      { credentials: 'same-origin' }
    );

    if (!response.ok) {
      throw new Error(`Recommendation lookup failed with status ${response.status}`);
    }

    const payload = await response.json();
    const result = payload?.result || payload || {};

    const resolvedAsin = [
      result.item?.asin,
      result.asin,
      result.selectedAsin,
      result.currentAsin,
      result.childAsin,
      result.variations?.find((variation) => variation?.isSelected)?.asin,
      result.variations?.[0]?.asin,
      itemData.asin
    ].find(Boolean);

    return {
      ...itemData,
      asin: resolvedAsin,
      recommendationId: result.recommendationId || itemData.recommendationId,
      recommendationType: result.recommendationType || itemData.recommendationType
    };
  }

  async fetchPromotionId(recommendationId, asin) {
    const response = await fetch(
      `https://${this.amazonDomain}/vine/api/recommendations/${encodeURIComponent(recommendationId)}/item/${asin}?imageSize=500`,
      { credentials: 'same-origin' }
    );

    if (!response.ok) {
      throw new Error(`Promotion lookup failed with status ${response.status}`);
    }

    const payload = await response.json();
    const result = payload?.result || payload || {};

    return result.promotionId || result.receiptData?.promotionId || result.item?.promotionId || '';
  }

  async fetchOfferId(recommendationId, asin, recommendationType) {
    const payload = JSON.stringify({
      recommendationId,
      recommendationType,
      itemAsin: asin,
      addressId: this.selectedAddressId,
      legacyAddressId: this.selectedLegacyAddressId
    });

    try {
      const response = await fetch(`https://${this.amazonDomain}/vine/api/voiceOrders`, {
        method: 'POST',
        credentials: 'same-origin',
        body: payload,
        headers: {
          'anti-csrftoken-a2z': this.csrfToken,
          'content-type': 'application/json'
        }
      });

      const text = await response.text();
      const offerId = (text.match(/"offer(?:Listing)?Id"\s*:\s*"(.*?)"/i) || [])[1];
      if (offerId) {
        return { success: true, id: offerId };
      }

      const parsed = text ? JSON.parse(text) : {};
      const errorMessage = parsed.error || parsed.result?.error || parsed.message;
      if (errorMessage) {
        return { success: false, error: errorMessage };
      }
    } catch (error) {
      console.error('[Vine Rocket] Voice order lookup failed:', error);
      return { success: false, error: error.message || 'Voice order lookup failed' };
    }

    return { success: false, error: 'No offer ID found' };
  }

  submitCheckoutForm({ asin, offerListingID, vinePromotionId }) {
    this.createOverlay();
    this.hideIframe();

    const previousForm = document.getElementById('vine-rocket-checkout-form');
    if (previousForm) {
      previousForm.remove();
    }

    const form = document.createElement('form');
    form.id = 'vine-rocket-checkout-form';
    form.method = 'POST';
    form.action = '/checkout/entry/buynow?pipelineType=Chewbacca';
    form.target = 'vine_checkout_frame';
    form.style.display = 'none';

    const fields = {
      skipCart: '1',
      quantity: '1',
      asin,
      offerListingID,
      vinePromotionType: 'VINE',
      vinePromotionId
    };

    Object.entries(fields).forEach(([name, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    });

    document.body.appendChild(form);
    this.updateOverlayMessage('Navigating to checkout...');
    form.submit();
  }

  createOverlay() {
    let overlay = document.getElementById('vine-overlay');
    if (overlay) {
      return overlay;
    }

    overlay = document.createElement('div');
    overlay.id = 'vine-overlay';
    overlay.className = 'vine-overlay';
    overlay.innerHTML = `
      <div class="vine-overlay-content" role="dialog" aria-modal="true" aria-live="polite">
        <div class="vine-overlay-header">
          <button id="vine-manual-toggle" class="vine-overlay-toggle" type="button" style="display:none;">Show Checkout</button>
          <h3 id="vine-overlay-message" class="vine-overlay-message">Preparing order...</h3>
          <button id="vine-overlay-close" class="vine-overlay-close" type="button" aria-label="Close rocket overlay">✕</button>
        </div>
        <iframe
          name="vine_checkout_frame"
          id="vine_checkout_frame"
          class="vine-checkout-frame"
          title="Vine checkout automation frame"
        ></iframe>
      </div>
    `;

    document.body.appendChild(overlay);

    const closeButton = overlay.querySelector('#vine-overlay-close');
    closeButton?.addEventListener('click', () => {
      overlay.style.display = 'none';
    });

    const toggleButton = overlay.querySelector('#vine-manual-toggle');
    toggleButton?.addEventListener('click', () => {
      const frame = document.getElementById('vine_checkout_frame');
      if (!frame) {
        return;
      }

      if (frame.classList.contains('vine-checkout-frame-visible')) {
        this.hideIframe();
      } else {
        this.showIframe();
      }
    });

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        overlay.style.display = 'none';
      }
    });

    return overlay;
  }

  showOverlay(message) {
    const overlay = this.createOverlay();
    this.updateOverlayMessage(message);
    overlay.style.display = 'flex';
    this.hideIframe();
  }

  updateOverlayMessage(message) {
    const messageElement = document.getElementById('vine-overlay-message');
    if (messageElement) {
      messageElement.textContent = message;
    }
  }

  showIframe() {
    const frame = document.getElementById('vine_checkout_frame');
    const toggle = document.getElementById('vine-manual-toggle');
    if (frame) {
      frame.classList.add('vine-checkout-frame-visible');
    }
    if (toggle) {
      toggle.style.display = 'inline-flex';
      toggle.textContent = 'Hide Checkout';
    }
  }

  hideIframe() {
    const frame = document.getElementById('vine_checkout_frame');
    const toggle = document.getElementById('vine-manual-toggle');
    if (frame) {
      frame.classList.remove('vine-checkout-frame-visible');
    }
    if (toggle) {
      toggle.style.display = 'none';
      toggle.textContent = 'Show Checkout';
    }
  }

  handleWindowMessage(event) {
    if (event.source === window) {
      return;
    }

    if (event.data === 'vine_status_placing_order') {
      this.updateOverlayMessage('Confirming order...');
      return;
    }

    if (event.data === 'vine_error_detected') {
      this.updateOverlayMessage('Checkout needs attention');
      this.showIframe();
      this.showToast('Checkout reported an error', 'error');
      this.resetActiveOrderState();
      return;
    }

    if (event.data?.type === 'vine_order_success') {
      const overlay = document.getElementById('vine-overlay');
      if (overlay) {
        overlay.style.display = 'none';
      }

      const duration = this.orderStartTime ? Date.now() - this.orderStartTime : 0;
      const message = event.data.orderId
        ? `Success: ${event.data.orderId}`
        : 'Order placed';

      this.showToast(message, 'success', duration);
      this.resetActiveOrderState();
    }
  }

  resetActiveOrderState() {
    if (this.activeButton) {
      this.activeButton.disabled = false;
      this.activeButton.classList.remove('vine-rocket-pending');
    }

    this.isOrdering = false;
    this.activeButton = null;
    this.activeOrder = null;
    this.orderStartTime = 0;
  }

  showToast(message, tone = 'success', durationMs = 0) {
    let toast = document.getElementById('vine-rocket-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'vine-rocket-toast';
      toast.className = 'vine-rocket-toast';
      document.body.appendChild(toast);
    }

    toast.className = `vine-rocket-toast vine-rocket-toast-${tone}`;
    toast.innerHTML = `
      <div class="vine-rocket-toast-title">${message}</div>
      ${durationMs ? `<div class="vine-rocket-toast-duration">${durationMs}ms</div>` : ''}
    `;

    toast.style.display = 'block';
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      toast.style.display = 'none';
    }, 4000);
  }

  cleanup() {
    super.cleanup();

    window.removeEventListener('message', this.handleWindowMessage);

    if (this.gridObserver) {
      this.gridObserver.disconnect();
    }

    if (this.processItemsTimeout) {
      clearTimeout(this.processItemsTimeout);
    }

    if (this.toastTimeout) {
      clearTimeout(this.toastTimeout);
    }
  }
}

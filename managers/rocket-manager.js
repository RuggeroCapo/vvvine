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
    this.placeOrderClicked = false;
    this.activeButton = null;
    this.activeOrder = null;
    this.activeOrderSource = null;
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
        this.attachAddressListeners();
        for (const tile of tiles) {
          this.processItem(tile);
        }
      }, 100);
    });

    this.gridObserver.observe(grid, {
      childList: true,
      // Keep this cheap on hot grid updates; Amazon currently appends tiles as direct children.
      subtree: false
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
      this.processItem(item);
    });
  }

  processItem(item) {
    if (item.hasAttribute('data-vine-rocket-processed')) {
      return;
    }

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
      isParent: input.dataset.isParentAsin === 'true'
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

    const host = window.vineAutopickManager?.getTileActionHost?.(item) ||
      item.querySelector('.vvp-item-tile-content');
    if (host) {
      host.appendChild(button);
    }
  }

  // Thin wrapper: binds the on-tile button UI to the shared order executor.
  async handleRocketClick(button, itemData) {
    return this.placeOrder(itemData, { button, source: 'manual' });
  }

  // Programmatic order entry. ctx.button is optional (null for autopick-driven orders).
  async placeOrder(itemData, ctx = {}) {
    const button = ctx.button || null;
    const source = ctx.source || 'manual';

    if (this.isOrdering) {
      this.showToast('Order already in progress', 'warning');
      return false;
    }

    this.csrfToken = this.getCsrfToken();
    this.syncSelectedAddress();

    if (!this.csrfToken) {
      this.showToast('Missing CSRF token on page', 'error');
      return false;
    }

    if (!this.selectedAddressId || !this.selectedLegacyAddressId) {
      this.showToast('No Vine address detected', 'error');
      return false;
    }

    this.isOrdering = true;
    this.placeOrderClicked = false;
    this.activeButton = button;
    this.activeOrder = itemData;
    this.activeOrderSource = source;
    this.orderStartTime = Date.now();

    if (button) {
      button.disabled = true;
      button.classList.add('vine-rocket-pending');
    }

    this.showOverlay('Initializing order...');

    try {
      const submitted = await this.performOrder(itemData);
      if (!submitted) {
        this.emitOrderResult('rocketOrderError', { reason: 'not-submitted' });
        this.resetActiveOrderState();
      }
      return submitted;
    } catch (error) {
      console.error('[Vine Rocket] Failed to start order:', error);
      this.updateOverlayMessage('Error starting order');
      this.showIframe();
      this.emitOrderResult('rocketOrderError', { reason: error?.message || 'start-failed' });
      this.resetActiveOrderState();
      return false;
    }
  }

  // Emit an order lifecycle event tagged with the active order's asin + source.
  emitOrderResult(eventName, extra = {}) {
    this.emit(eventName, {
      asin: this.activeOrder?.asin || null,
      source: this.activeOrderSource || 'manual',
      ...extra
    });
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

    let matchingStoredElement = null;
    let checkedElement = null;
    for (const element of addressElements) {
      if (
        !matchingStoredElement &&
        element.getAttribute('data-address-id') === this.selectedAddressId
      ) {
        matchingStoredElement = element;
      }

      const radio = element.querySelector('input[type="radio"]');
      if (!checkedElement && radio?.checked) {
        checkedElement = element;
      }

      if (matchingStoredElement && checkedElement) {
        break;
      }
    }

    const selectedElement = checkedElement || matchingStoredElement || addressElements[0];

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
      const storedAddressId = localStorage.getItem(this.addressStorageKeys.addressId);
      if (storedAddressId !== this.selectedAddressId) {
        localStorage.setItem(this.addressStorageKeys.addressId, this.selectedAddressId);
      }
    }

    if (this.selectedLegacyAddressId) {
      const storedLegacyAddressId = localStorage.getItem(this.addressStorageKeys.legacyAddressId);
      if (storedLegacyAddressId !== this.selectedLegacyAddressId) {
        localStorage.setItem(this.addressStorageKeys.legacyAddressId, this.selectedLegacyAddressId);
      }
    }
  }

  async performOrder(itemData) {
    const speculativePromotionPromise = itemData.isParent
      ? this.fetchPromotionId(itemData.recommendationId, itemData.asin).catch(() => null)
      : null;
    const resolvedItem = await this.resolveOrderTarget(itemData);
    const canUseSpeculativePromotion = Boolean(
      speculativePromotionPromise &&
      resolvedItem.recommendationId === itemData.recommendationId
    );
    const promotionPromise = canUseSpeculativePromotion
      ? speculativePromotionPromise.then((promotionId) => {
        if (promotionId) {
          return promotionId;
        }

        return this.fetchPromotionId(resolvedItem.recommendationId, resolvedItem.asin);
      })
      : this.fetchPromotionId(resolvedItem.recommendationId, resolvedItem.asin);

    const [promotionId, offerResult] = await Promise.all([
      promotionPromise,
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
    // Keep the checkout frame visible through the navigation; it stays up until the
    // order finishes (success hides the overlay, errors leave it open for inspection).
    this.showIframe();

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
          <button id="vine-overlay-abort" class="vine-overlay-abort" type="button" aria-label="Abort order and stop automation">⛔ Blocca ordine</button>
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

    const abortButton = overlay.querySelector('#vine-overlay-abort');
    abortButton?.addEventListener('click', () => {
      this.abortOrder('manual-abort');
    });

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
    // Show the checkout iframe from the start so the automation stays watchable for the
    // whole order; it is only torn down once the order completes. Use the header toggle
    // to collapse it manually.
    this.showIframe();
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

  // Panic button: kill the in-flight checkout and stop the automation that feeds it.
  // Tears down the frame first (that is the only guaranteed stop), then reconciles the
  // parent-side state so autopick's placeOrderAndAwait resolves instead of hanging.
  abortOrder(reason = 'manual-abort') {
    const wasOrdering = this.isOrdering;
    const alreadyClicked = this.placeOrderClicked;

    const frame = document.getElementById('vine_checkout_frame');
    if (frame) {
      // Best-effort notice to checkout-automation.js; it may not survive the blanking below.
      try {
        frame.contentWindow?.postMessage('vine_abort_order', '*');
      } catch (error) {
        // Cross-origin frame already gone — blanking it is enough.
      }
      frame.src = 'about:blank';
    }

    document.getElementById('vine-rocket-checkout-form')?.remove();

    const stopped = this.stopPipeline();

    if (wasOrdering) {
      this.emitOrderResult('rocketOrderError', { reason });
    }
    this.resetActiveOrderState();

    this.hideIframe();
    this.updateOverlayMessage('Order aborted');
    const overlay = document.getElementById('vine-overlay');
    if (overlay) {
      overlay.style.display = 'none';
    }

    const stoppedText = stopped.length ? ` — stopped: ${stopped.join(', ')}` : '';
    const message = alreadyClicked
      ? `Aborted after Place Order was clicked — verify on Amazon${stoppedText}`
      : `Order aborted${stoppedText}`;

    this.showToast(message, alreadyClicked ? 'warning' : 'error');
    console.warn(`[Vine Rocket] Abort (${reason})`, { wasOrdering, alreadyClicked, stopped });

    return { wasOrdering, alreadyClicked, stopped };
  }

  // Stop whatever would start the next order right after this one is killed.
  stopPipeline() {
    const stopped = [];

    const autopick = window.vineAutopickManager;
    if (autopick?.kill) {
      autopick.kill();
      stopped.push('autopick');
    }

    const monitoring = window.vineMonitoringManager;
    if (monitoring?.isMonitoring) {
      Promise.resolve(monitoring.stopMonitoring())
        .catch((error) => console.error('[Vine Rocket] Failed to stop monitoring:', error));
      stopped.push('monitoring');
    }

    this.emit('rocketEmergencyStop', { stopped });
    return stopped;
  }

  handleWindowMessage(event) {
    if (event.source === window) {
      return;
    }

    // After an abort the frame is blanked but a late message can still land; without
    // an active order there is nothing to report, so drop everything except the
    // abort acknowledgement instead of toasting a stale result.
    if (!this.isOrdering && event.data?.type !== 'vine_order_aborted') {
      return;
    }

    if (event.data === 'vine_status_placing_order') {
      this.placeOrderClicked = true;
      this.updateOverlayMessage('Confirming order...');
      return;
    }

    if (event.data?.type === 'vine_order_aborted') {
      console.warn('[Vine Rocket] Checkout frame confirmed abort', event.data);
      return;
    }

    if (event.data === 'vine_error_detected') {
      this.updateOverlayMessage('Checkout needs attention');
      this.showIframe();
      this.showToast('Checkout reported an error', 'error');
      this.emitOrderResult('rocketOrderError', { reason: 'checkout-error' });
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
      this.emitOrderResult('rocketOrderSuccess', { orderId: event.data.orderId || null, durationMs: duration });
      this.resetActiveOrderState();
    }
  }

  resetActiveOrderState() {
    if (this.activeButton) {
      this.activeButton.disabled = false;
      this.activeButton.classList.remove('vine-rocket-pending');
    }

    this.isOrdering = false;
    this.placeOrderClicked = false;
    this.activeButton = null;
    this.activeOrder = null;
    this.activeOrderSource = null;
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
    toast.textContent = '';

    const title = document.createElement('div');
    title.className = 'vine-rocket-toast-title';
    title.textContent = message;
    toast.appendChild(title);

    if (durationMs) {
      const duration = document.createElement('div');
      duration.className = 'vine-rocket-toast-duration';
      duration.textContent = `${durationMs}ms`;
      toast.appendChild(duration);
    }

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

(function checkoutAutomation() {
  if (window.self === window.top || window.name !== 'vine_checkout_frame') {
    return;
  }

  let successReported = false;
  let orderButtonClicked = false;
  let errorReported = false;
  let aborted = false;
  let intervalId = null;
  let observer = null;

  // Backup shipping address (Milan) used when Amazon can't ship an item to the
  // primary Vine address; tried once per order before giving up.
  const FALLBACK_ADDRESS_ID = '7ESUR7HHK2O664MWXL2IG12M42N5X1RHEA2OEHR1X5N24MLPXTQ2FAA2OXQACVRO';
  let fallbackAddressAttempted = false;
  let switchingAddress = false;
  let useFallbackAddress = true;

  chrome.storage.local.get(['vineAutopickConfig']).then((result) => {
    if (result.vineAutopickConfig?.useFallbackAddress === false) {
      useFallbackAddress = false;
    }
  }).catch(() => {});

  function postToParent(message) {
    window.parent.postMessage(message, '*');
  }

  function findPlaceOrderButton() {
    return document.getElementById('placeOrder') ||
      document.querySelector('input[name="placeYourOrder1"]') ||
      document.querySelector('.place-your-order-button');
  }

  function findDestinationShipError() {
    const el = document.querySelector('[data-messageid="LineItemDestinationNoValidShipOptionCVMessage"]');
    if (!el) {
      return null;
    }

    const visible = el.offsetParent !== null || window.getComputedStyle(el).display !== 'none';
    return visible ? el : null;
  }

  function findFallbackAddressOption() {
    const legacySelect = document.querySelector('select[name="line-item-address"]');
    if (legacySelect) {
      const option = Array.from(legacySelect.options)
        .find((opt) => opt.value.includes(FALLBACK_ADDRESS_ID));
      if (option) {
        return { type: 'select', select: legacySelect, option };
      }
    }

    const radio = document.querySelector(`input[type="radio"][value*="addressID=${FALLBACK_ADDRESS_ID}"]`);
    if (radio) {
      return { type: 'radio', radio };
    }

    return null;
  }

  function findAddressContinueButton() {
    return document.querySelector('#checkout-secondary-continue-button-id input[data-testid="secondary-continue-button"]') ||
      document.querySelector('#checkout-secondary-continue-button-id input[type="submit"]') ||
      document.querySelector('input[data-testid="secondary-continue-button"]');
  }

  function switchToFallbackAddress() {
    return new Promise((resolve) => {
      const target = findFallbackAddressOption();
      if (!target) {
        resolve(false);
        return;
      }

      if (target.type === 'select') {
        target.select.value = target.option.value;
        target.select.dispatchEvent(new Event('input', { bubbles: true }));
        target.select.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        target.radio.checked = true;
        target.radio.dispatchEvent(new Event('click', { bubbles: true }));
        target.radio.dispatchEvent(new Event('change', { bubbles: true }));
      }

      window.setTimeout(() => {
        const continueButton = findAddressContinueButton();
        if (!continueButton) {
          resolve(false);
          return;
        }

        continueButton.click();
        resolve(true);
      }, 500);
    });
  }

  function stopAutomation() {
    if (intervalId !== null) {
      window.clearInterval(intervalId);
      intervalId = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  }

  function attemptPlaceOrder() {
    if (aborted || successReported || orderButtonClicked || switchingAddress) {
      return false;
    }

    const button = findPlaceOrderButton();
    if (!button || button.disabled) {
      return false;
    }

    orderButtonClicked = true;
    postToParent('vine_status_placing_order');
    button.click();
    return true;
  }

  function checkSuccess() {
    if (successReported) {
      return true;
    }

    const purchaseMatch = window.location.href.match(/[?&]purchaseId=([^&]+)/);
    if (purchaseMatch) {
      successReported = true;
      postToParent({
        type: 'vine_order_success',
        orderId: decodeURIComponent(purchaseMatch[1])
      });
      return true;
    }

    const text = document.body?.innerText || '';
    const successSnippets = [
      'Thank you',
      'Order placed',
      'Grazie',
      'Ordine effettuato',
      'ordine è stato effettuato',
      'ordine è stato inviato'
    ];

    if (successSnippets.some((snippet) => text.includes(snippet))) {
      successReported = true;
      postToParent({
        type: 'vine_order_success',
        orderId: 'Confirmed'
      });
      return true;
    }

    return false;
  }

  function checkError() {
    const destinationError = findDestinationShipError();
    if (destinationError) {
      if (!useFallbackAddress) {
        if (!errorReported) {
          errorReported = true;
          postToParent('vine_error_detected');
        }
        return true;
      }

      if (!fallbackAddressAttempted && !switchingAddress) {
        switchingAddress = true;
        fallbackAddressAttempted = true;
        orderButtonClicked = false;

        switchToFallbackAddress().then((switched) => {
          switchingAddress = false;
          if (!switched && !errorReported && !aborted) {
            errorReported = true;
            postToParent('vine_error_detected');
          }
        });
      } else if (!switchingAddress && !errorReported) {
        errorReported = true;
        postToParent('vine_error_detected');
      }

      return true;
    }

    const errorElement = document.querySelector('.a-alert-error') ||
      document.querySelector('#message_error') ||
      document.querySelector('.a-message-error') ||
      document.querySelector('#vvp-out-of-inventory-error-alert') ||
      document.querySelector('#vvp-product-details-error-alert');

    if (!errorElement) {
      return false;
    }

    const isVisible = errorElement.offsetParent !== null ||
      window.getComputedStyle(errorElement).display !== 'none';

    if (isVisible && !errorReported) {
      errorReported = true;
      postToParent('vine_error_detected');
    }

    return isVisible;
  }

  // Parent-driven kill switch: stops polling before the Place Order click can fire.
  // The parent also blanks the frame, so this may not get the chance to run.
  window.addEventListener('message', (event) => {
    if (event.source !== window.parent || event.data !== 'vine_abort_order') {
      return;
    }

    aborted = true;
    stopAutomation();
    postToParent({ type: 'vine_order_aborted', alreadyClicked: orderButtonClicked });
  });

  function tick() {
    if (aborted) {
      stopAutomation();
      return;
    }

    if (checkSuccess()) {
      stopAutomation();
      return;
    }

    checkError();
    attemptPlaceOrder();
  }

  intervalId = window.setInterval(tick, 50);

  observer = new MutationObserver(tick);

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();

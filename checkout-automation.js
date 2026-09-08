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

  function postToParent(message) {
    window.parent.postMessage(message, '*');
  }

  function findPlaceOrderButton() {
    return document.getElementById('placeOrder') ||
      document.querySelector('input[name="placeYourOrder1"]') ||
      document.querySelector('.place-your-order-button');
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
    if (aborted || successReported || orderButtonClicked) {
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

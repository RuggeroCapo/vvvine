// Extension context guard
//
// When the extension is reloaded, updated or disabled, Chrome kills the
// context of the content scripts already running in open pages but leaves the
// scripts themselves alive. From that moment every chrome.* call throws
// "Extension context invalidated", so timers keep firing, keep failing and
// spam the console forever. This guard detects that state once and lets every
// manager shut down cleanly instead of retrying against a dead context.

(function () {
  const BANNER_ID = 'vine-context-invalidated-banner';
  let invalidated = false;

  function isInvalidationError(error) {
    if (!error) return false;
    const message = typeof error === 'string' ? error : (error.message || '');
    return message.includes('Extension context invalidated') ||
           message.includes('Extension context was invalidated');
  }

  // Cheap pre-flight check: chrome.runtime.id is undefined once the context
  // is gone (and accessing chrome.runtime can itself throw).
  function isValid() {
    if (invalidated) return false;
    try {
      return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    } catch (error) {
      return false;
    }
  }

  function showReloadBanner() {
    if (document.getElementById(BANNER_ID) || !document.body) return;

    const banner = document.createElement('div');
    banner.id = BANNER_ID;
    banner.textContent = 'Vine Enhancer was reloaded — refresh this page to resume monitoring.';
    banner.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483647',
      'padding:10px 16px', 'background:#b12704', 'color:#fff',
      'font:600 13px/1.4 Arial, sans-serif', 'text-align:center',
      'cursor:pointer'
    ].join(';');
    banner.title = 'Click to reload the page';
    banner.addEventListener('click', () => window.location.reload());
    document.body.appendChild(banner);
  }

  // Flags the context as dead (idempotent) and tells every manager to stop.
  function markInvalidated(source) {
    if (invalidated) return;
    invalidated = true;

    console.warn(`[Vine Enhancer] Extension context invalidated (${source}). ` +
                 'Stopping all activity — reload the page to resume.');

    showReloadBanner();

    if (window.vineEventBus) {
      window.vineEventBus.emit('extensionContextInvalidated', { source });
    }
  }

  // Returns true when the error is an invalidation (and the shutdown has been
  // triggered), so callers can bail out instead of logging a hard error.
  function handle(error, source) {
    if (!isInvalidationError(error)) return false;
    markInvalidated(source);
    return true;
  }

  window.vineExtensionContext = {
    isValid,
    isInvalidated: () => invalidated,
    isInvalidationError,
    markInvalidated,
    handle
  };
})();

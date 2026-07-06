/**
 * Runs in the page's JavaScript world so DevTools (default "page" context) can call helpers.
 * Loaded via chrome-extension://… URL (see web_accessible_resources).
 */
(function vineFlowInspectorPageBridge() {
  window.vineFlowInspectorCopy = function vineFlowInspectorCopy() {
    document.dispatchEvent(new CustomEvent('vineflow-copy-request'));
  };

  window.vineFlowInspectorExport = function vineFlowInspectorExport() {
    const ev = new CustomEvent('vineflow-export-sync', { detail: {} });
    document.dispatchEvent(ev);
    return ev.detail._text || '';
  };
})();

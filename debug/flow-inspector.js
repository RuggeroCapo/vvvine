/**
 * Opt-in page flow logger for debugging Vine → checkout flows.
 *
 * Enable any of:
 *   - URL: ?vineFlowInspector=1
 *   - localStorage: vineFlowInspector = 1
 *   - sessionStorage: vineFlowInspector = 1
 *
 * DevTools console uses the **page** context by default. This extension injects
 * vineFlowInspectorCopy / vineFlowInspectorExport into the page so they work there.
 * Alternatively open the console’s context dropdown and pick this extension’s
 * isolated world — then window.vineFlowInspectorLog is available too.
 *
 * After load:
 *   vineFlowInspectorCopy()            // copy JSON report
 *   copy(vineFlowInspectorExport())    // same string into clipboard (Chrome)
 *   vineFlowInspectorLog               // only in extension context
 *
 * Optional (noisy): localStorage vineFlowInspectorClicks = 1 logs every click.
 */
(function vineFlowInspector() {
  const FLAG = 'vineFlowInspector';
  const CLICKS_FLAG = 'vineFlowInspectorClicks';

  function enabled() {
    try {
      if (new URLSearchParams(window.location.search).get(FLAG) === '1') {
        return true;
      }
      if (window.sessionStorage.getItem(FLAG) === '1') {
        return true;
      }
      if (window.localStorage.getItem(FLAG) === '1') {
        return true;
      }
    } catch (e) {
      /* storage blocked */
    }
    return false;
  }

  if (!enabled()) {
    return;
  }

  const clicksEnabled = (() => {
    try {
      return window.localStorage.getItem(CLICKS_FLAG) === '1';
    } catch (e) {
      return false;
    }
  })();

  const t0 = performance.now();
  const MAX_ENTRIES = 2500;
  const logs = [];

  function stamp() {
    return {
      iso: new Date().toISOString(),
      ms: Math.round((performance.now() - t0) * 1000) / 1000
    };
  }

  function push(kind, detail) {
    const entry = { ...stamp(), kind, frame: frameLabel(), ...detail };
    logs.push(entry);
    if (logs.length > MAX_ENTRIES) {
      logs.shift();
    }
    console.log('[VineFlow]', kind, entry);
  }

  function frameLabel() {
    if (window === window.top) {
      return 'top';
    }
    return window.name || 'iframe';
  }

  function shortUrl(u) {
    const s = String(u);
    return s.length > 800 ? `${s.slice(0, 800)}…` : s;
  }

  function safeArgs(args, maxEach) {
    const lim = maxEach || 400;
    return args.map((a) => {
      if (a == null) {
        return a;
      }
      if (typeof a === 'string') {
        return a.length > lim ? `${a.slice(0, lim)}…` : a;
      }
      if (typeof a === 'object') {
        try {
          const j = JSON.stringify(a);
          return j.length > lim ? `${j.slice(0, lim)}…` : a;
        } catch (e) {
          return '[object]';
        }
      }
      return String(a).slice(0, lim);
    });
  }

  push('inspector:boot', { href: shortUrl(location.href), userAgent: navigator.userAgent.slice(0, 200) });

  const origFetch = window.fetch.bind(window);
  window.fetch = function fetchWrapped(input, init) {
    const url = typeof input === 'string' ? input : input?.url;
    const method = (init && init.method) || (typeof input !== 'string' && input?.method) || 'GET';
    push('fetch:start', { method, url: shortUrl(url) });
    return origFetch(input, init).then(
      (res) => {
        push('fetch:response', {
          method,
          url: shortUrl(url),
          status: res.status,
          ok: res.ok,
          type: res.type
        });
        return res;
      },
      (err) => {
        push('fetch:error', { method, url: shortUrl(url), message: err?.message || String(err) });
        throw err;
      }
    );
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function openWrapped(method, url, ...rest) {
    this.__vineFlowMethod = method;
    this.__vineFlowUrl = url;
    return xhrOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function sendWrapped(body) {
    push('xhr:send', {
      method: this.__vineFlowMethod,
      url: shortUrl(this.__vineFlowUrl),
      bodyLen: body != null ? String(body).length : 0
    });
    this.addEventListener(
      'loadend',
      () => {
        push('xhr:loadend', {
          url: shortUrl(this.__vineFlowUrl),
          status: this.status,
          statusText: this.statusText?.slice(0, 120)
        });
      },
      { once: true }
    );
    return xhrSend.call(this, body);
  };

  window.addEventListener(
    'message',
    (ev) => {
      if (ev.source === window && ev.data == null) {
        return;
      }
      let data = ev.data;
      if (typeof data === 'object') {
        try {
          data = JSON.parse(JSON.stringify(data));
        } catch (e) {
          data = '[non-serializable]';
        }
      } else if (typeof data === 'string') {
        data = data.length > 400 ? `${data.slice(0, 400)}…` : data;
      }
      push('message:in', { origin: ev.origin, sourceFrame: ev.source === window ? 'self' : 'other', data });
    },
    true
  );

  const postMessage = window.postMessage.bind(window);
  window.postMessage = function postMessageWrapped(message, targetOrigin, transfer) {
    let preview = message;
    if (typeof message === 'string') {
      preview = message.length > 400 ? `${message.slice(0, 400)}…` : message;
    } else if (message && typeof message === 'object') {
      try {
        preview = JSON.parse(JSON.stringify(message));
      } catch (e) {
        preview = '[object]';
      }
    }
    push('message:out', { targetOrigin, data: preview });
    return postMessage(message, targetOrigin, transfer);
  };

  function wrapHistory(fn, name) {
    return function wrappedHistory(state, title, url) {
      push(`history:${name}`, {
        url: url != null ? shortUrl(url) : '',
        hasState: state != null
      });
      return fn.call(history, state, title, url);
    };
  }
  history.pushState = wrapHistory(history.pushState.bind(history), 'pushState');
  history.replaceState = wrapHistory(history.replaceState.bind(history), 'replaceState');
  window.addEventListener('popstate', (e) => {
    push('history:popstate', { hasState: e.state != null });
  });

  window.addEventListener('error', (e) => {
    push('window:error', {
      message: e.message,
      filename: e.filename,
      lineno: e.lineno,
      colno: e.colno
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    push('unhandledrejection', { reason: String(e.reason) });
  });

  document.addEventListener('readystatechange', () => {
    push('document:readystatechange', { readyState: document.readyState });
  });
  window.addEventListener('DOMContentLoaded', () => push('window:DOMContentLoaded', {}), { once: true });
  window.addEventListener('load', () => push('window:load', {}), { once: true });
  document.addEventListener('visibilitychange', () => {
    push('document:visibilitychange', { visibilityState: document.visibilityState, hidden: document.hidden });
  });
  window.addEventListener('pagehide', (e) => {
    push('window:pagehide', { persisted: e.persisted });
  });

  document.addEventListener(
    'submit',
    (e) => {
      const f = e.target;
      push('form:submit', {
        id: f.id || '',
        action: f.action ? shortUrl(f.action) : '',
        method: f.method || '',
        target: f.target || ''
      });
    },
    true
  );

  if (clicksEnabled) {
    document.addEventListener(
      'click',
      (e) => {
        const t = e.target;
        if (!t || t.nodeType !== 1) {
          return;
        }
        push('click', {
          tag: t.tagName,
          id: t.id || '',
          className: (t.className && String(t.className).slice(0, 120)) || '',
          text: (t.innerText || '').trim().slice(0, 80)
        });
      },
      true
    );
  }

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
    const orig = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = function sendMessageWrapped(...args) {
      push('chrome.runtime.sendMessage', { argc: args.length, first: safeArgs([args[0]])[0] });
      return orig(...args);
    };
  }

  function exportJson() {
    return JSON.stringify(
      {
        exportedAt: new Date().toISOString(),
        pageUrl: location.href,
        frame: frameLabel(),
        entries: logs
      },
      null,
      2
    );
  }

  async function copyReportToClipboard() {
    const text = exportJson();
    try {
      await navigator.clipboard.writeText(text);
      console.log('[VineFlow] Copied', logs.length, 'events to clipboard');
    } catch (e) {
      console.log('[VineFlow] Clipboard failed; paste from vineFlowInspectorExport() below');
      console.log(text);
    }
  }

  window.vineFlowInspectorLog = logs;
  window.vineFlowInspectorExport = exportJson;
  window.vineFlowInspectorCopy = copyReportToClipboard;

  document.addEventListener(
    'vineflow-copy-request',
    () => {
      void copyReportToClipboard();
    },
    true
  );

  document.addEventListener(
    'vineflow-export-sync',
    (e) => {
      e.detail._text = exportJson();
    },
    true
  );

  function installPageConsoleBridge() {
    if (typeof chrome === 'undefined' || !chrome.runtime?.getURL) {
      console.warn('[VineFlow] No chrome.runtime — page bridge skipped');
      return;
    }
    const src = chrome.runtime.getURL('debug/flow-inspector-page-bridge.js');
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.addEventListener(
      'error',
      () => {
        console.warn(
          '[VineFlow] Page bridge script did not load (CSP?). Use the console context dropdown → this extension, or copy from extension context.'
        );
      },
      { once: true }
    );
    s.addEventListener('load', () => s.remove(), { once: true });
    (document.head || document.documentElement).appendChild(s);
  }

  installPageConsoleBridge();

  console.info(
    '[VineFlow] Inspector active. In the **page** console: vineFlowInspectorCopy() or copy(vineFlowInspectorExport()). ' +
      'Click logging: localStorage.setItem("vineFlowInspectorClicks","1") + reload.'
  );
})();

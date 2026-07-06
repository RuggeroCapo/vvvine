/**
 * Runs in the PAGE world (injected). Logs Amazon-side fetch/XHR/history/errors.
 * Enabled when URL has ?vineFlowInspector=1 or localStorage vineFlowInspector === '1'
 */
(function pageFlowInspector() {
  function enabled() {
    try {
      if (new URLSearchParams(window.location.search).get('vineFlowInspector') === '1') {
        return true;
      }
      if (window.localStorage.getItem('vineFlowInspector') === '1') {
        return true;
      }
    } catch (e) {
      /* ignore */
    }
    return false;
  }

  if (!enabled()) {
    return;
  }

  const t0 = performance.now();

  function emit(category, detail) {
    const payload = {
      source: 'page',
      category,
      t: Math.round(performance.now() - t0),
      iso: new Date().toISOString(),
      url: window.location.href,
      detail: detail == null ? null : typeof detail === 'object' ? safeDetail(detail) : String(detail)
    };
    try {
      document.dispatchEvent(new CustomEvent('__vineFlowInspector', { detail: payload }));
    } catch (e) {
      /* ignore */
    }
  }

  function safeDetail(obj, depth = 0) {
    if (obj == null || depth > 4) {
      return obj;
    }
    if (typeof obj !== 'object') {
      return obj;
    }
    if (obj instanceof Error) {
      return { name: obj.name, message: obj.message, stack: obj.stack };
    }
    if (Array.isArray(obj)) {
      return obj.slice(0, 50).map((x) => safeDetail(x, depth + 1));
    }
    const out = {};
    let n = 0;
    for (const k of Object.keys(obj)) {
      if (n++ > 40) {
        out._truncated = true;
        break;
      }
      try {
        const v = obj[k];
        if (typeof v === 'function') {
          out[k] = '[Function]';
        } else if (typeof v === 'object' && v !== null) {
          out[k] = safeDetail(v, depth + 1);
        } else {
          out[k] = v;
        }
      } catch (e) {
        out[k] = '[unreadable]';
      }
    }
    return out;
  }

  emit('boot', { href: window.location.href });

  const ofetch = window.fetch;
  window.fetch = function patchedFetch(input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    const method = (init && init.method) || (typeof input !== 'string' && input && input.method) || 'GET';
    emit('fetch.start', { method, url: String(url).slice(0, 2048) });
    return ofetch.apply(this, arguments).then(
      (res) => {
        emit('fetch.done', {
          method,
          url: String(url).slice(0, 2048),
          status: res.status,
          ok: res.ok,
          type: res.type
        });
        return res;
      },
      (err) => {
        emit('fetch.error', { method, url: String(url).slice(0, 2048), error: err && err.message });
        throw err;
      }
    );
  };

  const XO = XMLHttpRequest.prototype.open;
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__vineMethod = method;
    this.__vineUrl = url;
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    const self = this;
    const u = self.__vineUrl;
    emit('xhr.send', {
      method: self.__vineMethod,
      url: u != null ? String(u).slice(0, 2048) : '',
      bodyLen: body != null ? String(body).length : 0
    });
    self.addEventListener('loadend', function () {
      emit('xhr.done', {
        method: self.__vineMethod,
        url: u != null ? String(u).slice(0, 2048) : '',
        status: self.status,
        readyState: self.readyState
      });
    });
    return XS.apply(this, arguments);
  };

  const ps = history.pushState;
  const rs = history.replaceState;
  history.pushState = function () {
    emit('history.pushState', { argsLen: arguments.length });
    return ps.apply(this, arguments);
  };
  history.replaceState = function () {
    emit('history.replaceState', { argsLen: arguments.length });
    return rs.apply(this, arguments);
  };

  window.addEventListener(
    'error',
    function (ev) {
      emit('window.error', {
        message: ev.message,
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
        error: ev.error && ev.error.message
      });
    },
    true
  );

  window.addEventListener('unhandledrejection', function (ev) {
    const r = ev.reason;
    emit('unhandledrejection', {
      reason: r && typeof r === 'object' ? safeDetail(r) : String(r)
    });
  });

  window.addEventListener(
    'message',
    function (ev) {
      const d = ev.data;
      if (d == null) {
        return;
      }
      const s = typeof d === 'string' ? d.slice(0, 200) : JSON.stringify(d).slice(0, 200);
      emit('message', { origin: ev.origin, preview: s });
    },
    true
  );

  emit('hooks_installed', {});
})();

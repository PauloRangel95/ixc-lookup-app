/* IXC Lookup PWA — shim de compatibilidade.
 * Emula as APIs chrome.* usadas pela extensão para rodar como app web (PWA).
 * Carregado ANTES de auth.js / logger.js / popup.js. Não altera o código original.
 */
(function () {
  if (typeof window.chrome === 'undefined') window.chrome = {};
  const PFX = 'ixc::';
  const LS = window.localStorage;

  function readKey(k) {
    const raw = LS.getItem(PFX + k);
    if (raw === null) return undefined;
    try { return JSON.parse(raw); } catch (e) { return raw; }
  }
  function allKeys() {
    const out = [];
    for (let i = 0; i < LS.length; i++) {
      const kk = LS.key(i);
      if (kk && kk.indexOf(PFX) === 0) out.push(kk.slice(PFX.length));
    }
    return out;
  }

  const storageLocal = {
    get(keys, cb) {
      const res = {};
      let list;
      if (keys === null || keys === undefined) list = allKeys();
      else if (typeof keys === 'string') list = [keys];
      else if (Array.isArray(keys)) list = keys;
      else if (typeof keys === 'object') list = Object.keys(keys);
      else list = [];
      list.forEach(k => {
        const v = readKey(k);
        if (v !== undefined) res[k] = v;
        else if (keys && typeof keys === 'object' && !Array.isArray(keys) && k in keys) res[k] = keys[k];
      });
      if (typeof cb === 'function') { cb(res); return; }
      return Promise.resolve(res);
    },
    set(obj, cb) {
      try { Object.keys(obj || {}).forEach(k => LS.setItem(PFX + k, JSON.stringify(obj[k]))); } catch (e) {}
      if (typeof cb === 'function') { cb(); return; }
      return Promise.resolve();
    },
    remove(keys, cb) {
      const list = Array.isArray(keys) ? keys : [keys];
      list.forEach(k => LS.removeItem(PFX + k));
      if (typeof cb === 'function') { cb(); return; }
      return Promise.resolve();
    },
    clear(cb) {
      allKeys().forEach(k => LS.removeItem(PFX + k));
      if (typeof cb === 'function') { cb(); return; }
      return Promise.resolve();
    }
  };
  window.chrome.storage = window.chrome.storage || {};
  window.chrome.storage.local = storageLocal;

  window.chrome.runtime = window.chrome.runtime || {};
  // Mantenha em sincronia com o manifest da extensão ao subir versão.
  window.chrome.runtime.getManifest = () => ({ version: '1.9.0' });
  window.chrome.runtime.getURL = (path) => new URL(path, location.href).href;

  window.chrome.tabs = window.chrome.tabs || {};
  window.chrome.tabs.create = (opts) => { try { window.open((opts && opts.url) || '', '_blank'); } catch (e) {} };

  // APIs não usadas no app — no-op para evitar erros
  window.chrome.sidePanel = window.chrome.sidePanel || { open() {}, setPanelBehavior() { return Promise.resolve(); } };
  window.chrome.action = window.chrome.action || { onClicked: { addListener() {} } };

  // ── OLT Cloud via proxy n8n (contorna CORS no navegador) ──
  // Redireciona qualquer fetch para carajas.oltcloud.co ao webhook ixc-olt-proxy.
  const OLT_PROXY = 'https://carajasnet-n8n.bwadmr.easypanel.host/webhook/ixc-olt-proxy';
  const OLT_HOST  = 'https://carajas.oltcloud.co';
  const _fetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = (typeof input === 'string') ? input : (input && input.url) || '';
    if (url.indexOf(OLT_HOST) === 0) {
      const method  = (init && init.method) || (typeof input !== 'string' && input && input.method) || 'GET';
      const headers = (init && init.headers) || {};
      const body    = (init && init.body) || null;
      return _fetch(OLT_PROXY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url, method, headers, body })
      });
    }
    return _fetch(input, init);
  };
})();

/* Car Theme Studio Web - in-browser "server".
 * Holds the opened APK in memory and answers the same /api/* requests the Windows Studio serves,
 * so designer.js works unchanged. Nothing is uploaded anywhere.
 */
(function () {
  'use strict';
  const te = new TextEncoder(), td = new TextDecoder();
  const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', json: 'application/json' };

  const S = {
    name: null,          // original file name
    files: null,         // Map<path, Uint8Array> (current state)
    originals: new Map(),// path -> first version before we changed it
    meta: {},            // designer settings
    urls: new Map(),     // path -> object URL
    changed: new Set()
  };

  function json(obj, status) {
    return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'Content-Type': 'application/json' } });
  }
  const isImage = p => /\.(png|jpe?g|webp)$/i.test(p);
  const ext = p => (p.split('.').pop() || '').toLowerCase();

  function put(path, bytes) {
    if (!S.originals.has(path) && S.files.has(path)) S.originals.set(path, S.files.get(path));
    S.files.set(path, bytes);
    S.changed.add(path);
    const u = S.urls.get(path);
    if (u) { URL.revokeObjectURL(u); S.urls.delete(path); }
  }

  async function bodyBytes(opts) {
    const b = opts && opts.body;
    if (b == null) return new Uint8Array(0);
    if (typeof b === 'string') return te.encode(b);
    if (b instanceof Blob) return new Uint8Array(await b.arrayBuffer());
    if (b instanceof ArrayBuffer) return new Uint8Array(b);
    if (b instanceof Uint8Array) return b;
    throw new Error('Unsupported body');
  }

  async function handle(url, opts) {
    const u = new URL(url, location.href);
    const method = ((opts && opts.method) || 'GET').toUpperCase();
    const q = u.searchParams;
    if (!S.files) return json({ error: 'Open a theme APK first' }, 400);
    switch (u.pathname.replace(/^.*\/api\//, '/api/')) {
      case '/api/images':
        return json([...S.files.keys()].filter(p => (p.startsWith('res/') || p.startsWith('assets/')) && isImage(p))
          .map(p => ({ path: p, size: S.files.get(p).length })));
      case '/api/jsons':
        return json([...S.files.keys()].filter(p => p.startsWith('assets/') && /\.json$/i.test(p)));
      case '/api/designer':
        if (method === 'POST') { S.meta = JSON.parse(td.decode(await bodyBytes(opts))); return json({ ok: true }); }
        return json(S.meta);
      case '/api/original': {
        const p = q.get('path');
        const d = S.originals.get(p) || S.files.get(p);
        if (!d) return json({ error: 'Not found' }, 404);
        return new Response(d, { headers: { 'Content-Type': MIME[ext(p)] || 'application/octet-stream' } });
      }
      case '/api/file': {
        let p = q.get('path');
        if (method === 'POST') {
          const bytes = await bodyBytes(opts);
          const rep = q.get('replace');
          // Inside an APK the resource table points at the exact file name, so a "jpg -> png" replacement
          // keeps the old name. Android decodes images by content, so PNG data in a .jpg entry works.
          if (rep && S.files.has(rep)) p = rep;
          if (!S.files.has(p)) return json({ error: 'File does not exist: ' + p }, 400);
          if (/\.json$/i.test(p)) {
            try { JSON.parse(td.decode(bytes)); } catch (e) { return json({ error: 'Invalid JSON: ' + e.message }, 400); }
          } else if (!isImage(p)) return json({ error: 'Only images and JSON can be replaced' }, 400);
          put(p, bytes);
          return json({ ok: true });
        }
        if (!S.files.has(p)) {
          // designer may ask for the ".png" name of a converted jpg
          const alt = [...S.files.keys()].find(k => k.replace(/\.(png|jpe?g|webp)$/i, '') === p.replace(/\.(png|jpe?g|webp)$/i, ''));
          if (!alt) return json({ error: 'Not found' }, 404);
          p = alt;
        }
        return new Response(S.files.get(p), { headers: { 'Content-Type': MIME[ext(p)] || 'application/octet-stream' } });
      }
    }
    return json({ error: 'Not found' }, 404);
  }

  window.StudioBackend = {
    fetch(url, opts) {
      const s = String(url);
      if (s.startsWith('blob:') || s.startsWith('data:') || !s.includes('/api/')) return fetch(url, opts);
      return handle(s, opts).catch(e => json({ error: e.message }, 500));
    },
    url(path) {
      if (!S.files || !S.files.has(path)) return '';
      let u = S.urls.get(path);
      if (!u) {
        // Image bytes may be PNG inside a .jpg entry; let the browser sniff the type.
        u = URL.createObjectURL(new Blob([S.files.get(path)]));
        S.urls.set(path, u);
      }
      return u;
    },
    state: S,
    open(name, files) {
      for (const u of S.urls.values()) URL.revokeObjectURL(u);
      S.name = name; S.files = files; S.originals = new Map(); S.meta = {}; S.urls = new Map(); S.changed = new Set();
    },
    put
  };
})();

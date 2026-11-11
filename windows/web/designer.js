/* Car Theme Studio - visual layout designer and live preview.
 *
 * Reads the theme's layout JSON (hotseat_config.json + theme_config.json for one screen size),
 * draws it at the real screen size, and lets you move, resize, add and remove app slots,
 * change backgrounds, icon/label sizes, and image transparency. "Save design" writes the
 * JSON back and bakes transparency into the images (originals are kept for undo).
 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------------ state
  let images = [];          // [{path,size}]
  let idx = {};             // image name -> [paths]
  let layouts = [];         // [{key, dir, W, H}]
  let meta = {};            // designer.json: {opacity, applied, orig, preview}
  let L = null;             // current layout data
  let sel = null;           // selected item {list, i}
  let dirty = false, ver = Date.now(), loadedOnce = false;

  const TYPE_LABEL = { app: 'App', lego: 'Quick apps panel', dw_app_setting: 'Window settings button', speed_text: 'Speed', speed_effect: 'Speed animation',
    desktop_window: 'Map / app window', time: 'Time', clock: 'Clock', weather: 'Weather', navi: 'Navigation', medias: 'Music / radio', image: 'Image' };
  const PLACEHOLDER = { time: '18:05', clock: '🕒', weather: '☀ 28°', speed_text: '125 km/h', speed_effect: '', medias: '♪ Music', desktop_window: 'Map / app window' };
  const COMMON_APPS = ['app_navi', 'app_music', 'app_bt', 'app_radio', 'app_video', 'app_setting', 'app_carsetting', 'app_file', 'app_eq', 'app_360', 'app_apps', 'app_browser', 'app_camera', 'app_call'];

  // ------------------------------------------------------------------ helpers
  async function api(path, opts) {
    const r = await fetch(path, opts);
    const ct = r.headers.get('content-type') || '';
    const data = ct.includes('json') ? await r.json() : await r.text();
    if (!r.ok) throw new Error(data && data.error ? data.error : r.statusText);
    return data;
  }
  async function getJson(path) {
    const r = await fetch('/api/file?path=' + encodeURIComponent(path) + '&t=' + Date.now());
    if (!r.ok) return null;
    const t = await r.text();
    try { return JSON.parse(t.replace(/^﻿/, '')); } catch (e) { console.warn('Bad JSON', path, e); return null; }
  }
  const baseName = p => p.split('/').pop().replace(/\.(png|jpe?g|webp)$/i, '');
  const is9 = p => /\.9\.png$/i.test(p);

  function buildIndex() {
    idx = {};
    for (const im of images) {
      if (!im.path.startsWith('res/')) continue;
      const n = baseName(im.path).replace(/\.9$/, '');
      (idx[n] = idx[n] || []).push(im.path);
    }
  }
  function dirRank(p, night, portrait) {
    const d = p.split('/')[1] || '';
    const isNight = d.includes('night');
    let r = 0;
    if (isNight !== night) r += 100;
    if (d.includes('ldrtl')) r += 50;
    if (d.includes('port') !== portrait) r += 20;
    if (d.startsWith('mipmap')) r -= 5;
    if (d.includes('mdpi')) r -= 2;
    return r;
  }
  function imgPath(name) {
    const list = name && idx[name];
    if (!list) return null;
    const night = $('dNight').checked, portrait = L && L.H > L.W;
    return list.slice().sort((a, b) => dirRank(a, night, portrait) - dirRank(b, night, portrait))[0];
  }
  const imgUrl = name => { const p = imgPath(name); return p ? '/api/file?path=' + encodeURIComponent(p) + '&v=' + ver : null; };
  const opacityOf = name => (meta.opacity && meta.opacity[name] != null) ? meta.opacity[name] : 1;

  // gravity  "l_7|t_74", "right|r_265|t_45", "center_vertical|l_156", "center" ...
  function parseG(g) {
    const o = { h: 'l', hv: 0, v: 't', vv: 0 };
    let l = null, r = null, t = null, b = null, right = false, bottom = false, ch = false, cv = false;
    for (const tok of String(g || '').split('|').map(s => s.trim())) {
      let m;
      if ((m = tok.match(/^l_(-?\d+)$/))) l = +m[1];
      else if ((m = tok.match(/^r_(-?\d+)$/))) r = +m[1];
      else if ((m = tok.match(/^t_(-?\d+)$/))) t = +m[1];
      else if ((m = tok.match(/^b_(-?\d+)$/))) b = +m[1];
      else if (tok === 'right') right = true;
      else if (tok === 'bottom') bottom = true;
      else if (tok === 'center_horizontal') ch = true;
      else if (tok === 'center_vertical') cv = true;
      else if (tok === 'center') { ch = true; cv = true; }
    }
    if (ch) { o.h = 'c'; o.hv = (l || 0) - (r || 0); } else if (right || (r != null && l == null)) { o.h = 'r'; o.hv = r || 0; } else o.hv = l || 0;
    if (cv) { o.v = 'c'; o.vv = (t || 0) - (b || 0); } else if (bottom || (b != null && t == null)) { o.v = 'b'; o.vv = b || 0; } else o.vv = t || 0;
    return o;
  }
  const dim = (v, parent) => (v === -1 ? parent : v === -2 || v == null ? Math.min(100, parent) : v);
  function place(item, PW, PH) {
    const w = dim(item.width, PW), h = dim(item.height, PH), g = parseG(item.gravity);
    const x = g.h === 'l' ? g.hv : g.h === 'r' ? PW - w - g.hv : (PW - w) / 2 + g.hv;
    const y = g.v === 't' ? g.vv : g.v === 'b' ? PH - h - g.vv : (PH - h) / 2 + g.vv;
    return { x: Math.round(x), y: Math.round(y), w, h, g };
  }
  function writeG(item, x, y, w, h, PW, PH) {
    // Keep the original anchor side (left/right/center, top/bottom/center) so other screens behave the same.
    const g = parseG(item.gravity);
    let hs, vs;
    if (g.h === 'r') hs = 'right|r_' + Math.round(PW - w - x);
    else if (g.h === 'c' && Math.round(x - (PW - w) / 2) === 0) hs = 'center_horizontal';
    else hs = 'l_' + Math.round(x);
    if (g.v === 'b') vs = 'bottom|b_' + Math.round(PH - h - y);
    else if (g.v === 'c' && Math.round(y - (PH - h) / 2) === 0) vs = 'center_vertical';
    else vs = 't_' + Math.round(y);
    item.gravity = hs + '|' + vs;
  }

  // ------------------------------------------------------------------ load
  async function init(force) {
    if (loadedOnce && !force) return;
    images = await api('/api/images');
    buildIndex();
    const jsons = await api('/api/jsons');
    layouts = jsons.map(p => p.match(/^assets\/(?:(layout-(\d+)x(\d+))\/)?hotseat_config\.json$/)).filter(Boolean).map(m => ({
      key: m[1] || 'default', dir: m[1] ? 'assets/' + m[1] + '/' : 'assets/', W: m[1] ? +m[2] : 1024, H: m[1] ? +m[3] : 600
    }));
    layouts.sort((a, b) => b.W * b.H - a.W * a.H);
    try { meta = await api('/api/designer'); } catch (e) { meta = {}; }
    meta.opacity = meta.opacity || {}; meta.applied = meta.applied || {}; meta.orig = meta.orig || {}; meta.preview = meta.preview || {};
    $('dLayout').innerHTML = layouts.map(l => `<option value="${l.key}">${l.W} × ${l.H}${l.key === 'default' ? ' (default)' : ''}</option>`).join('');
    const bgNames = Object.keys(idx).sort();
    $('dBgList').innerHTML = bgNames.map(n => `<option value="${esc(n)}">`).join('');
    $('designer').style.display = layouts.length ? '' : 'none';
    loadedOnce = true;
    if (layouts.length) await loadLayout(layouts[0].key);
  }

  async function loadLayout(key) {
    const lay = layouts.find(l => l.key === key);
    const hotseat = await getJson(lay.dir + 'hotseat_config.json');
    const theme = await getJson(lay.dir + 'theme_config.json');
    L = { ...lay, hotseat, theme, ids: hotseat.config.map((_, i) => i), viewCfgs: {}, lego: {}, dirtyFiles: new Set(), page: 0 };
    // view configs used by app slots (icon size, label size)
    for (const it of hotseat.config) {
      if (it.view_config_path && it.soft_type === 'app' && !L.viewCfgs[it.view_config_path]) L.viewCfgs[it.view_config_path] = await getJson(lay.dir + it.view_config_path);
      if (it.soft_type === 'lego' && it.config_file_path) L.lego[it.config_file_path] = await getJson(lay.dir + it.config_file_path);
    }
    const pages = (theme && theme.config) || [];
    $('dPage').innerHTML = pages.map((p, i) => `<option value="${i}">Page ${i + 1}: ${(p.page_config || []).map(c => TYPE_LABEL[c.soft_type] || c.soft_type).filter((v, j, a) => a.indexOf(v) === j).join(', ')}</option>`).join('');
    $('dLayout').value = key;
    sel = null; dirty = false;
    render(); renderProps();
  }

  // Which hotseat indices live inside a lego (quick apps panel)?
  function legoOwner(i) {
    for (const [j, it] of L.hotseat.config.entries()) {
      if (it.soft_type !== 'lego') continue;
      const lc = L.lego[it.config_file_path];
      if (lc && (lc.include_widget_indices || []).includes(i)) return j;
    }
    return -1;
  }

  // ------------------------------------------------------------------ render
  function previewApp(i) {
    const p = (meta.preview[L.key] = meta.preview[L.key] || {});
    if (p[i] && idx[p[i]]) return p[i];
    const apps = L.hotseat.config.map((c, k) => k).filter(k => L.hotseat.config[k].soft_type === 'app');
    const n = apps.indexOf(i);
    const avail = COMMON_APPS.filter(a => idx[a]).concat(Object.keys(idx).filter(a => /^app_/.test(a) && !COMMON_APPS.includes(a)));
    return avail[n % avail.length] || null;
  }

  function elHtml(list, i, item, box, extraClass) {
    const bg = item.background ? imgUrl(item.background) : null;
    const isSel = sel && sel.list === list && sel.i === i;
    let inner = '';
    if (item.soft_type === 'app') {
      const vc = L.viewCfgs[item.view_config_path] || { attributes: [] };
      const icon = (vc.attributes || []).find(a => a.id_name === 'iv_app_icon') || { width: 40, height: 40, gravity: 'center' };
      const label = (vc.attributes || []).find(a => a.id_name === 'tv_item');
      const app = previewApp(i);
      const ip = place(icon, box.w, box.h);
      if (app) inner += `<img class="d-icon" src="${imgUrl(app)}" style="left:${ip.x}px;top:${ip.y}px;width:${ip.w}px;height:${ip.h}px">`;
      if (label && label.visibility !== false && label.text_size > 0) {
        const g = parseG(label.gravity);
        const pos = g.v === 'b' ? `bottom:${g.vv}px` : g.v === 'c' ? 'top:50%;transform:translateY(-50%)' : `top:${g.vv}px`;
        inner += `<div class="d-label" style="${pos};font-size:${label.text_size}px">${esc((app || 'app').replace(/^app_/, ''))}</div>`;
      }
    } else if (PLACEHOLDER[item.soft_type] != null && box.w > 40 && !(item.soft_type === 'speed_text' && box.w > 400)) {
      inner += `<div class="d-ph">${PLACEHOLDER[item.soft_type]}</div>`;
    }
    return `<div class="d-el ${extraClass || ''} ${isSel ? 'sel' : ''}" data-list="${list}" data-i="${i}"
      style="left:${box.x}px;top:${box.y}px;width:${box.w}px;height:${box.h}px">
      ${bg ? `<div class="d-bg" style="background-image:url('${bg}');opacity:${opacityOf(item.background)}"></div>` : ''}
      ${inner}
      <span class="d-tag">${esc(TYPE_LABEL[item.soft_type] || item.soft_type)}${list === 'h' ? ' #' + i : ''}</span>
      ${isSel ? '<div class="d-handle"></div>' : ''}</div>`;
  }

  function render() {
    if (!L) return;
    const screen = $('dScreen');
    const theme = L.theme || {};
    const page = (theme.config || [])[+$('dPage').value || 0] || {};
    const pageBg = page.page_bg || theme.background;
    const bgUrl = pageBg ? imgUrl(pageBg) : null;
    let html = `<div class="d-pagebg" style="${bgUrl ? `background-image:url('${bgUrl}');` : ''}opacity:${pageBg ? opacityOf(pageBg) : 1}"></div>`;
    (page.page_config || []).forEach((it, i) => { html += elHtml('p', i, it, place(it, L.W, L.H)); });
    const inLego = new Set();
    L.hotseat.config.forEach((it, i) => {
      if (it.soft_type === 'lego') { const lc = L.lego[it.config_file_path]; (lc && lc.include_widget_indices || []).forEach(k => inLego.add(k)); }
    });
    L.hotseat.config.forEach((it, i) => {
      if (inLego.has(i)) return;
      const box = place(it, L.W, L.H);
      let html2 = elHtml('h', i, it, box);
      if (it.soft_type === 'lego') {
        const lc = L.lego[it.config_file_path];
        const kids = (lc && lc.include_widget_indices || []).filter(k => L.hotseat.config[k]).map(k => elHtml('h', k, L.hotseat.config[k], place(L.hotseat.config[k], box.w, box.h), 'child')).join('');
        html2 = html2.replace(/<\/div>$/, kids + '</div>');
      }
      html += html2;
    });
    screen.innerHTML = html;
    screen.style.width = L.W + 'px'; screen.style.height = L.H + 'px';
    screen.classList.toggle('labels', $('dLabels').checked);
    fit();
    $('dSave').classList.toggle('primary', dirty);
    $('dSave').textContent = dirty ? 'Save design *' : 'Save design';
  }

  function fit() {
    if (!L) return;
    const stage = $('dStage');
    const full = document.body.classList.contains('d-full');
    const availW = full ? innerWidth - 20 : stage.clientWidth;
    const availH = full ? innerHeight - 70 : Infinity;
    const s = Math.min(availW / L.W, availH / L.H, 2);
    L.scale = s;
    $('dScreen').style.transform = `scale(${s})`;
    stage.style.height = (L.H * s) + 'px';
    $('dZoom').textContent = Math.round(s * 100) + '%';
  }

  // ------------------------------------------------------------------ properties panel
  const itemOf = s => s.list === 'h' ? L.hotseat.config[s.i] : ((L.theme.config[+$('dPage').value || 0] || {}).page_config || [])[s.i];
  function parentDims(s) {
    if (s.list === 'h') { const o = legoOwner(s.i); if (o >= 0) { const b = place(L.hotseat.config[o], L.W, L.H); return [b.w, b.h]; } }
    return [L.W, L.H];
  }

  function renderProps() {
    const P = $('dProps');
    if (!L) { P.innerHTML = ''; return; }
    const theme = L.theme || {};
    const page = (theme.config || [])[+$('dPage').value || 0] || {};
    if (!sel) {
      const pb = page.page_bg || theme.background || '';
      P.innerHTML = `<h3>Screen</h3>
        <p class="muted">Click any box on the preview to edit it. Drag to move, drag the corner to resize, arrow keys nudge (Shift = 10px).</p>
        <label>Wallpaper image<input list="dBgList" id="pBg" value="${esc(pb)}" data-target="${page.page_bg ? 'page' : 'theme'}"></label>
        ${opacityRow(pb)}
        <p class="muted">App slots on this screen: <b>${L.hotseat.config.filter(c => c.soft_type === 'app').length}</b></p>`;
      bindCommon(); return;
    }
    const it = itemOf(sel);
    if (!it) { sel = null; renderProps(); return; }
    const [PW, PH] = parentDims(sel);
    const b = place(it, PW, PH);
    let html = `<h3>${esc(TYPE_LABEL[it.soft_type] || it.soft_type)} ${sel.list === 'h' ? '#' + sel.i : ''}</h3>
      <div class="pgrid">
        <label>X<input type="number" id="pX" value="${b.x}"></label>
        <label>Y<input type="number" id="pY" value="${b.y}"></label>
        <label>Width<input type="number" id="pW" value="${b.w}" min="1"></label>
        <label>Height<input type="number" id="pH" value="${b.h}" min="1"></label>
      </div>
      <p class="muted small">Anchor: ${esc(it.gravity)}</p>
      <label>Background image<input list="dBgList" id="pBg" value="${esc(it.background || '')}" placeholder="none"></label>
      ${opacityRow(it.background)}`;
    if (it.soft_type === 'app') {
      const vc = L.viewCfgs[it.view_config_path] || { attributes: [] };
      const icon = (vc.attributes || []).find(a => a.id_name === 'iv_app_icon');
      const label = (vc.attributes || []).find(a => a.id_name === 'tv_item');
      const shared = L.hotseat.config.filter(c => c.view_config_path === it.view_config_path).length;
      const app = previewApp(sel.i);
      const appNames = Object.keys(idx).filter(n => /^app_/.test(n)).sort();
      html += `<label class="chk"><input type="checkbox" id="pEditable" ${it.editable ? 'checked' : ''}> Driver can choose the app (long-press on the car)</label>
        <label>Preview app (only for this preview)<select id="pApp">${appNames.map(n => `<option ${n === app ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
        <h4>Icon and label <span class="muted small">shared by ${shared} slot${shared > 1 ? 's' : ''}</span></h4>
        <div class="pgrid">
          ${icon ? `<label>Icon size<input type="number" id="pIcon" value="${icon.width}" min="8"></label>` : ''}
          ${label ? `<label>Label size<input type="number" id="pTxt" value="${label.text_size || 0}" min="0"></label>` : ''}
        </div>
        ${label ? `<label class="chk"><input type="checkbox" id="pShowTxt" ${label.visibility !== false && label.text_size > 0 ? 'checked' : ''}> Show app name</label>` : ''}
        <div class="row" style="margin-top:10px"><button id="pDup">Duplicate slot</button><button id="pDel" class="danger">Delete slot</button></div>`;
    }
    P.innerHTML = html;
    bindCommon();
    const num = id => { const v = parseInt($(id).value, 10); return isNaN(v) ? 0 : v; };
    for (const id of ['pX', 'pY', 'pW', 'pH']) $(id).onchange = () => {
      const w = Math.max(1, num('pW')), h = Math.max(1, num('pH'));
      it.width = w; it.height = h;
      writeG(it, num('pX'), num('pY'), w, h, PW, PH);
      markDirty(); render(); renderProps();
    };
    if (it.soft_type === 'app') {
      $('pEditable').onchange = e => { it.editable = e.target.checked; markDirty(); };
      $('pApp').onchange = e => { meta.preview[L.key] = meta.preview[L.key] || {}; meta.preview[L.key][sel.i] = e.target.value; saveMeta(); render(); };
      const vc = L.viewCfgs[it.view_config_path];
      const icon = vc && vc.attributes.find(a => a.id_name === 'iv_app_icon');
      const label = vc && vc.attributes.find(a => a.id_name === 'tv_item');
      if ($('pIcon')) $('pIcon').onchange = e => { const v = Math.max(8, +e.target.value || 8); icon.width = v; icon.height = v; L.dirtyFiles.add('vc:' + it.view_config_path); markDirty(); render(); };
      if ($('pTxt')) $('pTxt').onchange = e => { label.text_size = Math.max(0, +e.target.value || 0); if (label.text_size > 0) label.visibility = true; L.dirtyFiles.add('vc:' + it.view_config_path); markDirty(); render(); renderProps(); };
      if ($('pShowTxt')) $('pShowTxt').onchange = e => {
        label.visibility = e.target.checked;
        if (e.target.checked && !(label.text_size > 0)) label.text_size = 16;
        L.dirtyFiles.add('vc:' + it.view_config_path); markDirty(); render(); renderProps();
      };
      $('pDup').onclick = () => duplicate(sel.i);
      $('pDel').onclick = () => removeSlot(sel.i);
    }
  }

  function opacityRow(name) {
    if (!name || !idx[name]) return '';
    const nine = idx[name].every(is9);
    if (nine) return `<p class="muted small">"${esc(name)}" is a 9-patch image; transparency can't be changed safely.</p>`;
    const v = Math.round(opacityOf(name) * 100);
    return `<label>Transparency of "${esc(name)}": <b id="pOpV">${100 - v}%</b>
      <input type="range" id="pOp" min="0" max="100" value="${100 - v}"></label>
      <p class="muted small">0% = solid, 100% = invisible. Applies everywhere this image is used${idx[name].length > 1 ? ` (${idx[name].length} files incl. night)` : ''}.</p>`;
  }

  function bindCommon() {
    const bg = $('pBg');
    if (bg) bg.onchange = () => {
      const v = bg.value.trim();
      if (v && !idx[v]) { alert('No image named "' + v + '"'); return; }
      if (!sel) {
        const page = L.theme.config[+$('dPage').value || 0];
        if (bg.dataset.target === 'page') page.page_bg = v; else L.theme.background = v;
        L.dirtyFiles.add('theme');
      } else itemOf(sel).background = v;
      markDirty(); render(); renderProps();
    };
    const op = $('pOp');
    if (op) op.oninput = () => {
      const name = sel ? itemOf(sel).background : (bg && bg.value.trim());
      meta.opacity[name] = Math.round(100 - op.value) / 100;
      $('pOpV').textContent = op.value + '%';
      markDirty(); render();
    };
  }

  function markDirty() { dirty = true; $('dSave').classList.add('primary'); $('dSave').textContent = 'Save design *'; }

  // ------------------------------------------------------------------ slot add / remove
  function legoOf(i) { const o = legoOwner(i); return o >= 0 ? L.lego[L.hotseat.config[o].config_file_path] : null; }

  function duplicate(i) {
    const src = L.hotseat.config[i];
    const copy = JSON.parse(JSON.stringify(src));
    const [PW, PH] = parentDims({ list: 'h', i });
    const b = place(src, PW, PH);
    copy.gravity = '';
    writeG(copy, Math.min(PW - b.w, b.x + 20), Math.min(PH - b.h, b.y + 20), b.w, b.h, PW, PH);
    L.hotseat.config.push(copy);
    L.ids.push(null);
    const lc = legoOf(i);
    const ni = L.hotseat.config.length - 1;
    if (lc) { lc.include_widget_indices.push(ni); L.dirtyFiles.add('lego'); }
    sel = { list: 'h', i: ni };
    markDirty(); render(); renderProps();
  }

  function addApp() {
    const tpl = L.hotseat.config.find(c => c.soft_type === 'app');
    const it = tpl ? JSON.parse(JSON.stringify(tpl)) : { soft_type: 'app', width: 90, height: 80, use_app_widget: true, editable: true, background: '' };
    it.gravity = 'l_' + Math.round(L.W / 2 - 45) + '|t_' + Math.round(L.H / 2 - 40);
    L.hotseat.config.push(it); L.ids.push(null);
    sel = { list: 'h', i: L.hotseat.config.length - 1 };
    markDirty(); render(); renderProps();
  }

  function removeSlot(i) {
    if (!confirm('Delete app slot #' + i + '?')) return;
    L.hotseat.config.splice(i, 1);
    L.ids.splice(i, 1);
    for (const lc of Object.values(L.lego)) {
      if (!lc || !lc.include_widget_indices) continue;
      lc.include_widget_indices = lc.include_widget_indices.filter(k => k !== i).map(k => k > i ? k - 1 : k);
    }
    // keep preview choices aligned with the new indices
    const pv = meta.preview[L.key] || {}, np = {};
    for (const [k, v] of Object.entries(pv)) { const n = +k; if (n < i) np[n] = v; else if (n > i) np[n - 1] = v; }
    meta.preview[L.key] = np;
    L.dirtyFiles.add('lego');
    sel = null; markDirty(); render(); renderProps();
  }

  // ------------------------------------------------------------------ mouse / keyboard
  let drag = null;
  function onDown(e) {
    const el = e.target.closest('.d-el');
    if (!el) { if (e.target.closest('#dScreen')) { sel = null; render(); renderProps(); } return; }
    e.preventDefault(); e.stopPropagation();
    const s = { list: el.dataset.list, i: +el.dataset.i };
    const changed = !sel || sel.list !== s.list || sel.i !== s.i;
    sel = s;
    const it = itemOf(s);
    const [PW, PH] = parentDims(s);
    const b = place(it, PW, PH);
    drag = { it, PW, PH, b, sx: e.clientX, sy: e.clientY, resize: e.target.classList.contains('d-handle'), moved: false };
    if (changed) { render(); renderProps(); }
  }
  function onMove(e) {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / L.scale, dy = (e.clientY - drag.sy) / L.scale;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 2) return;
    drag.moved = true;
    const { it, b, PW, PH } = drag;
    if (drag.resize) {
      const w = Math.max(4, Math.round(b.w + dx)), h = Math.max(4, Math.round(b.h + dy));
      it.width = w; it.height = h; writeG(it, b.x, b.y, w, h, PW, PH);
    } else {
      writeG(it, Math.round(b.x + dx), Math.round(b.y + dy), b.w, b.h, PW, PH);
      it.width = b.w; it.height = b.h;
    }
    dirty = true; render();
  }
  function onUp() { if (drag && drag.moved) { markDirty(); renderProps(); } drag = null; }
  function onKey(e) {
    if (!sel || !L || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const step = e.shiftKey ? 10 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) {
      e.preventDefault();
      const it = itemOf(sel), [PW, PH] = parentDims(sel), b = place(it, PW, PH);
      it.width = b.w; it.height = b.h;
      writeG(it, b.x + d[0], b.y + d[1], b.w, b.h, PW, PH);
      markDirty(); render(); renderProps();
    } else if ((e.key === 'Delete') && sel.list === 'h' && itemOf(sel).soft_type === 'app') removeSlot(sel.i);
    else if (e.key === 'Escape') { if (document.body.classList.contains('d-full')) toggleFull(); else { sel = null; render(); renderProps(); } }
  }

  function toggleFull() { document.body.classList.toggle('d-full'); $('dFull').textContent = document.body.classList.contains('d-full') ? 'Exit full screen' : 'Full screen preview'; fit(); }

  // ------------------------------------------------------------------ save
  async function saveMeta() { await api('/api/designer', { method: 'POST', body: JSON.stringify(meta) }); }

  async function bakeOpacity(log) {
    for (const [name, op] of Object.entries(meta.opacity)) {
      if ((meta.applied[name] != null ? meta.applied[name] : 1) === op) continue;
      for (const p of (idx[name] || [])) {
        if (is9(p)) continue;
        const orig = meta.orig[p] || p;
        const blob = await (await fetch('/api/original?path=' + encodeURIComponent(orig) + '&t=' + Date.now())).blob();
        let target, body;
        if (op >= 1) { target = orig; body = blob; }
        else {
          const bmp = await createImageBitmap(blob);
          const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
          const g = c.getContext('2d'); g.globalAlpha = op; g.drawImage(bmp, 0, 0);
          body = await new Promise(r => c.toBlob(r, 'image/png'));
          target = orig.replace(/\.(jpe?g|webp|png)$/i, '.png');
        }
        let url = '/api/file?path=' + encodeURIComponent(target);
        if (target !== p) url += '&replace=' + encodeURIComponent(p);
        await api(url, { method: 'POST', body });
        delete meta.orig[p];
        if (target !== orig) meta.orig[target] = orig;
      }
      meta.applied[name] = op;
      log.push(`Transparency ${Math.round((1 - op) * 100)}% -> ${name}`);
    }
  }

  async function save() {
    if (!L) return;
    const log = [];
    const btn = $('dSave'); btn.disabled = true; btn.textContent = 'Saving...';
    try {
      await api('/api/file?path=' + encodeURIComponent(L.dir + 'hotseat_config.json'), { method: 'POST', body: JSON.stringify(L.hotseat, null, 2) });
      log.push('Saved ' + L.dir + 'hotseat_config.json');
      if (L.theme) { await api('/api/file?path=' + encodeURIComponent(L.dir + 'theme_config.json'), { method: 'POST', body: JSON.stringify(L.theme, null, 2) }); log.push('Saved theme_config.json'); }
      for (const [p, vc] of Object.entries(L.viewCfgs)) if (vc && L.dirtyFiles.has('vc:' + p)) { await api('/api/file?path=' + encodeURIComponent(L.dir + p), { method: 'POST', body: JSON.stringify(vc, null, 2) }); log.push('Saved ' + p); }
      for (const [p, lc] of Object.entries(L.lego)) if (lc) await api('/api/file?path=' + encodeURIComponent(L.dir + p), { method: 'POST', body: JSON.stringify(lc, null, 2) });
      // keep the plugin summary (.gen/c.json) app count in step
      const cj = await getJson('assets/.gen/c.json');
      if (cj && cj.layouts) {
        const res = L.W + 'x' + L.H;
        const lay = cj.layouts.find(l => l.resolution === res);
        const ent = lay && lay.hotseat_config_plugins && (lay.hotseat_config_plugins.json || []).find(j => j.type === 'app');
        const n = L.hotseat.config.filter(c => c.soft_type === 'app').length;
        if (ent && ent.count !== n) { ent.count = n; await api('/api/file?path=' + encodeURIComponent('assets/.gen/c.json'), { method: 'POST', body: JSON.stringify(cj) }); log.push(`App slot count for ${res}: ${n}`); }
      }
      await bakeOpacity(log);
      await saveMeta();
      images = await api('/api/images'); buildIndex();
      ver = Date.now(); dirty = false; L.dirtyFiles.clear(); L.ids = L.hotseat.config.map((_, i) => i);
      render(); renderProps();
      window.studioLog && window.studioLog(log.join('\n') + '\nDesign saved. Build the APK to test it on the car.');
    } catch (e) {
      window.studioLog && window.studioLog('ERROR saving design: ' + e.message);
    } finally { btn.disabled = false; render(); }
  }

  // ------------------------------------------------------------------ export preview image
  async function exportPng() {
    if (!L) return;
    const c = document.createElement('canvas'); c.width = L.W; c.height = L.H;
    const g = c.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, L.W, L.H);
    const sr = $('dScreen').getBoundingClientRect(), s = L.scale;
    const draw = async (url, x, y, w, h, a) => {
      try { const bmp = await createImageBitmap(await (await fetch(url)).blob()); g.globalAlpha = a; g.drawImage(bmp, x, y, w, h); g.globalAlpha = 1; } catch (e) { }
    };
    for (const el of $('dScreen').querySelectorAll('.d-pagebg, .d-bg, .d-icon')) {
      const r = el.getBoundingClientRect();
      const m = (el.style.backgroundImage || '').match(/url\("?'?(.*?)'?"?\)/);
      const url = el.tagName === 'IMG' ? el.src : m && m[1];
      if (url) await draw(url, (r.left - sr.left) / s, (r.top - sr.top) / s, r.width / s, r.height / s, +(getComputedStyle(el).opacity));
    }
    const a = document.createElement('a');
    a.download = `preview_${L.W}x${L.H}${$('dNight').checked ? '_night' : ''}.png`;
    a.href = c.toDataURL('image/png'); a.click();
  }

  // ------------------------------------------------------------------ wire up
  function wire() {
    $('dLayout').onchange = async e => {
      if (dirty && !confirm('You have unsaved changes on this screen size. Discard them?')) { e.target.value = L.key; return; }
      await loadLayout(e.target.value);
    };
    $('dPage').onchange = () => { if (sel && sel.list === 'p') sel = null; render(); renderProps(); };
    $('dNight').onchange = () => render();
    $('dLabels').onchange = () => render();
    $('dAddApp').onclick = addApp;
    $('dFull').onclick = toggleFull;
    $('dSave').onclick = save;
    $('dExport').onclick = exportPng;
    $('dScreen').addEventListener('mousedown', onDown);
    $('dStage').addEventListener('mousedown', e => { if (e.target.id === 'dStage') { sel = null; render(); renderProps(); } });
    addEventListener('mousemove', onMove);
    addEventListener('mouseup', onUp);
    addEventListener('keydown', onKey);
    addEventListener('resize', fit);
    addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  }

  window.Designer = { init, isDirty: () => dirty };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();

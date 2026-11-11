/* Car Theme Studio Web - page logic (open, identity, images, JSON, export, signing key). */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const td = new TextDecoder(), te = new TextEncoder();
  const PREFIX = 'launcher.variety.theme.plugin.';
  const KEY_STORE = 'carThemeStudio.signingKey';
  const BE = window.StudioBackend;
  let orig = null;     // identity read from the opened APK
  let images = [];
  let replaceTarget = null;

  function log(msg) { $('log').textContent = msg; }
  window.studioLog = log;

  function chip(text, ok) { return `<span class="chip ${ok ? 'ok' : 'bad'}">${text}</span>`; }
  function chips() {
    $('chips').innerHTML = chip('Theme loaded', !!orig) + chip('Signing key', !!loadKey());
  }

  async function busy(fn) {
    const all = document.querySelectorAll('button');
    all.forEach(b => b.disabled = true);
    try { await fn(); } catch (e) { console.error(e); log('ERROR: ' + e.message); alert(e.message); }
    finally { all.forEach(b => b.disabled = false); }
  }

  // ------------------------------------------------------------------ signing key (kept in this browser)
  function loadKey() { try { return JSON.parse(localStorage.getItem(KEY_STORE) || 'null'); } catch (e) { return null; } }
  function saveKey(k) { try { localStorage.setItem(KEY_STORE, JSON.stringify(k)); } catch (e) { /* private mode */ } showKey(); }
  function showKey() {
    const k = loadKey();
    if (!k) { $('keyInfo').textContent = 'none yet - one is created on first export'; chips(); return; }
    try {
      const i = ApkEngine.certInfo(k.cert);
      $('keyInfo').textContent = `${i.subject} · SHA-256 ${i.sha256.slice(0, 23)}… · valid to ${i.notAfter.getFullYear()}`;
    } catch (e) { $('keyInfo').textContent = 'stored key is unreadable'; }
    chips();
  }
  async function ensureKey() {
    let k = loadKey();
    if (!k) { log('Creating a signing key (a few seconds, only once)...'); k = await ApkEngine.generateKey('Car Theme Studio'); saveKey(k); }
    return k;
  }
  function download(name, data, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: type || 'application/octet-stream' }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }

  // ------------------------------------------------------------------ open
  async function openApk(file) {
    log('Reading ' + file.name + ' ...');
    const files = ApkEngine.readZip(new Uint8Array(await file.arrayBuffer()));
    if (!files.has('AndroidManifest.xml') || !files.has('resources.arsc')) throw new Error('This is not an APK file.');
    const man = ApkEngine.readManifest(files.get('AndroidManifest.xml')).info;
    const arsc = ApkEngine.readThemeName(files.get('resources.arsc'));
    let cfg = {};
    if (files.has('assets/import_theme_info_config.json')) {
      try { cfg = JSON.parse(td.decode(files.get('assets/import_theme_info_config.json')).replace(/^﻿/, '')); } catch (e) { cfg = {}; }
    }
    if (!man.pluginId) throw new Error('This APK is not a variety theme plugin (no launcher.variety.theme.plugin meta-data).');
    orig = {
      package: man.package, pluginId: man.pluginId, versionCode: man.versionCode, versionName: man.versionName,
      themeName: arsc && arsc.themeName, themeId: cfg.themeId || '', oemId: cfg.oemId || ''
    };
    BE.open(file.name, files);
    $('suffix').value = man.package.startsWith(PREFIX) ? man.package.slice(PREFIX.length) : man.pluginId;
    $('themeName').value = orig.themeName || '';
    $('themeId').value = orig.themeId;
    $('versionCode').value = orig.versionCode || 1;
    $('versionName').value = orig.versionName || '1.0';
    $('oemId').value = orig.oemId;
    $('pkgLine').textContent = `Opened: ${orig.package} · ${orig.themeName || ''} · version ${orig.versionCode} (${orig.versionName})`;
    for (const id of ['identity', 'imagesSec', 'jsonSec', 'buildSec']) $(id).style.display = '';
    await loadImages();
    await loadJsonList();
    await Designer.init(true);
    chips();
    log(`Opened ${file.name}: ${files.size} files, ${images.length} images.\nTip: change the ID name before exporting so it installs next to the original.`);
  }

  // ------------------------------------------------------------------ images
  async function loadImages() {
    images = await (await BE.fetch('/api/images')).json();
    renderGallery();
  }
  function renderGallery() {
    const f = $('filter').value.trim().toLowerCase();
    const list = images.filter(x => !f || x.path.toLowerCase().includes(f));
    $('imgCount').textContent = `${list.length} of ${images.length} images`;
    $('gallery').innerHTML = list.slice(0, 400).map(x => `
      <div class="tile" data-path="${x.path}" title="${x.path}">
        <div class="img"><img loading="lazy" src="${BE.url(x.path)}"
          onload="this.closest('.tile').title += ' (' + this.naturalWidth + 'x' + this.naturalHeight + ')'"></div>
        <div class="name">${x.path.replace(/^res\//, '')}</div>
      </div>`).join('');
  }

  // ------------------------------------------------------------------ JSON
  async function loadJsonList() {
    const list = await (await BE.fetch('/api/jsons')).json();
    const cur = $('jsonSel').value;
    $('jsonSel').innerHTML = list.map(p => `<option>${p}</option>`).join('');
    if (cur && list.includes(cur)) $('jsonSel').value = cur;
    await loadJson();
  }
  async function loadJson() {
    const p = $('jsonSel').value;
    if (!p) return;
    $('jsonText').value = await (await BE.fetch('/api/file?path=' + encodeURIComponent(p))).text();
  }

  // ------------------------------------------------------------------ export
  async function exportApk() {
    if (!orig) throw new Error('Open a theme APK first.');
    if (Designer.isDirty() && !confirm('The layout designer has unsaved changes. Export without them?')) return;
    const suffix = $('suffix').value.trim();
    if (!/^[a-z][a-z0-9_]{1,40}$/.test(suffix)) throw new Error('ID name must be lowercase letters, digits or _ and start with a letter.');
    const themeId = $('themeId').value.trim();
    if (themeId && !/^\d{6,20}$/.test(themeId)) throw new Error('Theme number must be digits only.');
    const versionCode = parseInt($('versionCode').value, 10);
    if (!(versionCode > 0)) throw new Error('Version code must be a positive number.');
    const versionName = $('versionName').value.trim() || String(versionCode);
    const themeName = $('themeName').value.trim() || suffix;
    const pkg = PREFIX + suffix;
    if (pkg === orig.package && !confirm('The ID name is the same as the original theme, so installing will replace it (and needs the same signing key). Continue?')) return;

    const key = await ensureKey();
    log('Building...');
    const files = new Map(BE.state.files);
    files.set('AndroidManifest.xml', ApkEngine.editManifest(files.get('AndroidManifest.xml'), {
      package: pkg, pluginId: suffix, versionCode, versionName, minSdk: 21
    }));
    files.set('resources.arsc', ApkEngine.editArsc(files.get('resources.arsc'), { package: pkg, themeName }));
    const cfgPath = 'assets/import_theme_info_config.json';
    if (files.has(cfgPath) && themeId) {
      const text = td.decode(files.get(cfgPath)).replace(/("themeId"\s*:\s*")[^"]*(")/, `$1${themeId}$2`);
      files.set(cfgPath, te.encode(text));
    }
    log('Signing...');
    const signed = await ApkEngine.signV1(files, key);
    log('Packing...');
    const out = ApkEngine.writeZip(signed);
    const name = `${suffix}_v${versionCode}.apk`;
    download(name, out, 'application/vnd.android.package-archive');
    const check = ApkEngine.readManifest(signed.get('AndroidManifest.xml')).info;
    log(`Exported ${name} (${(out.length / 1048576).toFixed(1)} MB)\nPackage: ${check.package}\nName: ${themeName}\nVersion: ${check.versionCode} (${check.versionName})\n`
      + `Changed files: ${BE.state.changed.size}\n\nInstall it on the head unit together with Car Launcher.`);
    $('versionCode').value = versionCode + 1; // next export is an update
  }

  // ------------------------------------------------------------------ events
  const drop = $('drop');
  drop.onclick = () => $('apkFile').click();
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) busy(() => openApk(e.dataTransfer.files[0])); };
  $('apkFile').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) busy(() => openApk(f)); };

  $('filter').oninput = renderGallery;
  $('gallery').onclick = e => { const t = e.target.closest('.tile'); if (!t) return; replaceTarget = t.dataset.path; $('imgFile').click(); };
  $('imgFile').onchange = e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f || !replaceTarget) return;
    busy(async () => {
      // Convert to PNG in the browser so any image type works (Android reads PNG data in any image entry).
      let body = f;
      const want = replaceTarget.split('.').pop().toLowerCase();
      if (!(f.type === 'image/png' || (/jpe?g/.test(want) && f.type === 'image/jpeg'))) {
        const bmp = await createImageBitmap(f);
        const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        body = await new Promise(r => c.toBlob(r, 'image/png'));
      }
      const r = await BE.fetch('/api/file?path=' + encodeURIComponent(replaceTarget), { method: 'POST', body });
      if (!r.ok) throw new Error((await r.json()).error);
      log('Replaced ' + replaceTarget);
      await loadImages();
      await Designer.init(true);
    });
  };

  $('jsonSel').onchange = () => loadJson();
  $('btnSaveJson').onclick = () => busy(async () => {
    try { JSON.parse($('jsonText').value); } catch (err) { throw new Error('Invalid JSON: ' + err.message); }
    const r = await BE.fetch('/api/file?path=' + encodeURIComponent($('jsonSel').value), { method: 'POST', body: $('jsonText').value });
    if (!r.ok) throw new Error((await r.json()).error);
    log('Saved ' + $('jsonSel').value);
    await Designer.init(true);
  });

  $('btnBuild').onclick = () => busy(exportApk);
  $('btnKeyExport').onclick = () => {
    const k = loadKey();
    if (!k) { alert('No key yet. Export a theme first, or restore a key.'); return; }
    download('car-theme-signing-key.json', JSON.stringify({ type: 'car-theme-studio-key', version: 1, key: k.key, cert: k.cert }, null, 2), 'application/json');
  };
  $('btnKeyImport').onclick = () => $('keyFile').click();
  $('keyFile').onchange = e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    busy(async () => {
      const k = JSON.parse(await f.text());
      if (!k.key || !k.cert) throw new Error('Not a Car Theme Studio key file.');
      ApkEngine.certInfo(k.cert);
      forge.pki.privateKeyFromPem(k.key);
      saveKey({ key: k.key, cert: k.cert });
      log('Signing key restored.');
    });
  };
  $('btnKeyNew').onclick = () => busy(async () => {
    if (loadKey() && !confirm('Replace the current signing key? Themes signed with the old key can then only be updated after uninstalling them. Back up the old key first.')) return;
    localStorage.removeItem(KEY_STORE);
    await ensureKey();
    log('New signing key created. Back it up.');
  });

  window.addEventListener('beforeunload', e => { if (BE.state.changed.size || Designer.isDirty()) { e.preventDefault(); e.returnValue = ''; } });
  if (location.protocol === 'file:') $('dlLauncher').href = '../windows/launcher/CarLauncher.apk';
  showKey();
  chips();
})();

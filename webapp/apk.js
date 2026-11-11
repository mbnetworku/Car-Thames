/* Car Theme Studio Web - APK engine (runs in the browser, also loadable in Node for tests).
 *
 * - read/write APK zip files (stored entries 4-byte aligned, like zipalign)
 * - edit the binary AndroidManifest.xml and resources.arsc string pools
 *   (package name, plugin id, theme name, version) without apktool
 * - sign with APK Signature Scheme v1 (JAR signing, SHA-256 + RSA)
 *
 * Dependencies: fflate (zip inflate/deflate) and node-forge (RSA, X.509, PKCS#7).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('fflate'), require('node-forge'));
  else root.ApkEngine = factory(root.fflate, root.forge);
})(typeof self !== 'undefined' ? self : this, function (fflate, forge) {
  'use strict';

  const te = new TextEncoder(), td = new TextDecoder();

  // ------------------------------------------------------------------ zip

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  /** @returns {Map<string, Uint8Array>} entry name -> uncompressed bytes (in zip order) */
  function readZip(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const files = fflate.unzipSync(u8);
    // keep the original central-directory order
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('Not a zip/APK file');
    const n = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = new Map();
    for (let i = 0; i < n; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) break;
      const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
      const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
      if (name in files) out.set(name, files[name]);
      p += 46 + nl + el + cl;
    }
    for (const k of Object.keys(files)) if (!out.has(k)) out.set(k, files[k]);
    return out;
  }

  const NO_COMPRESS = /\.(png|jpe?g|gif|webp|wav|mp2|mp3|ogg|aac|mpg|mpeg|mid|midi|smf|jet|rtttl|imy|xmf|mp4|m4a|m4v|3gp|3gpp|3g2|3gpp2|amr|awb|wma|wmv|webm|mkv|arsc|otf|ttf)$/i;

  /** Writes a zip. Stored entries are aligned to 4 bytes (zipalign -p 4 equivalent for resources.arsc and images). */
  function writeZip(entries) {
    const parts = [], central = [];
    let offset = 0;
    const DOS_TIME = 0, DOS_DATE = (1 << 5) | 1; // 1980-01-01, deterministic
    for (const [name, data] of entries) {
      const nameB = te.encode(name);
      const store = NO_COMPRESS.test(name) || data.length === 0;
      let body = data, method = 0;
      if (!store) {
        const d = fflate.deflateSync(data, { level: 9 });
        if (d.length < data.length) { body = d; method = 8; }
      }
      const crc = crc32(data);
      let extraLen = 0;
      if (method === 0) {
        const dataStart = offset + 30 + nameB.length;
        extraLen = (4 - (dataStart % 4)) % 4;
      }
      const lh = new Uint8Array(30 + nameB.length + extraLen);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, method, true);
      lv.setUint16(10, DOS_TIME, true); lv.setUint16(12, DOS_DATE, true); lv.setUint32(14, crc, true);
      lv.setUint32(18, body.length, true); lv.setUint32(22, data.length, true);
      lv.setUint16(26, nameB.length, true); lv.setUint16(28, extraLen, true);
      lh.set(nameB, 30);
      parts.push(lh, body);
      const ch = new Uint8Array(46 + nameB.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, method, true); cv.setUint16(12, DOS_TIME, true); cv.setUint16(14, DOS_DATE, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, body.length, true); cv.setUint32(24, data.length, true);
      cv.setUint16(28, nameB.length, true); cv.setUint32(42, offset, true);
      ch.set(nameB, 46);
      central.push(ch);
      offset += lh.length + body.length;
    }
    const cdStart = offset;
    let cdLen = 0;
    for (const c of central) { parts.push(c); cdLen += c.length; }
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, central.length, true); ev.setUint16(10, central.length, true);
    ev.setUint32(12, cdLen, true); ev.setUint32(16, cdStart, true);
    parts.push(end);
    const total = parts.reduce((s, p) => s + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  // ------------------------------------------------------------------ binary string pools

  const UTF8_FLAG = 1 << 8;

  function readLen8(u8, p) { let l = u8[p]; if (l & 0x80) return [((l & 0x7F) << 8) | u8[p + 1], 2]; return [l, 1]; }
  function readLen16(dv, p) { let l = dv.getUint16(p, true); if (l & 0x8000) return [((l & 0x7FFF) << 16) | dv.getUint16(p + 2, true), 4]; return [l, 2]; }

  /** Parses a ResStringPool chunk at `off`. */
  function parsePool(u8, off) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (dv.getUint16(off, true) !== 0x0001) throw new Error('Not a string pool');
    const headerSize = dv.getUint16(off + 2, true), size = dv.getUint32(off + 4, true);
    const count = dv.getUint32(off + 8, true), styleCount = dv.getUint32(off + 12, true), flags = dv.getUint32(off + 16, true);
    const stringsStart = dv.getUint32(off + 20, true), stylesStart = dv.getUint32(off + 24, true);
    const utf8 = !!(flags & UTF8_FLAG);
    const strings = [];
    for (let i = 0; i < count; i++) {
      let p = off + stringsStart + dv.getUint32(off + headerSize + i * 4, true);
      if (utf8) {
        const [, a] = readLen8(u8, p); p += a;
        const [blen, b] = readLen8(u8, p); p += b;
        strings.push(td.decode(u8.subarray(p, p + blen)));
      } else {
        const [clen, a] = readLen16(dv, p); p += a;
        let s = '';
        for (let k = 0; k < clen; k++) s += String.fromCharCode(dv.getUint16(p + k * 2, true));
        strings.push(s);
      }
    }
    const styleOffsets = [];
    for (let i = 0; i < styleCount; i++) styleOffsets.push(dv.getUint32(off + headerSize + count * 4 + i * 4, true));
    const styles = styleCount ? u8.slice(off + stylesStart, off + size) : new Uint8Array(0);
    return { off, size, headerSize, flags, utf8, strings, styleOffsets, styles };
  }

  function encLen8(n) { return n > 0x7F ? [((n >> 8) & 0x7F) | 0x80, n & 0xFF] : [n]; }
  function encLen16(n) { return n > 0x7FFF ? [((n >> 16) & 0x7FFF) | 0x8000, n & 0xFFFF] : [n]; }

  function buildPool(pool) {
    const data = [];
    const offsets = [];
    let len = 0;
    for (const s of pool.strings) {
      offsets.push(len);
      let bytes;
      if (pool.utf8) {
        const b = te.encode(s);
        bytes = [...encLen8(s.length), ...encLen8(b.length), ...b, 0];
      } else {
        const l = encLen16(s.length);
        bytes = [];
        for (const v of l) bytes.push(v & 0xFF, v >> 8);
        for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); bytes.push(c & 0xFF, c >> 8); }
        bytes.push(0, 0);
      }
      data.push(bytes); len += bytes.length;
    }
    const pad = (4 - (len % 4)) % 4;
    const headerSize = 28;
    const count = pool.strings.length, styleCount = pool.styleOffsets.length;
    const stringsStart = headerSize + count * 4 + styleCount * 4;
    const stylesStart = styleCount ? stringsStart + len + pad : 0;
    const size = stringsStart + len + pad + pool.styles.length;
    const out = new Uint8Array(size);
    const dv = new DataView(out.buffer);
    dv.setUint16(0, 0x0001, true); dv.setUint16(2, headerSize, true); dv.setUint32(4, size, true);
    dv.setUint32(8, count, true); dv.setUint32(12, styleCount, true); dv.setUint32(16, pool.flags, true);
    dv.setUint32(20, stringsStart, true); dv.setUint32(24, stylesStart, true);
    offsets.forEach((o, i) => dv.setUint32(headerSize + i * 4, o, true));
    pool.styleOffsets.forEach((o, i) => dv.setUint32(headerSize + count * 4 + i * 4, o, true));
    let p = stringsStart;
    for (const b of data) { out.set(b, p); p += b.length; }
    if (styleCount) out.set(pool.styles, stylesStart);
    return out;
  }

  /** Replaces the pool at pool.off inside a top-level chunk file (manifest or arsc) and fixes the file size. */
  function replacePool(u8, pool) {
    const nu = buildPool(pool);
    const out = new Uint8Array(u8.length - pool.size + nu.length);
    out.set(u8.subarray(0, pool.off), 0);
    out.set(nu, pool.off);
    out.set(u8.subarray(pool.off + pool.size), pool.off + nu.length);
    new DataView(out.buffer).setUint32(4, out.length, true); // top-level chunk size
    return out;
  }

  // ------------------------------------------------------------------ AndroidManifest.xml (binary XML)

  const ATTR_VERSION_CODE = 0x0101021b, ATTR_VERSION_NAME = 0x0101021c, ATTR_MIN_SDK = 0x0101020c;

  function readManifest(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (dv.getUint16(0, true) !== 0x0003) throw new Error('AndroidManifest.xml is not binary XML');
    const pool = parsePool(u8, dv.getUint16(2, true));
    let resIds = [];
    const info = { package: null, pluginId: null, versionCode: null, versionName: null, metas: {} };
    const attrs = []; // {elem, nameIdx, resId, valueOff (offset of Res_value data), type, rawIdx}
    let p = dv.getUint16(2, true);
    while (p < u8.length) {
      const type = dv.getUint16(p, true), hs = dv.getUint16(p + 2, true), sz = dv.getUint32(p + 4, true);
      if (type === 0x0180) { // resource map
        const n = (sz - hs) / 4; resIds = [];
        for (let i = 0; i < n; i++) resIds.push(dv.getUint32(p + hs + i * 4, true));
      } else if (type === 0x0102) { // start element
        const ext = p + hs;
        const elem = pool.strings[dv.getUint32(ext + 4, true)];
        const attrStart = dv.getUint16(ext + 8, true), attrSize = dv.getUint16(ext + 10, true), attrCount = dv.getUint16(ext + 12, true);
        const el = { name: elem, attrs: {} };
        for (let i = 0; i < attrCount; i++) {
          const a = ext + attrStart + i * attrSize;
          const nameIdx = dv.getUint32(a + 4, true), raw = dv.getInt32(a + 8, true);
          const dtype = dv.getUint8(a + 15), data = dv.getUint32(a + 16, true);
          const aname = pool.strings[nameIdx];
          const rec = { elem, name: aname, resId: resIds[nameIdx] || 0, rawOff: a + 8, dataOff: a + 16, type: dtype, raw, data };
          attrs.push(rec);
          el.attrs[aname] = dtype === 0x03 ? pool.strings[data] : data;
        }
        if (elem === 'manifest') {
          info.package = el.attrs.package;
          for (const r of attrs) if (r.elem === 'manifest') {
            if (r.resId === ATTR_VERSION_CODE) info.versionCode = r.data;
            if (r.resId === ATTR_VERSION_NAME) info.versionName = r.type === 0x03 ? pool.strings[r.data] : null;
          }
        }
        if (elem === 'meta-data' && el.attrs.name != null) info.metas[el.attrs.name] = el.attrs.value;
        if (elem === 'uses-sdk') for (const r of attrs) if (r.elem === 'uses-sdk' && r.resId === ATTR_MIN_SDK && r.type !== 0x03) info.minSdk = r.data;
      }
      p += sz;
      if (!sz) break;
    }
    info.pluginId = info.metas['launcher.variety.theme.plugin'] || null;
    return { info, pool, attrs };
  }

  /**
   * changes: { package, pluginId, versionCode, versionName, minSdk }
   * minSdk only raises the value (SHA-256 v1 signatures need API 18+).
   * String values are replaced in the pool (all uses of the same string change together).
   */
  function editManifest(u8, changes) {
    const m = readManifest(u8);
    const pool = m.pool;
    const swap = (oldS, newS) => {
      if (oldS == null || newS == null || oldS === newS) return;
      const i = pool.strings.indexOf(oldS);
      if (i < 0) throw new Error('String not found in manifest: ' + oldS);
      if (pool.strings.indexOf(newS) >= 0 && pool.strings.indexOf(newS) !== i) throw new Error('Manifest already contains "' + newS + '"');
      pool.strings[i] = newS;
    };
    swap(m.info.package, changes.package);
    swap(m.info.pluginId, changes.pluginId);
    swap(m.info.versionName, changes.versionName);
    let out = replacePool(u8, pool);
    const delta = out.length - u8.length; // attributes live after the pool, so they moved by delta
    const dv = new DataView(out.buffer);
    for (const a of m.attrs) {
      if (changes.versionCode != null && a.elem === 'manifest' && a.resId === ATTR_VERSION_CODE) dv.setUint32(a.dataOff + delta, changes.versionCode >>> 0, true);
      if (changes.minSdk != null && a.elem === 'uses-sdk' && a.resId === ATTR_MIN_SDK && a.type !== 0x03 && a.data < changes.minSdk) dv.setUint32(a.dataOff + delta, changes.minSdk, true);
    }
    return out;
  }

  // ------------------------------------------------------------------ resources.arsc

  /** Finds the package and the global-pool indices used by string resource `keyName`. */
  function readArsc(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    if (dv.getUint16(0, true) !== 0x0002) throw new Error('resources.arsc is not a resource table');
    const tableHs = dv.getUint16(2, true);
    const global = parsePool(u8, tableHs);
    const pkgs = [];
    let p = tableHs + global.size;
    while (p < u8.length) {
      const type = dv.getUint16(p, true), hs = dv.getUint16(p + 2, true), sz = dv.getUint32(p + 4, true);
      if (type === 0x0200) {
        let name = '';
        for (let i = 0; i < 128; i++) { const c = dv.getUint16(p + 12 + i * 2, true); if (!c) break; name += String.fromCharCode(c); }
        const typeStrOff = dv.getUint32(p + 268, true), keyStrOff = dv.getUint32(p + 276, true);
        const typePool = parsePool(u8, p + typeStrOff), keyPool = parsePool(u8, p + keyStrOff);
        pkgs.push({ off: p, size: sz, hs, name, typePool, keyPool });
      }
      p += sz;
      if (!sz) break;
    }
    return { global, pkgs };
  }

  function stringValueIndices(u8, pkg, typeName, keyName) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const typeId = pkg.typePool.strings.indexOf(typeName) + 1, keyIdx = pkg.keyPool.strings.indexOf(keyName);
    const out = new Set();
    if (typeId < 1 || keyIdx < 0) return out;
    let p = pkg.off + pkg.hs;
    const end = pkg.off + pkg.size;
    while (p < end) {
      const type = dv.getUint16(p, true), hs = dv.getUint16(p + 2, true), sz = dv.getUint32(p + 4, true);
      if (type === 0x0201 && dv.getUint8(p + 8) === typeId) {
        const flags = dv.getUint8(p + 9);
        const count = dv.getUint32(p + 12, true), entriesStart = dv.getUint32(p + 16, true);
        const sparse = flags & 0x01, off16 = flags & 0x02;
        for (let i = 0; i < count; i++) {
          let eo;
          if (sparse) eo = dv.getUint16(p + hs + i * 4 + 2, true) * 4;
          else if (off16) { eo = dv.getUint16(p + hs + i * 2, true); if (eo === 0xFFFF) continue; eo *= 4; }
          else { eo = dv.getUint32(p + hs + i * 4, true); if (eo === 0xFFFFFFFF) continue; }
          const e = p + entriesStart + eo;
          const esz = dv.getUint16(e, true), eflags = dv.getUint16(e + 2, true);
          if (eflags & 0x0001) continue; // complex
          if (dv.getUint32(e + 4, true) !== keyIdx) continue;
          const v = e + esz;
          if (dv.getUint8(v + 3) === 0x03) out.add(dv.getUint32(v + 4, true));
        }
      }
      p += sz;
      if (!sz) break;
    }
    return out;
  }

  function readThemeName(u8) {
    const a = readArsc(u8);
    if (!a.pkgs.length) return null;
    const idx = [...stringValueIndices(u8, a.pkgs[0], 'string', 'theme_name')];
    // Prefer the plain value (not pseudo-locale variants, which contain decorations)
    const vals = idx.map(i => a.global.strings[i]);
    vals.sort((x, y) => (/^[\x20-\x7E]*$/.test(y) ? 1 : 0) - (/^[\x20-\x7E]*$/.test(x) ? 1 : 0));
    return { packageName: a.pkgs[0].name, themeName: vals[0] || null, all: vals };
  }

  /** changes: { package, themeName } */
  function editArsc(u8, changes) {
    let out = u8;
    if (changes.themeName != null) {
      const a = readArsc(out);
      const idx = stringValueIndices(out, a.pkgs[0], 'string', 'theme_name');
      if (idx.size) {
        for (const i of idx) a.global.strings[i] = changes.themeName;
        out = replacePool(out, a.global);
      }
    }
    if (changes.package != null) {
      const a = readArsc(out);
      const dv = new DataView(out.buffer, out.byteOffset, out.byteLength);
      const p = a.pkgs[0].off;
      if (changes.package.length > 127) throw new Error('Package name too long');
      for (let i = 0; i < 128; i++) dv.setUint16(p + 12 + i * 2, i < changes.package.length ? changes.package.charCodeAt(i) : 0, true);
    }
    return out;
  }

  // ------------------------------------------------------------------ v1 signing

  function b64(bytes) { return forge.util.encode64(bytesToBinary(bytes)); }
  function bytesToBinary(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return s; }
  async function sha256(u8) {
    if (typeof crypto !== 'undefined' && crypto.subtle) return new Uint8Array(await crypto.subtle.digest('SHA-256', u8));
    const md = forge.md.sha256.create(); md.update(bytesToBinary(u8)); return binaryToBytes(md.digest().getBytes());
  }
  function binaryToBytes(s) { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }

  /** "Name: x" header wrapped at 72 bytes per line, never splitting a UTF-8 character. */
  function manifestLine(key, value) {
    const bytes = te.encode(key + ': ' + value);
    const lines = [];
    let start = 0, first = true;
    while (start < bytes.length) {
      const max = first ? 70 : 69;
      let end = Math.min(bytes.length, start + max);
      while (end < bytes.length && (bytes[end] & 0xC0) === 0x80) end--;
      lines.push((first ? '' : ' ') + td.decode(bytes.subarray(start, end)));
      start = end; first = false;
    }
    return lines.join('\r\n') + '\r\n';
  }

  const SIG_FILE = /^META-INF\/([^/]+\.(SF|RSA|DSA|EC)|MANIFEST\.MF)$/i;

  /** Generates an RSA-2048 signing key with a 30-year self-signed certificate. Returns PEM strings. */
  function generateKey(commonName) {
    return new Promise((resolve, reject) => {
      forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 }, (err, keys) => {
        if (err) return reject(err);
        const cert = forge.pki.createCertificate();
        cert.publicKey = keys.publicKey;
        cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(8));
        cert.validity.notBefore = new Date();
        cert.validity.notAfter = new Date(); cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 30);
        const attrs = [{ name: 'commonName', value: commonName || 'Car Theme Studio' }, { name: 'organizationName', value: 'Car Themes' }];
        cert.setSubject(attrs); cert.setIssuer(attrs);
        cert.sign(keys.privateKey, forge.md.sha256.create());
        resolve({ key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) });
      });
    });
  }

  /** Signs (v1) and returns the new entry map. `signer` = {key, cert} PEMs. */
  async function signV1(entries, signer) {
    const out = new Map();
    for (const [n, d] of entries) if (!SIG_FILE.test(n)) out.set(n, d);
    let mf = 'Manifest-Version: 1.0\r\nCreated-By: Car Theme Studio Web\r\n\r\n';
    let sf = '';
    for (const [n, d] of out) {
      if (n.endsWith('/')) continue;
      const section = manifestLine('Name', n) + 'SHA-256-Digest: ' + b64(await sha256(d)) + '\r\n\r\n';
      mf += section;
      sf += manifestLine('Name', n) + 'SHA-256-Digest: ' + b64(await sha256(te.encode(section))) + '\r\n\r\n';
    }
    const mfBytes = te.encode(mf);
    const sfBytes = te.encode('Signature-Version: 1.0\r\nSHA-256-Digest-Manifest: ' + b64(await sha256(mfBytes))
      + '\r\nCreated-By: Car Theme Studio Web\r\n\r\n' + sf);

    const key = forge.pki.privateKeyFromPem(signer.key);
    const cert = forge.pki.certificateFromPem(signer.cert);
    const p7 = forge.pkcs7.createSignedData();
    p7.content = forge.util.createBuffer(bytesToBinary(sfBytes));
    p7.addCertificate(cert);
    p7.addSigner({ key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256 });
    p7.sign({ detached: true });
    const rsa = binaryToBytes(forge.asn1.toDer(p7.toAsn1()).getBytes());

    const signed = new Map();
    signed.set('META-INF/MANIFEST.MF', mfBytes);
    signed.set('META-INF/CERT.SF', sfBytes);
    signed.set('META-INF/CERT.RSA', rsa);
    for (const [n, d] of out) signed.set(n, d);
    return signed;
  }

  function certInfo(certPem) {
    const c = forge.pki.certificateFromPem(certPem);
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes();
    const md = forge.md.sha256.create(); md.update(der);
    return { subject: c.subject.getField('CN') ? c.subject.getField('CN').value : '', sha256: md.digest().toHex().replace(/(..)(?!$)/g, '$1:').toUpperCase(), notAfter: c.validity.notAfter };
  }

  return { readZip, writeZip, crc32, parsePool, buildPool, readManifest, editManifest, readArsc, readThemeName, editArsc, generateKey, signV1, certInfo };
});

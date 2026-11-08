'use strict';
/*
 * Leser für die Dateiformate von The Witcher 3 (REDengine 3) – nur lesend.
 *   .bundle        (POTATO70-Archive, z. B. xml.bundle)
 *   texture.cache  (Texturen, z. B. Gwint-Karten und Inventar-Icons)
 *   .w3strings     (lokalisierte Texte)
 * Dazu ein kleiner DXT1/DXT3/DXT5-Decoder und PNG-Encoder, damit Bilder ohne
 * externe Abhängigkeiten angezeigt werden können.
 */
const fs = require('fs');
const zlib = require('zlib');
const { t } = require('../../../src/core/i18n');

// ---------- LZ4 (Block-Format) ----------
function lz4Block(src, outLen) {
  const dst = Buffer.alloc(outLen);
  let s = 0, d = 0;
  while (s < src.length) {
    const tok = src[s++];
    let lit = tok >> 4;
    if (lit === 15) { let b; do { b = src[s++]; lit += b; } while (b === 255); }
    src.copy(dst, d, s, s + lit); s += lit; d += lit;
    if (s >= src.length) break;
    const off = src[s] | (src[s + 1] << 8); s += 2;
    let ml = tok & 15;
    if (ml === 15) { let b; do { b = src[s++]; ml += b; } while (b === 255); }
    ml += 4;
    for (let i = 0; i < ml; i++) { dst[d] = dst[d - off]; d++; }
  }
  return dst;
}

// ---------- Bundles ----------
const BUNDLE_ENTRY = 304;
function openBundle(file) {
  const fd = fs.openSync(file, 'r');
  const head = Buffer.alloc(32);
  fs.readSync(fd, head, 0, 32, 0);
  if (head.toString('latin1', 0, 8) !== 'POTATO70') { fs.closeSync(fd); throw new Error(t('Kein Bundle: {file}', { file })); }
  const tocSize = head.readUInt32LE(16);
  const toc = Buffer.alloc(tocSize);
  fs.readSync(fd, toc, 0, tocSize, 32);
  const items = [];
  for (let o = 0; o + BUNDLE_ENTRY <= tocSize; o += BUNDLE_ENTRY) {
    const end = toc.indexOf(0, o);
    const name = toc.toString('latin1', o, Math.min(end < 0 ? o + 256 : end, o + 256));
    if (!name) continue;
    const w = (k) => toc.readUInt32LE(o + 272 + 4 * k);
    items.push({ name, off: w(0), size: w(2), zsize: w(3), comp: w(5) });
  }
  return {
    items,
    read(it) {
      const z = Buffer.alloc(it.zsize);
      fs.readSync(fd, z, 0, it.zsize, it.off);
      if (it.comp === 0 || it.size === it.zsize) return z;
      if (it.comp === 1) return zlib.inflateSync(z);
      if (it.comp === 4 || it.comp === 5) return lz4Block(z, it.size);
      throw new Error(t('Kompression {comp} nicht unterstützt ({name})', { comp: it.comp, name: it.name }));
    },
    close() { try { fs.closeSync(fd); } catch (_) {} },
  };
}

// ---------- texture.cache ----------
function openTextureCache(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const ft = Buffer.alloc(32);
  fs.readSync(fd, ft, 0, 32, size - 32);
  if (ft.toString('latin1', 24, 28) !== 'HCXT') { fs.closeSync(fd); throw new Error(t('Unbekanntes texture.cache-Format')); }
  const ec = ft.readUInt32LE(12), sts = ft.readUInt32LE(16), mc = ft.readUInt32LE(20);
  const len = ec * 52 + sts + mc * 12;
  const b = Buffer.alloc(len);
  fs.readSync(fd, b, 0, len, size - 32 - len);
  const strs = b.subarray(mc * 12, mc * 12 + sts);
  const base = mc * 12 + sts;
  const byName = new Map();
  for (let i = 0; i < ec; i++) {
    const o = base + i * 52;
    const no = b.readUInt32LE(o + 4);
    const end = strs.indexOf(0, no);
    const name = strs.toString('latin1', no, end < 0 ? strs.length : end).toLowerCase();
    byName.set(name, {
      page: b.readUInt32LE(o + 8), w: b.readUInt16LE(o + 24), h: b.readUInt16LE(o + 26),
      fmt: b.readUInt16LE(o + 48),
    });
  }
  return {
    names: () => byName.keys(),
    has: (n) => byName.has(n.toLowerCase()),
    // Liefert RGBA-Pixel der obersten Mip-Stufe
    readRGBA(name) {
      const e = byName.get(name.toLowerCase());
      if (!e) return null;
      // 0x3fd = unkomprimiert 32 bit (große Journal-/Bestiarium-Bilder), sonst DXT1/DXT3/DXT5
      // (0x40d: Alpha-DXT-Variante, z. B. Briefe/Schriftrollen im Inventar – dekodiert wie DXT5)
      const kind = { 0x3fd: 'raw', 0x407: 1, 0x408: 3, 0x40a: 2, 0x40d: 3 }[e.fmt];
      if (!kind) return null;
      const h = Buffer.alloc(9);
      fs.readSync(fd, h, 0, 9, e.page * 4096);
      const zlen = h.readUInt32LE(0);
      if (!zlen || zlen > 64 * 1024 * 1024) return null;
      const z = Buffer.alloc(zlen);
      fs.readSync(fd, z, 0, zlen, e.page * 4096 + 9);
      const data = zlib.inflateSync(z);
      if (kind === 'raw') {
        if (data.length < e.w * e.h * 4) return null;
        return { w: e.w, h: e.h, rgba: Buffer.from(data.subarray(0, e.w * e.h * 4)) };
      }
      return { w: e.w, h: e.h, rgba: decodeBC(data, e.w, e.h, kind) };
    },
    close() { try { fs.closeSync(fd); } catch (_) {} },
  };
}

// ---------- DXT / BCn ----------
function rgb565(c) { return [((c >> 11) & 31) * 255 / 31 | 0, ((c >> 5) & 63) * 255 / 63 | 0, (c & 31) * 255 / 31 | 0]; }

function decodeBC(buf, w, h, kind) {
  const out = Buffer.alloc(w * h * 4);
  const bw = Math.ceil(w / 4), bh = Math.ceil(h / 4);
  const bs = kind === 1 ? 8 : 16;
  const alpha = new Uint8Array(16);
  let o = 0;
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++, o += bs) {
      if (o + bs > buf.length) return out;
      let co = o;
      let hasAlpha = false;
      if (kind === 3) {
        const a0 = buf[o], a1 = buf[o + 1];
        const pal = [a0, a1];
        if (a0 > a1) for (let i = 1; i < 7; i++) pal.push(((7 - i) * a0 + i * a1) / 7 | 0);
        else { for (let i = 1; i < 5; i++) pal.push(((5 - i) * a0 + i * a1) / 5 | 0); pal.push(0, 255); }
        let lo = buf.readUInt32LE(o + 2) >>> 0, hi = buf.readUInt16LE(o + 6);
        for (let i = 0; i < 16; i++) {
          const bit = 3 * i;
          let v;
          if (bit + 3 <= 32) v = (lo >>> bit) & 7;
          else if (bit >= 32) v = (hi >>> (bit - 32)) & 7;
          else v = ((lo >>> bit) | (hi << (32 - bit))) & 7;
          alpha[i] = pal[v];
        }
        co = o + 8; hasAlpha = true;
      } else if (kind === 2) {
        for (let i = 0; i < 16; i++) alpha[i] = ((buf[o + (i >> 1)] >> ((i & 1) * 4)) & 15) * 17;
        co = o + 8; hasAlpha = true;
      }
      const c0 = buf.readUInt16LE(co), c1 = buf.readUInt16LE(co + 2);
      const p0 = rgb565(c0), p1 = rgb565(c1);
      const transparentBlack = kind === 1 && c0 <= c1;
      const pal = transparentBlack
        ? [p0, p1, [(p0[0] + p1[0]) >> 1, (p0[1] + p1[1]) >> 1, (p0[2] + p1[2]) >> 1], [0, 0, 0]]
        : [p0, p1,
          [(2 * p0[0] + p1[0]) / 3 | 0, (2 * p0[1] + p1[1]) / 3 | 0, (2 * p0[2] + p1[2]) / 3 | 0],
          [(p0[0] + 2 * p1[0]) / 3 | 0, (p0[1] + 2 * p1[1]) / 3 | 0, (p0[2] + 2 * p1[2]) / 3 | 0]];
      const idx = buf.readUInt32LE(co + 4);
      for (let i = 0; i < 16; i++) {
        const x = bx * 4 + (i & 3), y = by * 4 + (i >> 2);
        if (x >= w || y >= h) continue;
        const ci = (idx >>> (2 * i)) & 3;
        const p = (y * w + x) * 4;
        out[p] = pal[ci][0]; out[p + 1] = pal[ci][1]; out[p + 2] = pal[ci][2];
        out[p + 3] = hasAlpha ? alpha[i] : (transparentBlack && ci === 3 ? 0 : 255);
      }
    }
  }
  return out;
}

// ---------- PNG ----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }

function encodePNG(rgba, w, h) {
  const stride = w * 4 + 1;
  const raw = Buffer.alloc(stride * h);
  for (let y = 0; y < h; y++) { raw[y * stride] = 0; rgba.copy(raw, y * stride + 1, y * w * 4, (y + 1) * w * 4); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- w3strings ----------
const W3S_LANG = {
  // Sprach-Schlüssel und "Magic" aus WolvenKit (W3Language.cs)
  pl: [0x83496237, 0x73946816], en: [0x43975139, 0x79321793], de: [0x75886138, 0x42791159],
  it: [0x45931894, 0x12375973], fr: [0x23863176, 0x75921975], cz: [0x24987354, 0x21793217],
  es: [0x18796651, 0x42387566], zh: [0x18632176, 0x16875467], ru: [0x63481486, 0x42386347],
  hu: [0x42378932, 0x67823218], jp: [0x54834893, 0x59825646],
};

function hashKey(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(h, 31) + key.charCodeAt(i)) >>> 0;
  return h;
}

function readVarInt(b, p) {
  const x = b[p.o++];
  let v = x & 63;
  if (x & 64) { let sh = 6, y; do { y = b[p.o++]; v |= (y & 127) << sh; sh += 7; } while (y & 128); }
  return v;
}

function readW3Strings(file) {
  const b = fs.readFileSync(file);
  if (b.toString('latin1', 0, 4) !== 'RTSW') throw new Error(t('Keine w3strings-Datei'));
  const key = ((b.readUInt16LE(8) << 16) | b.readUInt16LE(b.length - 2)) >>> 0;
  const lang = Object.values(W3S_LANG).find((v) => v[0] === key);
  const magic = lang ? lang[1] : 0;
  const p = { o: 10 };
  const n1 = readVarInt(b, p);
  const blocks = [];
  for (let i = 0; i < n1; i++) {
    blocks.push({ id: (b.readUInt32LE(p.o) ^ magic) >>> 0, off: b.readUInt32LE(p.o + 4), len: b.readUInt32LE(p.o + 8) });
    p.o += 12;
  }
  const n2 = readVarInt(b, p);
  const keys = new Map();
  for (let i = 0; i < n2; i++) { keys.set(b.readUInt32LE(p.o), (b.readUInt32LE(p.o + 4) ^ magic) >>> 0); p.o += 8; }
  const total = readVarInt(b, p);
  const start = p.o;
  const sk0 = (magic >>> 8) & 0xffff;
  const strings = new Map();
  if (b.length - 2 - start === total * 2) {
    // Ältere Spielversionen: UTF-16, Offsets in Zeichen
    for (const e of blocks) {
      let sk = sk0, s = '', o = start + e.off * 2;
      for (let i = 0; i < e.len && o + 1 < b.length; i++, o += 2) {
        const ck = ((e.len + 1) * sk) & 0xffff;
        s += String.fromCharCode((b[o] ^ (ck & 255)) | ((b[o + 1] ^ (ck >> 8)) << 8));
        sk = ((sk << 1) | (sk >>> 15)) & 0xffff;
      }
      strings.set(e.id, s);
    }
    return makeStrings(strings, keys);
  }
  const offs = blocks.map((e) => e.off).sort((x, y) => x - y);
  const next = new Map();
  for (let i = 0; i < offs.length; i++) next.set(offs[i], i + 1 < offs.length ? offs[i + 1] : b.length - 2 - start);
  // Aktuelle Spielversion: 1 Byte pro Zeichen (UTF-8), Offsets in Bytes
  for (const e of blocks) {
    const nb = Math.max(0, Math.min(next.get(e.off) - e.off - 1, b.length - start - e.off));
    const out = Buffer.alloc(nb);
    let sk = sk0;
    for (let i = 0; i < nb; i++) {
      const ck = ((e.len + 1) * sk) & 0xffff;
      out[i] = b[start + e.off + i] ^ (ck & 255);
      sk = ((sk << 1) | (sk >>> 15)) & 0xffff;
    }
    strings.set(e.id, out.toString('utf8'));
  }
  return makeStrings(strings, keys);
}

function makeStrings(strings, keys) {
  return {
    byKey(k) { if (!k) return null; const id = keys.get(hashKey(k)); return id === undefined ? null : (strings.get(id) ?? null); },
    byId(id) { return strings.get(id) ?? null; },
    size: strings.size,
  };
}

module.exports = { lz4Block, openBundle, openTextureCache, decodeBC, encodePNG, readW3Strings, hashKey };

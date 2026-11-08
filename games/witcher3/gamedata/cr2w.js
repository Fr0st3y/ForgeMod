'use strict';
/*
 * Minimaler Leser für CR2W-Ressourcen (REDengine 3) – nur lesend.
 * Liefert die Namenstabelle und je Chunk die Properties als rohe Puffer.
 * Reicht für einfache Dinge wie Positionen von Wegweisern oder DLC-Karteneinstellungen.
 */

const { t } = require('../../../src/core/i18n');

function readCR2W(buf) {
  if (buf.toString('latin1', 0, 4) !== 'CR2W') throw new Error(t('Keine CR2W-Datei'));
  // Kopf: magic, version, flags, timestamp(8), buildVersion, fileSize, bufferSize, crc, numChunks, dann 10 Tabellen {offset, count, crc}
  const tables = [];
  for (let i = 0; i < 10; i++) { const o = 40 + i * 12; tables.push({ off: buf.readUInt32LE(o), count: buf.readUInt32LE(o + 4) }); }
  const strOff = tables[0].off;
  const cstr = (o) => { const s = strOff + o; const e = buf.indexOf(0, s); return buf.toString('latin1', s, e < 0 ? buf.length : e); };
  const names = [];
  for (let i = 0; i < tables[1].count; i++) names.push(cstr(buf.readUInt32LE(tables[1].off + i * 8)));
  const chunks = [];
  for (let i = 0; i < tables[4].count; i++) {
    const o = tables[4].off + i * 24;
    const type = names[buf.readUInt16LE(o)];
    const size = buf.readUInt32LE(o + 8), off = buf.readUInt32LE(o + 12);
    const props = {};
    let p = off + 1;
    try {
      while (p + 8 <= off + size) {
        const ni = buf.readUInt16LE(p);
        if (ni === 0) break;
        const ti = buf.readUInt16LE(p + 2), sz = buf.readUInt32LE(p + 4);
        if (sz < 4) break;
        props[names[ni]] = { type: names[ti], data: buf.subarray(p + 8, p + 4 + sz) };
        p += 4 + sz;
      }
    } catch (_) { /* unvollständiger Chunk – was wir haben, reicht */ }
    chunks.push({ type, props });
  }
  return { names, chunks };
}

// Hilfen für häufige Werttypen
const value = {
  float: (pr) => (pr && pr.data.length >= 4 ? pr.data.readFloatLE(0) : null),
  int: (pr) => (pr && pr.data.length >= 4 ? pr.data.readInt32LE(0) : null),
  locId: (pr) => (pr && pr.data.length >= 4 ? pr.data.readUInt32LE(0) : null),
  cname: (pr, names) => (pr && pr.data.length >= 2 ? names[pr.data.readUInt16LE(0)] : null),
  // EngineTransform: 1 Byte Flags, bei Bit 0 folgen x, y, z
  position: (pr) => {
    if (!pr || pr.data.length < 13 || !(pr.data[0] & 1)) return null;
    return { x: pr.data.readFloatLE(1), y: pr.data.readFloatLE(5), z: pr.data.readFloatLE(9) };
  },
};

module.exports = { readCR2W, value };

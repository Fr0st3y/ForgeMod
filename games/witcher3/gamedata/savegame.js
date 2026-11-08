'use strict';
/*
 * Liest aus dem neuesten Witcher-3-Spielstand (Dokumente\The Witcher 3\gamesaves) – nur lesend:
 *   - die aktuelle Welt (worldInfo → world)
 *   - die eigenen Kartenmarker (UserMapPin: Region, X/Y, Typ)
 * Typ 0 = grüner Wegpunkt („Individuelle Markierung“), 1–6 = Symbole aus der Auswahl.
 *
 * Aufbau: "SNFHFZLC" + Chunk-Tabelle (komprimiert, entpackt, Ende) mit LZ4-Blöcken.
 * Entpackt: Variablen als "BS"<name> (Block) und "VL"<name><typ><wert>, Namenstabelle "MANU" am Ende.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { lz4Block } = require('./formats');
const { t } = require('../../../src/core/i18n');

function saveDirs() {
  const dirs = [];
  try { dirs.push(path.join(require('electron').app.getPath('documents'), 'The Witcher 3', 'gamesaves')); } catch (_) {}
  const home = process.env.USERPROFILE || os.homedir();
  for (const docs of ['Documents', 'Dokumente', path.join('OneDrive', 'Documents'), path.join('OneDrive', 'Dokumente')]) {
    dirs.push(path.join(home, docs, 'The Witcher 3', 'gamesaves'));
  }
  return [...new Set(dirs)].filter((d) => fs.existsSync(d));
}

function newestSave() {
  let best = null;
  for (const dir of saveDirs()) {
    for (const f of fs.readdirSync(dir)) {
      if (!f.toLowerCase().endsWith('.sav')) continue;
      const file = path.join(dir, f);
      const st = fs.statSync(file);
      if (!best || st.mtimeMs > best.mtime) best = { file, mtime: st.mtimeMs };
    }
  }
  return best;
}

function unpack(buf) {
  if (buf.toString('latin1', 0, 8) !== 'SNFHFZLC') throw new Error(t('Unbekanntes Spielstand-Format'));
  const chunks = buf.readUInt32LE(8), headerSize = buf.readUInt32LE(12);
  const parts = [];
  let off = headerSize;
  for (let i = 0; i < chunks; i++) {
    const o = 16 + i * 12;
    const cs = buf.readUInt32LE(o), ds = buf.readUInt32LE(o + 4);
    parts.push(lz4Block(buf.subarray(off, off + cs), ds));
    off += cs;
  }
  return Buffer.concat(parts);
}

function readNames(d, s) {
  const mi = s.lastIndexOf('MANU');
  if (mi < 0) throw new Error(t('Namenstabelle im Spielstand fehlt'));
  const count = d.readUInt32LE(mi + 4);
  const names = [''];
  let p = mi + 12;
  for (let i = 0; i < count && p < d.length; i++) { const l = d[p]; names.push(d.toString('latin1', p + 1, p + 1 + l)); p += 1 + l; }
  return names;
}

// Reihenfolge wie in gameplay\globals\minimap_settings.csv (ältere Spielstände speichern die Region als Zahl)
const AREA_ENUM = ['AN_Undefined', 'AN_NMLandNovigrad', 'AN_Skellige_ArdSkellig', 'AN_Kaer_Morhen', 'AN_Prologue_Village',
  'AN_Wyzima', 'AN_Island_of_Myst', 'AN_Spiral', 'AN_Prologue_Village_Winter', 'AN_Velen'];

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b.toString('latin1'); };

function parseSave(d) {
  const s = d.toString('latin1');
  const names = readNames(d, s);
  const id = (n) => names.indexOf(n);
  // Aktuelle Welt
  let world = null;
  const wi = s.indexOf('BS' + u16(id('worldInfo')));
  if (wi >= 0) {
    const m = s.slice(wi, wi + 400).match(/((?:dlc\\[a-z0-9_]+\\data\\)?levels\\[a-z0-9_\\]+\.w2w)/i);
    if (m) world = m[1].toLowerCase();
  }
  // Eigene Marker
  const pins = [];
  const bi = s.indexOf('BS' + u16(id('UserMapPin')));
  if (bi >= 0) {
    const VL = (n) => 'VL' + u16(id(n));
    let p = s.indexOf(VL('UserMapPinsCount'), bi);
    const count = p >= 0 && p - bi < 64 ? d.readUInt32LE(p + 6) : 0;
    const xKey = u16(id('X')) + u16(id('Float')), yKey = u16(id('Y')) + u16(id('Float'));
    for (let i = 0; i < count && i < 500; i++) {
      const pa = s.indexOf(VL('UserMapPinArea'), p);
      const pp = s.indexOf(VL('UserMapPinPosition'), pa);
      const pt = s.indexOf(VL('UserMapPinType'), pp);
      if (pa < 0 || pp < 0 || pt < 0 || pt - pa > 200) break;
      // Neue Spielstände: CName (Namensindex), ältere: Int32-Enum
      const areaType = names[d.readUInt16LE(pa + 4)];
      const area = areaType === 'CName' ? names[d.readUInt16LE(pa + 6)] : (AREA_ENUM[d.readInt32LE(pa + 6)] || null);
      const px = s.indexOf(xKey, pp), py = s.indexOf(yKey, pp);
      const x = px > 0 && px < pt ? d.readFloatLE(px + 4) : NaN;
      const y = py > 0 && py < pt ? d.readFloatLE(py + 4) : NaN;
      pins.push({ index: i, area, x, y, type: d.readInt32LE(pt + 6) });
      p = pt + 10;
    }
  }
  return { world, pins };
}

// Kartenbereich (AN_…) bzw. Weltpfad -> Welt-ID wie in maps.js
const AREA_WORLD = {
  AN_NMLandNovigrad: 'novigrad', AN_Velen: 'novigrad', AN_Skellige_ArdSkellig: 'skellige', AN_Kaer_Morhen: 'kaer_morhen',
  AN_Prologue_Village: 'prolog_village', AN_Prologue_Village_Winter: 'prolog_village_winter', AN_Wyzima: 'wyzima_castle',
  AN_Bob: 'bob', AN_Dlc_Bob: 'bob', AN_Island_of_Myst: 'island_of_mist', AN_Spiral: 'the_spiral',
};
function worldFromPath(p) {
  if (!p) return null;
  if (p.includes('\\bob\\')) return 'bob';
  const m = p.match(/levels\\([a-z_]+)\\/);
  return m ? m[1] : null;
}

// Neuester grüner Wegpunkt + aktuelle Welt aus dem neuesten Spielstand
// opts.unpacked: bereits entpackter Spielstand (für Tests)
async function readWaypoint(opts = {}) {
  const save = opts.unpacked ? { file: 'test.sav', mtime: opts.mtime || Date.now() } : newestSave();
  if (!save) throw new Error(t('Kein Spielstand gefunden (Dokumente\\The Witcher 3\\gamesaves).'));
  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { data = parseSave(opts.unpacked || unpack(fs.readFileSync(save.file))); break; } catch (e) {
      if (attempt === 2) throw new Error(t('Spielstand konnte nicht gelesen werden: {error}', { error: e.message }));
      await new Promise((r) => setTimeout(r, 700)); // Spiel schreibt evtl. noch
    }
  }
  const waypoints = data.pins.filter((p) => p.type === 0 && Number.isFinite(p.x) && Number.isFinite(p.y));
  const wp = waypoints[waypoints.length - 1] || null;
  return {
    file: path.basename(save.file),
    ageSec: Math.round((Date.now() - save.mtime) / 1000),
    currentWorld: worldFromPath(data.world),
    waypoint: wp ? { ...wp, world: AREA_WORLD[wp.area] || null } : null,
    pinCount: data.pins.length,
  };
}

// Gwint-Sammlung: CR4GwintManager -> SBCollectionCard / SBLeaderCollectionCard (cardIndex, numCopies)
function parseGwent(d) {
  const s = d.toString('latin1');
  const names = readNames(d, s);
  const id = (n) => names.indexOf(n);
  const cards = new Map(), leaders = new Map();
  const ci = 'VL' + u16(id('cardIndex')), nc = 'VL' + u16(id('numCopies'));
  for (const [block, out] of [['SBCollectionCard', cards], ['SBLeaderCollectionCard', leaders]]) {
    const b = id(block);
    if (b < 0) continue;
    const tag = 'BS' + u16(b);
    let at = -1;
    while ((at = s.indexOf(tag, at + 1)) >= 0) {
      if (s.substr(at + 4, 4) !== ci) continue;
      const index = d.readInt32LE(at + 10);
      const copies = s.substr(at + 14, 4) === nc ? d.readInt32LE(at + 20) : 1;
      out.set(index, (out.get(index) || 0) + Math.max(0, copies));
    }
  }
  return { found: id('CR4GwintManager') >= 0, cards, leaders };
}

// Geralts Inventar (Name -> Anzahl). Aufbau, ermittelt durch Vergleich zweier Spielstände:
//   [u16 nächste Item-Nummer][u16 Anzahl Einträge] danach die Einträge, jeder:
//   +0 u16 Name (Namenstabelle) … +13 u16 "Dye Default" u16 "dye_default" +17 u16 Menge +19 f32 Haltbarkeit (-1 = keine) …
//   (Länge variabel)
// Die Liste des Spielers beginnt mit seinen Körperteilen ("Body underwear 01" … "Geralt fists").
function parseInventory(d) {
  const s = d.toString('latin1');
  const names = readNames(d, s);
  const id = (n) => names.indexOf(n);
  const dye1 = id('Dye Default'), dye2 = id('dye_default'), fists = id('Geralt fists');
  const items = new Map();
  if (dye1 < 0 || dye2 < 0 || fists < 0) return { found: false, items };
  const mark = Buffer.alloc(4);
  mark.writeUInt16LE(dye1, 0); mark.writeUInt16LE(dye2, 2);
  const pos = [];
  let at = -1;
  while ((at = d.indexOf(mark, at + 1)) >= 0) pos.push(at);
  const fi = pos.findIndex((x) => x >= 13 && d.readUInt16LE(x - 13) === fists);
  if (fi < 0) return { found: false, items };
  // zum Listenanfang zurück (Einträge liegen dicht hintereinander)
  let a = fi;
  while (a > 0 && pos[a] - pos[a - 1] < 600) a--;
  const count = d.readUInt16LE(pos[a] - 13 - 2);
  if (count < fi - a + 1 || a + count > pos.length) return { found: false, items };
  for (let i = a; i < a + count; i++) {
    const name = names[d.readUInt16LE(pos[i] - 13)];
    const qty = d.readUInt16LE(pos[i] + 4);
    if (name) items.set(name, (items.get(name) || 0) + qty);
  }
  return { found: true, count, items };
}

// Geralts Inventar aus dem neuesten Spielstand (nur lesend)
async function readInventory(opts = {}) {
  const save = opts.unpacked ? { file: 'test.sav', mtime: opts.mtime || Date.now() } : newestSave();
  if (!save) throw new Error(t('Kein Spielstand gefunden (Dokumente\\The Witcher 3\\gamesaves).'));
  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { data = parseInventory(opts.unpacked || unpack(fs.readFileSync(save.file))); break; } catch (e) {
      if (attempt === 2) throw new Error(t('Spielstand konnte nicht gelesen werden: {error}', { error: e.message }));
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  return { file: path.basename(save.file), ageSec: Math.round((Date.now() - save.mtime) / 1000), ...data };
}

// Freigeschaltete Journal-Einträge (u. a. Bestiarium): BS SJournalEntryStatus -> VL guid … VL status (EJournalStatus).
// Der eigene Eintrag ist die letzte guid vor "status"; davor stehen die übergeordneten Einträge (Pfad).
function parseJournal(d) {
  const s = d.toString('latin1');
  const names = readNames(d, s);
  const id = (n) => names.indexOf(n);
  const known = new Set();
  const block = id('SJournalEntryStatus');
  if (block < 0) return { found: false, known };
  const BLOCK = 'BS' + u16(block), VLG = 'VL' + u16(id('guid')), VLS = 'VL' + u16(id('status'));
  const starts = [];
  let at = -1;
  while ((at = s.indexOf(BLOCK, at + 1)) >= 0) starts.push(at);
  for (let i = 0; i < starts.length; i++) {
    const end = i + 1 < starts.length ? starts[i + 1] : Math.min(s.length, starts[i] + 4000);
    const st = s.indexOf(VLS, starts[i]);
    if (st < 0 || st > end) continue;
    const status = names[d.readUInt16LE(st + 6)];
    if (status !== 'JS_Active' && status !== 'JS_Success') continue;
    const g = s.lastIndexOf(VLG, st);
    if (g > starts[i]) known.add(d.subarray(g + 6, g + 22).toString('hex'));
  }
  return { found: true, known };
}

async function readJournal(opts = {}) {
  const save = opts.unpacked ? { file: 'test.sav', mtime: opts.mtime || Date.now() } : newestSave();
  if (!save) throw new Error(t('Kein Spielstand gefunden (Dokumente\\The Witcher 3\\gamesaves).'));
  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { data = parseJournal(opts.unpacked || unpack(fs.readFileSync(save.file))); break; } catch (e) {
      if (attempt === 2) throw new Error(t('Spielstand konnte nicht gelesen werden: {error}', { error: e.message }));
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  return { file: path.basename(save.file), ageSec: Math.round((Date.now() - save.mtime) / 1000), ...data };
}

// Gwint-Sammlung aus dem neuesten Spielstand (nur lesend)
async function readGwentCollection(opts = {}) {
  const save = opts.unpacked ? { file: 'test.sav', mtime: opts.mtime || Date.now() } : newestSave();
  if (!save) throw new Error(t('Kein Spielstand gefunden (Dokumente\\The Witcher 3\\gamesaves).'));
  let data;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { data = parseGwent(opts.unpacked || unpack(fs.readFileSync(save.file))); break; } catch (e) {
      if (attempt === 2) throw new Error(t('Spielstand konnte nicht gelesen werden: {error}', { error: e.message }));
      await new Promise((r) => setTimeout(r, 700));
    }
  }
  return { file: path.basename(save.file), ageSec: Math.round((Date.now() - save.mtime) / 1000), ...data };
}

module.exports = { readWaypoint, readGwentCollection, readInventory, readJournal, parseSave, parseGwent, parseInventory, parseJournal, unpack, newestSave };

'use strict';
/*
 * Weltkarten aus der eigenen Installation:
 *   - Kacheln:   gui_new\maps\<karte>\level<L>\tile<x>x<y>.jpg  (y zählt von unten, 1024 px je Kachel)
 *   - Maßstab:   gameplay\globals\minimap_settings.csv  bzw. dlc\bob\activation_bob.reddlc (Toussaint)
 *                Die Karte deckt die Welt [-S/2, S/2]² ab (S = "world size").
 *   - Wegweiser: W3FastTravelEntity in den fast_travel-Ebenen der World-Bundles (Position + Name)
 * Alles nur lesend.
 */
const fs = require('fs');
const path = require('path');
const { openBundle } = require('./formats');
const { readCR2W, value } = require('./cr2w');
const { t } = require('../../../src/core/i18n');

const REGIONS = [
  { id: 'novigrad', name: 'Velen & Novigrad', goto: 'gotoNovigrad' },
  { id: 'skellige', name: 'Skellige', goto: 'gotoSkellige' },
  { id: 'bob', name: 'Toussaint', goto: 'gotoBob', dlc: 'bw' },
  { id: 'kaer_morhen', name: 'Kaer Morhen', goto: 'gotoKaerMorhen' },
  { id: 'prolog_village', name: 'Weißgarten', goto: 'gotoProlog' },
  { id: 'wyzima_castle', name: 'Wyzima (Königspalast)', goto: 'gotoWyzima' },
];

// Kartenparameter aus minimap_settings.csv: Weltgröße + Sichtbereich (Einheit S/2048)
function readSettingsCsv(content) {
  const out = {};
  let b;
  try { b = openBundle(path.join(content, 'bundles', 'startup.bundle')); } catch (_) { return out; }
  try {
    const it = b.items.find((i) => i.name.toLowerCase() === 'gameplay\\globals\\minimap_settings.csv');
    if (!it) return out;
    const lines = b.read(it).toString('utf8').split(/\r?\n/);
    for (const line of lines.slice(1)) {
      const c = line.split(';');
      if (c.length < 15 || !Number(c[1])) continue;
      out[c[0].trim()] = { size: Number(c[1]), view: [Number(c[11]), Number(c[12]), Number(c[13]), Number(c[14])] };
    }
  } finally { b.close(); }
  return out;
}

// Toussaint steht nicht in der CSV, sondern in der DLC-Aktivierung
function readBobSettings(content) {
  let b;
  try { b = openBundle(path.join(content, 'bundles', 'bob.bundle')); } catch (_) { return null; }
  try {
    const it = b.items.find((i) => i.name.toLowerCase() === 'dlc\\bob\\activation_bob.reddlc');
    if (!it) return null;
    const { chunks } = readCR2W(b.read(it));
    const w = chunks.find((c) => c.type === 'CR4WorldDescriptionDLC');
    if (!w) return null;
    const p = w.props;
    const size = value.float(p.worldMiniMapSize);
    if (!size) return null;
    return { size, view: ['VminX', 'VmaxX', 'VminY', 'VmaxY'].map((k) => value.int(p['worldMiniMap' + k])) };
  } catch (_) { return null; } finally { b.close(); }
}

function worldOf(name) {
  const n = name.toLowerCase();
  if (n.startsWith('dlc\\bob\\data\\levels\\bob\\')) return 'bob';
  const m = n.match(/(?:^|\\)levels\\([a-z_]+)\\/);
  return m ? m[1] : null;
}

// Alle Schnellreisepunkte mit Position und lokalisiertem Namen
function readSignposts(content, LK) {
  const dir = path.join(content, 'bundles');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^world_.*\.bundle$|^(ep1|bob)\.bundle$/i.test(f)); } catch (_) { return []; }
  const out = [];
  const seen = new Set();
  for (const f of files) {
    let b;
    try { b = openBundle(path.join(dir, f)); } catch (_) { continue; }
    try {
      for (const it of b.items) {
        const n = it.name.toLowerCase();
        if (!n.endsWith('.w2l') || !n.includes('fast_travel')) continue;
        const world = worldOf(n);
        if (!world) continue;
        let doc;
        try { doc = readCR2W(b.read(it)); } catch (_) { continue; }
        for (const c of doc.chunks) {
          if (c.type !== 'W3FastTravelEntity') continue;
          const pos = value.position(c.props.transform);
          if (!pos || !Number.isFinite(pos.x)) continue;
          // Der Name auf der Karte kommt aus "map_location_<tag>" (wie im Spiel)
          const tag = (value.cname(c.props.entityName, doc.names) || '').toLowerCase();
          if (!tag) continue;
          const name = LK('map_location_' + tag) || LK('map_location_' + tag.replace(/_ft$/, '')) || tag.replace(/_ft$/, '').replace(/_/g, ' ');
          // Wegweiser + Ankunftspunkt liegen dicht beieinander – nur einmal zeigen
          const near = out.find((q) => q.world === world && q.name === name && Math.hypot(q.x - pos.x, q.y - pos.y) < 250);
          if (near) continue;
          const key = `${world}|${Math.round(pos.x)}|${Math.round(pos.y)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push({ world, name: name.trim(), x: +pos.x.toFixed(1), y: +pos.y.toFixed(1), z: +pos.z.toFixed(1), boat: /harbor|boat|port/i.test(n + tag) });
        }
      }
    } finally { b.close(); }
  }
  return out;
}

function buildMaps({ content, texIndex, LK }) {
  const settings = readSettingsCsv(content);
  const bob = readBobSettings(content);
  if (bob) settings.bob = bob;
  // Kacheln je Karte und Stufe aus dem Textur-Index
  const tiles = {};
  for (const [key, full] of texIndex) {
    const m = key.match(/^maps\\([a-z_]+)\\level(\d)\\tile(\d+)x(\d+)\.jpg$/);
    if (!m) continue;
    const lv = (tiles[m[1]] ||= {});
    (lv[m[2]] ||= []).push([Number(m[3]), Number(m[4]), full]);
  }
  const signposts = readSignposts(content, LK);
  const regions = [];
  for (const r of REGIONS) {
    const s = settings[r.id];
    const tl = tiles[r.id];
    if (!s || !tl) continue;
    const half = s.size / 2;
    const unit = s.size / 2048;
    const [vx0, vx1, vy0, vy1] = s.view || [];
    const view = Number.isFinite(vx0) && vx1 > vx0 && vy1 > vy0
      ? { x0: vx0 * unit, x1: vx1 * unit, y0: vy0 * unit, y1: vy1 * unit }
      : { x0: -half, x1: half, y0: -half, y1: half };
    regions.push({
      ...r,
      name: t(r.name),
      size: s.size,
      view,
      levels: Object.fromEntries(Object.entries(tl).map(([lv, list]) => [lv, list])),
      signposts: signposts.filter((p) => p.world === r.id && Math.abs(p.x) <= half && Math.abs(p.y) <= half)
        .sort((a, b) => a.name.localeCompare(b.name, 'de')),
    });
  }
  return regions;
}

module.exports = { buildMaps, REGIONS };

'use strict';
// Prüft, dass jeder deutsche Text eine englische Übersetzung hat (i18n/en.js).
// Quellen: t('…')-Aufrufe im Code, Plugin-Texte (Cheats, Felder, Galerien, Anleitung), feste Katalognamen, index.html.
// Aufruf mit "--list" gibt die fehlenden Texte aus.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const EN = require('../i18n/en');

const ROOT = path.join(__dirname, '..');
const keys = new Set();
const add = (s) => { if (typeof s === 'string' && s.trim() && /[a-zäöüß]/i.test(s)) keys.add(s); };

// 1) t('…') im Code (einfache Anführungszeichen, ohne Template-Literale)
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'test', 'i18n'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.js')) files.push(p);
  }
})(ROOT);
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  for (const m of src.matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) add(m[1].replace(/\\(.)/g, '$1'));
}

// 2) Plugin-Texte
const plugin = require('../games/witcher3');
add(plugin.subtitle); add(plugin.setupHint);
for (const l of Object.values(plugin.setupGuide.launchers)) l.steps.forEach(add);
for (const list of Object.values(plugin.launchOptions)) list.forEach((o) => add(o.label));
for (const g of Object.values(plugin.galleries)) { add(g.title); add(g.hint); }
(plugin.extraTexts || []).forEach(add);
for (const cat of plugin.categories) {
  if (!cat.hidden) add(cat.name);
  for (const c of cat.cheats) {
    if (cat.hidden) continue;
    [c.name, c.desc, c.button, c.confirm, c.tag, c.warn].forEach(add);
    for (const f of c.fields || []) { add(f.label); add(f.placeholder); add(f.hint); (f.options || []).forEach((o) => add(o.label)); }
  }
}
// 3) Feste Katalog- und Kartennamen
require('../games/witcher3/gamedata/catalog').TEXTS().forEach(add);
require('../games/witcher3/gamedata/maps').REGIONS.forEach((r) => add(r.name));

// 4) Feste Texte in index.html (Textknoten, placeholder, title)
const html = fs.readFileSync(path.join(ROOT, 'renderer', 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<svg[\s\S]*?<\/svg>/g, '');
for (const m of html.matchAll(/>([^<>]+)</g)) add(m[1].trim());
for (const m of html.matchAll(/(?:placeholder|title)="([^"]+)"/g)) add(m[1]);

// Eigennamen, die in beiden Sprachen gleich sind, brauchen keinen Eintrag – sie müssen aber bewusst gelistet sein
const SAME = new Set(['ForgeMod', 'Forge', 'Mod', 'Steam', 'Epic Games', 'GOG Galaxy', 'DirectX 12', 'DirectX 11', 'Skellige', 'Toussaint',
  'Kaer Morhen', 'Nilfgaard', 'Monster', 'X', 'Y', 'XP', 'Combo', 'God Mode', 'Teleport', 'Renderer', 'Updates', 'Installation', '›', '–',
  'Radius', 'Ability-ID', 'Skill-ID', 'Head-ID', 'Appearance-ID', 'Witcher-2-Tattoo', 'Velen & Novigrad', 'Scoia’tael', 'Gwint',
  'Wolf', 'Bruxa', 'Alp', 'Barghest', 'Gargoyle', 'Golem', 'Him', 'Fugas', 'Katakan', 'Pesta', 'Wyvern', 'Basilisk', 'Nekker', 'Panther',
  'Eredin', 'Imlerith', 'Eskel', 'Ves', 'Syanna', 'Triss Merigold', 'Vernon Roche', 'Keira Metz', 'Emhyr var Emreis', 'Crach an Craite',
  'Sigismund Dijkstra', 'Banshee', 'Lamia', 'Ignis Fatuus', 'Wyzima', 'DE', 'EN', 'Sprache / Language']);

const missing = [...keys].filter((k) => !SAME.has(k) && !Object.prototype.hasOwnProperty.call(EN, k));
if (process.argv.includes('--list')) { for (const k of missing) console.log(JSON.stringify(k)); console.log(missing.length, 'fehlen von', keys.size); process.exit(0); }

// Platzhalter müssen in beiden Sprachen gleich sein
const badVars = Object.entries(EN).filter(([de, en]) => {
  const v = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  return v(de) !== v(en);
});
assert.deepStrictEqual(badVars, [], 'Platzhalter unterschiedlich: ' + badVars.map((x) => x[0]).join(' | '));
assert.deepStrictEqual(missing, [], `Fehlende englische Texte (${missing.length}):\n` + missing.join('\n'));
console.log(`✓ Übersetzung vollständig: ${keys.size} Texte, ${Object.keys(EN).length} Einträge im Wörterbuch`);

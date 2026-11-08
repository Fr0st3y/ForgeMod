'use strict';
/*
 * Baut aus der eigenen Witcher-3-Installation einen Katalog mit
 * Gegenständen, Gwint-Karten, Kreaturen und Wetter – inklusive deutscher Namen
 * und Bildern. Alles wird nur gelesen; das Ergebnis landet im ForgeMod-Cache
 * (%APPDATA%\ForgeMod\cache\witcher3), nicht im Spielordner.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { openBundle, openTextureCache, encodePNG, readW3Strings } = require('./formats');
const { buildMaps } = require('./maps');
const { readCR2W } = require('./cr2w');
const { t } = require('../../../src/core/i18n');

const CATALOG_VERSION = 13;
const ITEM_BUNDLES = ['xml.bundle', 'dlc0.bundle', 'ep1.bundle', 'bob.bundle'];
// Bestiariums-Einträge (journal\bestiary\*.journal) liegen im Hauptspiel in startup.bundle, sonst in den DLC-Paketen
const JOURNAL_BUNDLES = ['startup.bundle', 'dlc0.bundle', 'ep1.bundle', 'bob.bundle'];
const SIGNS = ['Aard', 'Igni', 'Yrden', 'Quen', 'Axii'];
// Gegen diese Gruppen wirkt das Stahlschwert, sonst das Silberschwert
const STEEL_GROUPS = new Set(['Beasts', 'Humans']);

// ---------- kleine XML-Helfer (die Spieldateien sind sehr regelmäßig) ----------
const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
function attrs(str) {
  const out = {};
  for (const m of str.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}
function* elements(xml, tag) {
  const re = new RegExp(`<${tag}\\s([^>]*?)(\\/?)>`, 'g');
  let m;
  while ((m = re.exec(xml))) {
    let inner = '';
    if (!m[2]) {
      const end = xml.indexOf(`</${tag}>`, re.lastIndex);
      if (end >= 0) { inner = xml.slice(re.lastIndex, end); re.lastIndex = end + tag.length + 3; }
    }
    yield { a: attrs(m[1]), inner };
  }
}

// ---------- Kategorien ----------
const CATEGORY_GROUPS = [
  ['steelsword', 'Stahlschwerter'], ['silversword', 'Silberschwerter'],
  ['armor', 'Rüstungen'], ['gloves', 'Handschuhe'], ['pants', 'Hosen'], ['boots', 'Stiefel'],
  ['crossbow', 'Armbrüste'], ['bolt', 'Bolzen'],
  ['potion', 'Tränke'], ['petard', 'Bomben'], ['oil', 'Öle'], ['mutagen', 'Mutagene'],
  ['upgrade', 'Runen & Glyphen'], ['trophy', 'Trophäen'], ['dye', 'Farbstoffe'],
  ['alchemy_ingredient', 'Alchemie-Zutaten'], ['crafting_ingredient', 'Handwerks-Material'],
  ['alchemy_recipe', 'Alchemie-Rezepte'], ['crafting_schematic', 'Baupläne'],
  ['edibles', 'Essen & Trinken'], ['horse', 'Pferd'], ['book', 'Bücher'], ['key', 'Schlüssel'],
  ['weapon_other', 'Andere Waffen'], ['usable', 'Benutzbar'], ['misc', 'Sonstiges'], ['junk', 'Plunder'],
];
const OTHER_WEAPONS = new Set(['spear2h', 'halberd2h', 'axe2h', 'hammer2h', 'axe1h', 'cleaver1h', 'blunt1h', 'staff2h', 'shield', 'bow', 'secondary']);
function groupOf(cat) {
  if (!cat) return 'misc';
  if (cat.startsWith('horse_')) return 'horse';
  if (OTHER_WEAPONS.has(cat)) return 'weapon_other';
  if (CATEGORY_GROUPS.some(([k]) => k === cat)) return cat;
  return 'misc';
}

// ---------- Gwint ----------
const FACTIONS = {
  F_NORTHERN_KINGDOM: { id: 'nr', name: 'Königreiche des Nordens', enum: 1 },
  F_NILFGAARD: { id: 'nf', name: 'Nilfgaard', enum: 2 },
  F_NO_MANS_LAND: { id: 'mo', name: 'Monster', enum: 3 },
  F_SCOIATAEL: { id: 'st', name: 'Scoia’tael', enum: 4 },
  F_SKELLIGE: { id: 'sk', name: 'Skellige', enum: 5 },
  F_NEUTRAL: { id: 'ne', name: 'Neutral', enum: 0 },
};
const EFFECTS = {
  EFFECT_SUMMON_CLONES: 'Musterung', EFFECT_SAME_TYPE_MORALE: 'Enge Bindung', EFFECT_IMPROVE_NEIGHBOURS: 'Moralschub',
  EFFECT_NURSE: 'Sanitäter', EFFECT_HORN: 'Horn', EFFECT_SCORCH: 'Verbrennen', EFFECT_MELEE_SCORCH: 'Verbrennen (Nah)',
  EFFECT_RANGED_SCORCH: 'Verbrennen (Fern)', EFFECT_DRAW_X2: 'Spion', EFFECT_MORPH: 'Berserker', EFFECT_MUSHROOM: 'Mardroeme',
  EFFECT_SUICIDE_SUMMON: 'Beschwören', EFFECT_CLEAR_SKY: 'Klarer Himmel', EFFECT_UNSUMMON_DUMMY: 'Köder',
};

// ---------- Kreaturen ----------
// Spawn-Alias (aus gameplay\globals\resources\gameplay.xml von Hauptspiel + DLCs), deutscher Name
// (wie im Spiel), Gruppe und Bild:
//   b:<x>  Bestiarium-Artwork  gui_new\textures\journal\bestiary\bestiary_<x>.png
//   c:<x>  Charakter-Portrait  gui_new\textures\journal\characters\journal_<x>.png
//   i:<x>  Inventar-Icon des Gegenstands <x>
// story: Hauptfiguren – ein zweites Exemplar kann Quests durcheinanderbringen.
const CREATURES = [
  // Monster
  ['wolf', 'Wolf', 'monster', 'b:wolf'], ['wolf_alpha', 'Leitwolf', 'monster', 'b:wolf'],
  ['wolf_white', 'Weißer Wolf', 'monster', 'b:wolf'], ['wolf_white_lvl3__alpha', 'Weißer Leitwolf', 'monster', 'b:wolf'],
  ['wild_dog', 'Wildhund', 'monster', 'b:dog'],
  ['bear_black', 'Schwarzbär', 'monster', 'b:bear'], ['bear_grizzly', 'Grizzlybär', 'monster', 'b:bear'], ['bear_white', 'Eisbär', 'monster', 'b:bear'],
  ['bear_berserker', 'Berserker (Bär)', 'monster', 'b:bersekerbear'],
  ['nekker', 'Nekker', 'monster', 'b:nekker'], ['nekker_warrior', 'Nekker-Krieger', 'monster', 'b:nekker'],
  ['drowner', 'Ertrunkener', 'monster', 'b:drowner'], ['drowner_lvl4__dead', 'Ertrunkener Toter', 'monster', 'b:drowner'],
  ['ghoul', 'Ghul', 'monster', 'b:ghoul'], ['alghoul', 'Alghul', 'monster', 'b:alghoul'], ['rotfiend', 'Moderhaut', 'monster', 'b:zgnilec'],
  ['harpy', 'Harpyie', 'monster', 'b:harpy'], ['erynia', 'Erynie', 'monster', 'b:erynia'],
  ['siren', 'Sirene', 'monster', 'b:siren'], ['lamia', 'Lamia', 'monster', 'b:lamiamh210'],
  ['endriaga_worker', 'Endriaga-Arbeiterin', 'monster', 'b:enddriagaworker'], ['endriaga_tailed', 'Endriaga-Kriegerin', 'monster', 'b:endriagatailed'],
  ['endriaga_spikey', 'Endriagendrohne', 'monster', 'b:endriagaspikey'],
  ['arachas', 'Krabbspinne', 'monster', 'b:arachas'], ['arachas_armored', 'Gepanzerte Krabbspinne', 'monster', 'b:arachasarmored'],
  ['arachas_poison', 'Giftige Krabbspinne', 'monster', 'b:poisonarachas'],
  ['wraith', 'Erscheinung', 'monster', 'b:wraith'], ['noonwraith', 'Mittagserscheinung', 'monster', 'b:noonwraith'],
  ['nightwraith', 'Nachterscheinung', 'monster', 'b:nightwraith'], ['pesta', 'Pesta', 'monster', 'b:pesta'],
  ['werewolf', 'Werwolf', 'monster', 'b:werewolf'], ['lycan', 'Lykanthrop', 'monster', 'b:licantropy'],
  ['katakan', 'Katakan', 'monster', 'b:katakan'], ['ekimma', 'Ekimma', 'monster', 'b:ekkima'],
  ['gravehag', 'Gruftweib', 'monster', 'b:gravehag'], ['waterhag', 'Wasserweib', 'monster', 'b:waterhag'],
  ['fogling', 'Nebling', 'monster', 'b:fogling'], ['willowisp', 'Ignis Fatuus', 'monster', 'b:foglingmh108'],
  ['forktail', 'Gabelschwanz', 'monster', 'b:fortail'], ['wyvern', 'Wyvern', 'monster', 'b:wyvern'],
  ['basilisk', 'Basilisk', 'monster', 'b:bazyliszek'], ['cockatrice', 'Gorgo', 'monster', 'b:kuroliszek'],
  ['troll', 'Felstroll', 'monster', 'b:troll'], ['troll_cave_lvl3__ice', 'Eistroll', 'monster', 'b:icetroll'],
  ['golem', 'Golem', 'monster', 'b:golem'], ['ice_golem', 'Eisgenius', 'monster', 'b:iceelemental'],
  ['ifrit', 'Feuergenius', 'monster', 'b:fireelemental'], ['dao', 'Erdgenius', 'monster', 'b:earthelemental'],
  ['gargoyle', 'Gargoyle', 'monster', 'b:gargoyle'], ['botchling', 'Fehlgeborener', 'monster', 'b:poroniec'],
  ['wildhunt_minion', 'Hund der Wilden Jagd', 'monster', 'b:wildhuntminion'],
  // Große Monster & Bosse
  ['gryphon', 'Greif', 'boss', 'b:gryphon'], ['volcanic_gryphon', 'Vulkanischer Greif', 'boss', 'b:gryphonmh301'],
  ['wyvern_mh', 'Königswyvern', 'boss', 'b:royalwyvern'], ['black_troll', 'Schwarzer Troll', 'boss', 'b:trollmh201'],
  ['ice_giant', 'Eisriese', 'boss', 'b:icegiant'], ['cyclop', 'Zyklop', 'boss', 'b:cyclop'],
  ['leshen', 'Waldschrat', 'boss', 'b:leshen'], ['lessog_lvl2__ancient', 'Alter Waldschrat', 'boss', 'b:leshenmh302'],
  ['bies', 'Unhold', 'boss', 'b:fiend'], ['czart', 'Tschort', 'boss', 'b:czart'],
  ['werewolf_lvl4__lycan', 'Lykanthrop (stark)', 'boss', 'b:licantropy'], ['katakan_large', 'Großer Katakan', 'boss', 'b:katakanmh304'],
  ['him', 'Him', 'boss', 'b:him'], ['fugas', 'Fugas', 'boss', 'c:fugas'], ['succubus', 'Sukkubus', 'boss', 'b:succubus'],
  ['witch_1', 'Weberin (Muhme)', 'boss', 'b:crones'], ['witch_2', 'Brauerin (Muhme)', 'boss', 'b:crones'], ['witch_3', 'Flüsterin (Muhme)', 'boss', 'b:crones'],
  ['red_miasmal', 'Geist der Teufelsgrube', 'boss', 'b:red_miasmal'],
  // Hearts of Stone
  ['black_spider', 'Arachnomorph', 'monster', 'b:blackspider', 'hos'], ['black_spider_large', 'Großer Arachnomorph', 'boss', 'b:blackspider', 'hos'],
  ['ethereal', 'Ätherische Erscheinung', 'boss', 'b:etheral', 'hos'], ['iris', 'Iris’ Albtraum', 'boss', 'b:irismonster', 'hos'],
  ['mon_toad', 'Kröterich (Krötenprinz)', 'boss', 'b:toad', 'hos'], ['caretaker', 'Pedell', 'boss', 'b:caretaker', 'hos'],
  ['boar', 'Wildschwein', 'animal', 'b:boar', 'hos'],
  // Blood and Wine
  ['bruxa', 'Bruxa', 'monster', 'b:bruxa', 'bw'], ['alp', 'Alp', 'monster', 'b:alp', 'bw'], ['fleder', 'Flatterer', 'monster', 'b:fleder', 'bw'],
  ['garkain', 'Garkin', 'monster', 'b:garkain', 'bw'], ['gravier', 'Gravier', 'monster', 'b:graveir', 'bw'],
  ['barghest', 'Barghest', 'monster', 'b:barghest', 'bw'], ['wight', 'Wicht', 'monster', 'b:wicht', 'bw'],
  ['kikimore', 'Kikimora-Krieger', 'monster', 'b:kikimore_warrior', 'bw'], ['kikimore_small', 'Kikimora-Arbeiter', 'monster', 'b:kikimore_worker', 'bw'],
  ['archespor_normal', 'Archespore', 'monster', 'b:echinops', 'bw'], ['scolopendromorph', 'Riesentausendfüßler', 'monster', 'b:scolopendromorph', 'bw'],
  ['dracolizard', 'Schleimling', 'boss', 'b:dracolizard', 'bw'], ['sharley', 'Glumaar', 'boss', 'b:sharley', 'bw'],
  ['sprigan', 'Waldteufel', 'boss', 'b:spriggan', 'bw'], ['cloud_giant', 'Wolkenriese', 'boss', 'b:cloud_giant', 'bw'],
  ['dagonet', 'Golyat', 'boss', 'b:dagonet', 'bw'], ['banshee', 'Banshee', 'boss', 'b:banshee', 'bw'],
  ['bigbadwolf', 'Großer Böser Wolf', 'boss', 'b:bigbadwolf', 'bw'], ['fairytale_witch', 'Märchenhexe', 'boss', 'b:fairy_witch', 'bw'],
  ['spooncollector', 'Löffelsammler', 'boss', 'b:spooncollector', 'bw'], ['dettlaff', 'Dettlaff (Bestie)', 'boss', 'b:detlaff_monster', 'bw'],
  ['dettlaff_vampire', 'Dettlaff (Höherer Vampir)', 'boss', 'b:dettlaff_vampire', 'bw'], ['panther', 'Panther', 'animal', 'b:panther', 'bw'],
  // Menschen & Figuren
  ['e3_bandit_sword', 'Bandit (Schwert)', 'human', 'i:Short sword 1'], ['e3_bandit_bow', 'Bandit (Bogen)', 'human', 'i:Crossbow 1'],
  ['e3_bandit_shield', 'Bandit (Schild)', 'human', 'i:W_Axe02'], ['e3_bandit_2hand', 'Bandit (Zweihänder)', 'human', 'i:W_Axe03'],
  ['witcher', 'Hexer (Gegner)', 'human', 'i:Wolf School steel sword 1'], ['sorceress', 'Zauberin (Gegnerin)', 'human', 'i:lore_lodge_of_sorceresses'], ['rider', 'Reiter mit Pferd', 'human', 'i:Horse Saddle 3'],
  ['wildhunt_sword', 'Krieger der Wilden Jagd', 'human', 'i:Wild Hunt sword 4'], ['eredin', 'Eredin', 'human', 'c:eredin', null, true],
  ['imlerith', 'Imlerith', 'human', 'c:imlerith', null, true], ['eskel', 'Eskel', 'human', 'c:eskel', null, true],
  ['letho', 'Letho von Guleta', 'human', 'c:letho', null, true], ['triss', 'Triss Merigold', 'human', 'c:triss', null, true],
  ['yennefer', 'Yennefer von Vengerberg', 'human', 'c:yenn', null, true], ['dandelion', 'Rittersporn', 'human', 'c:dandelion', null, true],
  ['roche', 'Vernon Roche', 'human', 'c:roche', null, true], ['ves', 'Ves', 'human', 'c:ves', null, true],
  ['keira', 'Keira Metz', 'human', 'c:keira', null, true], ['red_baron', 'Der Blutige Baron', 'human', 'c:baron', null, true],
  ['emhyr', 'Emhyr var Emreis', 'human', 'c:emhyr', null, true], ['djikstra', 'Sigismund Dijkstra', 'human', 'c:dijkstra', null, true],
  ['crach', 'Crach an Craite', 'human', 'c:crach', null, true], ['avallac_h', 'Avallac’h', 'human', 'c:avallachunlocked', null, true],
  ['merchant', 'Fahrender Händler', 'human', ''], ['syanna', 'Syanna', 'human', 'c:syanna', 'bw', true],
  ['regis_vampire', 'Regis (Vampir)', 'human', 'c:regis', 'bw', true],
  // Tiere
  ['horse', 'Pferd', 'animal', 'c:roach'], ['cow', 'Kuh', 'animal', 'i:Cow hide'], ['pig', 'Schwein', 'animal', 'i:Grilled pork'],
  ['chicken', 'Hühnchen', 'animal', 'i:Chicken'], ['rooster', 'Hahn', 'animal', 'i:Roasted chicken'], ['goat', 'Ziege', 'animal', 'i:Goat hide'],
  ['sheep', 'Schaf', 'animal', 'i:Old sheep skin'], ['ram', 'Widder', 'animal', 'i:Old sheep skin'], ['dog', 'Hund', 'animal', 'b:dog'],
  ['cat', 'Katze', 'animal', ''], ['deer', 'Hirsch', 'animal', 'i:Deer hide'], ['hare', 'Hase', 'animal', 'i:Rabbit pelt'],
  ['goose', 'Gans', 'animal', ''], ['crow', 'Krähe', 'animal', 'i:Crows eye'], ['seagull', 'Möwe', 'animal', ''],
  ['pigeon', 'Taube', 'animal', ''], ['rat', 'Ratte', 'animal', ''], ['toad', 'Kröte', 'animal', 'b:toad'], ['crab', 'Krabbe', 'animal', ''],
  ['peacock', 'Pfau', 'animal', 'i:Peacock feather', 'bw'], ['pheasant', 'Fasan', 'animal', 'i:Pheasant gutted', 'bw'],
];
const RESOURCE_XMLS = new Set([
  'gameplay\\globals\\resources\\gameplay.xml',
  'dlc\\ep1\\data\\gameplay\\globals\\resources\\gameplay.xml',
  'dlc\\bob\\data\\gameplay\\globals\\resources\\gameplay.xml',
]);

// ---------- Ausrüstung: Seltenheit & Varianten ----------
const GEAR_GROUPS = new Set(['steelsword', 'silversword', 'armor', 'gloves', 'pants', 'boots', 'crossbow', 'weapon_other']);
const SCHOOLS = { WolfSet: 'Wolf', LynxSet: 'Katze', GryphonSet: 'Greif', BearSet: 'Bär', RedWolfSet: 'Mantikor', ViperSet: 'Viper', NetflixSet: 'Netflix' };
function gearInfo(it, abilities) {
  let q = 0, min, max;
  for (const ab of it.base || []) {
    const x = abilities.get(ab);
    if (!x) continue;
    if (x.q) q = Math.max(q, x.q);
    if (x.min !== undefined) min = x.min;
    if (x.max !== undefined) max = x.max;
  }
  const tags = it.tags || [];
  const school = Object.keys(SCHOOLS).find((t) => tags.includes(t));
  return {
    rarity: q || 1, // wie GetItemQuality(): ohne Angabe = gewöhnlich
    // "Autogen": das Spiel berechnet Werte und Stufe beim Erhalt passend zur Spielerstufe
    scales: tags.includes('Autogen') ? (tags.includes('AutogenUseLevelRange') && min !== undefined ? [min, max ?? min] : true) : false,
    variant: /^NGP /.test(it.id) ? 'ngp' : /_crafted$/.test(it.id) ? 'crafted' : /^NPC /i.test(it.id) ? 'npc' : null,
    school: school ? t(SCHOOLS[school]) : null,
  };
}

const WEATHER_DE = {
  WT_Clear: 'Klar', WT_Light_Clouds: 'Leicht bewölkt', WT_Mid_Clouds: 'Bewölkt', WT_Mid_Clouds_Dark: 'Bewölkt (dunkel)',
  WT_Heavy_Clouds: 'Stark bewölkt', WT_Heavy_Clouds_Dark: 'Stark bewölkt (dunkel)', WT_Rain_Storm: 'Gewitter', WT_Fog: 'Nebel',
  WT_Snow: 'Schnee', WT_Blizzard: 'Schneesturm', WT_Wild_Hunt: 'Wilde Jagd', WT_Heavy_Distant: 'Fernes Unwetter',
  WT_Grey_Sky: 'Grauer Himmel', WT_Light_Rain: 'Leichter Regen', WT_Mid_Clouds_Fog: 'Bewölkt mit Nebel', WT_Light_Snow: 'Leichter Schnee',
};
// Das Spiel kennt pro Region nur die Wetter aus deren Tabelle – im Namen zeigen, wo es geht
const REGION_DE = { novigrad: 'Velen/Novigrad', skellige: 'Skellige', bob: 'Toussaint', kaer_morhen: 'Kaer Morhen', prolog: 'Weißgarten' };

function fileSig(file) {
  try { const s = fs.statSync(file); return `${path.basename(file)}:${s.size}:${Math.round(s.mtimeMs)}`; } catch (_) { return `${path.basename(file)}:-`; }
}

class W3GameData {
  constructor({ root, cacheDir, lang = 'de', log = () => {} }) {
    this.root = root;
    this.content = path.join(root, 'content', 'content0');
    this.cacheDir = cacheDir;
    this.imgDir = path.join(cacheDir, 'img');
    this.lang = lang;
    this.log = log;
    this.catalog = null;
    this.tc = null;
    this.texIndex = null;
    this.loading = null;
  }

  signature() {
    const files = [...new Set([...ITEM_BUNDLES, ...JOURNAL_BUNDLES])].map((b) => path.join(this.content, 'bundles', b))
      .concat([path.join(this.content, `${this.lang}.w3strings`), path.join(this.content, 'texture.cache')]);
    return `v${CATALOG_VERSION}|${this.lang}|` + files.map(fileSig).join('|');
  }

  load(onProgress = () => {}) {
    if (this.catalog) return Promise.resolve(this.catalog);
    if (!this.loading) this.loading = this._load(onProgress).finally(() => { this.loading = null; });
    return this.loading;
  }

  async _load(onProgress) {
    fs.mkdirSync(this.imgDir, { recursive: true });
    const file = path.join(this.cacheDir, `catalog-${this.lang}.json`);
    const sig = this.signature();
    try {
      const cached = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (cached.signature === sig) { this.catalog = cached; return cached; }
    } catch (_) {}
    onProgress(t('Lese Spieldaten …'), 0.05);
    await new Promise((r) => setImmediate(r));
    const cat = this.build(onProgress);
    cat.signature = sig;
    fs.writeFileSync(file, JSON.stringify(cat));
    this.catalog = cat;
    return cat;
  }

  textures() {
    if (!this.tc) {
      this.tc = openTextureCache(path.join(this.content, 'texture.cache'));
      // Index: Pfad ab "gui_new\" (ohne DLC-Präfix) -> voller Name
      this.texIndex = new Map();
      for (const n of this.tc.names()) {
        const i = n.indexOf('gui_new\\');
        if (i < 0) continue;
        const key = n.slice(i + 8);
        // Basisspiel bevorzugen, DLC als Ersatz
        if (!this.texIndex.has(key) || !n.startsWith('dlc\\')) this.texIndex.set(key, n);
      }
    }
    return this.tc;
  }

  resolveTexture(rel) {
    if (!rel) return null;
    this.textures();
    const key = rel.replace(/\//g, '\\').toLowerCase().replace(/^gameplay\\gui_new\\/, '');
    return this.texIndex.get(key) || this.texIndex.get(key.replace(/\.(dds|xbm)$/, '.png')) || null;
  }

  build(onProgress) {
    const strings = readW3Strings(path.join(this.content, `${this.lang}.w3strings`));
    let fallback = null;
    if (this.lang !== 'en') { try { fallback = readW3Strings(path.join(this.content, 'en.w3strings')); } catch (_) {} }
    const L = (k) => (k && (strings.byKey(k) || (fallback && fallback.byKey(k)))) || null;
    onProgress(t('Lese Gegenstände …'), 0.2);

    const items = new Map();
    const abilities = new Map(); // Ability -> { q: Seltenheit 1–5, min/max: Stufenbereich }
    let cardXml = '', kingXml = '', resXml = '';
    const weather = new Map();
    for (const bn of ITEM_BUNDLES) {
      let b;
      try { b = openBundle(path.join(this.content, 'bundles', bn)); } catch (_) { continue; }
      try {
        for (const it of b.items) {
          const n = it.name.toLowerCase();
          if (!n.endsWith('.xml') && !n.endsWith('.csv')) continue;
          if (n.endsWith('gameplay\\items\\def_gwint_cards_final.xml')) { cardXml = b.read(it).toString('utf8'); continue; }
          if (n.endsWith('gameplay\\items\\def_gwint_battle_king_cards.xml')) { kingXml = b.read(it).toString('utf8'); continue; }
          if (RESOURCE_XMLS.has(n)) { resXml += stripComments(b.read(it).toString('utf8')); continue; }
          if (!/\\items(_plus)?\\[^\\]+\.xml$/.test(n)) continue;
          const xml = stripComments(b.read(it).toString('utf8'));
          // Seltenheit ("quality") und Stufenbereich stehen in den Abilities der Gegenstände
          for (const m of xml.matchAll(/<ability\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/ability>/g)) {
            const q = m[2].match(/<quality\b[^>]*\bmin="(\d+)"/);
            const lmin = m[2].match(/<item_level_min\b[^>]*\bmin="(\d+)"/);
            const lmax = m[2].match(/<item_level_max\b[^>]*\bmin="(\d+)"/);
            if (q || lmin || lmax) {
              const prevA = abilities.get(m[1]) || {};
              abilities.set(m[1], { q: q ? Number(q[1]) : prevA.q, min: lmin ? Number(lmin[1]) : prevA.min, max: lmax ? Number(lmax[1]) : prevA.max });
            }
          }
          if (!xml.includes('<item')) continue;
          const dlc = (n.match(/^dlc\\(\w+)\\/) || [])[1] || null;
          for (const { a, inner } of elements(xml, 'item')) {
            if (!a.name || !a.icon_path) continue;
            const tags = ((inner.match(/<tags>([\s\S]*?)<\/tags>/) || [])[1] || '').split(',').map((t) => t.trim()).filter(Boolean);
            const prev = items.get(a.name);
            const maxAbl = (inner.match(/max_card_(\d)/) || [])[1];
            const base = [...((inner.match(/<base_abilities>([\s\S]*?)<\/base_abilities>/) || [])[1] || '').matchAll(/<a>([^<]+)<\/a>/g)].map((x) => x[1].trim());
            items.set(a.name, {
              id: a.name,
              cat: a.category || prev?.cat || '',
              icon: a.icon_path || prev?.icon,
              nameKey: a.localisation_key_name || prev?.nameKey,
              descKey: a.localisation_key_description || prev?.descKey,
              price: Number(a.price) || prev?.price || 0,
              tags: tags.length ? tags : (prev?.tags || []),
              dlc: dlc || prev?.dlc || null,
              maxCards: maxAbl !== undefined ? Number(maxAbl) : prev?.maxCards,
              base: base.length ? base : (prev?.base || []),
            });
          }
        }
      } finally { b.close(); }
    }
    // Wetter-Namen aus den Wetter-Tabellen der Regionen
    // (Hauptspiel: startup.bundle, Toussaint: bob.bundle – dlc\bob\data\fx\environment\weather\weather_bob.csv)
    for (const bn of ['startup.bundle', 'bob.bundle']) {
      try {
        const sb = openBundle(path.join(this.content, 'bundles', bn));
        try {
          for (const it of sb.items) {
            const m = it.name.match(/weather_([a-z_]+)\.csv$/i);
            if (!m || !/environment/i.test(it.name)) continue;
            const region = m[1];
            for (const line of sb.read(it).toString('utf8').split(/\r?\n/).slice(1)) {
              const w = line.split(';')[0].trim();
              if (/^WT_/.test(w)) { if (!weather.has(w)) weather.set(w, new Set()); weather.get(w).add(region); }
            }
          }
        } finally { sb.close(); }
      } catch (_) {}
    }

    onProgress(t('Ordne Bilder zu …'), 0.55);
    this.textures();

    // ---------- Gwint-Karten ----------
    // Karten-Gegenstände nach Lokalisierungs-Schlüssel (so ordnet auch das Spiel sie zu)
    const cardItemsByKey = new Map();
    for (const it of items.values()) {
      if (it.cat !== 'gwint' || !it.id.startsWith('gwint_card_')) continue;
      if (!cardItemsByKey.has(it.nameKey)) cardItemsByKey.set(it.nameKey, []);
      cardItemsByKey.get(it.nameKey).push(it);
    }
    const cards = [];
    const usedItems = new Set();
    const defs = [...elements(stripComments(cardXml), 'card'), ...elements(stripComments(kingXml), 'card')];
    // Gegenstände, die per Namensregel schon einer Karte gehören, nicht doppelt vergeben
    for (const { a } of defs) if (items.has(`gwint_card_${a.name}`)) usedItems.add(`gwint_card_${a.name}`);
    for (const { a, inner } of defs) {
      if (!a.title || a.name === 'dummy_leader') continue;
      const flags = [...inner.matchAll(/<flag name="([^"]+)"/g)].map((m) => m[1]);
      const f = FACTIONS[a.faction_index] || FACTIONS.F_NEUTRAL;
      const leader = flags.includes('TYPE_KING');
      // passenden Gegenstand finden – das Spiel benennt ihn fast immer "gwint_card_<Kartenname>"
      let item = null;
      const byName = items.get(`gwint_card_${a.name}`);
      if (a.item && items.has(a.item)) item = items.get(a.item);
      else if (byName && byName.cat === 'gwint') item = byName;
      else if (leader) {
        const m = a.title.match(/^gwint_name_(\w+?)_(copper|bronze|silver|gold|platinium)$/);
        if (m && m[2] !== 'copper') item = items.get(`gwint_card_${m[1]}_${m[2]}`) || null;
      } else {
        const list = (cardItemsByKey.get(a.title) || []).filter((x) => !usedItems.has(x.id));
        const gog = /gog/i.test(a.name);
        item = list.find((x) => gog === /_gog_/.test(x.id)) || list[0] || null;
      }
      if (item) usedItems.add(item.id);
      const rows = ['TYPE_MELEE', 'TYPE_RANGED', 'TYPE_SIEGE'].filter((r) => flags.includes(r))
        .map((r) => ({ TYPE_MELEE: 'nah', TYPE_RANGED: 'fern', TYPE_SIEGE: 'belagerung' })[r]);
      let kind = 'unit';
      if (leader) kind = 'leader';
      else if (flags.includes('TYPE_WEATHER') || flags.includes('EFFECT_CLEAR_SKY')) kind = 'weather';
      else if (!flags.includes('TYPE_CREATURE')) kind = 'special';
      const key = a.title + '|' + a.faction_index;
      const nice = (L(a.title) || a.name.replace(/_/g, ' ')).replace(/<br\s*\/?>/gi, ' – ');
      const existing = !leader && cards.find((c) => c.key === key);
      // Jede Kopie hat im Spiel eine eigene Nummer (index) – so steht sie auch in der Sammlung im Spielstand
      const def = { i: Number(a.index), item: item ? item.id : null };
      if (existing) {
        // weitere Kopie derselben Karte (z. B. Nekker 2, Nekker 3, GOG-Variante)
        existing.defs.push(def);
        if (item) existing.items.push(item.id);
        else existing.cards.push(a.name);
        existing.copies += 1;
        if (existing.starter && item) existing.starter = false;
        continue;
      }
      cards.push({
        key,
        id: item ? item.id : `card:${a.name}`,
        items: item ? [item.id] : [],
        cards: item ? [] : [a.name],
        card: a.name,
        defs: [def],
        copies: 1,
        name: nice,
        desc: (L(a.description) || '').replace(/<br\s*\/?>/gi, ' '),
        faction: f.id,
        power: Number(a.power) || 0,
        hero: flags.includes('TYPE_HERO'),
        spy: flags.includes('TYPE_SPY'),
        rows,
        kind,
        abilities: flags.filter((x) => EFFECTS[x]).map((x) => t(EFFECTS[x])),
        img: this.resolveTexture(`icons\\gwint\\${a.picture}.png`),
        starter: !item,
        dlc: item?.dlc || null,
      });
    }
    for (const c of cards) delete c.key;
    cards.sort((x, y) => (x.kind === 'leader') - (y.kind === 'leader') || y.power - x.power || x.name.localeCompare(y.name, 'de'));

    onProgress(t('Lese Kreaturen …'), 0.75);
    // ---------- Gegenstände ----------
    const outItems = [];
    for (const it of items.values()) {
      if (it.cat === 'gwint' || !/^[\w \-.]+$/.test(it.id)) continue;
      const name = L(it.nameKey);
      if (!name || name.startsWith('[') || name.length > 80) continue;
      const desc = L(it.descKey) || '';
      const group = groupOf(it.cat);
      const entry = {
        id: it.id, name, desc: desc.length > 400 ? desc.slice(0, 400) + '…' : desc,
        group, cat: it.cat, price: it.price,
        icon: this.resolveTexture(it.icon), dlc: it.dlc,
        quest: it.tags.includes('Quest'),
      };
      if (GEAR_GROUPS.has(group)) Object.assign(entry, gearInfo(it, abilities));
      outItems.push(entry);
    }
    outItems.sort((x, y) => x.name.localeCompare(y.name, 'de'));

    // ---------- Kreaturen ----------
    const aliases = new Set([...resXml.matchAll(/<res\s+alias="([^"]+)"/g)].map((m) => m[1].toLowerCase()));
    const creatureImage = (ref) => {
      const [kind, key] = [ref.slice(0, 1), ref.slice(2).toLowerCase()];
      if (kind === 'b') {
        return this.resolveTexture(`textures\\journal\\bestiary\\bestiary_${key}.png`)
          || this.resolveTexture(`icons\\monsters\\bestiary_${key}.png`);
      }
      if (kind === 'c') return this.resolveTexture(`textures\\journal\\characters\\journal_${key}.png`);
      if (kind === 'i') { const it = items.get(ref.slice(2)); return it ? this.resolveTexture(it.icon) : null; }
      return null;
    };
    const creatures = CREATURES
      .filter(([id]) => aliases.size === 0 || aliases.has(id.toLowerCase()))
      .map(([id, name, group, ref, dlc = null, story = false]) => ({
        id, name: t(name), group, dlc, story,
        icon: ref ? creatureImage(ref) : null,
        animal: group === 'animal',
      }));
    const missing = CREATURES.filter(([id]) => aliases.size && !aliases.has(id.toLowerCase())).map(([id]) => id);
    if (missing.length) this.log('warn', t('Kreaturen ohne Spawn-Eintrag in dieser Spielversion ausgeblendet: {list}', { list: missing.join(', ') }));

    const weatherList = [...weather.entries()].filter(([id]) => !/q\d|battle|vesemir|lessun|arena|fight|hell|_\d/i.test(id))
      .map(([id, regions]) => {
        const where = [...regions].map((r) => REGION_DE[r]).filter(Boolean).map((r) => t(r));
        const base = WEATHER_DE[id] ? t(WEATHER_DE[id]) : id.replace(/^WT_/, '').replace(/_/g, ' ');
        return { id, name: where.length && where.length < 5 ? `${base} (${where.join(', ')})` : base, regions: [...regions] };
      })
      .filter((w) => w.regions.some((r) => REGION_DE[r]))
      .sort((a, b) => b.regions.length - a.regions.length);

    onProgress(t('Lese Bestiarium …'), 0.85);
    let bestiary = { groups: [], entries: [] };
    try { bestiary = this.bestiary(strings, fallback, outItems); } catch (e) { this.log('warn', t('Bestiarium konnte nicht gelesen werden: {error}', { error: e.message })); }

    onProgress(t('Lese Karten …'), 0.9);
    let maps = [];
    try { maps = buildMaps({ content: this.content, texIndex: this.texIndex, LK: (k) => strings.byKey(k) || (fallback && fallback.byKey(k)) || null }); } catch (e) { this.log('warn', t('Karten konnten nicht gelesen werden: {error}', { error: e.message })); }

    onProgress(t('Fertig'), 1);
    return {
      version: CATALOG_VERSION,
      lang: this.lang,
      factions: Object.values(FACTIONS).map(({ id, name, enum: e }) => ({ id, name: t(name), enum: e })),
      groups: CATEGORY_GROUPS.map(([id, name]) => ({ id, name: t(name), count: outItems.filter((i) => i.group === id).length })).filter((g) => g.count),
      cards, items: outItems, creatures, weather: weatherList, maps, bestiary,
    };
  }

  // ---------- Bestiarium ----------
  // Jede Kreatur: Name, Bild, Beschreibungen und die Schwachstellen-Liste des Spiels (itemsUsedAgainstCreature).
  // Die Kennung (guid) ist dieselbe wie im Spielstand – darüber erkennt ForgeMod, was man schon entdeckt hat.
  bestiary(strings, fallback, outItems) {
    const S = (id) => (id && (strings.byId(id) || (fallback && fallback.byId(id)))) || null;
    const hex = (pr) => (pr && pr.data.length >= 16 ? pr.data.subarray(0, 16).toString('hex') : null);
    const loc = (pr) => (pr && pr.data.length >= 4 ? S(pr.data.readUInt32LE(0)) : null);
    const str = (pr) => {
      if (!pr || !pr.data.length) return null;
      const l = pr.data[0];
      return l & 0x80 ? pr.data.toString('latin1', 1, 1 + (l & 0x7f)) : pr.data.toString('utf16le', 1, 1 + l * 2);
    };
    // Spieltexte: <br> -> Zeilenumbruch, andere Tags weg; kursiver Anfang = Zitat
    const clean = (txt) => txt.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{3,}/g, '\n\n').trim();
    const itemById = new Map(outItems.map((x) => [x.id, x]));
    const groups = new Map();      // guid -> { id, key, name }
    const raw = [];
    for (const bn of JOURNAL_BUNDLES) {
      let b;
      try { b = openBundle(path.join(this.content, 'bundles', bn)); } catch (_) { continue; }
      try {
        for (const it of b.items) {
          if (!/journal\\bestiary\\[^\\]+\.journal$/i.test(it.name)) continue;
          let doc;
          try { doc = readCR2W(b.read(it)); } catch (_) { continue; }
          const byParent = new Map();
          for (const c of doc.chunks) {
            const pg = hex(c.props.parentGuid);
            if (pg) { if (!byParent.has(pg)) byParent.set(pg, []); byParent.get(pg).push(c); }
          }
          for (const c of doc.chunks) {
            if (c.type === 'CJournalCreatureGroup') {
              groups.set(hex(c.props.guid), { key: str(c.props.baseName), name: loc(c.props.name) });
            } else if (c.type === 'CJournalCreature') {
              const guid = hex(c.props.guid);
              const name = loc(c.props.name);
              if (!guid || !name) continue; // tote Doppel-Einträge im Spiel haben keinen Namen
              const arr = c.props.itemsUsedAgainstCreature;
              const weakNames = arr ? Array.from({ length: arr.data.readUInt32LE(0) }, (_, i) => doc.names[arr.data.readUInt16LE(4 + i * 2)]) : [];
              // Beschreibungen hängen an der Beschreibungsgruppe der Kreatur
              const texts = [];
              for (const g of byParent.get(guid) || []) {
                if (g.type !== 'CJournalCreatureDescriptionGroup' && g.type !== 'CJournalCreatureGameplayHintGroup') continue;
                for (const e of byParent.get(hex(g.props.guid)) || []) {
                  const txt = loc(e.props.description);
                  if (txt) texts.push({ text: clean(txt), quote: /^\s*<i>/i.test(txt), hint: g.type === 'CJournalCreatureGameplayHintGroup' });
                }
              }
              raw.push({ guid, name, group: hex(c.props.linkedParentGuid) || hex(c.props.parentGuid), image: str(c.props.image), weakNames, texts,
                dlc: bn === 'ep1.bundle' ? 'hos' : bn === 'bob.bundle' ? 'bw' : null });
            }
          }
        }
      } finally { b.close(); }
    }
    // Gleichnamige Gruppen (z. B. Ogroide aus einem DLC) zusammenlegen
    const groupList = [];
    const groupByName = new Map();
    for (const [guid, g] of groups) {
      if (!g.name) continue;
      if (!groupByName.has(g.name)) { const entry = { id: g.key || guid, name: g.name }; groupByName.set(g.name, entry); groupList.push(entry); }
      groups.get(guid).id = groupByName.get(g.name).id;
    }
    const weak = (n) => {
      if (SIGNS.includes(n)) return { kind: 'sign', id: n, name: n };
      const it = itemById.get(n);
      if (!it) return null;
      const kind = it.cat === 'oil' ? 'oil' : it.cat === 'petard' ? 'bomb' : it.cat === 'potion' ? 'potion' : null;
      if (!kind) return null;
      // Stufen: "Bestienöl 1" -> 2 -> 3, soweit es sie im Spiel gibt
      const base = n.replace(/ \d$/, '');
      const levels = /\d$/.test(n) ? [1, 2, 3].map((l) => `${base} ${l}`).filter((x) => itemById.has(x)) : [n];
      return { kind, id: n, name: it.name, icon: it.icon, levels };
    };
    const entries = raw.map((r) => {
      const g = groups.get(r.group);
      return {
        id: r.guid, name: r.name, group: g ? g.id : null, dlc: r.dlc,
        img: r.image ? this.resolveTexture(`textures\\journal\\bestiary\\${r.image}`) : null,
        steel: g ? STEEL_GROUPS.has(g.key) : false,
        texts: r.texts,
        weak: r.weakNames.map(weak).filter(Boolean),
      };
    });
    // Gleiche Kreatur mehrfach im Spiel (z. B. in Hearts of Stone und Blood and Wine): zusammenführen.
    // ids enthält alle Kennungen – entdeckt ist sie, sobald eine davon im Spielstand steht.
    const merged = new Map();
    for (const e of entries) {
      const key = `${e.name}|${e.group}`;
      const m = merged.get(key);
      if (!m) { merged.set(key, { ...e, ids: [e.id] }); continue; }
      m.ids.push(e.id);
      if (!m.img && e.img) m.img = e.img;
      if (e.weak.length > m.weak.length) m.weak = e.weak;
      if (e.texts.length > m.texts.length) m.texts = e.texts;
    }
    const list = [...merged.values()].sort((a, b) => a.name.localeCompare(b.name, this.lang));
    groupList.sort((a, b) => a.name.localeCompare(b.name, this.lang));
    return { groups: groupList.filter((g) => list.some((e) => e.group === g.id)), entries: list };
  }

  // PNG für eine Textur (mit Datei-Cache)
  image(texName, maxW) {
    if (!texName) return null;
    const key = crypto.createHash('sha1').update(`v2|${texName}|${maxW || 0}`).digest('hex').slice(0, 20);
    const file = path.join(this.imgDir, key + '.png');
    try { return fs.readFileSync(file); } catch (_) {}
    const tex = this.textures().readRGBA(texName);
    if (!tex) return null;
    let { w, h, rgba } = tex;
    // Journal-Artworks (Bestiarium, Figuren) haben viel transparenten Rand
    if (/\\textures\\journal\\/i.test(texName)) ({ w, h, rgba } = trimAlpha(rgba, w, h));
    if (maxW && w > maxW) { ({ w, h, rgba } = downscale(rgba, w, h, maxW)); }
    const png = encodePNG(rgba, w, h);
    try { fs.writeFileSync(file, png); } catch (_) {}
    return png;
  }

  close() { if (this.tc) this.tc.close(); this.tc = null; }
}

// Schneidet transparente Ränder ab (mit etwas Luft), Ergebnis quadratisch zentriert
function trimAlpha(rgba, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (rgba[(y * w + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return { w, h, rgba };
  const side = Math.min(Math.max(w, h), Math.round(Math.max(x1 - x0 + 1, y1 - y0 + 1) * 1.06));
  const cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
  const ox = Math.round(cx - side / 2), oy = Math.round(cy - side / 2);
  const out = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) {
    const sy = oy + y;
    if (sy < 0 || sy >= h) continue;
    for (let x = 0; x < side; x++) {
      const sx = ox + x;
      if (sx < 0 || sx >= w) continue;
      rgba.copy(out, (y * side + x) * 4, (sy * w + sx) * 4, (sy * w + sx) * 4 + 4);
    }
  }
  return { w: side, h: side, rgba: out };
}

// Box-Filter-Verkleinerung (für schnelle Kachel-Vorschauen)
function downscale(rgba, w, h, maxW) {
  const f = w / maxW;
  const nw = Math.round(w / f), nh = Math.round(h / f);
  const out = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * f), x1 = Math.min(w, Math.floor((x + 1) * f));
      const y0 = Math.floor(y * f), y1 = Math.min(h, Math.floor((y + 1) * f));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const p = (yy * w + xx) * 4; const al = rgba[p + 3];
        r += rgba[p] * al; g += rgba[p + 1] * al; b += rgba[p + 2] * al; a += al; n++;
      }
      const p = (y * nw + x) * 4;
      out[p] = a ? r / a : 0; out[p + 1] = a ? g / a : 0; out[p + 2] = a ? b / a : 0; out[p + 3] = n ? a / n : 0;
    }
  }
  return { w: nw, h: nh, rgba: out };
}

// Feste Texte (für den Übersetzungs-Test)
const TEXTS = () => [
  ...CATEGORY_GROUPS.map(([, n]) => n), ...Object.values(FACTIONS).map((f) => f.name), ...Object.values(EFFECTS),
  ...CREATURES.map((c) => c[1]), ...Object.values(WEATHER_DE), ...Object.values(REGION_DE), ...Object.values(SCHOOLS),
];

module.exports = { W3GameData, TEXTS };

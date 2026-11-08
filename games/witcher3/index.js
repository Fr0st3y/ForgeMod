'use strict';
/*
 * ForgeMod-Plugin: The Witcher 3: Wild Hunt (Complete Edition / Next-Gen)
 *
 * Alle Befehle sind eingebaute Exec-Funktionen des Spiels und wurden gegen die
 * Spielskripte (content\content0\scripts) der aktuellen Version geprüft.
 * ForgeMod schickt sie über das offizielle Debug-Protokoll (-net -debugscripts).
 * Der Spielordner wird nie verändert.
 *
 * Cheat-Typen:  action | toggle | loop  (siehe README)
 * Galerien:     Kategorien mit `gallery` zeigen Bilder aus der eigenen Installation
 *               (Gwint-Karten, Gegenstände, Kreaturen).
 */
const path = require('path');
const { W3Client } = require('./w3net');
const launcher = require('./launcher');
const { W3GameData } = require('./gamedata/catalog');
const { readWaypoint, readGwentCollection, readInventory, readJournal } = require('./gamedata/savegame');
const i18n = require('../../src/core/i18n');
const { t } = i18n;

const opt = (value, label) => ({ value, label: label || value });

const POTIONS = ['Swallow', 'Thunderbolt', 'Tawny Owl', 'Cat', 'White Honey', 'Full Moon', 'Maribor Forest', 'Petri Philtre', 'Blizzard', 'Golden Oriole', 'Black Blood', 'White Raffards Decoction'];
const BOMBS = ['Dancing Star', 'Devils Puffball', 'Dwimeritium Bomb', 'Dragons Dream', 'Grapeshot', 'Samum', 'Silver Dust Bomb', 'White Frost'];
const OILS = ['Beast Oil', 'Cursed Oil', 'Hanged Man Venom', 'Hybrid Oil', 'Insectoid Oil', 'Magicals Oil', 'Necrophage Oil', 'Specter Oil', 'Vampire Oil', 'Draconide Oil', 'Ogre Oil', 'Relic Oil'];
const DYES = ['Black', 'Blue', 'Brown', 'Gray', 'Green', 'Orange', 'Pink', 'Purple', 'Red', 'Turquoise', 'White', 'Yellow', 'Default'];

// Großmeister-Ausrüstung (Namen aus der Spielfunktion "addset")
const SETS = {
  wolf: ['Wolf Armor 4', 'Wolf Pants 5', 'Wolf Gloves 5', 'Wolf Boots 5', 'Wolf School steel sword 4', 'Wolf School silver sword 4'],
  lynx: ['Lynx Armor 4', 'Lynx Pants 5', 'Lynx Gloves 5', 'Lynx Boots 5', 'Lynx School steel sword 4', 'Lynx School silver sword 4'],
  gryphon: ['Gryphon Armor 4', 'Gryphon Pants 5', 'Gryphon Gloves 5', 'Gryphon Boots 5', 'Gryphon School steel sword 4', 'Gryphon School silver sword 4'],
  bear: ['Bear Armor 4', 'Bear Pants 5', 'Bear Gloves 5', 'Bear Boots 5', 'Bear School steel sword 4', 'Bear School silver sword 4'],
  redwolf: ['Red Wolf Armor 1', 'Red Wolf Pants 1', 'Red Wolf Gloves 1', 'Red Wolf Boots 1', 'Red Wolf School steel sword 1', 'Red Wolf School silver sword 1'],
};

const BUFFS = [
  opt('EET_Swallow', 'Schwalbe (Regeneration)'), opt('EET_Thunderbolt', 'Donnerschlag (mehr Angriff)'), opt('EET_Blizzard', 'Blizzard (Zeitlupe)'),
  opt('EET_TawnyOwl', 'Waldkauz (Ausdauer)'), opt('EET_Cat', 'Katze (Nachtsicht)'), opt('EET_FullMoon', 'Vollmond (mehr Vitalität)'),
  opt('EET_GoldenOriole', 'Pirol (Gift-Immunität)'), opt('EET_KillerWhale', 'Schwertwal (unter Wasser)'), opt('EET_PetriPhiltre', 'Petris Philter (Zeichen)'),
  opt('EET_BlackBlood', 'Schwarzes Blut'), opt('EET_WhiteRaffardDecoction', 'Weißer Raffard-Absud'), opt('EET_WellFed', 'Satt (Regeneration)'),
  opt('EET_WellRested', 'Ausgeruht'), opt('EET_HorseStableBuff', 'Stall-Bonus (Pferd)'), opt('EET_BookshelfBuff', 'Bücherregal-Bonus'),
  opt('EET_EnhancedArmor', 'Verstärkte Rüstung'), opt('EET_EnhancedWeapon', 'Geschärfte Waffe'), opt('EET_ShrineQuen', 'Schrein: Quen'),
  opt('EET_ShrineIgni', 'Schrein: Igni'), opt('EET_ShrineAard', 'Schrein: Aard'), opt('EET_ShrineYrden', 'Schrein: Yrden'), opt('EET_ShrineAxii', 'Schrein: Axii'),
  opt('EET_PolishedGenitals', 'Ganz frisch (Toussaint-Bonus)'), opt('EET_Drunkenness', 'Betrunken'),
];

const TELEPORTS = [
  opt('gotoNovigrad', 'Novigrad & Velen'), opt('gotoSkellige', 'Skellige'), opt('gotoKaerMorhen', 'Kaer Morhen'),
  opt('gotoBob', 'Toussaint (Blood and Wine)'), opt('gotoWyzima', 'Wyzima (Königspalast)'),
  opt('gotoProlog', 'Weißgarten (Prolog)'), opt('gotoPrologWinter', 'Weißgarten (Winter, Epilog-Welt)'),
];

// xy() setzt dich auf 500 m Höhe, wenn das Gelände am Ziel noch nicht geladen ist (StaticTrace schlägt fehl).
// Darum: hin, kurz warten bis gestreamt, nochmal – beim zweiten/dritten Mal landet man auf dem Boden.
const safeXY = (x, y) => [`xy(${x}, ${y})`, '@wait 1500', `xy(${x}, ${y})`, '@wait 2000', `xy(${x}, ${y})`];

// Grüner Wegpunkt: Das Spiel bietet dafür keinen Befehl (tptopin nimmt blind den ältesten Marker, egal welchen Typ).
// Darum liest ForgeMod den Wegpunkt aus dem neuesten Spielstand (nur lesend) und teleportiert per Koordinaten.
const REGION_INFO = {
  novigrad: ['Velen & Novigrad', 'gotoNovigrad'], skellige: ['Skellige', 'gotoSkellige'], bob: ['Toussaint', 'gotoBob'],
  kaer_morhen: ['Kaer Morhen', 'gotoKaerMorhen'], prolog_village: ['Weißgarten', 'gotoProlog'],
  prolog_village_winter: ['Weißgarten (Winter)', 'gotoPrologWinter'], wyzima_castle: ['Wyzima', 'gotoWyzima'],
};
let lastRegionLoad = {};
async function waypointTeleport(p, ctx = {}) {
  const info = await readWaypoint({ unpacked: ctx.unpacked, mtime: ctx.mtime });
  const wp = info.waypoint;
  if (!wp) {
    throw new Error(info.pinCount
      ? t('Im neuesten Spielstand ist kein grüner Wegpunkt (nur Symbol-Marker). Wegpunkt setzen, F5 drücken, nochmal.')
      : t('Im neuesten Spielstand ist kein Wegpunkt. Grünen Wegpunkt setzen, F5 drücken, nochmal.'));
  }
  const age = info.ageSec > 120 ? ' ' + t('(Spielstand ist {min} Min. alt – hast du nach dem Setzen F5 gedrückt?)', { min: Math.round(info.ageSec / 60) }) : '';
  const x = Math.round(wp.x * 10) / 10, y = Math.round(wp.y * 10) / 10;
  if (wp.world && info.currentWorld && wp.world !== info.currentWorld && REGION_INFO[wp.world]) {
    const name = t(REGION_INFO[wp.world][0]), cmd = REGION_INFO[wp.world][1];
    // Region schon geladen, aber noch kein neuerer Spielstand? Nicht nochmal laden, sondern um F5 bitten
    const saveTime = Date.now() - info.ageSec * 1000;
    if (lastRegionLoad.world === wp.world && saveTime < lastRegionLoad.at && Date.now() - lastRegionLoad.at < 10 * 60 * 1000) {
      throw new Error(t('{region} wurde gerade geladen – drück im Spiel kurz F5 (Schnellspeichern), dann nochmal.', { region: name }));
    }
    lastRegionLoad = { world: wp.world, at: Date.now() };
    // Nach dem Laden braucht ForgeMod einen neuen Spielstand, um die neue Region zu sehen
    return { commands: [cmd], message: t('Wegpunkt liegt in {region} – Region wird geladen. Nach dem Ladebildschirm F5 drücken und nochmal „Zum grünen Wegpunkt“.', { region: name }) };
  }
  return { commands: ['closeUI', '@wait 600', ...safeXY(x, y)], message: t('Grüner Wegpunkt bei {x} / {y}', { x, y }) + age };
}

const FACTION_OPTS = [
  opt('0', 'Alle Fraktionen'), opt('1', 'Königreiche des Nordens'), opt('2', 'Nilfgaard'),
  opt('3', 'Monster'), opt('4', 'Scoia’tael'), opt('5', 'Skellige'),
];

// Hinweis, wenn der Spielstand schon älter ist (ForgeMod sieht nur den letzten gespeicherten Stand)
const ageNote = (sec) => (sec > 120 ? ' ' + t('(Spielstand ist {min} Min. alt – für den aktuellen Stand vorher F5 drücken.)', { min: Math.round(sec / 60) }) : '');

// Gegenstandslisten der eingebauten Befehle (aus den Spielskripten: AddAllThMaps, addFTmaps, addkeys)
const TH_MAPS = ['th1003_map_lynx_upgrade1a', 'th1003_map_lynx_upgrade1b', 'th1003_map_lynx_upgrade2', 'th1003_map_lynx_upgrade3',
  'th1005_map_gryphon_upgrade1a', 'th1005_map_gryphon_upgrade1b', 'th1005_map_gryphon_upgrade2', 'th1005_map_gryphon_upgrade3',
  'th1007_map_bear_upgrade1a', 'th1007_map_bear_upgrade1b', 'th1007_map_bear_upgrade2', 'th1007_map_bear_upgrade3'];
const FT_MAPS = ['an_skellige_map', 'ard_skellige_map', 'faroe_map', 'hindarsfjal_map', 'undvik_map', 'spikeroog_map'];
const KEYS = ['q103_tamara_shrine_key', 'q104_keira_mine_key', 'q107_guslar_cell_key', 'q201_yen_chamber_key', 'q202_hjalmar_cell_key',
  'q205_key_to_burrow', 'q206_arnvalds_key', 'q206_arnvalds_chest_key', 'q208_yen_room_key', 'q301_crematory_key', 'q303_menges_skeleton_key',
  'q303_vault_key', 'q305_key_midgets_house', 'q401_trial_ingredients_key', 'q503_lockbox_key', 'sq102_barn_door_side_key', 'sq102_lockbox_key',
  'sq210_underwater_chest_key', 'sq210_underwater_gate2_key', 'sq210_underwater_gate1_key', 'sq302_philippa_key', 'sq303_pollys_key',
  'sq304_warehouse_key', 'sq304_wrhs_indoor_key', 'sq310_zed_door_key', 'sq310_attic_key', 'sq310_triangle_key', 'sq314_prison_key',
  'sq314_sigil_key', 'mq2003_treasure_chamber_key', 'mq3002_chest_key', 'mq2020_slave_cells_key', 'mh207_lighthouse_door_key',
  'mh104_ekimma_house_key', 'mq2020_pirate_lord_house_door', 'mh303_succubus_house_key', 'mh304_morge_door_key',
  'mh304_katakan_hideout_door_key', 'mh306_dao_manor_door_key', 'gp_prologue_key01', 'lw_prologue_royal_key01', 'lw_cb17_key',
  'lw_cp_glinsk_cage_key_1', 'lw_tm12_refugee_camp_key', 'lw_gr13_slavers_key', 'lw_de6_scavenger_key'];

const SKIP_FIELD = { key: 'skip', label: 'Vorhandenes überspringen', type: 'bool', default: true,
  hint: 'An: Nur, was dir laut neuestem Spielstand noch fehlt (vorher F5 drücken). Aus: Alles, auch wenn du es schon hast.' };

// Gibt aus einer Liste nur die Gegenstände, die Geralt laut neuestem Spielstand noch nicht hat
function giveMissing(list, original) {
  return async (p, ctx = {}) => {
    if (!p.skip) return { commands: [original] };
    const inv = await readInventory({ unpacked: ctx.unpacked, mtime: ctx.mtime });
    if (!inv.found) throw new Error(t('Geralts Inventar wurde im Spielstand nicht gefunden. Schalte „Vorhandenes überspringen“ aus, um trotzdem alles zu geben.'));
    const missing = list.filter((x) => !inv.items.get(x));
    if (!missing.length) throw new Error(t('Laut deinem neuesten Spielstand hast du schon alles davon.') + ageNote(inv.ageSec));
    return { commands: missing.map((x) => `additem('${x}', 1)`),
      message: t('{n} von {total} fehlen dir noch und werden hinzugefügt.', { n: missing.length, total: list.length }) + ageNote(inv.ageSec) };
  };
}

// Bestiarium: Öl auftragen bzw. Bombe/Trank ausrüsten.
// mode "own": eigenes (stärkste Stufe, die man laut Spielstand hat) – sonst die stärkste Stufe geben
// mode "max": immer die stärkste Stufe geben
// Öle werden beim Auftragen nicht verbraucht. useoil legt ein Exemplar dazu und trägt es auf; bei eigenem Öl
// wird dieses zusätzliche Exemplar danach wieder entfernt – man hat also genauso viele wie vorher.
function bestiaryAction(kind) {
  return async (p, ctx = {}) => {
    const levels = [p.l1, p.l2, p.l3].filter(Boolean);
    if (!levels.length) throw new Error(t('Unbekannter Gegenstand.'));
    const best = levels[levels.length - 1];
    const sword = p.steel ? 0 : 1;
    const swordName = p.steel ? t('Stahlschwert') : t('Silberschwert');
    let owned = null, age = '';
    if (p.mode !== 'max') {
      const inv = await readInventory({ unpacked: ctx.unpacked, mtime: ctx.mtime });
      if (inv.found) owned = [...levels].reverse().find((x) => inv.items.get(x)) || null;
      age = ageNote(inv.ageSec);
    }
    const label = p.label || best;
    if (kind === 'oil') {
      if (owned) return { commands: [`useoil('${owned}', ${sword})`, `removeitem('${owned}')`], message: t('Dein Öl „{name}“ auf das {sword} aufgetragen.', { name: label, sword: swordName }) + age };
      return { commands: [`useoil('${best}', ${sword})`], message: t('„{name}“ (stärkste Stufe) gegeben und auf das {sword} aufgetragen.', { name: label, sword: swordName }) + age };
    }
    if (owned) return { commands: [`equipitem('${owned}')`], message: t('Dein „{name}“ ausgerüstet.', { name: label }) + age };
    return { commands: [`additem('${best}', 1, true)`], message: t('„{name}“ (stärkste Stufe) gegeben und ausgerüstet.', { name: label }) + age };
  };
}
const BEST_FIELDS = [
  { key: 'l1', type: 'text', default: '' }, { key: 'l2', type: 'text', default: '' }, { key: 'l3', type: 'text', default: '' },
  { key: 'label', type: 'label', default: '', maxLength: 80 },
  { key: 'mode', type: 'select', default: 'own', options: [{ value: 'own', label: 'own' }, { value: 'max', label: 'max' }] },
  { key: 'steel', type: 'bool', default: false },
];

// Gwint: nur die Karten geben, die laut neuestem Spielstand noch fehlen.
// Jede Kopie einer Karte hat im Spiel eine eigene Nummer und darf genau einmal in der Sammlung sein
// (z. B. Nekker 1, 2, 3). Besitzt man schon 1 von 3, kommen nur die 2 fehlenden dazu.
async function gwentCards(p, ctx = {}) {
  if (!p.missing) return { commands: [`addAllGwentCards(${p.f})`] };
  const cat = await ctx.catalog();
  const coll = await readGwentCollection({ unpacked: ctx.unpacked, mtime: ctx.mtime });
  if (!coll.found) throw new Error(t('Im Spielstand ist noch keine Gwint-Sammlung. Spiel einmal Gwint im Spiel oder schalte „Nur fehlende Karten“ aus.'));
  const faction = Number(p.f) ? (cat.factions.find((f) => f.enum === Number(p.f)) || {}).id : null;
  const commands = [];
  for (const card of cat.cards) {
    if (card.kind === 'leader' || (faction && card.faction !== faction)) continue;
    // Nur Kopien, die es als Gegenstand gibt (Startdeck-Karten hat jeder schon)
    const defs = (card.defs || []).filter((d) => d.item);
    const owned = defs.reduce((n, d) => n + (coll.cards.get(d.i) || 0), 0);
    let missing = defs.length - owned;
    for (const d of defs) {
      if (missing <= 0) break;
      if (coll.cards.get(d.i)) continue;
      commands.push(`additem('${d.item}', 1)`);
      missing--;
    }
  }
  const age = ageNote(coll.ageSec);
  if (!commands.length) throw new Error(t('Laut deinem neuesten Spielstand hast du schon alle Karten.') + age);
  return { commands, message: t('{n} fehlende Gwint-Karten werden hinzugefügt.', { n: commands.length }) + age };
}

const categories = [
  {
    id: 'player', name: 'Spieler', icon: 'shield',
    cheats: [
      { id: 'god', name: 'God Mode', desc: 'Unverwundbar, keine negativen Effekte und unendliche Ausdauer.', type: 'toggle', on: 'god', off: (p, t) => ['god', t.stamina ? "addfact(debug_fact_stamina_boy)" : null], hotkey: 'num1', tag: 'Beliebt' },
      { id: 'immortal', name: 'Unsterblich', desc: 'Du nimmst Schaden, kannst aber nicht sterben – fühlt sich fairer an als God Mode.', type: 'toggle', on: 'god2', off: 'god2' },
      { id: 'infhealth', name: 'Unendliche Gesundheit', desc: 'Füllt die Vitalität jede Sekunde wieder auf.', type: 'loop', run: 'healme', interval: 1000, hotkey: 'num2' },
      { id: 'healme', name: 'Sofort voll heilen', desc: 'Setzt die Vitalität einmalig auf das Maximum.', button: 'Heilen', run: 'healme', hotkey: 'num3' },
      { id: 'stamina', name: 'Unendliche Ausdauer', desc: 'Zeichen und Sprints ohne Ausdauerverbrauch (Stamina Boy).', type: 'toggle', on: "addfact(debug_fact_stamina_boy)", off: "removefact(debug_fact_stamina_boy)" },
      { id: 'likeaboss', name: 'One-Hit-Wonder (Like a Boss)', desc: 'Jeder Treffer zieht 40 % der maximalen Gegner-Gesundheit ab.', type: 'toggle', on: "addfact(player_is_the_boss)", off: "removefact(player_is_the_boss)", hotkey: 'num4', tag: 'Spaß' },
      { id: 'cat', name: 'Dauerhafte Katzensicht', desc: 'Nachtsicht wie mit dem Katzen-Trank, ohne Toxizität.', type: 'toggle', on: 'Cat(true)', off: 'Cat(false)', hotkey: 'num5' },
      { id: 'drunk', name: 'Betrunken', desc: 'Verschwommene, schwankende Sicht.', type: 'toggle', on: 'Drunk(true)', off: 'Drunk(false)', tag: 'Spaß' },
      { id: 'buff', name: 'Trank-Effekt / Buff', desc: 'Wendet einen Effekt für eine bestimmte Zeit an – ganz ohne Toxizität.', button: 'Anwenden',
        fields: [
          { key: 'effect', label: 'Effekt', type: 'select', default: 'EET_Swallow', options: BUFFS },
          { key: 'sec', label: 'Sekunden', type: 'number', default: 600, min: 1, max: 36000 },
        ],
        run: (p) => `buffgeralt(${p.effect.replace(/^EET_/, '')}Effect, ${p.sec})` },
      { id: 'addabl', name: 'Fähigkeit (Ability) hinzufügen', desc: 'Fügt Geralt eine Ability per ID hinzu.', button: 'Hinzufügen',
        fields: [{ key: 'abl', label: 'Ability-ID', type: 'text', default: '' }], run: (p) => (p.abl ? `addabl('${p.abl}')` : null) },
      { id: 'rmvabl', name: 'Fähigkeit entfernen', desc: 'Entfernt eine Ability wieder.', button: 'Entfernen',
        fields: [{ key: 'abl', label: 'Ability-ID', type: 'text', default: '' }], run: (p) => (p.abl ? `rmvabl('${p.abl}')` : null) },
      { id: 'ciri', name: 'Als Ciri spielen', desc: 'Wechselt die Spielfigur zu Cirilla. Vorher speichern!', button: 'Wechseln', run: 'Ciri', confirm: 'Der Wechsel kann laufende Quests stören. Hast du gespeichert?' },
      { id: 'geralt', name: 'Zurück zu Geralt', desc: 'Wechselt die Spielfigur wieder zu Geralt.', button: 'Wechseln', run: 'Geralt' },
    ],
  },
  {
    id: 'progress', name: 'Geld & XP', icon: 'coins',
    cheats: [
      { id: 'money', name: 'Kronen hinzufügen', desc: 'Füllt deinen Geldbeutel auf.', button: 'Geben', hotkey: 'num6', tag: 'Beliebt',
        fields: [{ key: 'amount', label: 'Kronen', type: 'number', default: 10000, min: 1, max: 9999999 }],
        presets: { key: 'amount', values: [1000, 10000, 100000, 1000000] }, run: 'addmoney({amount})' },
      { id: 'removemoney', name: 'Kronen entfernen', desc: 'Geld wieder abziehen.', button: 'Abziehen',
        fields: [{ key: 'amount', label: 'Kronen', type: 'number', default: 1000, min: 1, max: 9999999 }], run: 'removemoney({amount})' },
      { id: 'xp', name: 'Erfahrung (XP) geben', desc: 'Fügt Erfahrungspunkte hinzu.', button: 'Geben', hotkey: 'num7',
        fields: [{ key: 'amount', label: 'XP', type: 'number', default: 5000, min: 1, max: 9999999 }],
        presets: { key: 'amount', values: [1000, 5000, 25000, 100000] }, run: 'addexp({amount})' },
      { id: 'levelup', name: 'Stufen aufsteigen', desc: 'Eine oder mehrere Stufen sofort aufsteigen.', button: 'Aufsteigen',
        fields: [{ key: 'n', label: 'Stufen', type: 'number', default: 1, min: 1, max: 99 }],
        presets: { key: 'n', values: [1, 5, 10, 20] }, run: 'levelup({n})' },
      { id: 'setlevel', name: 'Stufe direkt setzen', desc: 'Steigt bis zur gewünschten Stufe auf (nur nach oben – niedriger geht nicht).', button: 'Setzen', danger: true,
        confirm: 'Stufe setzen kann Fähigkeitspunkte zurücksetzen. Hast du gespeichert?',
        fields: [{ key: 'level', label: 'Stufe', type: 'number', default: 30, min: 1, max: 100 }], run: 'setlevel({level})' },
      { id: 'skillpoints', name: 'Fähigkeitspunkte geben', desc: 'Zusätzliche Punkte für den Fähigkeitenbaum.', button: 'Geben',
        fields: [{ key: 'n', label: 'Punkte', type: 'number', default: 10, min: 1, max: 500 }],
        presets: { key: 'n', values: [5, 10, 50, 100] }, run: 'addSkillPoints({n})' },
      { id: 'learnskill', name: 'Fähigkeit lernen', desc: 'Schaltet eine Fähigkeit per Skill-ID frei.', button: 'Lernen',
        fields: [{ key: 'skill', label: 'Skill-ID', type: 'text', default: '' }], run: (p) => (p.skill ? `learnskill('${p.skill}')` : null) },
      { id: 'starter', name: 'Hexer-Starterpaket', desc: '50.000 Kronen, 20.000 XP und 20 Fähigkeitspunkte.', button: 'Paket holen', tag: 'Combo',
        run: ['addmoney(50000)', 'addexp(20000)', 'addSkillPoints(20)'] },
      { id: 'schematics', name: 'Alle Baupläne lernen', desc: 'Jeder Schmiede- und Rüstungsbauplan des Spiels.', button: 'Lernen', run: 'learnallschematics' },
      { id: 'recipes', name: 'Alle Alchemie-Rezepte', desc: 'Rezepte für Tränke, Bomben, Öle und Mutagene.', button: 'Holen', tag: 'Combo',
        run: ['addrecipespotions', 'addrecipesbombs', 'addrecipesoils', 'addmutagenrecipes'] },
      { id: 'thmaps', name: 'Alle Schatzkarten (Hexer-Ausrüstung)', desc: 'Alle Schatzsuche-Karten für die Hexerschulen.', button: 'Holen',
        fields: [SKIP_FIELD], prepare: giveMissing(TH_MAPS, 'AddAllThMaps') },
      { id: 'glossary', name: 'Glossar komplett freischalten', desc: 'Alle Charakter- und Bestiarium-Einträge.', button: 'Freischalten',
        run: ['activateAllGlossaryCharacters', 'activateAllGlossaryBeastiary'] },
    ],
  },
  {
    id: 'gwent', name: 'Gwint', icon: 'cards', gallery: 'cards',
    cheats: [
      { id: 'allcards', name: 'Alle Gwint-Karten', desc: 'Jede sammelbare Karte – für alle Fraktionen oder eine bestimmte. Auf Wunsch nur die, die dir noch fehlen.', button: 'Karten holen', tag: 'Beliebt',
        fields: [
          { key: 'f', label: 'Fraktion', type: 'select', default: '0', options: FACTION_OPTS },
          { key: 'missing', label: 'Nur fehlende Karten', type: 'bool', default: true,
            hint: 'An: Nur Karten, die dir laut neuestem Spielstand noch fehlen (vorher F5 drücken). Aus: Jede Karte in voller Anzahl, auch wenn du sie schon hast.' },
        ],
        prepare: gwentCards },
      { id: 'unlockdeck', name: 'Fraktions-Deck freischalten', desc: 'Schaltet ein Deck im Deck-Builder frei, z. B. Skellige ohne Blood and Wine-Quest.', button: 'Freischalten',
        fields: [{ key: 'f', label: 'Fraktion', type: 'select', default: '5', options: FACTION_OPTS.slice(1) }], run: 'unlockDeck({f})' },
      { id: 'wingwent', name: 'Partie sofort gewinnen', desc: 'Während einer Gwint-Partie ausführen.', button: 'Gewinnen', run: 'winGwent(true)', hotkey: 'num8' },
      { id: 'losegwent', name: 'Partie sofort verlieren', desc: 'Beendet die aktuelle Partie als Niederlage.', button: 'Aufgeben', run: 'winGwent(false)' },
      { id: 'secretgwent', name: 'Gwint überall spielen', desc: 'Öffnet eine Partie gegen die KI – egal wo du bist.', button: 'Mischen!', run: 'secretGwent', tag: 'Spaß' },
      { id: 'gwentai', name: 'KI gegen KI zuschauen', desc: 'Zwei Computergegner spielen gegeneinander.', button: 'Zuschauen', run: 'secretGwentAI', tag: 'Spaß' },
    ],
  },
  {
    id: 'items', name: 'Inventar', icon: 'bag', gallery: 'items',
    cheats: [
      { id: 'set', name: 'Hexer-Ausrüstung (Großmeister)', desc: 'Komplettes Set inkl. Stahl- und Silberschwert.', button: 'Set holen', tag: 'Beliebt',
        fields: [{ key: 's', label: 'Schule', type: 'select', default: 'wolf', options: [
          opt('wolf', 'Wolfsschule'), opt('lynx', 'Katzenschule'), opt('gryphon', 'Greifenschule'), opt('bear', 'Bärenschule'), opt('redwolf', 'Mantikor (Toussaint)'),
        ] }],
        run: (p) => (SETS[p.s] || []).map((i) => `additem('${i}')`) },
      { id: 'potions', name: 'Alle Tränke (Stufe 3)', desc: 'Jeweils einen Trank jeder Sorte in der stärksten Stufe.', button: 'Brauen', tag: 'Combo',
        run: [...POTIONS.map((p) => `additem('${p} 3')`), "additem('Killer Whale 1')"] },
      { id: 'bombs', name: 'Alle Bomben (Stufe 3)', desc: 'Jeweils 3 Bomben jeder Sorte.', button: 'Bauen', tag: 'Combo',
        run: BOMBS.map((b) => `additem('${b} 3', 3)`) },
      { id: 'oils', name: 'Alle Klingenöle (Stufe 3)', desc: 'Jedes Öl in der stärksten Stufe.', button: 'Holen', run: OILS.map((o) => `additem('${o} 3')`) },
      { id: 'mutagens', name: 'Alle Mutagene', desc: 'Jede Mutagen-Art.', button: 'Holen', run: 'addmutagens' },
      { id: 'ingredients', name: 'Handwerks-Material', desc: 'Je 20 Stück aller wichtigen Handwerkszutaten.', button: 'Holen',
        fields: [{ key: 'n', label: 'Anzahl', type: 'number', default: 20, min: 1, max: 999 }], run: 'addcraftingingre({n})' },
      { id: 'alcingredients', name: 'Mutagen-Zutaten', desc: 'Zutaten für Mutagen-Rezepte.', button: 'Holen', run: 'addmutageningredients' },
      { id: 'dyes', name: 'Alle Farbstoffe', desc: 'Alle Rüstungsfarben (Blood and Wine).', button: 'Holen', run: DYES.map((d) => `additem('Dye ${d}', 3)`) },
      { id: 'alcohol', name: 'Meditations-Vorrat', desc: '10× Zwergenschnaps und 10× Alkahest.', button: 'Holen', run: ["additem('Dwarven spirit', 10)", "additem('Alcohest', 10)"] },
      { id: 'horseitems', name: 'Pferde-Ausrüstung', desc: 'Satteltaschen, Scheuklappen und Sättel.', button: 'Holen', run: ['addhorseitems', 'addHorseArmors'] },
      { id: 'transmog', name: 'Alle Optiken freischalten', desc: 'Schaltet alle Rüstungs- und Waffen-Optiken für das Aussehen-System frei.', button: 'Freischalten', run: 'UnlockAllTransmogItems' },
      { id: 'keys', name: 'Alle Schlüssel', desc: 'Jeder Schlüssel des Spiels.', button: 'Holen',
        fields: [SKIP_FIELD], prepare: giveMissing(KEYS, 'addkeys') },
      { id: 'witchcraft', name: 'Hexerei: ALLE Gegenstände', desc: 'Eine Kopie von jedem Gegenstand. Das Spiel kann abstürzen.', button: 'Wirklich alles', danger: true,
        confirm: 'Das fügt tausende Gegenstände hinzu und kann das Spiel abstürzen lassen. Unbedingt vorher speichern. Fortfahren?', run: 'witchcraft' },
    ],
  },
  {
    id: 'bestiary', name: 'Bestiarium', icon: 'book', gallery: 'bestiary',
    cheats: [],
  },
  {
    id: 'creatures', name: 'Kreaturen', icon: 'paw', gallery: 'creatures',
    cheats: [
      { id: 'killall', name: 'Alle Gegner im Umkreis töten', desc: 'Tötet alle Gegner im Radius (Meter).', button: 'Vernichten', hotkey: 'num9',
        fields: [{ key: 'r', label: 'Radius', type: 'number', default: 30, min: 1, max: 500 }], run: 'killall({r})' },
      { id: 'dismember', name: 'Ziel zerstückeln', desc: 'Trennt dem anvisierten Gegner die Gliedmaßen ab.', button: 'Zack!', run: 'dismember' },
      { id: 'appearance', name: 'Aussehen des Ziels ändern', desc: 'Ändert die Erscheinung des anvisierten NPCs per Appearance-ID.', button: 'Ändern',
        fields: [{ key: 'a', label: 'Appearance-ID', type: 'text', default: '' }], run: (p) => (p.a ? `appearance('${p.a}')` : null) },
    ],
  },
  {
    id: 'world', name: 'Welt', icon: 'globe',
    cheats: [
      { id: 'weather', name: 'Wetter ändern', desc: 'Nicht jede Region kennt jedes Wetter – die Liste kommt aus deinem Spiel.', button: 'Ändern',
        fields: [{ key: 'w', label: 'Wetter', type: 'select', default: 'WT_Clear', optionsFrom: 'weather', options: [opt('WT_Clear', 'Klar')] }],
        run: "changeweather('{w}')" },
      { id: 'rain', name: 'Gewitter aufziehen lassen', desc: 'Regen und Gewitter (überall außer Wyzima).', button: 'Gewitter', run: "changeweather('WT_Rain_Storm')" },
      { id: 'stoprain', name: 'Klares Wetter', desc: 'Sonne statt Regen.', button: 'Sonne', run: "changeweather('WT_Clear')" },
      { id: 'wait', name: 'Zeit vorspulen', desc: 'Spult die Spielzeit vor – wie Meditieren, nur ohne Hinsetzen.', button: 'Vorspulen',
        fields: [
          { key: 'h', label: 'Stunden', type: 'number', default: 6, min: 0, max: 240 },
          { key: 'm', label: 'Minuten', type: 'number', default: 0, min: 0, max: 59 },
        ],
        presets: { key: 'h', values: [1, 6, 12, 24] }, run: 'wait(0, {h}, {m}, 0)' },
      { id: 'timescale', name: 'Tageszeit-Geschwindigkeit', desc: 'Spielstunden pro echter Minute (normal: 0,25).', button: 'Setzen',
        fields: [{ key: 'x', label: 'Std./Min.', type: 'number', default: 1, min: 0.1, max: 60, float: true, step: 0.1 }],
        presets: { key: 'x', values: [0.25, 1, 5, 30] }, run: 'TM({x})' },
    ],
  },
  {
    id: 'travel', name: 'Reisen', icon: 'map', gallery: 'map',
    cheats: [
      { id: 'allowft', name: 'Schnellreise von überall', desc: 'Direkt aus der Karte reisen, ohne Wegweiser.', type: 'toggle', on: 'AllowFT(true)', off: 'AllowFT(false)', hotkey: 'num0', tag: 'Beliebt',
        warn: 'Kann Quests blockieren: Gespräche, die erst beim Verlassen eines Ortes starten (z. B. vor einem Burgtor), werden übersprungen.',
        confirm: 'Manche Quests starten oder gehen erst weiter, wenn du einen Ort zu Fuß verlässt – zum Beispiel wartet vor einem Burgtor ein Gespräch. Reist du stattdessen direkt per Schnellreise weg, wird dieses Gespräch übersprungen und die Quest kann hängen bleiben.\n\nIm Zweifel den Ort normal verlassen und erst danach schnellreisen. Trotzdem einschalten?' },
      { id: 'showft', name: 'Alle Wegweiser aufdecken', desc: 'Zeigt alle Schnellreisepunkte.', type: 'toggle', on: 'ShowAllFT(true)', off: 'ShowAllFT(false)' },
      { id: 'showpins', name: 'Alle Kartenmarker', desc: 'Zeigt sämtliche Marker auf der Karte.', type: 'toggle', on: 'ShowPins(true)', off: 'ShowPins(false)' },
      { id: 'showknown', name: 'Fragezeichen aufdecken', desc: 'Zeigt alle ?-Orte.', type: 'toggle', on: 'ShowKnownPins(true)', off: 'ShowKnownPins(false)' },
      { id: 'ftmaps', name: 'Skellige-Inselkarten', desc: 'Karten aller Skellige-Inseln.', button: 'Holen',
        fields: [SKIP_FIELD], prepare: giveMissing(FT_MAPS, 'addFTmaps') },
      { id: 'waypoint', name: 'Zum grünen Wegpunkt', desc: 'Grünen Wegpunkt („Individuelle Markierung“) auf der Karte setzen, F5 drücken (Schnellspeichern) – dann bringt dich das genau dorthin.', button: 'Teleport', tag: 'Beliebt',
        prepare: waypointTeleport },
      { id: 'teleport', name: 'Teleport in Region', desc: 'Lädt eine andere Region (Ladebildschirm).', button: 'Reisen',
        fields: [{ key: 't', label: 'Ziel', type: 'select', default: 'gotoNovigrad', options: TELEPORTS }], run: '{t}' },
      { id: 'xy', name: 'Teleport zu Koordinaten', desc: 'Innerhalb der aktuellen Region – oder einfach unten auf die Karte klicken.', button: 'Teleport',
        fields: [
          { key: 'x', label: 'X', type: 'number', default: 0, min: -10000, max: 10000, float: true },
          { key: 'y', label: 'Y', type: 'number', default: 0, min: -10000, max: 10000, float: true },
        ], run: (p) => safeXY(p.x, p.y) },
      { id: 'pony', name: 'Pferd mit unendlicher Ausdauer', desc: 'Plötze wird nie müde.', type: 'toggle', on: "addfact(debug_fact_stamina_pony)", off: "removefact(debug_fact_stamina_pony)", tag: 'Spaß' },
      { id: 'horse', name: 'Pferd spawnen', desc: 'Lässt ein Pferd neben dir erscheinen.', button: 'Pfeifen', run: "spawn('horse')" },
      { id: 'boat', name: 'Boot spawnen & einsteigen', desc: 'Am Wasser benutzen.', button: 'Ahoi', run: 'spawnBoatAndMount' },
    ],
  },
  {
    id: 'looks', name: 'Aussehen', icon: 'scissors',
    cheats: [
      { id: 'hair', name: 'Frisur ändern', desc: 'Kein Barbier nötig.', button: 'Stylen',
        fields: [{ key: 'h', label: 'Frisur', type: 'select', default: 'addHair1', options: [
          opt('addHair1', 'Standard (Zopf)'), opt('addHair2', 'Pferdeschwanz'), opt('addHair3', 'Lang & offen'),
          opt('addHairDLC1', 'Kurz & locker'), opt('addHairDLC2', 'Irokesen-Zopf'), opt('addHairDLC3', 'Elfenrebell'),
        ] }], run: '{h}' },
      { id: 'shave', name: 'Rasieren', desc: 'Entfernt den Bart.', button: 'Rasieren', run: 'shave' },
      { id: 'beard', name: 'Bart wachsen lassen', desc: 'Voller Bart oder eine bestimmte Wachstumsstufe.', button: 'Setzen',
        fields: [{ key: 'stage', label: 'Stufe (1–5)', type: 'number', default: 5, min: 1, max: 5 }], run: 'setbeard(false, {stage})' },
      { id: 'tattoo', name: 'Witcher-2-Tattoo', desc: 'Das Tattoo aus Witcher 2 am Hals.', type: 'toggle', on: 'settattoo(true)', off: 'settattoo(false)' },
      { id: 'customhead', name: 'Eigenen Kopf setzen', desc: 'Ersetzt das Kopfmodell per Head-ID.', button: 'Setzen',
        fields: [{ key: 'head', label: 'Head-ID', type: 'text', default: '' }], run: (p) => (p.head ? `setcustomhead('${p.head}')` : null) },
      { id: 'resethead', name: 'Kopf zurücksetzen', desc: 'Normales Kopfmodell.', button: 'Zurücksetzen', run: 'removecustomhead' },
    ],
  },
  {
    id: 'camera', name: 'Kamera & Foto', icon: 'camera',
    cheats: [
      { id: 'hud', name: 'HUD ausblenden', desc: 'Blendet die Oberfläche aus – für Screenshots.', type: 'toggle', on: 'dlgshow', off: 'dlghide' },
      { id: 'pause', name: 'Spiel einfrieren', desc: 'Pausiert die Spielwelt.', type: 'toggle', on: 'testpause', off: 'testunpause' },
      { id: 'fade', name: 'Bild abblenden', desc: 'Kino-Abblende zu Schwarz.', type: 'toggle', on: 'fadeout', off: 'fadein' },
      { id: 'camrot', name: 'Kamera-Autorotation', desc: 'Automatisches Nachdrehen der Kamera umschalten.', button: 'Umschalten', run: 'ToggleCameraAutoRotation' },
    ],
  },
  {
    id: 'danger', name: 'Gefährlich', icon: 'alert',
    cheats: [
      { id: 'cleardevelop', name: 'Charakter zurücksetzen', desc: 'Stufe 1 und leeres Inventar – nur mit Backup-Spielstand!', button: 'Zurücksetzen', danger: true,
        confirm: 'Das setzt Geralt auf Stufe 1 zurück und leert das Inventar. Wirklich?', run: 'cleardevelop' },
    ],
  },
  {
    // Aktionen der Galerien (nicht als eigene Karten sichtbar)
    id: '_gallery', name: 'Galerie', hidden: true,
    cheats: [
      { id: 'b_oil', name: 'Öl auftragen', button: 'Auftragen', fields: BEST_FIELDS, prepare: bestiaryAction('oil') },
      { id: 'b_equip', name: 'Ausrüsten', button: 'Ausrüsten', fields: BEST_FIELDS, prepare: bestiaryAction('equip') },
      { id: 'g_item', name: 'Gegenstand geben', button: 'Geben',
        fields: [{ key: 'id', type: 'text', default: '' }, { key: 'n', type: 'number', default: 1, min: 1, max: 999 }, { key: 'equip', type: 'bool', default: false }],
        // equip = true: additem legt den neuen Gegenstand direkt an ("Autogen"-Gegenstände entstehen dabei auf der aktuellen Stufe)
        run: (p) => (p.id ? `additem('${p.id}', ${p.n}${p.equip ? ', true' : ''})` : null) },
      // Wie beim Looten: Karten-Gegenstand ins Inventar – das Spiel legt ihn dabei selbst in die Sammlung
      { id: 'g_card', name: 'Gwint-Karte geben', button: 'Geben',
        fields: [{ key: 'ids', type: 'text', default: '', maxLength: 400 }],
        run: (p) => p.ids.split(' ').filter((i) => /^gwint_card_\w+$/.test(i)).slice(0, 10).map((i) => `additem('${i}', 1)`) },
      { id: 'g_draw', name: 'Karte ins Blatt ziehen', button: 'Ziehen',
        fields: [{ key: 'card', type: 'text', default: '' }], run: (p) => (p.card ? `drawCard('${p.card}')` : null) },
      // Karte: mit bekannter Höhe (Wegweiser) exakt, sonst sicherer Koordinaten-Teleport
      { id: 'g_tp', name: 'Teleport (Karte)', button: 'Teleport',
        fields: [
          { key: 'x', type: 'number', default: 0, min: -10000, max: 10000, float: true },
          { key: 'y', type: 'number', default: 0, min: -10000, max: 10000, float: true },
          { key: 'z', type: 'number', default: -9999, min: -9999, max: 2000, float: true },
        ],
        run: (p) => (p.z > -9000 ? `tptopos(${p.x}, ${p.y}, ${+(p.z + 0.5).toFixed(2)})` : safeXY(p.x, p.y)) },
      { id: 'g_region', name: 'Region laden', button: 'Laden',
        fields: [{ key: 't', type: 'select', default: 'gotoNovigrad', options: TELEPORTS }], run: '{t}' },
      { id: 'g_spawn', name: 'Kreatur beschwören', button: 'Beschwören',
        fields: [
          { key: 'id', type: 'text', default: '' },
          { key: 'n', type: 'number', default: 1, min: 1, max: 20 },
          { key: 'dist', type: 'number', default: 4, min: 1, max: 50 },
          { key: 'hostile', type: 'bool', default: true },
          { key: 'level', type: 'number', default: 0, min: 0, max: 100 },
        ],
        run: (p) => (p.id ? `spawn('${p.id}', ${p.n}, ${p.dist}, ${p.hostile}${p.level ? ', ' + p.level : ''})` : null) },
    ],
  },
];

// ---------- Galerien ----------
const galleries = {
  cards: {
    title: 'Gwint-Sammlung', source: 'cards', aspect: '308 / 444', thumb: 200,
    hint: 'Klick auf eine Karte für Details. Karten aus dem Startdeck kannst du während einer Partie direkt ins Blatt ziehen.',
  },
  items: {
    title: 'Alle Gegenstände', source: 'items', aspect: '1 / 1', thumb: 0,
    hint: 'Alle Gegenstände deines Spiels mit den Namen aus dem Spiel – klicken, Anzahl wählen, geben.',
  },
  map: {
    title: 'Weltkarte & Teleport', source: 'maps', top: true,
    hint: 'Klick auf die Karte oder einen Wegweiser, dann „Hierhin teleportieren“. Mausrad = Zoom, Ziehen = verschieben.',
  },
  bestiary: {
    title: 'Bestiarium', source: 'bestiary', thumb: 260,
    hint: 'Alle Einträge aus dem Bestiarium des Spiels – mit Schwachstellen, die du direkt auftragen oder ausrüsten kannst.',
  },
  creatures: {
    title: 'Kreaturen beschwören', source: 'creatures', aspect: '1 / 1', thumb: 260,
    hint: 'Monster, Bosse, Figuren und Tiere aus Hauptspiel und DLCs – sie erscheinen vor dir, wo die Kamera hinschaut.',
  },
};

let gamedata = null;
function getGameData({ install, cacheDir, log }) {
  const root = install && (install.root || (install.exePath && path.resolve(path.dirname(install.exePath), '..', '..')));
  if (!root) return null;
  // Spieldaten (Namen von Gegenständen, Karten, Orten) in der Sprache der Oberfläche – aus der offiziellen Lokalisierung
  const lang = i18n.getLang();
  if (!gamedata || gamedata.root !== root || gamedata.lang !== lang) {
    if (gamedata) gamedata.close();
    gamedata = new W3GameData({ root, cacheDir, lang, log });
  }
  return gamedata;
}

module.exports = {
  id: 'witcher3',
  name: 'The Witcher 3',
  subtitle: 'Wild Hunt · Complete Edition',
  accent: '#d9a441',
  banner: { from: '#3a1d12', via: '#7a2c1a', to: '#14100e', glyph: 'medallion' },
  processNames: ['witcher3.exe'],
  setupHint: 'Witcher 3 muss mit den Startoptionen „-net -debugscripts“ laufen. Einmal im Launcher eintragen – dann ganz normal starten. Der Spielordner bleibt unverändert.',
  // Einmalige Einrichtung, damit man ganz normal über den eigenen Launcher starten kann
  setupGuide: {
    args: '-net -debugscripts',
    launchers: {
      steam: { name: 'Steam', steps: [
        'In der Steam-Bibliothek Rechtsklick auf „The Witcher 3“ → Eigenschaften.',
        'Unter „Allgemein“ → „Startoptionen“ einfügen:',
        'Fenster schließen – fertig. Ab jetzt einfach über Steam starten, ForgeMod verbindet sich von selbst.',
      ] },
      epic: { name: 'Epic Games', steps: [
        'Im Epic Games Launcher: Bibliothek → bei „The Witcher 3“ auf „…“ → Verwalten.',
        'Bei „Startoptionen“ den Schalter einschalten und einfügen:',
        'Fertig – ab jetzt einfach über Epic starten.',
      ] },
      gog: { name: 'GOG Galaxy', steps: [
        'In GOG Galaxy „The Witcher 3“ öffnen → Einstellungen-Symbol neben „Spielen“ → Installation verwalten → Konfigurieren.',
        'Unter „Funktionen“ → „Benutzerdefinierte ausführbare Dateien/Argumente“ einen Eintrag hinzufügen und als Argumente einfügen:',
        'Diesen Eintrag zum Starten verwenden – fertig.',
      ] },
    },
  },
  launchOptions: {
    modes: [opt('direct', 'Direkt (witcher3.exe)'), opt('steam', 'Über Steam')],
    renderers: [opt('dx12', 'DirectX 12'), opt('dx11', 'DirectX 11')],
  },
  categories,
  galleries,
  // Liefert Katalog und Bilder aus der eigenen Installation
  data: {
    async catalog(ctx, onProgress) {
      const gd = getGameData(ctx);
      if (!gd) throw new Error(t('Witcher-3-Installation nicht gefunden – bitte unter ⚙ suchen oder die EXE auswählen.'));
      return gd.load(onProgress);
    },
    reset() { if (gamedata) gamedata.close(); gamedata = null; },
    // Im neuesten Spielstand freigeschaltete Journal-Einträge (u. a. Bestiarium)
    async journal() {
      const j = await readJournal();
      return { file: j.file, ageSec: j.ageSec, found: j.found, known: [...j.known] };
    },
    image(ctx, tex, maxW) {
      const gd = getGameData(ctx);
      return gd ? gd.image(tex, maxW) : null;
    },
  },
  // Texte, die nur zur Laufzeit übersetzt werden (für den Übersetzungs-Test)
  extraTexts: Object.values(REGION_INFO).map((r) => r[0]),
  createConnector: ({ log }) => new W3Client({ log }),
  detectInstall: launcher.detectInstall,
  launch: launcher.launch,
};

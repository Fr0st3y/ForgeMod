'use strict';
// Tests für die Witcher-3-Dateiformate. Mit W3_ROOT="D:\...\The Witcher 3" zusätzlich gegen die echte Installation.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { openBundle, decodeBC, encodePNG, hashKey } = require('../games/witcher3/gamedata/formats');

// DXT1: Block mit zwei Farben (rot/blau), alle Pixel Index 0 -> rot
const block = Buffer.alloc(8);
block.writeUInt16LE(0xf800, 0); block.writeUInt16LE(0x001f, 2); block.writeUInt32LE(0, 4);
const px = decodeBC(block, 4, 4, 1);
assert.deepStrictEqual([...px.subarray(0, 4)], [255, 0, 0, 255]);
const png = encodePNG(px, 4, 4);
assert.deepStrictEqual([...png.subarray(1, 4)], [80, 78, 71]);
assert.strictEqual(hashKey('ab'), 97 * 31 + 98);
console.log('✓ DXT-Decoder, PNG-Encoder, Schlüssel-Hash');

// Minimales POTATO70-Bundle mit einer zlib-Datei
const data = Buffer.from('<redxml>hallo</redxml>');
const z = zlib.deflateSync(data);
const head = Buffer.alloc(32); head.write('POTATO70', 0, 'latin1'); head.writeUInt32LE(304, 16);
const entry = Buffer.alloc(304); entry.write('gameplay\\items\\test.xml', 0, 'latin1');
const off = 32 + 304;
entry.writeUInt32LE(off, 272); entry.writeUInt32LE(data.length, 280); entry.writeUInt32LE(z.length, 284); entry.writeUInt32LE(1, 292);
const file = path.join(os.tmpdir(), `fm-test-${process.pid}.bundle`);
fs.writeFileSync(file, Buffer.concat([head, entry, z]));
const b = openBundle(file);
assert.strictEqual(b.items.length, 1);
assert.strictEqual(b.read(b.items[0]).toString(), data.toString());
b.close(); fs.unlinkSync(file);
console.log('✓ Bundle-Leser');

if (process.env.W3_ROOT) {
  const { W3GameData } = require('../games/witcher3/gamedata/catalog');
  const gd = new W3GameData({ root: process.env.W3_ROOT, cacheDir: path.join(os.tmpdir(), 'fm-w3-cache') });
  gd.load().then((c) => {
    assert.ok(c.cards.length > 150, 'zu wenige Gwint-Karten');
    assert.ok(c.items.length > 2000, 'zu wenige Gegenstände');
    assert.ok(c.cards.every((x) => x.img), 'Karte ohne Bild');
    const g = c.cards.find((x) => x.items.includes('gwint_card_geralt'));
    assert.ok(g && g.power === 15 && g.hero);
    assert.ok(gd.image(g.img, 200).length > 1000);
    // Karten-Kopien gehören zu den gleichnamigen Gegenständen (so vergibt das Spiel sie beim Looten)
    const crin = c.cards.find((x) => x.card === 'crinfrid');
    assert.deepStrictEqual(crin.items, ['gwint_card_crinfrid', 'gwint_card_crinfrid2', 'gwint_card_crinfrid3']);
    // Kreaturen: große Bestiarium-Bilder statt 64-px-Symbole
    assert.ok(c.creatures.length > 120, 'zu wenige Kreaturen');
    const monsters = c.creatures.filter((x) => x.group === 'monster' || x.group === 'boss');
    assert.ok(monsters.every((x) => x.icon), 'Monster ohne Bild: ' + monsters.filter((x) => !x.icon).map((x) => x.id));
    const wolf = c.creatures.find((x) => x.id === 'wolf');
    assert.ok(/textures\\journal\\bestiary\\bestiary_wolf\.png$/.test(wolf.icon), wolf.icon);
    const wpng = gd.image(wolf.icon);
    assert.ok(wpng.readUInt32BE(16) >= 300, 'Bestiarium-Bild zu klein');
    // Seltenheit & Varianten (gleicher Name = verschiedene Gegenstände)
    const beau = c.items.filter((x) => x.name === 'Beauclair-Stahlschwert').map((x) => x.rarity).sort().join(',');
    assert.strictEqual(beau, '1,2,3', 'Beauclair-Stahlschwert-Varianten');
    assert.strictEqual(c.items.find((x) => x.id === 'Wolf School steel sword 1').rarity, 5);
    assert.strictEqual(c.items.find((x) => x.id === 'Medium armor 04_crafted').variant, 'crafted');
    // Inventar-Icons im Format 0x40d (Briefe/Schriftrollen)
    const scroll = c.items.find((x) => /scrolls\\scroll2\.dds$/.test(x.icon || ''));
    assert.ok(scroll && gd.image(scroll.icon), 'Schriftrollen-Icon nicht dekodierbar');
    // Weltkarten: Maßstab aus den Spieldateien, Wegweiser mit deutschem Namen an der richtigen Stelle
    const byId = Object.fromEntries(c.maps.map((m) => [m.id, m]));
    for (const id of ['novigrad', 'skellige', 'bob', 'kaer_morhen', 'prolog_village']) assert.ok(byId[id], 'Karte fehlt: ' + id);
    assert.strictEqual(byId.novigrad.size, 8625);
    assert.strictEqual(byId.bob.size, 8000);
    assert.ok(byId.novigrad.signposts.length > 80 && byId.skellige.signposts.length > 40);
    const novi = byId.novigrad.signposts.find((p) => p.name === 'Platz des Hierarchen');
    assert.ok(novi && Math.hypot(novi.x - 672, novi.y - 1875) < 50, 'Wegweiser Novigrad falsch');
    const tile = byId.novigrad.levels[2][0][2];
    assert.ok(gd.image(tile, 256).length > 1000, 'Kartenkachel nicht dekodierbar');
    // Bestiarium: Einträge mit Kategorie, Text und Schwachstellen (Öle mit drei Stufen)
    const b = c.bestiary;
    assert.ok(b && b.entries.length > 100 && b.groups.length >= 10, 'Bestiarium zu klein');
    assert.ok(b.entries.every((e) => e.group && e.texts.length && Array.isArray(e.weak) && e.ids.length), 'Bestiariums-Eintrag unvollständig');
    const wolves = b.entries.find((e) => /bestiary_wolf\.png$/.test(e.img || ''));
    assert.ok(wolves && wolves.steel && wolves.weak.some((w) => w.kind === 'oil' && w.levels.length === 3), 'Wölfe im Bestiarium falsch');
    console.log(`✓ Echte Installation: ${c.cards.length} Karten, ${c.items.length} Gegenstände, ${c.creatures.length} Kreaturen, ${c.maps.length} Weltkarten, ${b.entries.length} Bestiariums-Einträge`);
  });
}

// Spielstand-Leser (nur lesend): aktuelle Welt und eigene Marker aus dem neuesten Spielstand
{
  const { newestSave, unpack, parseSave, parseGwent, parseInventory } = require('../games/witcher3/gamedata/savegame');
  const save = newestSave();
  if (save) {
    const data = unpack(fs.readFileSync(save.file));
    const r = parseSave(data);
    assert.ok(/\.w2w$/.test(r.world || ''), 'aktuelle Welt nicht gefunden');
    assert.ok(Array.isArray(r.pins) && r.pins.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && p.type >= 0 && p.type <= 6));
    // Gwint-Sammlung: Kartennummern und Anzahl der Kopien
    const g = parseGwent(data);
    if (g.found) assert.ok([...g.cards.entries()].every(([i, n]) => i >= 0 && i < 10000 && n >= 1 && n < 100), 'Gwint-Sammlung unplausibel');
    // Geralts Inventar: Liste mit Anzahl im Kopf, beginnt mit seinen Körperteilen
    const inv = parseInventory(data);
    assert.ok(inv.found, 'Geralts Inventar nicht gefunden');
    assert.ok(inv.items.get('Geralt fists') === 1 && inv.items.has('Body underwear 01'), 'Inventar-Liste unplausibel');
    assert.ok([...inv.items.values()].every((n) => Number.isInteger(n) && n >= 0 && n < 1e7), 'Mengen unplausibel');
    console.log(`✓ Spielstand ${path.basename(save.file)}: ${r.world}, ${r.pins.length} eigene Marker, ${g.cards.size} Gwint-Karten + ${g.leaders.size} Anführer, ${inv.count} Inventar-Einträge`);
  }
}

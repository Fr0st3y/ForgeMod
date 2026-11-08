'use strict';
/* global forge, state, el, svg, toast, $, t, LOCALE, renderMap, renderBestiary, renderCheats */
/*
 * Galerien mit Bildern aus der eigenen Spielinstallation:
 *   cards     – Gwint-Sammlung (Karten-Art, Stärke, Reihe, Fähigkeiten)
 *   items     – alle Gegenstände mit Inventar-Icons
 *   creatures – Kreaturen mit Bestiarium-Bildern zum Beschwören
 */

const GAL = {
  view: {},      // gameId:gallery -> { filter, search, kind, limit }
  loading: {},   // gameId -> Promise
  failed: {},
  progress: null,
};

const PAGE = 96;
const ROW_LABEL = { nah: t('Nahkampf'), fern: t('Fernkampf'), belagerung: t('Belagerung') };
const CREATURE_GROUPS = { monster: t('Monster'), boss: t('Bosse & Große'), human: t('Menschen & Figuren'), animal: t('Tiere') };
const DLC_LABEL = { hos: 'Hearts of Stone', bw: 'Blood and Wine' };
const ITEM_DLC_LABEL = { ep1: 'Hearts of Stone', bob: 'Blood and Wine' };
// Seltenheit wie im Spiel (Attribut "quality") – Farben wie im Inventar
const RARITY = { 1: t('Gewöhnlich'), 2: t('Meister'), 3: t('Magisch'), 4: t('Relikt'), 5: t('Hexerausrüstung') };
const GEAR = new Set(['steelsword', 'silversword', 'armor', 'gloves', 'pants', 'boots', 'crossbow', 'weapon_other']);
const VARIANT = {
  crafted: [t('Hergestellt'), t('Vom Schmied gefertigte Version: feste Werte, oft mit Bonus-Effekten. Skaliert nicht mit deiner Stufe.')],
  ngp: [t('Neues Spiel+'), t('Version für „Neues Spiel+“: deutlich höhere Stufe und Werte. Im normalen Spiel kannst du sie erst mit entsprechender Stufe anlegen.')],
  npc: [t('NPC-Waffe'), t('Waffe, die eigentlich Gegner/NPCs tragen. Für Geralt meist schwächer.')],
};
const scalesText = (x) => (Array.isArray(x.scales)
  ? t('passt sich an (Stufe {min}–{max})', { min: x.scales[0], max: x.scales[1] })
  : t('passt sich deiner Stufe an'));
function gearLabel(x) {
  const parts = [RARITY[x.rarity] || ''];
  if (x.variant) parts.push(VARIANT[x.variant][0]);
  else if (x.school) parts.push(t('Schule: {school}', { school: x.school }));
  return parts.filter(Boolean).join(' · ');
}

function fallbackIcon(kind, x) {
  if (kind === 'items') return 'bag';
  return x.group === 'human' ? 'user' : 'paw';
}

function img(g, tex, w) { return tex ? forge.imageUrl(g.id, tex, w) : ''; }

function ensureCatalog(g) {
  if (state.catalogs[g.id]) return Promise.resolve(true);
  if (GAL.failed[g.id]) return Promise.resolve(false);
  if (!GAL.loading[g.id]) {
    GAL.loading[g.id] = forge.getCatalog(g.id).then((r) => {
      delete GAL.loading[g.id];
      if (r && r.ok) { state.catalogs[g.id] = r.catalog; return true; }
      GAL.failed[g.id] = r?.error || t('Unbekannter Fehler');
      return false;
    });
  }
  return GAL.loading[g.id];
}

forge.onCatalogProgress((p) => {
  GAL.progress = p;
  const bar = document.querySelector('.gal-loading .bar i');
  const txt = document.querySelector('.gal-loading .txt');
  if (bar) bar.style.width = `${Math.round(p.progress * 100)}%`;
  if (txt) txt.textContent = p.text;
});

function viewState(g, kind) {
  const k = `${g.id}:${kind}`;
  if (!GAL.view[k]) GAL.view[k] = { filter: 'all', type: 'all', rarity: 'all', variant: 'all', search: '', limit: PAGE };
  return GAL.view[k];
}

function renderGallery(root, g, kind) {
  const def = g.galleries[kind];
  const wrap = el('section', `gallery gal-${kind}`);
  root.append(wrap);
  const cat = state.catalogs[g.id];
  if (!cat) {
    if (GAL.failed[g.id]) {
      const box = el('div', 'gal-loading');
      box.append(el('b', '', t('Spieldaten konnten nicht gelesen werden')), el('span', 'txt', GAL.failed[g.id]));
      const retry = el('button', 'btn small', t('Erneut versuchen'));
      retry.onclick = () => { delete GAL.failed[g.id]; renderCheats(); };
      box.append(retry);
      wrap.append(box);
      return wrap;
    }
    const box = el('div', 'gal-loading');
    box.append(el('b', '', t('Lese Spieldaten aus deiner Witcher-3-Installation …')));
    const bar = el('div', 'bar'); bar.append(el('i'));
    box.append(bar, el('span', 'txt', GAL.progress?.text || t('Beim ersten Mal dauert das ein paar Sekunden.')));
    wrap.append(box);
    ensureCatalog(g).then(() => { if (state.current === g.id && state.tab) renderCheats(); });
    return wrap;
  }
  if (kind === 'map') { renderMap(wrap, g, cat, def); return wrap; }
  if (kind === 'bestiary') { renderBestiary(wrap, g, cat, def); return wrap; }

  const vs = viewState(g, kind);
  const list = cat[def.source] || [];

  // Kopf mit Suche
  const head = el('div', 'gal-head');
  const titleBox = el('div', 'gal-title');
  titleBox.append(el('h2', '', def.title), el('p', '', def.hint || ''));
  const search = el('label', 'search gal-search');
  search.innerHTML = svg('search');
  const sIn = el('input');
  sIn.type = 'search';
  sIn.placeholder = kind === 'cards' ? t('Karte suchen …') : kind === 'items' ? t('Gegenstand suchen …') : t('Kreatur suchen …');
  sIn.value = vs.search; sIn.spellcheck = false;
  sIn.oninput = () => { vs.search = sIn.value; vs.limit = PAGE; drawGrid(); };
  search.append(sIn);
  head.append(titleBox, search);
  wrap.append(head);

  // Filter
  const chips = el('div', 'gal-filters');
  const chip = (id, label, count, key = 'filter') => {
    const b = el('button', `chip${vs[key] === id ? ' active' : ''}`);
    b.append(el('span', '', label));
    if (count !== undefined) b.append(el('span', 'n', String(count)));
    b.onclick = () => { vs[key] = id; vs.limit = PAGE; renderCheats(); };
    return b;
  };
  if (kind === 'cards') {
    chips.append(chip('all', t('Alle'), list.length));
    for (const f of cat.factions) chips.append(chip(f.id, f.name, list.filter((c) => c.faction === f.id).length));
    const types = el('div', 'gal-filters sub');
    types.append(chip('all', t('Alle Typen'), undefined, 'type'), chip('hero', t('Helden'), undefined, 'type'), chip('unit', t('Einheiten'), undefined, 'type'),
      chip('special', t('Spezial & Wetter'), undefined, 'type'), chip('leader', t('Anführer'), undefined, 'type'), chip('starter', t('Startdeck'), undefined, 'type'));
    wrap.append(chips, types);
  } else if (kind === 'items') {
    chips.append(chip('all', t('Alle'), list.length));
    for (const gr of cat.groups) chips.append(chip(gr.id, gr.name, gr.count));
    wrap.append(chips);
    // Waffen & Rüstungen: zusätzlich nach Seltenheit und Variante filtern
    if (GEAR.has(vs.filter)) {
      const inGroup = list.filter((x) => x.group === vs.filter);
      const rar = el('div', 'gal-filters sub');
      rar.append(chip('all', t('Alle Seltenheiten'), inGroup.length, 'rarity'));
      for (const [r, label] of Object.entries(RARITY)) {
        const n = inGroup.filter((x) => String(x.rarity) === r).length;
        if (n) { const b = chip(r, label, n, 'rarity'); b.classList.add(`rar-${r}`); rar.append(b); }
      }
      const vari = el('div', 'gal-filters sub');
      const vcount = (f) => inGroup.filter(f).length;
      vari.append(chip('all', t('Alle Varianten'), undefined, 'variant'),
        chip('normal', t('Normal'), vcount((x) => !x.variant), 'variant'),
        chip('scales', t('Passt sich Stufe an'), vcount((x) => x.scales), 'variant'),
        chip('crafted', t('Hergestellt'), vcount((x) => x.variant === 'crafted'), 'variant'),
        chip('ngp', t('Neues Spiel+'), vcount((x) => x.variant === 'ngp'), 'variant'));
      wrap.append(rar, vari);
    }
  } else {
    chips.append(chip('all', t('Alle'), list.length));
    for (const [id, label] of Object.entries(CREATURE_GROUPS)) {
      const n = list.filter((c) => c.group === id).length;
      if (n) chips.append(chip(id, label, n));
    }
    for (const [id, label] of Object.entries(DLC_LABEL)) {
      const n = list.filter((c) => c.dlc === id).length;
      if (n) chips.append(chip(id, label, n));
    }
    wrap.append(chips);
  }

  const grid = el('div', `gal-grid g-${kind}`);
  const more = el('div', 'gal-more');
  wrap.append(grid, more);

  function filtered() {
    const q = vs.search.trim().toLowerCase();
    return list.filter((x) => {
      if (q && !(x.name.toLowerCase().includes(q) || (x.id || '').toLowerCase().includes(q))) return false;
      if (kind === 'cards') {
        if (vs.filter !== 'all' && x.faction !== vs.filter) return false;
        if (vs.type === 'hero' && !x.hero) return false;
        if (vs.type === 'unit' && (x.kind !== 'unit' || x.hero)) return false;
        if (vs.type === 'special' && !(x.kind === 'special' || x.kind === 'weather')) return false;
        if (vs.type === 'leader' && x.kind !== 'leader') return false;
        if (vs.type === 'starter' && !x.starter) return false;
        return true;
      }
      if (kind === 'items') {
        if (vs.filter !== 'all' && x.group !== vs.filter) return false;
        if (!GEAR.has(vs.filter)) return true;
        if (vs.rarity !== 'all' && String(x.rarity) !== vs.rarity) return false;
        if (vs.variant === 'normal' && x.variant) return false;
        if (vs.variant === 'scales' && !x.scales) return false;
        if ((vs.variant === 'crafted' || vs.variant === 'ngp') && x.variant !== vs.variant) return false;
        return true;
      }
      if (vs.filter === 'all') return true;
      if (DLC_LABEL[vs.filter]) return x.dlc === vs.filter;
      return (x.group || (x.animal ? 'animal' : 'monster')) === vs.filter;
    });
  }

  function drawGrid() {
    grid.textContent = '';
    more.textContent = '';
    const items = filtered();
    if (!items.length) { grid.append(el('div', 'empty', t('Nichts gefunden.'))); return; }
    for (const x of items.slice(0, vs.limit)) grid.append(tile(g, kind, x, cat));
    if (items.length > vs.limit) {
      const b = el('button', 'btn small ghost', t('Weitere {n} von {rest} anzeigen', { n: Math.min(PAGE, items.length - vs.limit), rest: items.length - vs.limit }));
      b.onclick = () => { vs.limit += PAGE; drawGrid(); };
      more.append(b);
      // automatisch nachladen beim Scrollen
      const io = new IntersectionObserver((ents) => {
        if (ents.some((e) => e.isIntersecting)) { io.disconnect(); vs.limit += PAGE; drawGrid(); }
      }, { root: document.querySelector('.cheats-wrap'), rootMargin: '400px' });
      io.observe(more);
    } else {
      const label = kind === 'cards' ? t('{n} Karten', { n: items.length }) : kind === 'items' ? t('{n} Gegenstände', { n: items.length }) : t('{n} Kreaturen', { n: items.length });
      more.append(el('span', 'gal-end', label));
    }
  }
  drawGrid();
  return wrap;
}

function tile(g, kind, x, cat) {
  const btn = el('button', `tile t-${kind}`);
  btn.title = x.name;
  if (kind === 'cards') {
    btn.classList.add(`f-${x.faction}`);
    if (x.hero) btn.classList.add('hero');
    if (x.starter) btn.classList.add('starter');
    const pic = el('div', 'pic');
    const im = el('img'); im.loading = 'lazy'; im.decoding = 'async'; im.src = img(g, x.img, 200); im.alt = '';
    pic.append(im);
    if (x.kind === 'unit' || x.hero) pic.append(el('span', `pow${x.hero ? ' gold' : ''}`, String(x.power)));
    if (x.copies > 1) pic.append(el('span', 'copies', `×${x.copies}`));
    if (x.starter) pic.append(el('span', 'badge', t('Startdeck')));
    btn.append(pic, el('span', 'tname', x.name));
  } else {
    const pic = el('div', 'pic');
    const thumb = g.galleries[kind]?.thumb || 0;
    if (x.icon) {
      const im = el('img'); im.loading = 'lazy'; im.decoding = 'async'; im.src = img(g, x.icon, thumb); im.alt = '';
      im.onerror = () => { im.remove(); pic.innerHTML = svg(fallbackIcon(kind, x), 'ph'); };
      pic.append(im);
    } else pic.innerHTML = svg(fallbackIcon(kind, x), 'ph');
    if (kind === 'creatures' && x.dlc) pic.append(el('span', 'badge', x.dlc === 'hos' ? 'HoS' : 'BaW'));
    btn.append(pic, el('span', 'tname', x.name));
    if (kind === 'items') {
      if (x.rarity) {
        btn.classList.add(`rar-${x.rarity}`);
        btn.append(el('span', 'tsub rar', gearLabel(x)));
      } else {
        const grp = cat.groups.find((gr) => gr.id === x.group);
        btn.append(el('span', 'tsub', grp ? grp.name : ''));
      }
    } else {
      btn.append(el('span', 'tsub', CREATURE_GROUPS[x.group] || ''));
    }
  }
  btn.onclick = () => openDetail(g, kind, x, cat);
  return btn;
}

// ---------- Detailansicht ----------
function openDetail(g, kind, x, cat) {
  const modal = $('#detail');
  const card = $('#detailCard');
  card.textContent = '';
  card.className = `detail-card d-${kind}`;
  const left = el('div', 'd-pic');
  const right = el('div', 'd-info');
  const close = el('button', 'd-close');
  close.innerHTML = svg('x');
  close.onclick = () => { modal.hidden = true; };
  card.append(close, left, right);

  const tex = kind === 'cards' ? x.img : x.icon;
  if (tex) {
    const im = el('img'); im.src = img(g, tex); im.alt = '';
    im.onerror = () => { im.remove(); left.innerHTML = svg(fallbackIcon(kind, x), 'ph'); };
    left.append(im);
  } else left.innerHTML = svg(fallbackIcon(kind, x), 'ph');

  right.append(el('h3', '', x.name));
  const meta = el('div', 'd-meta');
  const actions = el('div', 'd-actions');
  const connected = g.status === 'connected';

  const act = async (cheatId, params, label) => {
    if (!connected) return toast(t('Spiel ist nicht verbunden'), 'err');
    const r = await forge.run(g.id, cheatId, params);
    if (r && r.ok) toast(label, 'ok'); else toast(r?.error ? t('Fehlgeschlagen: {error}', { error: r.error }) : t('Fehlgeschlagen'), 'err');
  };

  if (kind === 'cards') {
    const f = cat.factions.find((y) => y.id === x.faction);
    meta.append(pill(f ? f.name : '', `f-${x.faction}`));
    if (x.kind === 'leader') meta.append(pill(t('Anführer')));
    if (x.hero) meta.append(pill(t('Held'), 'gold'));
    if (x.kind === 'unit' || x.hero) meta.append(pill(t('Stärke {n}', { n: x.power })));
    for (const r of x.rows) meta.append(pill(ROW_LABEL[r]));
    for (const a of x.abilities) meta.append(pill(a, 'ability'));
    if (x.spy) meta.append(pill(t('Spion'), 'ability'));
    right.append(meta);
    if (x.desc) right.append(el('p', 'd-desc quote', x.desc));
    if (x.copies > 1) right.append(el('p', 'd-note', t('Diese Karte gibt es {n}× im Spiel.', { n: x.copies })));

    const give = el('button', 'btn primary', x.copies > 1 ? t('Alle {n} in die Sammlung', { n: x.items.length || x.copies }) : t('In die Sammlung'));
    give.disabled = x.starter || !x.items.length;
    give.onclick = () => act('g_card', { ids: x.items.join(' ') }, t('{name} zur Sammlung hinzugefügt', { name: x.name }));
    const draw = el('button', 'btn', t('Während Partie ins Blatt ziehen'));
    draw.onclick = () => act('g_draw', { card: (x.cards && x.cards[0]) || x.card }, t('{name} gezogen', { name: x.name }));
    if (!x.starter) actions.append(give);
    actions.append(draw);
    if (x.starter) right.append(el('p', 'd-note', t('Startdeck-Karte: Du besitzt sie schon. Während einer Gwint-Partie kannst du sie beliebig oft ins Blatt ziehen.')));
    else right.append(el('p', 'd-note', t('„Ins Blatt ziehen“ funktioniert mit jeder Karte – auch fremder Fraktionen – während du gerade Gwint spielst.')));
  } else if (kind === 'items') {
    const grp = cat.groups.find((gr) => gr.id === x.group);
    if (x.rarity) meta.append(pill(RARITY[x.rarity], `rar rar-${x.rarity}`));
    if (x.variant) meta.append(pill(VARIANT[x.variant][0]));
    if (x.school) meta.append(pill(t('Hexerschule: {school}', { school: x.school })));
    if (grp) meta.append(pill(grp.name));
    if (x.price) meta.append(pill(t(x.price === 1 ? '{n} Krone' : '{n} Kronen', { n: x.price.toLocaleString(LOCALE) })));
    if (x.dlc) meta.append(pill(ITEM_DLC_LABEL[x.dlc] || 'DLC'));
    right.append(meta);
    if (x.desc) right.append(el('p', 'd-desc', x.desc));
    right.append(el('p', 'd-id', x.id));
    const n = numberField(t('Anzahl'), 1, 1, 999);
    const quick = el('div', 'presets');
    for (const v of [1, 5, 10, 99]) { const b = el('button', 'preset', String(v)); b.onclick = () => { n.input.value = v; }; quick.append(b); }
    const give = el('button', 'btn primary', t('Geben'));
    give.onclick = () => act('g_item', { id: x.id, n: Number(n.input.value) || 1 }, `${n.input.value}× ${x.name}`);
    actions.append(n.wrap, give);
    if (x.rarity) {
      // additem(..., true): das Spiel legt den Gegenstand direkt an
      const equip = el('button', 'btn', x.scales ? t('Auf meine Stufe holen & anlegen') : t('Geben & anlegen'));
      equip.onclick = () => act('g_item', { id: x.id, n: 1, equip: true }, t('{name} angelegt', { name: x.name }));
      actions.append(equip);
    }
    right.append(quick);
    if (x.rarity) {
      if (x.scales) right.append(el('p', 'd-note', t('Mitleveln: Dieser Gegenstand {scales}. Das Spiel berechnet Werte und Stufe in dem Moment, in dem du ihn bekommst. Nach einem Stufenaufstieg einfach neu holen – die neue Kopie ist dann stärker.', { scales: scalesText(x) })));
      else right.append(el('p', 'd-note', x.rarity === 5
        ? t('Hexerausrüstung hat im Spiel feste Stufen (Basis → Verbessert → Überlegen → Meisterlich → Großmeister). Stärker wird sie über die nächste Stufe des Sets, nicht durch Mitleveln.')
        : t('Feste Werte – skaliert nicht mit deiner Stufe.')));
      if (x.variant) right.append(el('p', 'd-note', VARIANT[x.variant][1]));
      // Gleicher Name, anderer Gegenstand: Varianten nebeneinander
      const twins = cat.items.filter((y) => y.name === x.name && y.id !== x.id);
      if (twins.length) {
        const box = el('div', 'd-variants');
        box.append(el('div', 'd-vtitle', t('{n} Varianten mit diesem Namen', { n: twins.length + 1 })));
        for (const y of [x, ...twins]) {
          const b = el('button', `d-vrow rar-${y.rarity}${y.id === x.id ? ' cur' : ''}`);
          b.append(el('span', 'dot'), el('span', 'vn', gearLabel(y) || y.id), el('span', 'vs', y.scales ? scalesText(y) : t('feste Werte')), el('span', 'vid', y.id));
          if (y.id !== x.id) b.onclick = () => openDetail(g, kind, y, cat);
          box.append(b);
        }
        right.append(box);
      }
    }
  } else {
    meta.append(pill(CREATURE_GROUPS[x.group] || (x.animal ? t('Tier') : t('Monster'))));
    if (x.dlc) meta.append(pill(DLC_LABEL[x.dlc]));
    right.append(meta);
    right.append(el('p', 'd-id', `spawn('${x.id}')`));
    const n = numberField(t('Anzahl'), 1, 1, 20);
    const lvl = numberField(t('Stufe (0 = auto)'), 0, 0, 100);
    const dist = numberField(t('Abstand (m)'), 4, 1, 50);
    const hostileWrap = el('label', 'd-check');
    const hostile = el('input'); hostile.type = 'checkbox'; hostile.checked = x.group !== 'animal' && x.group !== 'human';
    hostileWrap.append(hostile, el('span', '', t('Greift dich an')));
    hostileWrap.title = t('An: greift dich auf jeden Fall an. Aus: normales Verhalten (Monster bleiben trotzdem meist feindlich).');
    const row = el('div', 'd-fields');
    row.append(n.wrap, lvl.wrap, dist.wrap, hostileWrap);
    right.append(row);
    if (x.story) right.append(el('p', 'd-note warn', t('Story-Figur: Ein zweites Exemplar kann laufende Quests stören. Nur zum Spaß, und danach am besten einen älteren Spielstand laden.')));
    else if (x.group === 'boss') right.append(el('p', 'd-note', t('Bosse sind stark. Speichere vorher, und schalte notfalls God Mode ein.')));
    const spawn = el('button', 'btn primary', t('Beschwören'));
    spawn.onclick = () => act('g_spawn', { id: x.id, n: Number(n.input.value) || 1, dist: Number(dist.input.value) || 4, hostile: hostile.checked, level: Number(lvl.input.value) || 0 },
      t('{n}× {name} beschworen', { n: n.input.value, name: x.name }));
    actions.append(spawn);
  }
  if (!connected) right.append(el('p', 'd-note warn', t('Starte Witcher 3, um Gegenstände zu geben oder zu beschwören.')));
  right.append(actions);
  modal.hidden = false;
}

function pill(text, cls = '') { return el('span', `pill ${cls}`, text); }

function numberField(label, def, min, max) {
  const wrap = el('div', 'field');
  wrap.append(el('label', '', label));
  const input = el('input');
  input.type = 'number'; input.value = def; input.min = min; input.max = max;
  wrap.append(input);
  return { wrap, input };
}

document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const m = $('#detail'); if (m) m.hidden = true; } });
document.addEventListener('click', (e) => { const m = $('#detail'); if (m && e.target === m) m.hidden = true; });

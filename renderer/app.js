'use strict';
/* global forge, t, LANG, LOCALE */

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const ICONS = {
  all: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  shield: '<path d="M12 3 4 6.5v5.5c0 4.6 3.4 8.2 8 9.5 4.6-1.3 8-4.9 8-9.5V6.5z"/>',
  coins: '<ellipse cx="9" cy="7" rx="6" ry="3"/><path d="M3 7v4c0 1.7 2.7 3 6 3s6-1.3 6-3V7"/><path d="M9 14v3c0 1.7 2.7 3 6 3s6-1.3 6-3v-4c0-1.7-2.7-3-6-3"/>',
  cards: '<rect x="3" y="6" width="11" height="15" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v13"/>',
  bag: '<path d="M5 8h14l-1 13H6z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>',
  map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1 20 20M8.1 15.9 20 4"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
  alert: '<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  paw: '<circle cx="5.5" cy="10" r="2"/><circle cx="9.5" cy="5.5" r="2"/><circle cx="14.5" cy="5.5" r="2"/><circle cx="18.5" cy="10" r="2"/><path d="M12 12c-3 0-6 3.5-6 6.5 0 1.5 1.2 2.5 2.7 2.5 1.2 0 2-.6 3.3-.6s2.1.6 3.3.6c1.5 0 2.7-1 2.7-2.5 0-3-3-6.5-6-6.5z"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  medallion: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6.5"/><path d="m8 7 8 10M16 7 8 17"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  book: '<path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 21.5V4.5M8 7h8M8 11h6"/>',
  window: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M14 14h4M16 12v4"/>',
  refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  drop: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
};
const svg = (name, cls) => `<svg viewBox="0 0 24 24"${cls ? ` class="${cls}"` : ''}>${ICONS[name] || ICONS.all}</svg>`;

const STATUS = {
  offline: { label: t('Nicht gestartet'), side: t('Nicht gestartet') },
  starting: { label: t('Spiel erkannt – verbinde …'), side: t('Verbinde …') },
  noport: { label: t('Läuft ohne Cheat-Schnittstelle'), side: t('Neustart nötig') },
  connected: { label: t('Verbunden · Cheats aktiv'), side: t('Verbunden') },
};

const state = {
  games: [],
  current: null,
  tab: 'all',
  search: '',
  logs: {},
  params: {}, // gameId -> cheatId -> {key: value}
  recording: null,
  catalogs: {},
  confirmed: new Set(), // Schalter, deren Warnung in dieser Sitzung schon bestätigt wurde
  update: null,
};

const game = () => state.games.find((g) => g.id === state.current);

// ---------- Start ----------
async function init() {
  const data = await forge.listGames();
  state.games = data.games;
  renderSidebar();
  const first = state.games.find((g) => g.id === data.lastGame) || state.games[0];
  if (first) selectGame(first.id);
  else $('#gameTitle').textContent = t('Keine Spiele gefunden');
  // Eigenes Bestiariums-Fenster: direkt den Bestiariums-Tab zeigen, ohne Seitenleiste/Kopf/Konsole
  if (VIEW === 'bestiary' && first) {
    document.title = `ForgeMod – ${t('Bestiarium')}`;
    state.tab = 'bestiary';
    renderTabs(); renderCheats(); renderStatus();
  }

  forge.onStatus((s) => {
    const g = state.games.find((x) => x.id === s.gameId);
    if (!g) return;
    const changed = g.status !== s.status;
    g.status = s.status;
    g.toggles = s.toggles || {};
    renderSidebar();
    if (g.id === state.current) {
      renderStatus();
      syncToggles();
      if (changed && s.status === 'connected') toast(t('{game} verbunden – Cheats freigeschaltet', { game: g.name }), 'ok');
    }
  });

  let lastSeq = 0;
  const onLog = (l) => {
    if (l.seq && l.seq <= lastSeq) return;
    lastSeq = l.seq || lastSeq;
    (state.logs[l.gameId] = state.logs[l.gameId] || []).push(l);
    if (state.logs[l.gameId].length > 500) state.logs[l.gameId].shift();
    if (l.gameId === state.current || l.gameId === 'app') appendLog(l); // 'app' = Meldungen von ForgeMod selbst
  };
  forge.onLog(onLog);
  for (const l of data.logs || []) onLog(l);

  bindUi();
  initUpdates();
}

// ---------- Seitenleiste ----------
function thumbStyle(g) {
  const b = g.banner || {};
  return `linear-gradient(135deg, ${b.from || '#222'} 0%, ${b.via || '#444'} 55%, ${b.to || '#111'} 100%)`;
}

function renderSidebar() {
  const list = $('#gameList');
  list.textContent = '';
  for (const g of state.games) {
    const item = el('button', `game-item s-${g.status}${g.id === state.current ? ' active' : ''}`);
    const thumb = el('div', 'game-thumb');
    thumb.style.background = thumbStyle(g);
    thumb.innerHTML = svg(g.banner?.glyph || 'medallion');
    const meta = el('div', 'game-meta');
    meta.append(el('div', 'game-name', g.name));
    const st = el('div', 'game-state');
    st.append(el('span', 'dot'), el('span', '', STATUS[g.status]?.side || g.status));
    meta.append(st);
    item.append(thumb, meta);
    item.onclick = () => selectGame(g.id);
    list.append(item);
  }
}

// ---------- Spiel auswählen ----------
function selectGame(id) {
  state.current = id;
  state.tab = 'all';
  const g = game();
  forge.setLastGame(id);
  document.documentElement.style.setProperty('--accent', g.accent);
  $('#gameTitle').textContent = g.name;
  $('#gameSub').textContent = g.subtitle;
  const art = $('#heroArt');
  art.style.background = thumbStyle(g);
  art.innerHTML = svg(g.banner?.glyph || 'medallion', 'glyph');

  // Feldwerte aus zuletzt benutzten Werten bzw. Standardwerten
  const p = (state.params[id] = state.params[id] || {});
  for (const cat of g.categories) for (const c of cat.cheats) {
    if (!c.fields.length || p[c.id]) continue;
    p[c.id] = {};
    for (const f of c.fields) p[c.id][f.key] = g.settings.lastParams?.[c.id]?.[f.key] ?? f.default;
  }

  renderSidebar();
  renderTabs();
  renderCheats();
  renderStatus();
  $('#log').textContent = '';
  for (const l of [...(state.logs.app || []), ...(state.logs[id] || [])].sort((a, b) => a.time - b.time)) appendLog(l);
}

function renderStatus() {
  const g = game();
  if (!g) return;
  const pill = $('#statusPill');
  pill.className = `status-pill s-${g.status}`;
  $('#statusText').textContent = STATUS[g.status]?.label || g.status;

  const launch = $('#launchBtn');
  const running = g.status !== 'offline';
  launch.disabled = running;
  launch.querySelector('span').textContent = running ? t('Läuft') : t('Spiel starten');

  const banner = $('#setupBanner');
  $('#setupGuide').textContent = '';
  if (g.status === 'noport') {
    banner.hidden = false;
    banner.className = 'setup-banner err';
    $('#setupTitle').textContent = t('Spiel läuft ohne Cheat-Schnittstelle');
    $('#setupText').textContent = g.setupGuide
      ? t('Einmal im Launcher eintragen, dann das Spiel neu starten – ab da erkennt ForgeMod es bei jedem normalen Start automatisch. (Alternativ: Spiel beenden und über „Spiel starten“ öffnen.)')
      : t('Beende {game} und starte es über „Spiel starten“ neu.', { game: g.name }) + ' ' + g.setupHint;
    if (g.setupGuide) renderSetupGuide($('#setupGuide'), g);
  } else if (g.status === 'starting') {
    banner.hidden = false;
    banner.className = 'setup-banner';
    $('#setupTitle').textContent = t('Spiel gefunden');
    $('#setupText').textContent = t('Warte auf die Cheat-Schnittstelle … Das dauert meist nur bis zum Hauptmenü.');
  } else {
    banner.hidden = true;
  }

  const wrap = document.querySelector('.cheats-wrap');
  const galleryTab = g.categories.some((c) => c.id === state.tab && c.gallery);
  wrap.classList.toggle('locked', g.status !== 'connected' && !galleryTab);
  $('#lockTitle').textContent = g.status === 'noport' ? t('Neustart mit Startoptionen nötig') : g.status === 'starting' ? t('Verbinde mit dem Spiel …') : t('Cheats gesperrt');
  $('#lockText').textContent = g.status === 'offline'
    ? t('Starte {game} mit den Startoptionen „-net -debugscripts“ – sobald es verbunden ist, werden die Cheats freigeschaltet. Läuft das Spiel schon und nichts passiert, fehlen die Startoptionen (Anleitung unter ⚙).', { game: g.name })
    : g.status === 'starting' ? t('Gleich geht’s los. Lade am besten schon einen Spielstand.') : g.setupHint;
}

// ---------- Tabs ----------
function renderTabs() {
  const g = game();
  const tabs = $('#tabs');
  tabs.textContent = '';
  const all = g.categories.reduce((n, c) => n + c.cheats.length, 0);
  const entries = [
    { id: 'all', name: t('Alle'), icon: 'all', count: all },
    { id: 'fav', name: t('Favoriten'), icon: 'star', count: g.settings.favorites.length },
    ...g.categories.map((c) => ({ id: c.id, name: c.name, icon: c.icon, count: c.cheats.length })),
  ];
  for (const e of entries) {
    const b = el('button', `tab${state.tab === e.id ? ' active' : ''}`);
    b.innerHTML = svg(e.icon);
    b.append(el('span', '', e.name));
    // reine Galerie-Tabs (z. B. Bestiarium) ohne Zähler
    if (e.count || !g.categories.some((c) => c.id === e.id && c.gallery)) b.append(el('span', 'count', String(e.count)));
    b.onclick = () => { state.tab = e.id; renderTabs(); renderCheats(); renderStatus(); document.querySelector('.cheats-wrap').scrollTop = 0; };
    tabs.append(b);
  }
}

// ---------- Cheats ----------
function matches(c, q) {
  if (!q) return true;
  return (c.name + ' ' + c.desc).toLowerCase().includes(q);
}

function renderCheats() {
  const g = game();
  const root = $('#cheats');
  root.textContent = '';
  const q = state.search.trim().toLowerCase();
  let shown = 0;
  for (const cat of g.categories) {
    if (state.tab !== 'all' && state.tab !== 'fav' && state.tab !== cat.id) continue;
    const cheats = cat.cheats.filter((c) => matches(c, q) && (state.tab !== 'fav' || g.settings.favorites.includes(c.id)));
    if (!cheats.length) continue;
    if (state.tab === 'all' || state.tab === 'fav') root.append(el('div', 'cat-title', cat.name));
    for (const c of cheats) { root.append(cheatCard(g, c)); shown++; }
  }
  const galCat = g.categories.find((c) => c.id === state.tab && c.gallery);
  if (galCat && g.galleries[galCat.gallery]) {
    const wrap = renderGallery(root, g, galCat.gallery);
    if (wrap && g.galleries[galCat.gallery].top) root.prepend(wrap);
    return;
  }
  if (!shown) {
    root.append(el('div', 'empty', state.tab === 'fav'
      ? t('Noch keine Favoriten – klicke auf den Stern bei einem Cheat.')
      : t('Keine Cheats gefunden.')));
  }
}

function prettyKey(acc) {
  if (!acc) return '–';
  return acc.replace(/num(\d)/i, 'Num $1').replace(/numadd/i, 'Num +').replace(/numsub/i, 'Num −')
    .replace(/nummult/i, 'Num ×').replace(/numdiv/i, 'Num ÷').replace(/numdec/i, 'Num ,')
    .replace('CommandOrControl', t('Strg')).replace('Control', t('Strg')).replace('Shift', '⇧');
}

function cheatCard(g, c) {
  const card = el('div', `cheat${c.danger ? ' is-danger' : ''}`);
  card.dataset.id = c.id;
  if (g.toggles[c.id]) card.classList.add('on');

  const top = el('div', 'cheat-top');
  const info = el('div', 'cheat-info');
  const name = el('div', 'cheat-name', c.name);
  if (c.tag) name.append(el('span', `tag t-${c.tag}`, c.tagLabel || c.tag));
  if (c.type === 'loop') name.append(el('span', 'tag', t('Dauerhaft')));
  info.append(name, el('div', 'cheat-desc', c.desc));
  if (c.warn) info.append(el('div', 'cheat-warn', c.warn));

  const side = el('div', 'cheat-side');
  const fav = el('button', `fav${g.settings.favorites.includes(c.id) ? ' on' : ''}`);
  fav.title = t('Favorit');
  fav.innerHTML = svg('star');
  fav.onclick = async () => {
    g.settings.favorites = await forge.toggleFavorite(g.id, c.id);
    fav.classList.toggle('on', g.settings.favorites.includes(c.id));
    renderTabs();
    if (state.tab === 'fav') renderCheats();
  };

  const hk = el('button', `hotkey${c.hotkey ? '' : ' none'}`, prettyKey(c.hotkey));
  hk.title = t('Klicken: Hotkey festlegen · Rechtsklick: entfernen');
  hk.onclick = () => recordHotkey(g, c, hk);
  hk.oncontextmenu = async (e) => { e.preventDefault(); await setHotkey(g, c, '', hk); };

  side.append(fav, hk);

  if (c.type === 'toggle' || c.type === 'loop') {
    const sw = el('label', 'switch');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = !!g.toggles[c.id];
    input.onchange = async () => {
      const want = input.checked;
      input.checked = !want; // erst nach Bestätigung durch das Spiel umschalten
      // Schalter mit Warnung: beim ersten Einschalten pro Sitzung nachfragen
      if (want && c.confirm && !state.confirmed.has(c.id)) {
        if (!(await confirmDialog(c.name, c.confirm, c.danger, t('Einschalten')))) return;
        state.confirmed.add(c.id);
      }
      const r = await forge.run(g.id, c.id, currentParams(g, c), want);
      if (r && r.ok) { input.checked = !!r.state; card.classList.toggle('on', !!r.state); toast(r.state ? t('{name} aktiviert', { name: c.name }) : t('{name} deaktiviert', { name: c.name }), 'ok'); }
      else toast(`${c.name}: ${r?.error || t('fehlgeschlagen')}`, 'err');
    };
    sw.append(input, el('span', 'track'), el('span', 'knob'));
    side.append(sw);
  }
  top.append(info, side);
  card.append(top);

  if (c.type === 'action' || !c.type) {
    const row = el('div', 'fields');
    for (const f of c.fields) row.append(fieldInput(g, c, f));
    const btn = el('button', `btn small${c.danger ? ' danger' : ' primary-soft'}`, c.button || t('Ausführen'));
    btn.onclick = () => runAction(g, c, card);
    row.append(btn);
    card.append(row);
    if (c.presets) {
      const pr = el('div', 'presets');
      for (const v of c.presets.values) {
        const b = el('button', 'preset', Number(v).toLocaleString(LOCALE));
        b.onclick = () => {
          state.params[g.id][c.id][c.presets.key] = v;
          const inp = card.querySelector(`[data-key="${c.presets.key}"]`);
          if (inp) inp.value = v;
          runAction(g, c, card);
        };
        pr.append(b);
      }
      card.append(pr);
    }
  }
  return card;
}

function fieldInput(g, c, f) {
  // Ja/Nein-Schalter (z. B. „Nur fehlende Karten“)
  if (f.type === 'bool') {
    const values = state.params[g.id][c.id];
    const wrap = el('label', 'field check');
    const input = el('input');
    input.type = 'checkbox';
    input.dataset.key = f.key;
    input.checked = values[f.key] ?? !!f.default;
    values[f.key] = input.checked;
    input.onchange = () => { values[f.key] = input.checked; };
    wrap.append(input, el('span', '', f.label));
    if (f.hint) wrap.title = f.hint;
    return wrap;
  }
  const wrap = el('div', `field${f.type === 'select' || f.type === 'text' ? ' wide' : ''}`);
  wrap.append(el('label', '', f.label));
  const values = state.params[g.id][c.id];
  let input;
  if (f.type === 'select') {
    input = el('select');
    let options = f.options;
    const cat = f.optionsFrom && state.catalogs[g.id];
    if (cat && Array.isArray(cat[f.optionsFrom]) && cat[f.optionsFrom].length) {
      options = cat[f.optionsFrom].map((o) => ({ value: o.id, label: o.name }));
    } else if (f.optionsFrom && g.hasData) {
      ensureCatalog(g).then((ok) => { if (ok && state.current === g.id) renderCheats(); });
    }
    for (const o of options) {
      const op = el('option', '', o.label);
      op.value = o.value;
      input.append(op);
    }
  } else {
    input = el('input');
    // Kommazahlen als Textfeld: Chromium würde sie sonst im Format der Windows-Region anzeigen ("0,25" auch auf Englisch)
    input.type = f.type === 'number' && !f.float ? 'number' : 'text';
    if (f.float) input.inputMode = 'decimal';
    if (f.min !== undefined) input.min = f.min;
    if (f.max !== undefined) input.max = f.max;
    if (f.step && !f.float) input.step = f.step;
    if (f.placeholder) input.placeholder = f.placeholder;
    input.spellcheck = false;
    input.onkeydown = (e) => { if (e.key === 'Enter') runAction(g, c, input.closest('.cheat')); };
  }
  input.dataset.key = f.key;
  input.value = values[f.key] ?? f.default ?? '';
  input.oninput = input.onchange = () => {
    values[f.key] = f.type === 'number' ? Number(String(input.value).trim().replace(',', '.')) : input.value;
    // z. B. die Weltkarte hört mit (Region / Koordinaten)
    document.dispatchEvent(new CustomEvent('forge:param', { detail: { gameId: g.id, cheatId: c.id, key: f.key, value: values[f.key] } }));
  };
  wrap.append(input);
  return wrap;
}

function currentParams(g, c) {
  return { ...(state.params[g.id]?.[c.id] || {}) };
}

async function runAction(g, c, card) {
  if (g.status !== 'connected') return toast(t('Spiel ist nicht verbunden'), 'err');
  if (c.confirm && !(await confirmDialog(c.name, c.confirm, c.danger))) return;
  const r = await forge.run(g.id, c.id, currentParams(g, c));
  if (card) { card.classList.remove('flash'); void card.offsetWidth; card.classList.add('flash'); }
  if (r && r.ok) {
    toast(`${c.name} ✓`, 'ok');
    document.dispatchEvent(new CustomEvent('forge:ran', { detail: { gameId: g.id, cheatId: c.id, params: currentParams(g, c) } }));
  }
  else if (r?.reason === 'empty') toast(t('Bitte zuerst die Felder ausfüllen'), 'err');
  else toast(`${c.name}: ${r?.error || t('Befehl fehlgeschlagen')}`, 'err');
}

function syncToggles() {
  const g = game();
  document.querySelectorAll('.cheat').forEach((card) => {
    const on = !!g.toggles[card.dataset.id];
    card.classList.toggle('on', on);
    const sw = card.querySelector('.switch input');
    if (sw) sw.checked = on;
  });
}

// ---------- Hotkeys ----------
function toAccelerator(e) {
  const code = e.code;
  let key = null;
  if (/^Numpad\d$/.test(code)) key = 'num' + code.slice(6);
  else if (code === 'NumpadAdd') key = 'numadd';
  else if (code === 'NumpadSubtract') key = 'numsub';
  else if (code === 'NumpadMultiply') key = 'nummult';
  else if (code === 'NumpadDivide') key = 'numdiv';
  else if (code === 'NumpadDecimal') key = 'numdec';
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (['Insert', 'Home', 'End', 'PageUp', 'PageDown', 'Up', 'Down', 'Left', 'Right'].includes(code.replace('Arrow', ''))) key = code.replace('Arrow', '');
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Control');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  // Buchstaben/Ziffern ohne Modifier würden das Tippen im Spiel blockieren
  if (!mods.length && /^[A-Z0-9]$/.test(key)) return 'NEEDMOD';
  return [...mods, key].join('+');
}

async function recordHotkey(g, c, btn) {
  if (state.recording) return;
  state.recording = true;
  await forge.pauseHotkeys();
  btn.classList.add('rec');
  btn.textContent = t('Taste …');
  const done = async (acc) => {
    window.removeEventListener('keydown', onKey, true);
    btn.classList.remove('rec');
    state.recording = null;
    if (acc === undefined) {
      btn.textContent = prettyKey(c.hotkey);
      await forge.resumeHotkeys();
    } else {
      await setHotkey(g, c, acc, btn);
    }
  };
  const onKey = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
    if (e.key === 'Escape') return done(undefined);
    if (e.key === 'Backspace' || e.key === 'Delete') return done('');
    const acc = toAccelerator(e);
    if (acc === 'NEEDMOD') { toast(t('Buchstaben/Ziffern bitte mit Strg, Alt oder Shift kombinieren'), 'err'); return; }
    if (!acc) { toast(t('Diese Taste wird nicht unterstützt'), 'err'); return; }
    done(acc);
  };
  window.addEventListener('keydown', onKey, true);
}

async function setHotkey(g, c, acc, btn) {
  await forge.setHotkey(g.id, c.id, acc);
  c.hotkey = acc || null;
  g.settings.hotkeys[c.id] = acc;
  btn.textContent = prettyKey(c.hotkey);
  btn.classList.toggle('none', !c.hotkey);
  toast(acc ? t('Hotkey für „{name}“: {key}', { name: c.name, key: prettyKey(acc) }) : t('Hotkey für „{name}“ entfernt', { name: c.name }), 'ok');
}

// ---------- Konsole / Log ----------
function appendLog(l) {
  const log = $('#log');
  const line = el('div', `log-line ${l.level}`);
  const time = el('time', '', new Date(l.time).toLocaleTimeString(LOCALE));
  line.append(time, el('span', '', l.text));
  log.append(line);
  if (log.childElementCount > 500) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
  $('#consoleLast').textContent = l.text;
}

// ---------- Popover & Dialoge ----------
function renderSettingsPop() {
  const g = game();
  const info = $('#installInfo');
  const inst = g.settings.install;
  info.textContent = '';
  if (inst) {
    const src = { steam: 'Steam', gog: 'GOG', epic: 'Epic Games', manual: t('Manuell') }[inst.source] || inst.source;
    info.append(el('b', '', src + ': '), document.createTextNode(inst.root || inst.exePath || ''));
  } else {
    info.textContent = t('Noch nicht gesucht – wird beim ersten Start automatisch gefunden.');
  }
  const opts = g.launchOptions || { modes: [], renderers: [] };
  const seg = (rootSel, items, key, def) => {
    const root = $(rootSel);
    root.textContent = '';
    const cur = g.settings[key] || def;
    for (const o of items) {
      const b = el('button', o.value === cur ? 'active' : '', o.label);
      b.onclick = async () => { await forge.setSetting(g.id, key, o.value); g.settings[key] = o.value; renderSettingsPop(); };
      root.append(b);
    }
  };
  seg('#modeSeg', opts.modes, 'launchMode', 'direct');
  if (g.setupGuide) renderSetupGuide($('#popGuide'), g); else $('#popGuide').closest('.pop-row').hidden = true;
  seg('#rendSeg', opts.renderers, 'renderer', 'dx12');
}

// Einmalige Einrichtung im eigenen Launcher (Steam/Epic/GOG), damit ForgeMod beim normalen Start verbinden kann
function renderSetupGuide(root, g) {
  const guide = g.setupGuide;
  root.textContent = '';
  const ids = Object.keys(guide.launchers);
  const src = g.settings.install && g.settings.install.source;
  let cur = ids.includes(src) ? src : ids[0];
  const tabs = el('div', 'guide-tabs');
  const body = el('div', 'guide-body');
  const draw = () => {
    tabs.textContent = '';
    for (const id of ids) {
      const b = el('button', `guide-tab${id === cur ? ' active' : ''}`, guide.launchers[id].name);
      b.onclick = () => { cur = id; draw(); };
      tabs.append(b);
    }
    body.textContent = '';
    const ol = el('ol', 'guide-steps');
    guide.launchers[cur].steps.forEach((step, i) => {
      const li = el('li', '', step);
      if (i === 1) {
        const row = el('div', 'guide-args');
        row.append(el('code', '', guide.args));
        const copy = el('button', 'btn small', t('Kopieren'));
        copy.onclick = async () => { await forge.copy(guide.args); toast(t('Startoptionen kopiert'), 'ok'); };
        row.append(copy);
        li.append(row);
      }
      ol.append(li);
    });
    body.append(ol);
  };
  draw();
  root.append(tabs, body);
  // Tabs werden neu gezeichnet – Klick nicht als "außerhalb des Popovers" werten
  root.onclick = (e) => e.stopPropagation();
}

function openPopover() {
  const pop = $('#settingsPop');
  renderSettingsPop();
  pop.hidden = false;
  const r = $('#settingsBtn').getBoundingClientRect();
  pop.style.top = `${r.bottom + 8}px`;
  pop.style.left = `${Math.max(12, r.right - pop.offsetWidth)}px`;
}

function confirmDialog(title, text, danger, yesLabel) {
  return new Promise((resolve) => {
    $('#modalTitle').textContent = title;
    $('#modalText').textContent = text;
    const btns = $('#modalBtns');
    btns.textContent = '';
    const no = el('button', 'btn small ghost', t('Abbrechen'));
    const yes = el('button', `btn small ${danger ? 'danger' : 'primary'}`, yesLabel || t('Ausführen'));
    const close = (v) => { $('#modal').hidden = true; resolve(v); };
    no.onclick = () => close(false);
    yes.onclick = () => close(true);
    btns.append(no, yes);
    $('#modal').hidden = false;
    yes.focus();
  });
}

function infoDialog(title, text) {
  $('#modalTitle').textContent = title;
  $('#modalText').textContent = text;
  const btns = $('#modalBtns');
  btns.textContent = '';
  const ok = el('button', 'btn small primary', t('Alles klar'));
  ok.onclick = () => { $('#modal').hidden = true; };
  btns.append(ok);
  $('#modal').hidden = false;
}

function toast(text, kind = '') {
  const box = el('div', `toast ${kind}`, text);
  $('#toasts').append(box);
  setTimeout(() => { box.classList.add('out'); setTimeout(() => box.remove(), 260); }, 2600);
}

// ---------- UI-Verdrahtung ----------
function bindUi() {
  $('#search').oninput = (e) => { state.search = e.target.value; renderCheats(); };

  $('#launchBtn').onclick = async () => {
    const g = game();
    const r = await forge.launch(g.id);
    if (r && r.ok) {
      if (r.install) g.settings.install = r.install;
      toast(t('{game} wird gestartet …', { game: g.name }), 'ok');
    } else {
      toast(r?.error || t('Start fehlgeschlagen'), 'err');
      if (/manuell|nicht gefunden|manually|not found/i.test(r?.error || '')) openPopover();
    }
  };

  $('#settingsBtn').onclick = (e) => {
    e.stopPropagation();
    const pop = $('#settingsPop');
    if (pop.hidden) openPopover(); else pop.hidden = true;
  };
  document.addEventListener('click', (e) => {
    const pop = $('#settingsPop');
    if (!pop.hidden && !pop.contains(e.target)) pop.hidden = true;
  });

  $('#detectBtn').onclick = async () => {
    const g = game();
    const found = await forge.detect(g.id);
    if (found) { g.settings.install = found; toast(t('Installation gefunden'), 'ok'); }
    else toast(t('Keine Installation gefunden – bitte EXE auswählen'), 'err');
    renderSettingsPop();
  };
  $('#pickBtn').onclick = async () => {
    const g = game();
    const inst = await forge.pickExe(g.id);
    if (inst) { g.settings.install = inst; toast(t('EXE gespeichert'), 'ok'); }
    renderSettingsPop();
  };

  $('#consoleToggle').onclick = () => $('#console').classList.toggle('open');
  $('#consoleForm').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#consoleInput');
    const cmd = input.value.trim();
    if (!cmd) return;
    const r = await forge.raw(state.current, cmd);
    if (r && r.ok) input.value = '';
  };

  $('#addGameBtn').onclick = () => infoDialog(t('Spiel hinzufügen'), [
    t('Jedes Spiel ist ein eigenes Plugin im Ordner „games“.'), '',
    t('1. Kopiere die Vorlage resources\\app\\games\\_template in einen Ordner „games“ direkt neben der ForgeMod.exe, z. B. games\\rdr2'),
    t('2. Trage Name, Prozessname und Cheats ein'),
    t('3. Lege fest, wie die Befehle ins Spiel kommen (Connector)'),
    t('4. ForgeMod neu starten – fertig.'), '',
    t('Witcher 3 (games/witcher3) dient als vollständiges Beispiel.'),
  ].join('\n'));

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { $('#settingsPop').hidden = true; }
    if ((e.ctrlKey && e.key.toLowerCase() === 'f')) { e.preventDefault(); $('#search').focus(); }
  });
}

// ---------- Updates ----------
function renderUpdate() {
  const st = state.update;
  const bar = $('#updateBar');
  if (st && st.available) {
    bar.hidden = false;
    $('#updateText').textContent = t('ForgeMod {version} ist da', { version: st.available.version });
    $('#updateNotes').textContent = st.available.notes ? st.available.notes.split(/\r?\n/).filter(Boolean).slice(0, 2).join(' · ') : t('Neue Funktionen und Verbesserungen.');
  } else bar.hidden = true;
  const v = $('#appVersion');
  if (v && st) v.textContent = `ForgeMod ${st.current}`;
  const info = $('#updateInfo');
  if (info && st) {
    info.textContent = st.available ? t('Version {version} bereit zur Installation', { version: st.available.version }) : t('Aktuell: {version} – kein Update gefunden', { version: st.current });
  }
}

async function initUpdates() {
  state.update = await forge.updateState();
  renderUpdate();
  forge.onUpdate((st) => { state.update = st; renderUpdate(); });
  $('#updateBtn').onclick = async () => {
    const btn = $('#updateBtn');
    btn.disabled = true;
    btn.querySelector('span').textContent = t('Aktualisiere …');
    const r = await forge.installUpdate();
    if (!r || !r.ok) {
      btn.disabled = false;
      btn.querySelector('span').textContent = t('Jetzt aktualisieren');
      toast(r?.error || t('Update fehlgeschlagen'), 'err');
    }
  };
  $('#checkUpdateBtn').onclick = async () => { state.update = await forge.checkUpdate(); renderUpdate(); toast(state.update.available ? t('Update gefunden!') : t('ForgeMod ist aktuell'), 'ok'); };
  $('#updateFolderBtn').onclick = () => forge.openUpdateFolder();
}

// ---------- Sprache ----------
function initLang() {
  for (const b of document.querySelectorAll('#langSwitch button')) {
    b.classList.toggle('active', b.dataset.lang === LANG);
    b.onclick = () => { if (b.dataset.lang !== LANG) forge.setLang(b.dataset.lang); };
  }
}
initLang();

init();

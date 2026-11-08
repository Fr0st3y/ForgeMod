'use strict';
/* global forge, state, el, svg, toast, t, img, pill, DLC_LABEL, renderCheats, VIEW */
/*
 * Bestiarium: alle Einträge aus dem Bestiarium des Spiels (Bild, Texte, Schwachstellen).
 * Standardmäßig nur Kreaturen, die man laut neuestem Spielstand schon entdeckt hat (wie im Spiel).
 * Schwachstellen lassen sich direkt auftragen (Öle) bzw. ausrüsten (Bomben, Tränke).
 */

const BEST = { journal: {}, loading: {}, view: {} };
const BEST_MODE_KEY = 'forgemod.bestiary.mode';
const bestMode = () => { try { return localStorage.getItem(BEST_MODE_KEY) || 'own'; } catch (_) { return 'own'; } };
const setBestMode = (m) => { try { localStorage.setItem(BEST_MODE_KEY, m); } catch (_) { /* egal */ } };
const KIND_LABEL = { oil: t('Öl'), bomb: t('Bombe'), potion: t('Trank'), sign: t('Zeichen') };

// Entdeckte Einträge aus dem neuesten Spielstand (nur lesend)
function loadJournal(g, force) {
  if (BEST.journal[g.id] && !force) return Promise.resolve(BEST.journal[g.id]);
  if (!BEST.loading[g.id] || force) {
    BEST.loading[g.id] = forge.getJournal(g.id).then((r) => {
      const j = r && r.ok && r.journal
        ? { ...r.journal, known: new Set(r.journal.known) }
        : { error: (r && r.error) || t('Unbekannter Fehler'), known: new Set() };
      BEST.journal[g.id] = j;
      delete BEST.loading[g.id];
      return j;
    });
  }
  return BEST.loading[g.id];
}

// Bild mit einem zweiten Versuch; klappt auch der nicht, wird onFail aufgerufen
function bestImg(src, onFail) {
  const im = el('img');
  im.alt = '';
  let tries = 0;
  im.onerror = () => {
    if (tries++ < 2) setTimeout(() => { im.src = `${src}${src.includes('?') ? '&' : '?'}r=${tries}`; }, 700 * tries);
    else onFail(im);
  };
  im.src = src;
  return im;
}

function renderBestiary(wrap, g, cat, def) {
  const data = cat.bestiary || { groups: [], entries: [] };
  const vs = BEST.view[g.id] || (BEST.view[g.id] = { group: 'all', search: '', all: false, sel: null });
  const j = BEST.journal[g.id];
  if (!j) loadJournal(g).then(() => { if (state.current === g.id) renderCheats(); });
  const journalOk = j && !j.error && j.found;
  const discovered = (e) => !journalOk || (e.ids || [e.id]).some((id) => j.known.has(id));
  const groupName = (id) => (data.groups.find((x) => x.id === id) || {}).name || '';

  // Kopf
  const head = el('div', 'gal-head');
  const titleBox = el('div', 'gal-title');
  titleBox.append(el('h2', '', def.title), el('p', '', def.hint || ''));
  const tools = el('div', 'best-tools');
  const search = el('label', 'search gal-search');
  search.innerHTML = svg('search');
  const sIn = el('input');
  sIn.type = 'search'; sIn.placeholder = t('Kreatur suchen …'); sIn.value = vs.search; sIn.spellcheck = false;
  sIn.oninput = () => { vs.search = sIn.value; drawList(); };
  search.append(sIn);
  tools.append(search);
  if (VIEW !== 'bestiary') {
    const pop = el('button', 'btn small ghost');
    pop.innerHTML = svg('window');
    pop.append(el('span', '', t('In eigenem Fenster öffnen')));
    pop.title = t('Öffnet das Bestiarium in einem eigenen Fenster – z. B. für den zweiten Monitor.');
    pop.onclick = () => forge.openBestiaryWindow();
    tools.append(pop);
  }
  head.append(titleBox, tools);
  wrap.append(head);

  // Filter: Gruppen, "alle anzeigen", Spielstand neu lesen
  const bar = el('div', 'best-bar');
  const chips = el('div', 'gal-filters');
  const pool = data.entries.filter((e) => vs.all || discovered(e));
  const chip = (id, label, count) => {
    const b = el('button', `chip${vs.group === id ? ' active' : ''}`);
    b.append(el('span', '', label), el('span', 'n', String(count)));
    b.onclick = () => { vs.group = id; renderCheats(); };
    return b;
  };
  chips.append(chip('all', t('Alle'), pool.length));
  for (const gr of data.groups) {
    const n = pool.filter((e) => e.group === gr.id).length;
    if (n) chips.append(chip(gr.id, gr.name, n));
  }
  const opts = el('div', 'best-opts');
  const allBox = el('label', 'field check');
  const allIn = el('input'); allIn.type = 'checkbox'; allIn.checked = vs.all;
  allIn.onchange = () => { vs.all = allIn.checked; renderCheats(); };
  allBox.append(allIn, el('span', '', t('Alle anzeigen (auch unentdeckte)')));
  allBox.title = t('Aus: nur Kreaturen, die du laut deinem neuesten Spielstand schon entdeckt hast – wie im Bestiarium des Spiels. An: alle (Spoiler!).');
  const reload = el('button', 'btn small ghost');
  reload.innerHTML = svg('refresh');
  reload.append(el('span', '', t('Spielstand neu lesen')));
  reload.title = t('Nach dem Entdecken neuer Kreaturen im Spiel F5 drücken und dann hier neu lesen.');
  reload.onclick = async () => { await loadJournal(g, true); renderCheats(); };
  opts.append(allBox, reload);
  bar.append(chips, opts);
  wrap.append(bar);
  if (!j) wrap.append(el('p', 'best-status', t('Lese deinen Spielstand …')));
  else if (j.error || !j.found) wrap.append(el('p', 'best-status warn', t('Entdeckte Einträge konnten nicht gelesen werden – es werden alle angezeigt.') + (j.error ? ` (${j.error})` : '')));
  else {
    const n = data.entries.filter(discovered).length;
    const age = j.ageSec > 120 ? ' ' + t('(Spielstand ist {min} Min. alt – für den aktuellen Stand vorher F5 drücken.)', { min: Math.round(j.ageSec / 60) }) : '';
    wrap.append(el('p', 'best-status', t('{n} von {total} Kreaturen entdeckt.', { n, total: data.entries.length }) + age));
  }

  // Liste + Details
  const layout = el('div', `best-layout${vs.sel ? ' has-sel' : ''}`);
  const grid = el('div', 'gal-grid g-best');
  const detail = el('aside', 'best-detail');
  layout.append(grid, detail);
  wrap.append(layout);

  function visible() {
    const q = vs.search.trim().toLowerCase();
    return pool.filter((e) => (vs.group === 'all' || e.group === vs.group) && (!q || e.name.toLowerCase().includes(q)));
  }

  function drawList() {
    grid.textContent = '';
    const list = visible();
    if (!list.length) { grid.append(el('div', 'empty', t('Nichts gefunden.'))); return; }
    for (const e of list) {
      const btn = el('button', `tile t-best${vs.sel === e.id ? ' sel' : ''}${discovered(e) ? '' : ' unknown'}`);
      btn.title = e.name;
      const pic = el('div', 'pic');
      if (e.img) {
        const im = bestImg(img(g, e.img, 260), (x) => { x.remove(); pic.innerHTML = svg('paw', 'ph'); });
        im.loading = 'lazy'; im.decoding = 'async';
        pic.append(im);
      } else pic.innerHTML = svg('paw', 'ph');
      if (e.dlc) pic.append(el('span', 'badge', e.dlc === 'hos' ? 'HoS' : 'BaW'));
      if (!discovered(e)) pic.append(el('span', 'badge dim', t('Unentdeckt')));
      btn.append(pic, el('span', 'tname', e.name), el('span', 'tsub', groupName(e.group)));
      btn.onclick = () => {
        vs.sel = e.id;
        for (const x of grid.querySelectorAll('.tile.sel')) x.classList.remove('sel');
        btn.classList.add('sel');
        layout.classList.add('has-sel');
        drawDetail();
        if (window.innerWidth < 900) detail.scrollIntoView({ block: 'start', behavior: 'smooth' });
      };
      grid.append(btn);
    }
  }

  function drawDetail() {
    detail.textContent = '';
    const e = data.entries.find((x) => x.id === vs.sel);
    if (!e) {
      detail.append(el('div', 'best-empty', t('Wähle links eine Kreatur aus.')));
      return;
    }
    if (e.img) {
      const pic = el('div', 'best-pic');
      pic.append(bestImg(img(g, e.img, 520), () => pic.remove()));
      detail.append(pic);
    }
    detail.append(el('h3', '', e.name));
    const meta = el('div', 'd-meta');
    if (e.group) meta.append(pill(groupName(e.group)));
    const sw = e.steel ? t('Stahlschwert') : t('Silberschwert');
    meta.append(pill(sw.charAt(0).toUpperCase() + sw.slice(1), 'sword'));
    if (e.dlc) meta.append(pill(DLC_LABEL[e.dlc]));
    if (!discovered(e)) meta.append(pill(t('Unentdeckt'), 'dim'));
    detail.append(meta);

    // Schwachstellen
    const weakBox = el('div', 'best-weak');
    weakBox.append(el('div', 'best-sub', t('Schwachstellen')));
    const usable = e.weak.filter((w) => w.kind !== 'sign');
    if (usable.length) {
      const seg = el('div', 'seg best-mode');
      for (const [m, label, hint] of [
        ['own', t('Eigenes nutzen, sonst geben'), t('Nutzt die stärkste Stufe, die du laut letztem Spielstand hast (vorher F5 drücken). Hast du nichts davon, gibt ForgeMod dir die stärkste Stufe.')],
        ['max', t('Immer stärkste Stufe'), t('Gibt immer die stärkste Stufe und rüstet sie aus bzw. trägt sie auf – egal, was du schon hast.')],
      ]) {
        const b = el('button', bestMode() === m ? 'active' : '', label);
        b.title = hint;
        b.onclick = () => { setBestMode(m); drawDetail(); };
        seg.append(b);
      }
      weakBox.append(seg);
    }
    if (!e.weak.length) weakBox.append(el('p', 'd-note', t('Das Bestiarium nennt für diese Kreatur keine besonderen Schwachstellen.')));
    const connected = g.status === 'connected';
    for (const w of e.weak) {
      const row = el('div', `best-wrow k-${w.kind}`);
      const ic = el('div', 'wic');
      if (w.icon) { const im = el('img'); im.src = img(g, w.icon, 64); im.alt = ''; ic.append(im); } else ic.innerHTML = svg(w.kind === 'sign' ? 'medallion' : 'drop');
      const txt = el('div', 'wtxt');
      txt.append(el('b', '', w.name), el('span', '', KIND_LABEL[w.kind] || ''));
      row.append(ic, txt);
      if (w.kind === 'sign') {
        row.append(el('span', 'wnote', t('Im Spiel auswählen')));
      } else {
        const b = el('button', 'btn small primary-soft', w.kind === 'oil' ? t('Auftragen') : t('Ausrüsten'));
        b.disabled = !connected;
        b.title = w.kind === 'oil' ? t('Trägt das Öl auf dein {sword} auf.', { sword: e.steel ? t('Stahlschwert') : t('Silberschwert') }) : t('Legt den Gegenstand in einen freien Schnellslot.');
        b.onclick = async () => {
          const [l1 = '', l2 = '', l3 = ''] = w.levels || [w.id];
          b.disabled = true;
          const r = await forge.run(g.id, w.kind === 'oil' ? 'b_oil' : 'b_equip', { l1, l2, l3, label: w.name, mode: bestMode(), steel: !!e.steel });
          b.disabled = false;
          if (r && r.ok) toast(w.kind === 'oil' ? t('{name} aufgetragen', { name: w.name }) : t('{name} ausgerüstet', { name: w.name }), 'ok');
          else toast(r && r.error ? t('Fehlgeschlagen: {error}', { error: r.error }) : t('Fehlgeschlagen'), 'err');
        };
        row.append(b);
      }
      weakBox.append(row);
    }
    if (usable.length && !connected) weakBox.append(el('p', 'd-note warn', t('Starte Witcher 3, um Öle aufzutragen oder Bomben und Tränke auszurüsten.')));
    detail.append(weakBox);

    // Texte aus dem Bestiarium
    const texts = el('div', 'best-texts');
    for (const p of e.texts) texts.append(el('p', p.quote ? 'quote' : p.hint ? 'hint' : '', p.text));
    detail.append(texts);
  }

  drawList();
  drawDetail();
}

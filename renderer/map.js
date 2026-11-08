'use strict';
/* global forge, state, el, svg, toast, t */
/*
 * Weltkarte mit Teleport (Kacheln aus der eigenen Spielinstallation).
 * Koordinaten: Die Karte deckt die Welt [-S/2, S/2]² ab, Kachel tile<x>x<y> zählt y von unten.
 * Klick = Ziel setzen, Wegweiser = Ziel mit exakter Höhe, Mausrad = Zoom, Ziehen = Verschieben.
 */

const MAPV = {
  region: {},   // gameId -> Region-ID
  target: {},   // gameId -> { x, y, z?, name? }
  loaded: {},   // gameId -> zuletzt über ForgeMod geladene Region
};

// "Teleport in Region"-Befehl -> Karten-Region
const GOTO_REGION = {
  gotoNovigrad: 'novigrad', gotoSkellige: 'skellige', gotoBob: 'bob', gotoKaerMorhen: 'kaer_morhen',
  gotoProlog: 'prolog_village', gotoPrologWinter: 'prolog_village', gotoWyzima: 'wyzima_castle',
};

function renderMap(wrap, g, cat, def) {
  const regions = cat.maps || [];
  if (!regions.length) {
    wrap.append(el('div', 'empty', t('Keine Karten in deiner Installation gefunden.')));
    return;
  }
  // Startregion: aus "Teleport in Region" bzw. zuletzt gewählt
  const tpSel = state.params[g.id]?.teleport?.t;
  if (!MAPV.region[g.id]) MAPV.region[g.id] = GOTO_REGION[tpSel] || regions[0].id;
  let region = regions.find((r) => r.id === MAPV.region[g.id]) || regions[0];

  const head = el('div', 'gal-head');
  const titleBox = el('div', 'gal-title');
  titleBox.append(el('h2', '', def.title), el('p', '', def.hint || ''));
  head.append(titleBox);
  wrap.append(head);

  const chips = el('div', 'gal-filters');
  wrap.append(chips);

  const layout = el('div', 'map-layout');
  const view = el('div', 'map-view');
  const tilesBase = el('div', 'map-layer');
  const tilesDetail = el('div', 'map-layer');
  const pinsLayer = el('div', 'map-layer pins');
  const targetEl = el('div', 'map-target');
  targetEl.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><path d="M12 1v6M12 17v6M1 12h6M17 12h6"/></svg>';
  const zoomBox = el('div', 'map-zoom');
  const zin = el('button', '', '+'), zout = el('button', '', '−'), zfit = el('button', '', '⤢');
  zin.title = t('Hineinzoomen'); zout.title = t('Herauszoomen'); zfit.title = t('Ganze Region');
  zoomBox.append(zin, zout, zfit);
  const coords = el('div', 'map-coords');
  view.append(tilesBase, tilesDetail, pinsLayer, targetEl, zoomBox, coords);

  const side = el('div', 'map-side');
  layout.append(view, side);
  wrap.append(layout);

  // ---------- Ansicht ----------
  let cx = 0, cy = 0, scale = 0.1; // Weltmitte und Pixel pro Meter
  let W = 0, H = 0;
  const tileEls = new Map();

  function fit() {
    W = view.clientWidth; H = view.clientHeight;
    const v = region.view;
    cx = (v.x0 + v.x1) / 2; cy = (v.y0 + v.y1) / 2;
    scale = Math.min(W / (v.x1 - v.x0), H / (v.y1 - v.y0)) * 0.98;
  }
  const sx = (x) => W / 2 + (x - cx) * scale;
  const sy = (y) => H / 2 - (y - cy) * scale;
  const wx = (px) => cx + (px - W / 2) / scale;
  const wy = (py) => cy - (py - H / 2) / scale;

  function levels() { return Object.keys(region.levels).map(Number).filter((l) => l > 0).sort((a, b) => a - b); }

  function placeTiles(layer, level, onlyVisible, keepKeys) {
    const n = 1 << level;
    const T = region.size / n;
    const half = region.size / 2;
    const px = T * scale;
    const want = px * (window.devicePixelRatio || 1) < 600 ? 512 : 0; // kleine Darstellung -> kleinere PNGs
    for (const [tx, ty, tex] of region.levels[level]) {
      const x0 = -half + tx * T, y1 = -half + (ty + 1) * T;
      const left = sx(x0), top = sy(y1);
      if (onlyVisible && (left > W || top > H || left + px < 0 || top + px < 0)) continue;
      const key = `${region.id}|${level}|${tx}|${ty}|${want}`;
      keepKeys.add(key);
      let im = tileEls.get(key);
      if (!im) {
        im = el('img', 'map-tile');
        im.decoding = 'async'; im.draggable = false; im.alt = '';
        im.src = forge.imageUrl(g.id, tex, want);
        tileEls.set(key, im);
      }
      if (im.parentNode !== layer) layer.append(im);
      im.style.transform = `translate(${left}px, ${top}px)`;
      im.style.width = im.style.height = `${px + 0.5}px`;
    }
  }

  let raf = 0;
  function draw() {
    raf = 0;
    if (!view.isConnected) return;
    if (!W) fit();
    const lv = levels();
    const keep = new Set();
    // Grundebene (wenige Kacheln) immer komplett, darüber die passende Detailstufe
    const base = lv.find((l) => l >= 2) ?? lv[0];
    placeTiles(tilesBase, base, false, keep);
    const need = scale * (window.devicePixelRatio || 1);
    let detail = lv[lv.length - 1];
    for (const l of lv) { if ((1024 * (1 << l)) / region.size >= need * 0.9) { detail = l; break; } }
    if (detail > base) placeTiles(tilesDetail, detail, true, keep);
    for (const [k, im] of tileEls) if (!keep.has(k)) { im.remove(); if (!k.startsWith(region.id + '|')) tileEls.delete(k); }
    // Wegweiser
    for (const pin of pinsLayer.children) {
      pin.style.transform = `translate(${sx(+pin.dataset.x)}px, ${sy(+pin.dataset.y)}px)`;
    }
    const tg = MAPV.target[g.id];
    if (tg && tg.region === region.id) {
      targetEl.hidden = false;
      targetEl.style.transform = `translate(${sx(tg.x)}px, ${sy(tg.y)}px)`;
    } else targetEl.hidden = true;
  }
  const redraw = () => { if (!raf) raf = requestAnimationFrame(draw); };

  // ---------- Wegweiser ----------
  function buildPins() {
    pinsLayer.textContent = '';
    for (const p of region.signposts) {
      const b = el('button', `map-pin${p.boat ? ' boat' : ''}`);
      b.dataset.x = p.x; b.dataset.y = p.y;
      b.title = p.name;
      b.append(el('span', 'lbl', p.name));
      b.onmousedown = (e) => e.stopPropagation();
      b.onclick = (e) => { e.stopPropagation(); setTarget({ x: p.x, y: p.y, z: p.z, name: p.name }); };
      pinsLayer.append(b);
    }
  }

  // ---------- Ziel ----------
  function nearestSign(x, y) {
    let best = null, bd = Infinity;
    for (const p of region.signposts) { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
    return best && bd < 600 ? { p: best, d: bd } : null;
  }

  function setTarget(tg, { center = false } = {}) {
    MAPV.target[g.id] = { ...tg, region: region.id, x: Math.round(tg.x * 10) / 10, y: Math.round(tg.y * 10) / 10 };
    // mit "Teleport zu Koordinaten" synchron halten
    const xy = state.params[g.id] && (state.params[g.id].xy ||= {});
    if (xy) { xy.x = MAPV.target[g.id].x; xy.y = MAPV.target[g.id].y; }
    document.querySelectorAll('.cheat[data-id="xy"] input[data-key]').forEach((inp) => { inp.value = MAPV.target[g.id][inp.dataset.key]; });
    if (center) { cx = tg.x; cy = tg.y; }
    renderSide();
    redraw();
  }

  async function teleport() {
    const tg = MAPV.target[g.id];
    if (!tg) return toast(t('Erst ein Ziel auf der Karte wählen'), 'err');
    if (g.status !== 'connected') return toast(t('Spiel ist nicht verbunden'), 'err');
    const loaded = MAPV.loaded[g.id];
    if (loaded && loaded !== region.id) {
      const rn = (regions.find((r) => r.id === loaded) || {}).name || loaded;
      toast(t('Achtung: Zuletzt wurde {region} geladen – Teleport gilt immer in der aktuellen Region', { region: rn }), 'err');
    }
    const r = await forge.run(g.id, 'g_tp', { x: tg.x, y: tg.y, z: tg.z ?? -9999 });
    if (r && r.ok) toast(tg.name ? t('Teleport: {name}', { name: tg.name }) : t('Teleport nach {x} / {y}', { x: tg.x, y: tg.y }), 'ok');
    else toast(t('Teleport fehlgeschlagen'), 'err');
  }

  async function loadRegion() {
    if (g.status !== 'connected') return toast(t('Spiel ist nicht verbunden'), 'err');
    const r = await forge.run(g.id, 'g_region', { t: region.goto });
    if (r && r.ok) { MAPV.loaded[g.id] = region.id; toast(t('{region} wird geladen …', { region: region.name }), 'ok'); renderSide(); }
  }

  // ---------- Seitenleiste ----------
  let query = '';
  function renderSide() {
    side.textContent = '';
    const tg = MAPV.target[g.id];
    const box = el('div', 'map-box');
    if (tg && tg.region === region.id) {
      const near = tg.name ? null : nearestSign(tg.x, tg.y);
      box.append(el('div', 'map-tname', tg.name || (near ? t('Nahe {name}', { name: near.p.name }) : t('Gewählter Punkt'))));
      const row = el('div', 'map-xy');
      for (const k of ['x', 'y']) {
        const f = el('label', 'field');
        f.append(el('span', '', k.toUpperCase()));
        const inp = el('input'); inp.type = 'text'; inp.inputMode = 'decimal'; inp.spellcheck = false; inp.value = tg[k];
        inp.onchange = () => setTarget({ ...tg, [k]: Number(inp.value.trim().replace(',', '.')) || 0, z: undefined, name: undefined }, { center: true });
        f.append(inp); row.append(f);
      }
      box.append(row);
      box.append(el('p', 'd-note', tg.z !== undefined && tg.z !== null
        ? t('Wegweiser: exakte Position und Höhe bekannt – du landest direkt dort.')
        : t('Freier Punkt: ForgeMod teleportiert, wartet kurz bis das Gelände geladen ist und setzt dich dann auf den Boden.')));
    } else {
      box.append(el('div', 'map-tname', t('Kein Ziel gewählt')));
      box.append(el('p', 'd-note', t('Klick auf die Karte oder auf einen Wegweiser.')));
    }
    const tp = el('button', 'btn primary', t('Hierhin teleportieren'));
    tp.disabled = !(tg && tg.region === region.id);
    tp.onclick = teleport;
    box.append(tp);
    const loaded = MAPV.loaded[g.id];
    const note = el('p', 'd-note warn',
      loaded && loaded !== region.id
        ? t('Du bist (laut ForgeMod) gerade nicht in {region}. Erst die Region laden, dann teleportieren.', { region: region.name })
        : t('Teleport klappt nur innerhalb der Region, in der Geralt gerade ist.'));
    const lr = el('button', 'btn small', t('{region} laden', { region: region.name }));
    lr.onclick = loadRegion;
    box.append(note, lr);
    side.append(box);

    // Wegweiser-Liste
    const list = el('div', 'map-box map-list');
    const s = el('label', 'search');
    s.innerHTML = svg('search');
    const q = el('input'); q.type = 'search'; q.placeholder = t('{n} Wegweiser durchsuchen …', { n: region.signposts.length }); q.value = query; q.spellcheck = false;
    s.append(q);
    const ul = el('div', 'map-list-items');
    const fill = () => {
      ul.textContent = '';
      const ql = query.trim().toLowerCase();
      for (const p of region.signposts.filter((x) => !ql || x.name.toLowerCase().includes(ql))) {
        const b = el('button', `map-li${tg && tg.name === p.name && tg.x === p.x ? ' active' : ''}`);
        b.append(el('span', 'dot' + (p.boat ? ' boat' : '')), el('span', '', p.name));
        b.onclick = () => {
          if (scale < 0.25) scale = 0.35;
          setTarget({ x: p.x, y: p.y, z: p.z, name: p.name }, { center: true });
        };
        ul.append(b);
      }
      if (!ul.childElementCount) ul.append(el('div', 'd-note', t('Nichts gefunden.')));
    };
    q.oninput = () => { query = q.value; fill(); };
    fill();
    list.append(s, ul);
    side.append(list);
  }

  // ---------- Regionen ----------
  function selectRegion(id) {
    region = regions.find((r) => r.id === id) || regions[0];
    MAPV.region[g.id] = region.id;
    for (const c of chips.children) c.classList.toggle('active', c.dataset.id === region.id);
    tilesBase.textContent = ''; tilesDetail.textContent = '';
    for (const k of [...tileEls.keys()]) if (!k.startsWith(region.id + '|')) tileEls.delete(k);
    query = '';
    W = 0;
    buildPins();
    renderSide();
    redraw();
  }
  for (const r of regions) {
    const b = el('button', 'chip');
    b.dataset.id = r.id;
    b.append(el('span', '', r.name), el('span', 'n', String(r.signposts.length)));
    b.onclick = () => selectRegion(r.id);
    chips.append(b);
  }

  // ---------- Maus ----------
  let drag = null;
  view.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target.closest('.map-zoom')) return;
    drag = { x: e.clientX, y: e.clientY, cx, cy, moved: false };
    view.classList.add('dragging');
  });
  const onMove = (e) => {
    const r = view.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      coords.textContent = `X ${Math.round(wx(e.clientX - r.left))}   Y ${Math.round(wy(e.clientY - r.top))}`;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    cx = drag.cx - dx / scale; cy = drag.cy + dy / scale;
    redraw();
  };
  const onUp = (e) => {
    if (!drag) return;
    view.classList.remove('dragging');
    if (!drag.moved && view.contains(e.target) && !e.target.closest('.map-zoom, .map-pin')) {
      const r = view.getBoundingClientRect();
      setTarget({ x: wx(e.clientX - r.left), y: wy(e.clientY - r.top) });
    }
    drag = null;
  };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  const zoomAt = (f, px = W / 2, py = H / 2) => {
    const x = wx(px), y = wy(py);
    scale = Math.min(4, Math.max(0.02, scale * f));
    cx = x - (px - W / 2) / scale; cy = y + (py - H / 2) / scale;
    redraw();
  };
  view.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = view.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  zin.onclick = () => zoomAt(1.5);
  zout.onclick = () => zoomAt(1 / 1.5);
  zfit.onclick = () => { W = 0; redraw(); };

  // Größenänderung des Fensters
  const ro = new ResizeObserver(() => {
    if (!view.isConnected) { ro.disconnect(); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); return; }
    const nw = view.clientWidth, nh = view.clientHeight;
    if (W && (nw !== W || nh !== H)) { W = nw; H = nh; redraw(); }
  });
  ro.observe(view);

  // Felder der Cheat-Karten -> Karte ("Teleport in Region" wechselt die Karte, X/Y verschiebt das Ziel)
  const onParam = (e) => {
    if (!view.isConnected) { document.removeEventListener('forge:param', onParam); return; }
    const { gameId, cheatId, key, value } = e.detail;
    if (gameId !== g.id) return;
    if (cheatId === 'teleport' && key === 't' && GOTO_REGION[value]) selectRegion(GOTO_REGION[value]);
    if (cheatId === 'xy') {
      const cur = MAPV.target[g.id] && MAPV.target[g.id].region === region.id ? MAPV.target[g.id] : { x: 0, y: 0 };
      setTarget({ x: key === 'x' ? Number(value) : cur.x, y: key === 'y' ? Number(value) : cur.y }, { center: true });
    }
  };
  document.addEventListener('forge:param', onParam);
  const onRun = (e) => {
    if (!view.isConnected) { document.removeEventListener('forge:ran', onRun); return; }
    const { gameId, cheatId, params } = e.detail;
    if (gameId === g.id && cheatId === 'teleport' && GOTO_REGION[params.t]) { MAPV.loaded[g.id] = GOTO_REGION[params.t]; renderSide(); }
  };
  document.addEventListener('forge:ran', onRun);

  selectRegion(region.id);
}

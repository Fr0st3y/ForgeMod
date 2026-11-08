'use strict';
// Lädt Spiel-Plugins aus /games, erkennt laufende Spiele und führt Cheats aus.
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { isAlive } = require('./processWatcher');
const { t } = require('./i18n');

// Texte der Plugins übersetzen (Felder, Auswahl-Optionen, Galerien, Einrichtung)
const tField = (f) => ({ ...f, label: t(f.label), placeholder: t(f.placeholder), hint: t(f.hint), options: f.options ? f.options.map((o) => ({ ...o, label: t(o.label) })) : f.options });
const tOpts = (list) => (list || []).map((o) => ({ ...o, label: t(o.label) }));
function tGuide(guide) {
  if (!guide) return null;
  const launchers = {};
  for (const [id, l] of Object.entries(guide.launchers || {})) launchers[id] = { ...l, steps: l.steps.map((x) => t(x)) };
  return { ...guide, launchers };
}
function tGalleries(gal) {
  const out = {};
  for (const [id, g] of Object.entries(gal || {})) out[id] = { ...g, title: t(g.title), hint: t(g.hint) };
  return out;
}

const POLL_MS = 2000;
const RETRY_MS = 2500; // so oft wird geprüft, ob die Cheat-Schnittstelle des Spiels antwortet
const NOPORT_AFTER_MS = 45000; // so lange darf das Spiel hochfahren, bevor wir "ohne Schnittstelle" melden
const LAUNCH_WAIT_MS = 180000; // nach "Spiel starten" so lange "verbinde …" anzeigen

class GameManager extends EventEmitter {
  constructor({ gamesDirs, settings }) {
    super();
    this.gamesDirs = gamesDirs.map((d) => path.resolve(d));
    this.settings = settings;
    this.games = new Map();
    this.timer = null;
    this.polling = false;
  }

  // ---------- Plugins laden ----------
  // Mehrere Ordner: eingebaute Spiele + eigene Plugins (z. B. neben der portable .exe)
  load() {
    const dirs = [];
    for (const base of this.gamesDirs) {
      if (!fs.existsSync(base)) continue;
      for (const d of fs.readdirSync(base, { withFileTypes: true })) {
        if (d.isDirectory() && !d.name.startsWith('_')) dirs.push({ base, name: d.name });
      }
    }
    for (const d of dirs) {
      const file = path.join(d.base, d.name, 'index.js');
      if (!fs.existsSync(file)) continue;
      try {
        const plugin = require(file);
        if (!plugin.id || !plugin.name || !Array.isArray(plugin.categories)) {
          throw new Error('Plugin braucht id, name und categories');
        }
        if (this.games.has(plugin.id)) { this.games.get(plugin.id).connector.disconnect?.(); } // eigener Ordner überschreibt eingebautes Plugin
        const cheats = new Map();
        for (const cat of plugin.categories) for (const c of cat.cheats) cheats.set(c.id, c);
        const log = (level, text) => this.log(plugin.id, level, text);
        const connector = plugin.createConnector({ log });
        connector.on && connector.on('close', () => this.onConnectorClosed(plugin.id));
        this.games.set(plugin.id, {
          plugin, cheats, connector,
          status: 'offline', pid: null, launchedAt: 0, lastAttempt: 0, connecting: false,
          toggles: {}, loops: {},
        });
        this.log(plugin.id, 'info', t('Plugin geladen: {name} ({n} Cheats)', { name: plugin.name, n: cheats.size }));
      } catch (e) {
        console.error(`Plugin ${d.name} fehlerhaft:`, e);
      }
    }
  }

  // Nur serialisierbare Daten an die Oberfläche geben (keine Funktionen)
  describe() {
    return [...this.games.values()].map(({ plugin, status, toggles }) => {
      const s = this.settings.game(plugin.id);
      return {
        id: plugin.id,
        name: plugin.name,
        subtitle: t(plugin.subtitle || ''),
        accent: plugin.accent || '#e8b04a',
        banner: plugin.banner || null,
        setupHint: t(plugin.setupHint || ''),
        status, toggles,
        setupGuide: tGuide(plugin.setupGuide),
        settings: { hotkeys: s.hotkeys, favorites: s.favorites, lastParams: s.lastParams, install: s.install || null, launchMode: s.launchMode || null, renderer: s.renderer || null },
        launchOptions: plugin.launchOptions ? { modes: tOpts(plugin.launchOptions.modes), renderers: tOpts(plugin.launchOptions.renderers) } : null,
        galleries: tGalleries(plugin.galleries),
        hasData: !!plugin.data,
        categories: plugin.categories.filter((cat) => !cat.hidden).map((cat) => ({
          id: cat.id, name: t(cat.name), icon: cat.icon || '', gallery: cat.gallery || null,
          cheats: cat.cheats.map((c) => ({
            id: c.id, name: t(c.name), desc: t(c.desc || ''), warn: t(c.warn) || null, type: c.type || 'action',
            fields: (c.fields || []).map(tField), presets: c.presets || null, button: t(c.button) || null,
            confirm: t(c.confirm) || null, danger: !!c.danger, hotkey: s.hotkeys[c.id] ?? c.hotkey ?? null,
            tag: c.tag || null, tagLabel: t(c.tag) || null,
          })),
        })),
      };
    });
  }

  start() {
    this.poll();
    this.timer = setInterval(() => this.poll(), POLL_MS);
  }

  stop() {
    clearInterval(this.timer);
    for (const g of this.games.values()) {
      this.stopLoops(g);
      try { g.connector.disconnect(); } catch (_) {}
    }
  }

  setStatus(g, status) {
    if (g.status === status) return;
    g.status = status;
    this.emitStatus(g);
  }

  emitStatus(g) {
    this.emit('status', { gameId: g.plugin.id, status: g.status, toggles: g.toggles, pid: g.pid });
  }

  log(gameId, level, text) {
    this.emit('log', { gameId, level, text, time: Date.now() });
  }

  // ---------- Erkennung ----------
  // ForgeMod listet keine fremden Prozesse auf (Virenscanner werten das als Spionage-Verhalten).
  // Stattdessen: alle paar Sekunden schauen, ob die Cheat-Schnittstelle des Spiels auf diesem PC antwortet.
  // Läuft sie, läuft auch das Spiel – mit den richtigen Startoptionen.
  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      for (const g of this.games.values()) {
        if (g.connector.isConnected()) { this.setStatus(g, 'connected'); continue; }
        // Über ForgeMod gestartet, aber inzwischen beendet?
        if (g.pid && !isAlive(g.pid)) { g.pid = null; g.launchedAt = 0; this.setStatus(g, 'offline'); }
        if (!g.connecting && Date.now() - g.lastAttempt > RETRY_MS) this.tryConnect(g);
      }
    } finally {
      this.polling = false;
    }
  }

  async tryConnect(g) {
    g.connecting = true;
    g.lastAttempt = Date.now();
    try {
      await g.connector.connect();
      this.log(g.plugin.id, 'ok', t('Cheat-Schnittstelle verbunden – Cheats sind freigeschaltet.'));
      this.setStatus(g, 'connected');
    } catch (_) {
      const since = g.launchedAt ? Date.now() - g.launchedAt : Infinity;
      if (g.pid && since > NOPORT_AFTER_MS) {
        // Von ForgeMod gestartet, Prozess läuft, aber die Schnittstelle bleibt zu
        if (g.status !== 'noport') {
          this.log(g.plugin.id, 'warn', t('Spiel läuft, aber die Cheat-Schnittstelle antwortet nicht. Startoptionen im Launcher prüfen (siehe oben) oder über ForgeMod starten.'));
        }
        this.setStatus(g, 'noport');
      } else if (since <= LAUNCH_WAIT_MS) {
        this.setStatus(g, 'starting');
      } else {
        g.launchedAt = 0;
        this.setStatus(g, 'offline');
      }
    } finally {
      g.connecting = false;
    }
  }

  // Wird nach "Spiel starten" aufgerufen: bis zum Hauptmenü "verbinde …" anzeigen
  launched(g, pid) {
    g.pid = pid || null;
    g.launchedAt = Date.now();
    g.lastAttempt = 0;
    this.setStatus(g, 'starting');
  }

  onConnectorClosed(gameId) {
    const g = this.games.get(gameId);
    if (!g) return;
    if (g.status === 'connected') this.log(gameId, 'info', t('Verbindung zum Spiel getrennt.'));
    this.resetSession(g);
    g.launchedAt = 0;
    this.setStatus(g, 'offline');
  }

  resetSession(g) {
    this.stopLoops(g);
    try { g.connector.disconnect(); } catch (_) {}
    g.pid = null;
    g.toggles = {};
  }

  stopLoops(g) {
    for (const id of Object.keys(g.loops)) {
      clearInterval(g.loops[id]);
      delete g.loops[id];
      g.toggles[id] = false;
    }
  }

  // ---------- Cheats ----------
  sanitize(cheat, params = {}) {
    const out = {};
    for (const f of cheat.fields || []) {
      let v = params[f.key];
      if (v === undefined || v === null || v === '') v = f.default;
      switch (f.type) {
        case 'number': {
          let n = typeof v === 'string' ? Number(v.trim().replace(',', '.')) : Number(v);
          if (!Number.isFinite(n)) n = Number(f.default) || 0;
          if (f.min !== undefined) n = Math.max(f.min, n);
          if (f.max !== undefined) n = Math.min(f.max, n);
          if (!f.float) n = Math.round(n);
          out[f.key] = n;
          break;
        }
        case 'select': {
          const ok = (f.options || []).some((o) => String(o.value) === String(v)) || (f.optionsFrom && /^\w{1,64}$/.test(String(v)));
          out[f.key] = ok ? v : f.default;
          break;
        }
        case 'bool':
          out[f.key] = v === true || v === 'true' || v === 1 || v === '1';
          break;
        case 'label': // nur Anzeigetext für Meldungen – wird nie in Spielbefehle eingesetzt
          out[f.key] = String(v ?? '').replace(/[^\p{L}\p{N} \-.’]/gu, '').trim().slice(0, f.maxLength || 96);
          break;
        default: // text – nur harmlose Zeichen, keine Anführungszeichen/Klammern
          out[f.key] = String(v ?? '').replace(/[^\w \-.]/g, '').trim().slice(0, f.maxLength || 96);
      }
    }
    return out;
  }

  // spec: Befehl, Liste oder Funktion (params, toggles) – toggles = aktuelle Schalter des Spiels
  build(spec, params, toggles = {}) {
    if (!spec) return [];
    const raw = typeof spec === 'function' ? spec(params, toggles) : spec;
    const list = Array.isArray(raw) ? raw : [raw];
    return list.filter(Boolean).map((t) => String(t).replace(/\{(\w+)\}/g, (_, k) => {
      const v = params[k];
      return typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v ?? '');
    }));
  }

  async execAll(g, commands) {
    const results = [];
    for (const cmd of commands) {
      // "@wait 1500" = Pause zwischen Befehlen (z. B. bis das Gelände nachgeladen ist)
      const wait = /^@wait (\d{1,5})$/.exec(cmd);
      if (wait) { await new Promise((res) => setTimeout(res, Number(wait[1]))); continue; }
      const r = await g.connector.exec(cmd);
      results.push({ cmd, ...r });
      this.log(g.plugin.id, r.ok ? 'cmd' : 'error', `${cmd}${r.output ? '  →  ' + r.output : ''}`);
      if (commands.length > 1) await new Promise((res) => setTimeout(res, 80));
    }
    return results;
  }

  async run(gameId, cheatId, params = {}, { enable } = {}) {
    const g = this.games.get(gameId);
    if (!g) throw new Error(t('Unbekanntes Spiel'));
    const cheat = g.cheats.get(cheatId);
    if (!cheat) throw new Error(t('Unbekannter Cheat'));
    if (!g.connector.isConnected()) {
      this.log(gameId, 'warn', t('„{name}“ nicht möglich – Spiel nicht verbunden.', { name: t(cheat.name) }));
      return { ok: false, reason: 'not-connected' };
    }
    const p = this.sanitize(cheat, params);
    const s = this.settings.game(gameId);
    if (cheat.fields && cheat.fields.length) { s.lastParams[cheatId] = p; this.settings.save(); }

    const type = cheat.type || 'action';
    if (type === 'action') {
      let spec = cheat.run;
      // prepare: liest vorher Daten (z. B. den Spielstand) und liefert die Befehle – oder einen Hinweis als Fehler
      if (cheat.prepare) {
        try {
          const r = await cheat.prepare(p, { log: (lvl, text) => this.log(gameId, lvl, text), catalog: () => this.catalog(gameId) });
          if (r && r.message) this.log(gameId, 'info', r.message);
          spec = r ? r.commands : null;
        } catch (e) {
          this.log(gameId, 'warn', `„${t(cheat.name)}“: ${e.message}`);
          return { ok: false, error: e.message };
        }
      }
      const cmds = this.build(spec, p);
      if (!cmds.length) {
        this.log(gameId, 'warn', t('„{name}“: bitte zuerst die Felder ausfüllen.', { name: t(cheat.name) }));
        return { ok: false, reason: 'empty' };
      }
      const res = await this.execAll(g, cmds);
      return { ok: res.every((r) => r.ok) };
    }

    const next = enable === undefined ? !g.toggles[cheatId] : !!enable;

    if (type === 'toggle') {
      const res = await this.execAll(g, this.build(next ? cheat.on : cheat.off, p, g.toggles));
      const ok = res.every((r) => r.ok);
      if (ok) g.toggles[cheatId] = next;
      this.emitStatus(g);
      return { ok, state: g.toggles[cheatId] };
    }

    if (type === 'loop') {
      clearInterval(g.loops[cheatId]);
      delete g.loops[cheatId];
      if (next) {
        await this.execAll(g, this.build(cheat.onEnable || cheat.run, p));
        let fails = 0;
        let busy = false;
        const tick = async () => {
          // Antwortet das Spiel langsam (Ladebildschirm), keine Befehle aufstauen
          if (busy || !g.connector.isConnected()) return;
          busy = true;
          try {
            for (const cmd of this.build(cheat.run, p)) {
              const r = await g.connector.exec(cmd);
              fails = r.ok ? 0 : fails + 1;
            }
          } finally { busy = false; }
          if (fails >= 3) {
            clearInterval(g.loops[cheatId]);
            delete g.loops[cheatId];
            g.toggles[cheatId] = false;
            this.log(gameId, 'error', t('„{name}“ gestoppt – Befehl schlägt fehl.', { name: t(cheat.name) }));
            this.emitStatus(g);
          }
        };
        g.loops[cheatId] = setInterval(tick, cheat.interval || 1000);
        this.log(gameId, 'ok', t('„{name}“ aktiv (alle {sec} s).', { name: t(cheat.name), sec: ((cheat.interval || 1000) / 1000).toFixed(1) }));
      } else {
        await this.execAll(g, this.build(cheat.onDisable, p));
        this.log(gameId, 'info', t('„{name}“ deaktiviert.', { name: t(cheat.name) }));
      }
      g.toggles[cheatId] = next;
      this.emitStatus(g);
      return { ok: true, state: next };
    }
    throw new Error(t('Unbekannter Cheat-Typ: {type}', { type }));
  }

  // Hotkey: Schalter umschalten bzw. Aktion mit zuletzt benutzten Werten ausführen
  async trigger(gameId, cheatId) {
    const s = this.settings.game(gameId);
    return this.run(gameId, cheatId, s.lastParams[cheatId] || {});
  }

  async raw(gameId, command) {
    const g = this.games.get(gameId);
    if (!g || !g.connector.isConnected()) {
      this.log(gameId, 'warn', t('Nicht verbunden.'));
      return { ok: false };
    }
    const clean = String(command).replace(/[\r\n]/g, ' ').trim().slice(0, 400);
    if (!clean) return { ok: false };
    const [r] = await this.execAll(g, [clean]);
    return r;
  }

  // ---------- Spieldaten (Katalog & Bilder) ----------
  async resolveInstall(gameId) {
    const g = this.games.get(gameId);
    const s = this.settings.game(gameId);
    if (s.install && (s.install.root || s.install.exePath)) return s.install;
    if (g && g.plugin.detectInstall) {
      const found = await g.plugin.detectInstall();
      if (found) { s.install = found; this.settings.save(); return found; }
    }
    return null;
  }

  dataContext(gameId, install) {
    return { install, cacheDir: path.join(this.cacheRoot || '.', gameId), log: (lvl, text) => this.log(gameId, lvl, text) };
  }

  // Im neuesten Spielstand freigeschaltete Journal-Einträge (fürs Bestiarium)
  async journal(gameId) {
    const g = this.games.get(gameId);
    if (!g || !g.plugin.data || !g.plugin.data.journal) return null;
    return g.plugin.data.journal();
  }

  async catalog(gameId) {
    const g = this.games.get(gameId);
    if (!g || !g.plugin.data) throw new Error(t('Keine Spieldaten für dieses Spiel'));
    const install = await this.resolveInstall(gameId);
    const t0 = Date.now();
    const cat = await g.plugin.data.catalog(this.dataContext(gameId, install), (text, progress) =>
      this.emit('catalog', { gameId, text, progress }));
    if (Date.now() - t0 > 1500) this.log(gameId, 'info', t('Spieldaten eingelesen: {cards} Gwint-Karten, {items} Gegenstände.', { cards: cat.cards?.length || 0, items: cat.items?.length || 0 }));
    return cat;
  }

  async image(gameId, tex, w) {
    const g = this.games.get(gameId);
    if (!g || !g.plugin.data) return null;
    const install = await this.resolveInstall(gameId);
    return g.plugin.data.image(this.dataContext(gameId, install), tex, w);
  }

  // Sprache gewechselt: Plugins legen ihren Katalog beim nächsten Abruf in der neuen Sprache an
  resetCatalogs() {
    for (const g of this.games.values()) if (g.plugin.data && g.plugin.data.reset) g.plugin.data.reset();
  }

  async detectInstall(gameId) {
    const g = this.games.get(gameId);
    return g && g.plugin.detectInstall ? g.plugin.detectInstall() : null;
  }

  async launch(gameId, helpers) {
    const g = this.games.get(gameId);
    if (!g || !g.plugin.launch) throw new Error(t('Dieses Spiel kann nicht gestartet werden'));
    const s = this.settings.game(gameId);
    const res = await g.plugin.launch(s, { ...helpers, log: (lvl, text) => this.log(gameId, lvl, text) });
    if (res && res.install) { s.install = res.install; this.settings.save(); }
    if (res && res.ok && !g.connector.isConnected()) this.launched(g, res.pid);
    return res;
  }
}

module.exports = GameManager;

'use strict';
const path = require('path');
const { app, BrowserWindow, ipcMain, globalShortcut, dialog, shell, protocol, clipboard, screen } = require('electron');
const Settings = require('./src/core/settings');
const GameManager = require('./src/core/gameManager');
const { Updater } = require('./src/core/updater');
const i18n = require('./src/core/i18n');
const { t } = i18n;

let win = null;
let bestWin = null; // separates Bestiariums-Fenster (z. B. für den zweiten Monitor)
let settings = null;
let manager = null;
let updater = null;
const logBuffer = [];
let logSeq = 0;

// ---------- Portabel: alle Daten im Ordner "ForgeMod-Daten" neben der ForgeMod.exe ----------
// Nichts landet in %APPDATA%. Liegt die .exe an einem schreibgeschützten Ort, bleibt Electrons Standard.
function setupPortableData() {
  const fs = require('fs');
  const base = process.env.PORTABLE_EXECUTABLE_DIR
    || (app.isPackaged ? path.dirname(process.execPath) : __dirname); // Entwicklungsmodus: im Quellcode-Ordner
  const dir = path.join(base, 'ForgeMod-Daten');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
  } catch (_) { return null; }
  // Einmalig Einstellungen aus älteren Versionen übernehmen (%APPDATA%\ForgeMod)
  const oldSettings = path.join(app.getPath('appData'), 'ForgeMod', 'settings.json');
  const newSettings = path.join(dir, 'settings.json');
  try { if (!fs.existsSync(newSettings) && fs.existsSync(oldSettings)) fs.copyFileSync(oldSettings, newSettings); } catch (_) {}
  app.setPath('userData', dir);
  app.setPath('crashDumps', path.join(dir, 'Crashpad'));
  return dir;
}
const portableDir = setupPortableData();

// Nur eine ForgeMod-Instanz gleichzeitig
if (!app.requestSingleInstanceLock()) app.exit(0);
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

// Bilder aus der Spielinstallation: forge-img://<spiel>/<textur>?w=<breite>
protocol.registerSchemesAsPrivileged([{ scheme: 'forge-img', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);

function send(channel, payload) {
  for (const w of [win, bestWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

const windowOptions = (extra = {}) => ({
  backgroundColor: '#0b0d12',
  titleBarStyle: 'hidden',
  titleBarOverlay: process.platform === 'win32' ? { color: '#0b0d12', symbolColor: '#c9ced8', height: 38 } : undefined,
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    spellcheck: false,
  },
  ...extra,
});

// ForgeMod ist komplett offline: keine neuen Fenster, keine Navigation weg von der eigenen Oberfläche
function lockDown(w) {
  w.setMenuBarVisibility(false);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file:')) e.preventDefault(); });
}

// Bestiarium in eigenem Fenster – Größe und Position werden gemerkt
function openBestiaryWindow() {
  if (bestWin && !bestWin.isDestroyed()) { if (bestWin.isMinimized()) bestWin.restore(); bestWin.focus(); return; }
  const b = { ...(settings.data.ui.bestiaryBounds || {}) };
  // Gemerkte Position nur nutzen, wenn sie noch auf einem angeschlossenen Bildschirm liegt
  if (b.x !== undefined && !screen.getAllDisplays().some((d) => b.x + 80 > d.workArea.x && b.x < d.workArea.x + d.workArea.width - 80 && b.y >= d.workArea.y - 10 && b.y < d.workArea.y + d.workArea.height - 80)) { delete b.x; delete b.y; }
  bestWin = new BrowserWindow(windowOptions({ width: b.width || 900, height: b.height || 900, x: b.x, y: b.y, minWidth: 520, minHeight: 480, title: 'ForgeMod – Bestiarium' }));
  lockDown(bestWin);
  bestWin.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { lang: i18n.getLang(), view: 'bestiary' } });
  const remember = () => { if (bestWin && !bestWin.isDestroyed() && !bestWin.isMinimized()) { settings.data.ui.bestiaryBounds = bestWin.getBounds(); settings.save(); } };
  bestWin.on('resized', remember);
  bestWin.on('moved', remember);
  bestWin.on('closed', () => { bestWin = null; });
}

function createWindow() {
  win = new BrowserWindow(windowOptions({ width: 1280, height: 820, minWidth: 980, minHeight: 640, title: 'ForgeMod' }));
  lockDown(win);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { lang: i18n.getLang() } });
  // Hauptfenster zu = ForgeMod zu (auch das Bestiariums-Fenster)
  win.on('closed', () => { win = null; if (bestWin && !bestWin.isDestroyed()) bestWin.close(); });
}

// ---------- Hotkeys ----------
// Global registriert werden sie nur, solange das Spiel verbunden ist – sonst bleiben alle Tasten frei
// (und ForgeMod belegt im Hintergrund keine Tastatur, was Virenscanner misstrauisch macht).
function registerHotkeys() {
  globalShortcut.unregisterAll();
  const used = new Map();
  for (const game of manager.describe()) {
    if (game.status !== 'connected') continue;
    for (const cat of game.categories) {
      for (const cheat of cat.cheats) {
        const acc = cheat.hotkey;
        if (!acc) continue;
        if (used.has(acc)) {
          manager.log(game.id, 'warn', t('Hotkey {key} doppelt belegt („{a}“ und „{b}“).', { key: acc, a: cheat.name, b: used.get(acc) }));
          continue;
        }
        try {
          const ok = globalShortcut.register(acc, () => {
            manager.trigger(game.id, cheat.id).catch((e) => manager.log(game.id, 'error', e.message));
          });
          if (ok) used.set(acc, cheat.name);
          else manager.log(game.id, 'warn', t('Hotkey {key} konnte nicht registriert werden (von anderem Programm belegt?).', { key: acc }));
        } catch (e) {
          manager.log(game.id, 'warn', t('Ungültiger Hotkey {key}: {error}', { key: acc, error: e.message }));
        }
      }
    }
  }
}

// ---------- IPC ----------
function setupIpc() {
  ipcMain.handle('games:list', () => ({ games: manager.describe(), lastGame: settings.data.ui.lastGame, logs: logBuffer }));

  ipcMain.handle('cheat:run', (_e, { gameId, cheatId, params, enable }) =>
    manager.run(gameId, cheatId, params, { enable }).catch((e) => ({ ok: false, error: e.message })));

  ipcMain.handle('cheat:raw', (_e, { gameId, command }) =>
    manager.raw(gameId, command).catch((e) => ({ ok: false, error: e.message })));

  ipcMain.handle('game:detect', async (_e, { gameId }) => {
    const found = await manager.detectInstall(gameId);
    if (found) { settings.game(gameId).install = found; settings.save(); }
    return found;
  });

  ipcMain.handle('game:pickExe', async (_e, { gameId }) => {
    const r = await dialog.showOpenDialog(win, {
      title: t('Spiel-EXE auswählen'),
      properties: ['openFile'],
      filters: [{ name: t('Programme'), extensions: ['exe'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    const install = { exePath: r.filePaths[0], source: 'manual' };
    settings.game(gameId).install = install;
    settings.save();
    return install;
  });

  ipcMain.handle('game:launch', (_e, { gameId }) =>
    manager.launch(gameId, { shell }).catch((e) => ({ ok: false, error: e.message })));

  ipcMain.handle('settings:set', (_e, { gameId, key, value }) => {
    const allowed = ['launchMode', 'renderer'];
    if (!allowed.includes(key)) return false;
    settings.game(gameId)[key] = value;
    settings.save();
    return true;
  });

  ipcMain.handle('settings:hotkey', (_e, { gameId, cheatId, accelerator }) => {
    const s = settings.game(gameId);
    s.hotkeys[cheatId] = accelerator || ''; // '' = bewusst ohne Hotkey
    settings.save();
    registerHotkeys();
    return true;
  });

  ipcMain.handle('settings:favorite', (_e, { gameId, cheatId }) => {
    const s = settings.game(gameId);
    const i = s.favorites.indexOf(cheatId);
    if (i >= 0) s.favorites.splice(i, 1); else s.favorites.push(cheatId);
    settings.save();
    return s.favorites;
  });

  ipcMain.handle('journal:get', async (_e, { gameId }) => {
    try { return { ok: true, journal: await manager.journal(gameId) }; } catch (e) { return { ok: false, error: e.message }; }
  });
  ipcMain.handle('window:bestiary', () => { openBestiaryWindow(); return true; });

  ipcMain.handle('catalog:get', async (_e, { gameId }) => {
    try { return { ok: true, catalog: await manager.catalog(gameId) }; } catch (e) { return { ok: false, error: e.message }; }
  });

  ipcMain.handle('update:state', () => updater.state());
  ipcMain.handle('update:check', () => updater.check());
  ipcMain.handle('update:install', () => updater.install().catch((e) => ({ ok: false, error: e.message })));
  ipcMain.handle('update:openFolder', () => {
    const dir = updater.folders()[0];
    try { require('fs').mkdirSync(dir, { recursive: true }); } catch (_) {}
    return shell.openPath(dir);
  });
  ipcMain.handle('app:version', () => updater.current);
  ipcMain.handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text).slice(0, 2000)); return true; });

  // Sprache umschalten: speichern, Spieldaten-Katalog in der neuen Sprache, Fenster neu laden
  ipcMain.handle('ui:setLang', (_e, lang) => {
    const from = i18n.getLang();
    i18n.setLang(lang);
    for (const l of logBuffer) l.text = i18n.retranslate(l.text, from, i18n.getLang());
    settings.data.ui.lang = i18n.getLang();
    settings.save();
    manager.resetCatalogs();
    registerHotkeys();
    if (win && !win.isDestroyed()) win.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { lang: i18n.getLang() } });
    if (bestWin && !bestWin.isDestroyed()) bestWin.loadFile(path.join(__dirname, 'renderer', 'index.html'), { query: { lang: i18n.getLang(), view: 'bestiary' } });
    return true;
  });

  ipcMain.handle('ui:lastGame', (_e, { gameId }) => {
    settings.data.ui.lastGame = gameId;
    settings.save();
    return true;
  });

  // Während der Hotkey-Aufnahme alle globalen Hotkeys pausieren
  ipcMain.handle('hotkeys:pause', () => { globalShortcut.unregisterAll(); return true; });
  ipcMain.handle('hotkeys:resume', () => { registerHotkeys(); return true; });
}

app.whenReady().then(() => {
  settings = new Settings(app.getPath('userData'));
  // Sprache: gespeicherte Wahl, sonst nach Windows-Sprache (Deutsch -> de, alles andere -> en)
  i18n.setLang(settings.data.ui.lang || (/^de/i.test(app.getLocale()) ? 'de' : 'en'));
  protocol.handle('forge-img', async (req) => {
    try {
      const u = new URL(req.url);
      const tex = decodeURIComponent(u.pathname.slice(1));
      const w = Number(u.searchParams.get('w')) || 0;
      const png = await manager.image(u.hostname, tex, w);
      if (!png) return new Response('', { status: 404 });
      return new Response(png, { headers: { 'content-type': 'image/png', 'cache-control': 'max-age=31536000' } });
    } catch (e) {
      return new Response(String(e.message), { status: 500 });
    }
  });
  const gamesDirs = [path.join(__dirname, 'games'), path.join(app.getPath('userData'), 'games')];
  // Eigene Spiel-Plugins: Ordner "games" direkt neben der ForgeMod.exe
  if (app.isPackaged) gamesDirs.push(path.join(path.dirname(process.execPath), 'games'));
  manager = new GameManager({ gamesDirs, settings });
  // Nicht "cache" nennen: Windows unterscheidet keine Groß-/Kleinschreibung, und "Cache" gehört Chromium
  manager.cacheRoot = path.join(app.getPath('userData'), 'Spieldaten');
  manager.on('catalog', (c) => send('catalog:progress', c));
  updater = new Updater({ app, settings, log: (lvl, t) => manager.log('app', lvl, t) });
  updater.on('state', (st) => send('update:state', st));
  let hotkeysFor = '';
  manager.on('status', (s) => {
    send('game:status', s);
    const connected = manager.describe().filter((g) => g.status === 'connected').map((g) => g.id).join(',');
    if (connected !== hotkeysFor) { hotkeysFor = connected; registerHotkeys(); }
  });
  // Log puffern, damit Meldungen vor dem Laden des Fensters nicht verloren gehen
  manager.on('log', (l) => {
    l.seq = ++logSeq;
    logBuffer.push(l);
    if (logBuffer.length > 300) logBuffer.shift();
    send('game:log', l);
  });
  if (portableDir) manager.log('app', 'info', t('Portabler Modus – Daten in {dir}', { dir: portableDir }));
  manager.load();
  setupIpc();
  createWindow();
  registerHotkeys();
  manager.start();
  updater.start();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (manager) manager.stop();
  if (updater) updater.stop();
});

app.on('window-all-closed', () => app.quit());

'use strict';
/*
 * Einfacher Auto-Updater für ForgeMod.
 *
 * Ein Update ist eine einzelne Datei "ForgeMod-x.y.z.update" (die Programmdateien, kein .exe).
 * Quellen (in dieser Reihenfolge):
 *   1. Ordner "updates" neben der ForgeMod.exe
 *   2. ForgeMod-Daten\updates
 *
 * Installieren = Datei nach ForgeMod-Daten\app kopieren und ForgeMod neu starten; boot.js lädt dann die neue Version.
 * Es wird keine .exe ersetzt und kein Skript ausgeführt (sonst schlagen Virenscanner Alarm).
 * ForgeMod verbindet sich nie mit dem Internet – Updates kommen nur aus lokalen Ordnern.
 */
const fs = require('original-fs');
const path = require('path');
const { EventEmitter } = require('events');
const { t } = require('./i18n');

const FILE_RE = /^ForgeMod-(\d+)\.(\d+)\.(\d+)\.update$/i;
const APP_RE = /^app-(\d+\.\d+\.\d+)\.asar$/;

function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}

class Updater extends EventEmitter {
  constructor({ app, settings, log = () => {} }) {
    super();
    this.app = app;
    this.settings = settings;
    this.log = log;
    let v = app.getVersion();
    try { v = require(path.join(__dirname, '..', '..', 'package.json')).version || v; } catch (_) {}
    this.current = v;
    this.available = null;
    this.checking = false;
    this.timer = null;
  }

  // Hierhin kommen installierte Versionen (boot.js schaut dort nach)
  appDir() {
    return this.app.isPackaged ? path.join(path.dirname(process.execPath), 'ForgeMod-Daten', 'app') : null;
  }

  folders() {
    const list = [];
    const cfg = this.settings.data.update || {};
    if (cfg.folder) list.push(cfg.folder);
    if (this.app.isPackaged) list.push(path.join(path.dirname(process.execPath), 'updates'));
    list.push(path.join(this.app.getPath('userData'), 'updates'));
    return [...new Set(list)];
  }

  state() {
    return {
      current: this.current,
      available: this.available,
      canInstall: !!(this.available && this.appDir()),
      folders: this.folders(),
      checking: this.checking,
    };
  }

  start() {
    this.cleanup();
    this.check();
    this.timer = setInterval(() => this.check(), 30 * 60 * 1000);
  }

  stop() { clearInterval(this.timer); }

  // Ältere installierte Versionen aufräumen (die laufende bleibt)
  cleanup() {
    const dir = this.appDir();
    if (!dir) return;
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { return; }
    for (const n of names) {
      const m = n.match(APP_RE);
      if (m && cmpVersion(m[1], this.current) < 0) { try { fs.unlinkSync(path.join(dir, n)); } catch (_) {} }
    }
  }

  async check() {
    if (this.checking) return this.state();
    this.checking = true;
    try {
      let best = null;
      for (const dir of this.folders()) {
        let names = [];
        try { names = fs.readdirSync(dir); } catch (_) { continue; }
        for (const n of names) {
          const m = n.match(FILE_RE);
          if (!m) continue;
          const version = `${m[1]}.${m[2]}.${m[3]}`;
          if (cmpVersion(version, this.current) <= 0) continue;
          if (!best || cmpVersion(version, best.version) > 0) best = { version, file: path.join(dir, n), notes: readNotes(dir, version) };
        }
      }
      const changed = (best && best.version) !== (this.available && this.available.version);
      this.available = best;
      if (changed && best) this.log('ok', t('Update verfügbar: ForgeMod {version}', { version: best.version }));
    } finally {
      this.checking = false;
      this.emit('state', this.state());
    }
    return this.state();
  }

  // Neue Version neben die alte legen und ForgeMod neu starten
  async install() {
    if (!this.available) throw new Error(t('Kein Update verfügbar'));
    const dir = this.appDir();
    if (!dir) throw new Error(t('Updates gehen nur in der fertigen ForgeMod.exe, nicht im Entwicklungsmodus.'));
    const source = this.available.file;
    const head = Buffer.alloc(16);
    const fd = fs.openSync(source, 'r');
    try { fs.readSync(fd, head, 0, 16, 0); } finally { fs.closeSync(fd); }
    // Eine .asar beginnt mit einem 4-Byte-Wert 4 (Pickle-Header) – alles andere ist keine gültige Update-Datei
    if (head.readUInt32LE(0) !== 4) throw new Error(t('Die Update-Datei ist beschädigt.'));
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, `app-${this.available.version}.asar`);
    fs.copyFileSync(source, target + '.tmp');
    fs.renameSync(target + '.tmp', target);
    this.log('info', t('Aktualisiere auf {version} …', { version: this.available.version }));
    setTimeout(() => { this.app.relaunch(); this.app.quit(); }, 300);
    return { ok: true, mode: 'relaunch' };
  }
}

function readNotes(dir, version) {
  for (const n of [`ForgeMod-${version}.txt`, `ForgeMod-${version}.md`, 'changelog.txt']) {
    try { return fs.readFileSync(path.join(dir, n), 'utf8').slice(0, 4000); } catch (_) {}
  }
  return '';
}

module.exports = { Updater, cmpVersion };

'use strict';
/*
 * Startpunkt von ForgeMod: lädt die neueste installierte Programmversion.
 *
 * Updates sind reine Programmdateien (app-x.y.z.asar in ForgeMod-Daten\app). Es wird nie eine .exe ersetzt,
 * kein Skript geschrieben und kein fremdes Programm gestartet – das mögen Virenscanner nicht.
 * Lässt sich eine Update-Datei nicht laden, wird sie beiseitegelegt und die mitgelieferte Version gestartet.
 */
const fs = require('original-fs');
const path = require('path');
const { app } = require('electron');

const BUILTIN = require('./package.json').version;
const APP_RE = /^app-(\d+\.\d+\.\d+)\.asar$/;

function cmpVersion(a, b) {
  const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}

const DIR = path.join(path.dirname(process.execPath), 'ForgeMod-Daten', 'app');
const BROKEN = path.join(DIR, 'defekt.txt'); // Versionen, die schon einmal nicht starten wollten

function newestUpdate() {
  if (!app.isPackaged) return null;
  let names = [];
  try { names = fs.readdirSync(DIR); } catch (_) { return null; }
  let broken = [];
  try { broken = fs.readFileSync(BROKEN, 'utf8').split(/\s+/); } catch (_) {}
  let best = null;
  for (const n of names) {
    const m = n.match(APP_RE);
    if (!m || broken.includes(m[1]) || cmpVersion(m[1], BUILTIN) <= 0) continue;
    if (!best || cmpVersion(m[1], best.version) > 0) best = { version: m[1], file: path.join(DIR, n) };
  }
  return best;
}

const update = newestUpdate();
if (update) {
  try {
    app.setVersion(update.version);
    require(path.join(update.file, 'main.js'));
  } catch (e) {
    console.error('Update konnte nicht geladen werden:', e);
    try { fs.appendFileSync(BROKEN, update.version + '\n'); } catch (_) {}
    app.relaunch();
    app.exit(0);
  }
} else {
  require('./main.js');
}

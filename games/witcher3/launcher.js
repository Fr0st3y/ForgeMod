'use strict';
// Findet die Witcher-3-Installation (Steam / GOG / Epic / manuell) und startet das Spiel
// mit den offiziellen Debug-Argumenten. Am Spielordner wird nichts verändert.
// Gesucht wird nur über Dateien an den üblichen Orten – ohne Registry-Abfragen oder Windows-Hilfsprogramme.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { t } = require('../../src/core/i18n');

const STEAM_APP_ID = '292030';
const DEBUG_ARGS = ['-net', '-debugscripts'];

// Vorhandene Laufwerke (C: bis Z:)
function drives() {
  const out = [];
  for (let c = 67; c <= 90; c++) {
    const d = String.fromCharCode(c) + ':\\';
    try { if (fs.statSync(d).isDirectory()) out.push(d); } catch (_) {}
  }
  return out;
}

function exesFor(root) {
  const dx12 = path.join(root, 'bin', 'x64_dx12', 'witcher3.exe');
  const dx11 = path.join(root, 'bin', 'x64', 'witcher3.exe');
  return { exeDx12: fs.existsSync(dx12) ? dx12 : null, exeDx11: fs.existsSync(dx11) ? dx11 : null };
}

async function findSteam() {
  // Steam-Ordner an den üblichen Orten; dessen libraryfolders.vdf nennt alle weiteren Bibliotheken
  const libs = [];
  for (const d of drives()) {
    for (const p of ['Program Files (x86)\\Steam', 'Program Files\\Steam', 'Steam', 'SteamLibrary', 'Games\\Steam', 'Games\\SteamLibrary', 'Spiele\\Steam', 'Spiele\\SteamLibrary']) {
      const lib = path.join(d, p);
      if (!fs.existsSync(path.join(lib, 'steamapps'))) continue;
      libs.push(lib);
      try {
        const vdf = fs.readFileSync(path.join(lib, 'steamapps', 'libraryfolders.vdf'), 'utf8');
        for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(m[1].replace(/\\\\/g, '\\'));
      } catch (_) {}
    }
  }
  for (const lib of [...new Set(libs.map((l) => path.resolve(l)))]) {
    const acf = path.join(lib, 'steamapps', `appmanifest_${STEAM_APP_ID}.acf`);
    if (!fs.existsSync(acf)) continue;
    const dir = (fs.readFileSync(acf, 'utf8').match(/"installdir"\s+"([^"]+)"/) || [])[1] || 'The Witcher 3';
    const root = path.join(lib, 'steamapps', 'common', dir);
    const exes = exesFor(root);
    if (exes.exeDx12 || exes.exeDx11) return { root, source: 'steam', ...exes };
  }
  return null;
}

async function findGog() {
  const names = ['The Witcher 3 Wild Hunt GOTY', 'The Witcher 3 Wild Hunt', 'The Witcher 3'];
  for (const d of drives()) {
    for (const base of ['GOG Games', 'Program Files (x86)\\GOG Galaxy\\Games', 'Program Files\\GOG Galaxy\\Games', 'Games\\GOG', 'GOG Galaxy\\Games']) {
      for (const n of names) {
        const root = path.join(d, base, n);
        const exes = exesFor(root);
        if (exes.exeDx12 || exes.exeDx11) return { root, source: 'gog', ...exes };
      }
    }
  }
  return null;
}

// Epic Games: Manifeste unter %ProgramData%\Epic\EpicGamesLauncher\Data\Manifests (*.item, JSON)
async function findEpic() {
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.item')); } catch (_) { return null; }
  for (const f of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!/witcher 3/i.test(m.DisplayName || '') || !m.InstallLocation) continue;
      const exes = exesFor(m.InstallLocation);
      if (exes.exeDx12 || exes.exeDx11) return { root: m.InstallLocation, source: 'epic', ...exes };
    } catch (_) {}
  }
  return null;
}

async function detectInstall() {
  return (await findSteam()) || (await findGog()) || (await findEpic()) || null;
}

function fromManual(install) {
  if (!install || !install.exePath) return install;
  // .../The Witcher 3/bin/x64_dx12/witcher3.exe -> Wurzelordner
  const root = path.resolve(path.dirname(install.exePath), '..', '..');
  const exes = exesFor(root);
  const isSteam = /steamapps[\\/]common/i.test(root);
  return { root, source: isSteam ? 'steam' : 'manual', ...exes, exePath: install.exePath };
}

async function launch(settings, { shell, log }) {
  let install = settings.install ? fromManual(settings.install) : null;
  if (!install || !(install.exeDx12 || install.exeDx11 || install.exePath)) install = await detectInstall();
  if (!install) throw new Error(t('Witcher 3 nicht gefunden. Bitte die witcher3.exe manuell auswählen.'));

  const mode = settings.launchMode || 'direct';
  if (mode === 'steam') {
    // Steam fragt einmalig nach, ob mit diesen Argumenten gestartet werden darf.
    await shell.openExternal(`steam://run/${STEAM_APP_ID}//${DEBUG_ARGS.join(' ')}/`);
    log('info', t('Start über Steam angefordert (-net -debugscripts).'));
    return { ok: true, install };
  }

  const wantDx11 = settings.renderer === 'dx11';
  const exe = install.exePath && !settings.renderer
    ? install.exePath
    : (wantDx11 ? (install.exeDx11 || install.exeDx12) : (install.exeDx12 || install.exeDx11));
  if (!exe || !fs.existsSync(exe)) throw new Error(t('witcher3.exe nicht gefunden: {path}', { path: exe }));

  const child = spawn(exe, DEBUG_ARGS, { cwd: path.dirname(exe), detached: true, stdio: 'ignore', windowsHide: false });
  child.on('error', (e) => log('error', t('Start fehlgeschlagen: {error}', { error: e.message })));
  child.unref();
  log('info', t('Starte {exe} {args}', { exe: path.basename(path.dirname(exe)) + '\\witcher3.exe', args: DEBUG_ARGS.join(' ') }));
  return { ok: true, install, pid: child.pid };
}

module.exports = { detectInstall, launch, DEBUG_ARGS };

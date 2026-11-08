'use strict';
// Nach electron-builder: fertigen Programmordner, Update-Datei und ZIP zum Weitergeben erzeugen.
//   dist/ForgeMod/                    Programmordner (ForgeMod.exe + Laufzeit + README.txt) – so wie er beim Nutzer liegt
//   dist/ForgeMod-x.y.z.update        Update für bestehende Installationen (in den Ordner "updates" legen)
//   dist/ForgeMod-x.y.z.zip           Programmordner als ZIP (zum Weitergeben, z. B. Nexus Mods)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const asar = require('@electron/asar');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const { version } = require('../package.json');
const unpacked = path.join(DIST, 'win-unpacked');
const out = path.join(DIST, 'ForgeMod');

(async () => {
  if (!fs.existsSync(path.join(unpacked, 'ForgeMod.exe'))) throw new Error('dist/win-unpacked fehlt – erst electron-builder ausführen');
  fs.rmSync(out, { recursive: true, force: true });
  fs.cpSync(unpacked, out, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'release', 'README.txt'), path.join(out, 'README.txt'));
  // Update-Datei = Programmdateien (resources/app) als eine .asar
  const update = path.join(DIST, `ForgeMod-${version}.update`);
  fs.rmSync(update, { force: true });
  await asar.createPackage(path.join(unpacked, 'resources', 'app'), update);

  const zip = path.join(DIST, `ForgeMod-${version}.zip`);
  fs.rmSync(zip, { force: true });
  // Windows-eigenes tar.exe (kann ZIP schreiben) – nicht das von Git Bash
  const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-c', '-f', path.basename(zip), 'ForgeMod'], { cwd: DIST, stdio: 'inherit' });
  console.log(`Fertig: dist/ForgeMod (Ordner), dist/ForgeMod-${version}.update, dist/ForgeMod-${version}.zip`);
})().catch((e) => { console.error(e); process.exit(1); });

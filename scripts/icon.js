'use strict';
// Erzeugt build/icon.png (256×256) aus dem ForgeMod-Logo (Schild mit Haken, wie oben links in der App).
// Aufruf: npx electron scripts/icon.js
const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const SIZE = 256;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 256 256">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1c2230"/><stop offset="1" stop-color="#0b0d12"/></linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f0c060"/><stop offset="1" stop-color="#c58a2a"/></linearGradient>
  </defs>
  <rect x="8" y="8" width="240" height="240" rx="52" fill="url(#bg)"/>
  <rect x="8.5" y="8.5" width="239" height="239" rx="51.5" fill="none" stroke="#d9a441" stroke-opacity=".35" stroke-width="3"/>
  <g transform="translate(32 30) scale(8)">
    <path d="M12 2 3 6v6c0 5 3.8 8.8 9 10 5.2-1.2 9-5 9-10V6z" fill="#d9a441" fill-opacity=".12" stroke="url(#gold)" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="m8 12 3 3 5-6" fill="none" stroke="url(#gold)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, show: false, frame: false, transparent: true, useContentSize: true,
    webPreferences: { offscreen: true } });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    `<html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.resize({ width: SIZE, height: SIZE }).toPNG());
  console.log('geschrieben:', out);
  app.exit(0);
});

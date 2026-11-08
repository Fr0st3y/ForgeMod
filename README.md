# ForgeMod

A standalone cheat menu (trainer) for **The Witcher 3: Wild Hunt – Complete Edition / Next-Gen** (single-player).
by **Fr0st3y**

ForgeMod talks to the game through its **official debug interface** (launch options `-net -debugscripts`,
TCP 127.0.0.1:37001) and runs the game's own built-in console functions. It never changes, adds or deletes any
file in the game folder and never connects to the internet.

Features: god mode, crowns/XP, all Gwent cards, item and creature galleries with in-game images, a bestiary with
one-click weaknesses, a world map with click-to-teleport, weather, time and more. Interface in English and German.

## How it works

| Part | What it does |
|---|---|
| `boot.js` | Entry point. Loads the newest installed program version (local `.update` files, never from the internet). |
| `main.js`, `preload.js` | Electron main process, IPC, hotkeys, `forge-img://` protocol for images read from the game. |
| `src/core/` | Plugin loader and game detection (`gameManager.js`), settings, updater, translations (`i18n.js`). |
| `games/witcher3/w3net.js` | Client for the game's debug protocol (exec commands). |
| `games/witcher3/index.js` | All cheats (every command was checked against the game's script files). |
| `games/witcher3/gamedata/` | **Read-only** readers for the game's `.bundle`, `texture.cache`, `.w3strings`, CR2W files and save games. |
| `renderer/` | User interface (HTML/CSS/JavaScript, no frameworks). |
| `i18n/en.js` | English translations (German text is the key). |
| `scripts/pack.js` | After the Electron build: creates the program folder, the `.update` file and the ZIP. |
| `test/` | Tests (`npm test`). |

Security-relevant facts, easy to verify in the code:
- No network access except the game on the local PC (127.0.0.1). No auto-update from the internet, no telemetry.
- The only program ForgeMod ever starts is `witcher3.exe` when the user clicks "Launch game" (`games/witcher3/launcher.js`).
  No PowerShell, no `cmd`, no `tasklist`, no registry access.
- Game files and save games are only ever opened for reading.
- All settings stay in the `ForgeMod-Daten` folder next to `ForgeMod.exe` (portable, nothing in AppData or the registry).

## Building from source

Requirements:
- Windows 10 or 11 (64-bit)
- [Node.js](https://nodejs.org) 20 or newer (built with Node.js 24.22 and npm 11.19)
- Git (to clone the repository)

Steps (in a terminal / PowerShell):

```
git clone <this repository>
cd ForgeMod
npm ci
npm run dist
```

`npm ci` installs the exact versions from `package-lock.json` (Electron 33.4.11, electron-builder 25.1.8).
`npm run dist` runs `electron-builder --win dir` and then `node scripts/pack.js`. The result is in `dist/`:

| Output | Content |
|---|---|
| `dist/ForgeMod/` | The program folder (this is what the release ZIP contains) |
| `dist/ForgeMod-<version>.zip` | The release ZIP as uploaded to Nexus Mods |
| `dist/ForgeMod-<version>.update` | Update file for existing installations |

**Note on the first build:** electron-builder downloads its helper package `winCodeSign` (used to set the program
icon and version information of `ForgeMod.exe`). That archive contains macOS symbolic links, which Windows only
allows to create with **Developer Mode enabled** (Settings → System → For developers) or in a terminal **run as
administrator**. Without that, the build stops with "Cannot create symbolic link".

### Verifying a release

- `ForgeMod/resources/app/` in the release ZIP contains the application code as plain, unpacked JavaScript.
  It is identical to the files `boot.js`, `main.js`, `preload.js` and the folders `src/`, `games/`, `renderer/`,
  `i18n/` of this repository (the build copies them unchanged). `package.json` is reduced by electron-builder to the
  fields needed at runtime (name, version, main, author, …).
- `ForgeMod.exe` is the unmodified Electron 33.4.11 runtime; electron-builder only sets the icon (`build/icon.png`)
  and the version information. The other files in the folder are the standard Electron/Chromium runtime files and
  their licenses (`LICENSE.electron.txt`, `LICENSES.chromium.html`).

### Tests

```
npm test
```

Some tests additionally check against a real installation of the game if it is available:
`set W3_ROOT=C:\Path\To\The Witcher 3` before `npm test`.

### Running from source

```
npm start
```

## License

© Fr0st3y – all rights reserved. The source code is published for transparency and review. See [LICENSE](LICENSE).
The Witcher is a trademark of CD PROJEKT S.A. ForgeMod is a fan project and is not affiliated with or endorsed by
CD PROJEKT RED. Electron and Chromium are subject to their own licenses (included in the release).

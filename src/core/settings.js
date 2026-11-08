'use strict';
// Einfache JSON-Einstellungen im Benutzerordner (nicht im Spielordner!)
const fs = require('fs');
const path = require('path');

class Settings {
  constructor(dir) {
    this.file = path.join(dir, 'settings.json');
    this.data = { games: {}, ui: { lastGame: null } };
    try {
      if (fs.existsSync(this.file)) {
        this.data = Object.assign(this.data, JSON.parse(fs.readFileSync(this.file, 'utf8')));
      }
    } catch (e) {
      console.error('Einstellungen konnten nicht gelesen werden:', e.message);
    }
  }

  game(id) {
    if (!this.data.games[id]) this.data.games[id] = { hotkeys: {}, favorites: [], lastParams: {} };
    const g = this.data.games[id];
    g.hotkeys = g.hotkeys || {};
    g.favorites = g.favorites || [];
    g.lastParams = g.lastParams || {};
    return g;
  }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('Einstellungen konnten nicht gespeichert werden:', e.message);
    }
  }
}

module.exports = Settings;

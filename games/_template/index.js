'use strict';
/*
 * Vorlage für ein neues Spiel.
 * 1. Ordner kopieren, z. B. games/_template -> games/rdr2 (Ordner mit "_" am Anfang werden ignoriert)
 * 2. id, name, processNames anpassen
 * 3. createConnector() liefert ein Objekt mit connect/disconnect/isConnected/exec
 *    – wie die Befehle ins Spiel kommen, entscheidet jedes Plugin selbst
 *    (Debug-Schnittstelle des Spiels, Mod-Loader-Socket, Script-Hook usw.)
 * 4. Cheats in categories eintragen. Typen: action | toggle | loop (siehe games/witcher3/index.js)
 */
const { EventEmitter } = require('events');

class ExampleConnector extends EventEmitter {
  constructor({ log }) { super(); this.log = log; this.connected = false; }
  isConnected() { return this.connected; }
  async connect() { throw new Error('Noch nicht implementiert'); }
  disconnect() { if (this.connected) { this.connected = false; this.emit('close'); } }
  async exec(command) { return { ok: false, output: `Nicht implementiert: ${command}` }; }
}

module.exports = {
  id: 'example',
  name: 'Beispielspiel',
  subtitle: 'Vorlage',
  accent: '#5aa9e6',
  banner: { from: '#10233a', via: '#1d4a73', to: '#0b1220', glyph: 'medallion' },
  processNames: ['example.exe'],
  setupHint: 'Hier steht, was der Nutzer tun muss, damit die Cheats verfügbar werden.',
  categories: [
    {
      id: 'player', name: 'Spieler', icon: 'shield',
      cheats: [
        { id: 'god', name: 'God Mode', desc: 'Beispiel-Schalter', type: 'toggle', on: 'god_on', off: 'god_off' },
        { id: 'money', name: 'Geld', desc: 'Beispiel mit Feld', button: 'Geben',
          fields: [{ key: 'n', label: 'Betrag', type: 'number', default: 1000, min: 1, max: 999999 }],
          run: 'give_money {n}' },
      ],
    },
  ],
  createConnector: ({ log }) => new ExampleConnector({ log }),
  // optional: detectInstall: async () => ({ root, exePath }), launch: async (settings, { shell, log }) => ({ ok: true })
};

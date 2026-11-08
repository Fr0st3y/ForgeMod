'use strict';
// Prüft, ob ein von ForgeMod selbst gestarteter Prozess (das Spiel) noch läuft.
// Bewusst keine Prozessliste (tasklist o. Ä.): ForgeMod startet keine Windows-Hilfsprogramme im Hintergrund.
function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

module.exports = { isAlive };

# ForgeMod – Cheat-Menü für Offline-Spiele

Standalone-Trainer im Stil von WeMod. Erstes Spiel: **The Witcher 3: Wild Hunt** (Complete Edition / Next-Gen).

von **Fr0st3y**

## Sprache: Deutsch / English

Unten links in der Seitenleiste umschalten (**DE | EN**). Die Wahl wird gespeichert; beim allerersten Start richtet sich
ForgeMod nach der Windows-Sprache. Umgestellt wird alles: Oberfläche, Cheats, Anleitungen, Meldungen – und die Namen
aus dem Spiel (Gegenstände, Gwint-Karten, Orte), die ForgeMod direkt aus der offiziellen Lokalisierung deiner
Installation liest (`de.w3strings` bzw. `en.w3strings`). Monster, Tränke und Gwint-Begriffe folgen den offiziellen
englischen Bezeichnungen von Witcher 3.

## Starten

Im Ordner **`ForgeMod-Programm`** die **`ForgeMod.exe`** doppelklicken – fertig. (Windows-SmartScreen: „Weitere
Informationen“ → „Trotzdem ausführen“.) Zum Weitergeben den ganzen Ordner verschicken bzw. die ZIP aus `dist`.

**Komplett portabel:** Keine Installation, nichts in `%APPDATA%` oder der Registry. Einstellungen, Bilder-Cache und
Chromium-Daten liegen im Ordner **`ForgeMod-Daten`** im Programmordner. Ordner löschen = ForgeMod ist weg.
Beim Weitergeben `ForgeMod-Daten` weglassen – darin stehen deine eigenen Einstellungen (z. B. dein Spielpfad).

Selbst bauen: `build.bat` (braucht Node.js) · Aus dem Quellcode starten: `start.bat`

### Virenscanner

ForgeMod ist nicht code-signiert (das Zertifikat kostet jährlich Geld), deshalb kennen Virenscanner die Datei nicht.
Damit die Verhaltensanalyse (z. B. Norton „IDP.HELU…“) nicht anspringt, macht ForgeMod bewusst nichts, was nach
Schadsoftware aussieht:
- kein selbstentpackendes Programm, das sich in den Temp-Ordner kopiert und von dort startet (normaler Programmordner),
- keine Windows-Hilfsprogramme im Hintergrund (kein PowerShell, kein `tasklist`, kein `reg query`, keine Skripte) –
  das Spiel wird nur daran erkannt, dass seine Cheat-Schnittstelle auf 127.0.0.1 antwortet; der Spielpfad wird über
  die Dateien von Steam/GOG/Epic an den üblichen Orten gefunden; einziges gestartetes Programm ist das Spiel selbst,
- globale Hotkeys nur, solange das Spiel verbunden ist,
- Updates ersetzen keine .exe, sondern sind reine Programmdateien (siehe unten).

Meldet ein Scanner trotzdem etwas: Datei beim Hersteller als Fehlalarm einreichen (Norton: submit.norton.com).

## Updates – automatisch

Ein Update ist eine einzelne Datei **`ForgeMod-x.y.z.update`** (~300 KB, nur die Programmdateien). In den Ordner
**`updates`** im Programmordner legen (oder `ForgeMod-Daten\updates`) → oben erscheint **„Jetzt aktualisieren“** →
ForgeMod legt die neue Version in `ForgeMod-Daten\app` ab und startet neu. Die `ForgeMod.exe` selbst wird dabei nie
verändert. Unter ⚙ gibt es außerdem „Nach Updates suchen“. Nur wenn sich die Electron-Laufzeit ändert, braucht es den
ganzen neuen Programmordner.

## Witcher 3

**Normal über Steam, Epic oder GOG starten (empfohlen):** einmalig im Launcher die Startoptionen
`-net -debugscripts` eintragen (ForgeMod zeigt die Schritte samt Kopieren-Knopf unter ⚙ bzw. automatisch, wenn das
Spiel ohne sie läuft). Danach das Spiel ganz normal starten – ForgeMod erkennt es nach wenigen Sekunden und
schaltet die Cheats frei. Alternativ startet **Spiel starten** in ForgeMod `witcher3.exe -net -debugscripts` direkt.

Sobald „Verbunden · Cheats aktiv“ steht: Cheats per Klick oder Hotkey (Numpad 0–9). Erkannt wird das Spiel daran,
dass seine Debug-Schnittstelle antwortet (alle 2,5 Sekunden geprüft) – ForgeMod liest keine Prozessliste.

Der Spielordner bleibt **komplett vanilla**: `-net -debugscripts` sind offizielle Startargumente von CD Projekt.
Die Cheats sind die eingebauten Exec-Funktionen des Spiels – **jeder Befehl wurde gegen die Spielskripte der
aktuellen Version geprüft**.

### Bilder & Galerien

ForgeMod liest Gwint-Karten-Art, Inventar-Icons, Bestiarium-Bilder und Namen (Deutsch oder Englisch) **direkt aus deiner
eigenen Installation** (nur lesend; Cache unter `ForgeMod-Daten\Spieldaten`). Dadurch passt alles immer zu deiner
Spielversion, und es werden keine Spieldateien mitgeliefert.

- **Gwint-Sammlung:** alle 185 Karten mit Bild, Stärke, Reihe, Fähigkeit – nach Fraktion/Typ filterbar.
  Einzeln in die Sammlung legen (wie beim Looten: Karten-Gegenstand ins Inventar, das Spiel trägt ihn selbst in die
  Sammlung ein) oder *während einer Partie* direkt ins Blatt ziehen (auch Startdeck-Karten).
- **Alle Gegenstände:** ~4000 Items mit Icon und Namen aus dem Spiel, 26 Kategorien, Suche, Anzahl wählbar.
  Waffen & Rüstungen zusätzlich nach **Seltenheit** (Gewöhnlich, Meister, Magisch, Relikt, Hexerausrüstung – aus dem
  Attribut `quality` der Spieldateien) und **Variante** (normal, passt sich Stufe an, hergestellt, Neues Spiel+) filterbar.
  Gleichnamige Gegenstände werden im Detail nebeneinander verglichen. „Auf meine Stufe holen & anlegen“ nutzt die
  Autogen-Mechanik des Spiels: Solche Gegenstände werden beim Erhalt auf die aktuelle Stufe berechnet.
- **Kreaturen:** ~147 Monster, Bosse, Figuren und Tiere aus Hauptspiel, Hearts of Stone und Blood and Wine – mit den
  großen Bestiarium-Artworks bzw. Charakter-Portraits. Anzahl, Stufe, Abstand, „greift dich an“. Jeder Spawn-Name wird
  beim Einlesen gegen die `gameplay.xml` deiner Spielversion geprüft.

- **Weltkarte & Teleport** (Tab „Reisen“): die echte Spielkarte aller Regionen (Velen & Novigrad, Skellige, Toussaint,
  Kaer Morhen, Weißgarten, Wyzima) mit allen Wegweisern und Ortsnamen. Klick auf die Karte oder einen
  Wegweiser → „Hierhin teleportieren“. Wegweiser: exakte Position und Höhe (`tptopos`). Freier Punkt: `xy` dreimal mit
  kurzer Pause, damit man nicht aus 500 m Höhe fällt, wenn das Gelände noch nicht geladen ist. Die Felder „Teleport zu
  Koordinaten“ und „Teleport in Region“ sind mit der Karte verbunden.

### Cheats

| Kategorie | Highlights |
|---|---|
| Spieler | God Mode, Unsterblich, Unendliche Gesundheit/Ausdauer, One-Hit, Katzensicht, Trank-Buffs ohne Toxizität, Ciri spielen |
| Geld & XP | Kronen, XP, Stufen, Fähigkeitspunkte, alle Baupläne, alle Alchemie-Rezepte, alle Schatzkarten, Glossar |
| Gwint | Alle Karten (gesamt oder pro Fraktion), Fraktions-Deck freischalten, Partie gewinnen/verlieren, überall spielen, KI gegen KI + Galerie |
| Inventar | Großmeister-Sets (Wolf, Katze, Greif, Bär, Mantikor), alle Tränke/Bomben/Öle/Mutagene, Material, Optiken + Galerie |
| Kreaturen | Beschwören-Galerie, Gegner im Umkreis töten, Zerstückeln |
| Welt | Wetter (Liste aus deinem Spiel), Sturm, Zeit vorspulen, Zeitraffer |
| Reisen | Weltkarte mit Klick-Teleport, zum grünen Wegpunkt (aus dem neuesten Spielstand gelesen – Wegpunkt setzen, F5, Teleport), Schnellreise überall, alle Wegweiser/Marker/?-Orte, Region wechseln, Ausdauer-Pferd, Boot |
| Aussehen | Frisuren, Rasur, Bart, Witcher-2-Tattoo, Kopfmodell |
| Kamera & Foto | HUD aus, Welt einfrieren, Abblenden |

## Neues Spiel hinzufügen

`games/_template` kopieren (oder Ordner `games` neben die .exe legen), `id`, `name`, `processNames`, Cheats und
`createConnector()` eintragen. Optional `data.catalog()` / `data.image()` für Galerien. Witcher 3 ist das
vollständige Beispiel.

Neue Texte immer mit `t('…')` schreiben und in `i18n/en.js` übersetzen – `npm test` meldet fehlende Übersetzungen.

## Aufbau

```
boot.js                       Startpunkt: lädt die neueste installierte Version (Updates)
main.js                       Electron-Hauptprozess, IPC, Hotkeys, forge-img:// (Bilder)
scripts/pack.js               Nach dem Build: Programmordner, .update-Datei und ZIP (für Nexus)
scripts/icon.js               Erzeugt build/icon.png (Programm-Icon)
release/README.txt            Anleitung (EN/DE), die in die ZIP kommt
src/core/gameManager.js       Plugins, Spiel-Erkennung (über die Debug-Schnittstelle), Cheats, Katalog
src/core/updater.js           Auto-Updater (.update-Dateien aus dem Update-Ordner – nie aus dem Internet, Nexus-Regel)
games/witcher3/w3net.js       Debug-Protokoll (TCP 37001)
games/witcher3/gamedata/      Leser für .bundle, texture.cache (DXT1/3/5 + unkomprimiert), .w3strings → PNG
games/witcher3/index.js       Cheats & Galerien
renderer/                     Oberfläche (app.js, gallery.js, map.js)
src/core/i18n.js, i18n/en.js  Sprachumschaltung: deutscher Text = Schlüssel, englische Übersetzung im Wörterbuch
```

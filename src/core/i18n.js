'use strict';
/*
 * Übersetzung Deutsch/Englisch.
 * Die deutschen Texte im Code sind die Schlüssel, die englischen stehen in i18n/en.js.
 * Platzhalter: t('Teleport nach {x} / {y}', { x, y })
 */
const EN = require('../../i18n/en');

let lang = 'de';

function setLang(l) { lang = l === 'en' ? 'en' : 'de'; }
function getLang() { return lang; }

function fill(s, vars) {
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m)) : s;
}

function t(text, vars) {
  if (typeof text !== 'string' || !text) return text;
  const s = lang === 'en' && Object.prototype.hasOwnProperty.call(EN, text) ? EN[text] : text;
  return fill(s, vars);
}

// Bereits übersetzten Text (z. B. ältere Konsolenzeilen) in die jeweils andere Sprache bringen.
// Erkennt auch Texte mit Platzhaltern; unbekannte Texte bleiben unverändert.
let patterns = null;
function retranslate(text, from, to) {
  if (typeof text !== 'string' || from === to) return text;
  if (!patterns) {
    const esc = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    const rx = (s) => new RegExp('^' + esc(s).replace(/\\?\{(\w+)\\?\}/g, '(?<$1>.*?)') + '$');
    patterns = { de: new Map(), en: new Map() };
    for (const [de, en] of Object.entries(EN)) {
      if (!patterns.de.has(de)) patterns.de.set(de, { re: rx(de), out: en });
      if (!patterns.en.has(en)) patterns.en.set(en, { re: rx(en), out: de });
    }
  }
  const list = patterns[from];
  if (!list) return text;
  const exact = list.get(text);
  if (exact) return exact.out;
  for (const [src, p] of list) {
    if (!src.includes('{')) continue;
    const m = text.match(p.re);
    if (m) {
      // Eingesetzte Namen (Cheat, Region …) mit übersetzen, wenn sie bekannt sind
      const vars = {};
      for (const [k, v] of Object.entries(m.groups)) vars[k] = list.has(v) ? list.get(v).out : v;
      return fill(p.out, vars);
    }
  }
  return text;
}

module.exports = { t, setLang, getLang, retranslate, EN };

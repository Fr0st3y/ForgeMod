'use strict';
/* global FORGE_EN */
/*
 * Übersetzung in der Oberfläche (gleiches Wörterbuch wie im Hauptprozess: i18n/en.js).
 * Die Sprache kommt als ?lang=de|en in der Fenster-URL – beim Umschalten lädt ForgeMod das Fenster neu.
 */
const LANG = new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'de';
const LOCALE = LANG === 'en' ? 'en-US' : 'de-DE';
document.documentElement.lang = LANG;
// Eigene Fenster (z. B. ?view=bestiary): zeigen nur einen Bereich von ForgeMod
const VIEW = new URLSearchParams(location.search).get('view') || '';
if (VIEW) document.documentElement.classList.add(`view-${VIEW}`);

function t(text, vars) {
  if (typeof text !== 'string' || !text) return text;
  const s = LANG === 'en' && Object.prototype.hasOwnProperty.call(FORGE_EN, text) ? FORGE_EN[text] : text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : m)) : s;
}

// Feste Texte aus index.html übersetzen (Textknoten sowie placeholder/title)
(function translateStatic(root) {
  if (LANG !== 'en') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const raw = n.nodeValue;
    const key = raw.trim();
    if (key && Object.prototype.hasOwnProperty.call(FORGE_EN, key)) n.nodeValue = raw.replace(key, FORGE_EN[key]);
  }
  for (const elm of root.querySelectorAll('[placeholder],[title]')) {
    for (const a of ['placeholder', 'title']) {
      const v = elm.getAttribute(a);
      if (v && Object.prototype.hasOwnProperty.call(FORGE_EN, v)) elm.setAttribute(a, FORGE_EN[v]);
    }
  }
})(document.body);

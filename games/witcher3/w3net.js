'use strict';
/*
 * Client für das offizielle Debug-Netzwerkprotokoll von The Witcher 3 (REDengine 3).
 * Das Spiel öffnet es selbst, wenn es mit "-net -debugscripts" gestartet wird
 * (TCP 127.0.0.1:37001). Es ist dasselbe Protokoll, das CD Projekts Script Studio,
 * WolvenKit und rusty_witcher_debugger nutzen. Es wird nichts in den Prozess
 * injiziert und keine Spieldatei verändert.
 *
 * Paketaufbau (Big Endian):
 *   DE AD | u16 Gesamtlänge (inkl. Kopf+Ende) | Nutzdaten ... | BE EF
 * Nutzdaten sind getaggte Werte:
 *   81 08 i8 · 81 16 i16 · 81 32 i32 · 71 32 u32 · 81 64 i64
 *   AC 08 <81 16 i16 Länge> UTF-8-Bytes
 *   9C 16 <81 16 i16 Länge> UTF-16BE-Code-Units
 */
const net = require('net');
const { EventEmitter } = require('events');
const { t } = require('../../src/core/i18n');

const PORT_GAME = 37001;
const HEAD = Buffer.from([0xde, 0xad]);
const TAIL = Buffer.from([0xbe, 0xef]);
const TAG = {
  I8: 0x8108, I16: 0x8116, I32: 0x8132, U32: 0x7132, I64: 0x8164, UTF8: 0xac08, UTF16: 0x9c16,
};
const EXEC_MAGIC_1 = 0x12345678;
const EXEC_MAGIC_2 = 0x81160008;
const NAMESPACES = ['ScriptDebugger', 'ScriptProfiler', 'ScriptCompiler', 'scripts', 'Remote', 'Utility', 'Config'];
const FAIL_TEXT = 'Warn: Failed to process command';
const OK_SPAM = 'Spam: Command executed without errors';

// ---------- Encoder ----------
function tagBuf(tag) { const b = Buffer.alloc(2); b.writeUInt16BE(tag); return b; }

function i16(v) { const b = Buffer.alloc(4); b.writeUInt16BE(TAG.I16, 0); b.writeInt16BE(v, 2); return b; }

function i32raw(u) { const b = Buffer.alloc(6); b.writeUInt16BE(TAG.I32, 0); b.writeUInt32BE(u >>> 0, 2); return b; }

function utf8(str) {
  const data = Buffer.from(String(str), 'utf8');
  if (data.length > 0x7fff) throw new Error('String zu lang');
  return Buffer.concat([tagBuf(TAG.UTF8), i16(data.length), data]);
}

function packet(parts) {
  const body = Buffer.concat(parts);
  const len = HEAD.length + 2 + body.length + TAIL.length;
  if (len > 0xffff) throw new Error(t('Paket zu groß'));
  const lenBuf = Buffer.alloc(2); lenBuf.writeUInt16BE(len);
  return Buffer.concat([HEAD, lenBuf, body, TAIL]);
}

const encodeBind = (ns) => packet([utf8('BIND'), utf8(ns)]);
const encodeExec = (cmd) => packet([utf8('Remote'), i32raw(EXEC_MAGIC_1), i32raw(EXEC_MAGIC_2), utf8(cmd)]);

// ---------- Decoder ----------
function decodePayload(buf) {
  const items = [];
  let o = 0;
  const readLen = () => {
    if (buf.readUInt16BE(o) !== TAG.I16) throw new Error(t('Längen-Tag erwartet'));
    const n = buf.readInt16BE(o + 2); o += 4; return n;
  };
  while (o + 2 <= buf.length) {
    const tag = buf.readUInt16BE(o); o += 2;
    switch (tag) {
      case TAG.I8: items.push(buf.readInt8(o)); o += 1; break;
      case TAG.I16: items.push(buf.readInt16BE(o)); o += 2; break;
      case TAG.I32: items.push(buf.readUInt32BE(o)); o += 4; break;
      case TAG.U32: items.push(buf.readUInt32BE(o)); o += 4; break;
      case TAG.I64: items.push(buf.readBigInt64BE(o)); o += 8; break;
      case TAG.UTF8: { const n = readLen(); items.push(buf.toString('utf8', o, o + n)); o += n; break; }
      case TAG.UTF16: {
        const n = readLen();
        const sw = Buffer.from(buf.subarray(o, o + n * 2)); sw.swap16();
        items.push(sw.toString('utf16le')); o += n * 2; break;
      }
      default: items.push({ unknownTag: tag }); return items; // Rest nicht interpretierbar
    }
  }
  return items;
}

class W3Client extends EventEmitter {
  constructor({ host = '127.0.0.1', port = PORT_GAME, timeout = 4000, log = () => {} } = {}) {
    super();
    this.host = host; this.port = port; this.timeout = timeout; this.log = log;
    this.sock = null; this.connected = false; this.buf = Buffer.alloc(0);
    this.pending = []; // FIFO der offenen exec-Antworten
    this.queue = Promise.resolve();
  }

  isConnected() { return this.connected; }

  connect() {
    if (this.connected) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const sock = net.createConnection({ host: this.host, port: this.port });
      const fail = (err) => { sock.destroy(); reject(err); };
      const t = setTimeout(() => fail(new Error('Timeout')), 1500);
      sock.once('error', (e) => { clearTimeout(t); fail(e); });
      sock.once('connect', () => {
        clearTimeout(t);
        sock.removeAllListeners('error');
        sock.setNoDelay(true);
        this.sock = sock; this.connected = true; this.buf = Buffer.alloc(0);
        sock.on('data', (d) => this.onData(d));
        sock.on('error', () => {});
        sock.on('close', () => this.onClose());
        for (const ns of NAMESPACES) sock.write(encodeBind(ns));
        resolve();
      });
    });
  }

  disconnect() {
    if (this.sock) { this.sock.removeAllListeners('close'); this.sock.destroy(); }
    this.onClose();
  }

  onClose() {
    const was = this.connected;
    this.connected = false; this.sock = null;
    for (const p of this.pending.splice(0)) { clearTimeout(p.timer); p.resolve({ ok: false, output: t('Verbindung getrennt') }); }
    if (was) this.emit('close');
  }

  onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    for (;;) {
      const start = this.buf.indexOf(HEAD);
      if (start < 0) { this.buf = Buffer.alloc(0); return; }
      if (start > 0) this.buf = this.buf.subarray(start);
      if (this.buf.length < 4) return;
      const len = this.buf.readUInt16BE(2);
      if (len < 6) { this.buf = this.buf.subarray(2); continue; }
      if (this.buf.length < len) return;
      const pkt = this.buf.subarray(0, len);
      this.buf = this.buf.subarray(len);
      if (pkt[len - 2] !== 0xbe || pkt[len - 1] !== 0xef) continue;
      let items;
      try { items = decodePayload(pkt.subarray(4, len - 2)); } catch (_) { continue; }
      this.onPacket(items);
    }
  }

  onPacket(items) {
    // Antwort auf exec: [0x12345678, 0x81160008, "Text"]
    if (items[0] === EXEC_MAGIC_1 && items[1] === EXEC_MAGIC_2) {
      const text = typeof items[2] === 'string' ? items[2] : '';
      const p = this.pending.shift();
      if (p) {
        clearTimeout(p.timer);
        const ok = text !== FAIL_TEXT;
        p.resolve({ ok, output: text === OK_SPAM ? '' : text.trim() });
      }
      return;
    }
    this.emit('packet', items);
  }

  // Führt eine Exec-Funktion aus (wie in der Entwicklerkonsole). Nacheinander, nie parallel.
  exec(command) {
    const run = () => new Promise((resolve) => {
      if (!this.connected) return resolve({ ok: false, output: t('Nicht verbunden') });
      const entry = { resolve, timer: null };
      entry.timer = setTimeout(() => {
        const i = this.pending.indexOf(entry);
        if (i >= 0) this.pending.splice(i, 1);
        // Manche Befehle (Ladebildschirm, Teleport) antworten spät – zählt trotzdem als gesendet
        resolve({ ok: true, output: t('(keine Antwort – Befehl gesendet)') });
      }, this.timeout);
      this.pending.push(entry);
      try { this.sock.write(encodeExec(command)); } catch (e) {
        clearTimeout(entry.timer); this.pending.pop(); resolve({ ok: false, output: e.message });
      }
    });
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => {});
    return p;
  }
}

module.exports = { W3Client, encodeExec, encodeBind, decodePayload, PORT_GAME, EXEC_MAGIC_1, EXEC_MAGIC_2 };

'use strict';
// Testet den Witcher-3-Protokoll-Client gegen einen lokalen Mock-Server (ohne Spiel).
const assert = require('assert');
const net = require('net');
const { W3Client, encodeExec, encodeBind, decodePayload } = require('../games/witcher3/w3net');

// 1) Byte-Layout exakt wie in der Referenzimplementierung (rusty_witcher_debugger)
const expected = Buffer.from(
  'DEAD0027' +
  'AC0881160006' + Buffer.from('Remote').toString('hex') +
  '813212345678' +
  '813281160008' +
  'AC0881160003' + Buffer.from('god').toString('hex') +
  'BEEF', 'hex');
assert.deepStrictEqual(encodeExec('god'), expected, 'exec-Paket weicht ab');
const bind = encodeBind('Remote');
assert.strictEqual(bind.readUInt16BE(2), bind.length, 'Längenfeld muss Gesamtlänge sein');
assert.deepStrictEqual(decodePayload(bind.subarray(4, -2)), ['BIND', 'Remote']);
console.log('✓ Paket-Kodierung identisch mit Referenz');

// 2) Ende-zu-Ende gegen Mock-Server
function reply(text) {
  const t = Buffer.from(text, 'utf8');
  const body = Buffer.concat([
    Buffer.from('813212345678813281160008', 'hex'),
    Buffer.from('AC088116', 'hex'), Buffer.from([t.length >> 8, t.length & 0xff]), t,
  ]);
  const len = body.length + 6;
  return Buffer.concat([Buffer.from([0xde, 0xad, len >> 8, len & 0xff]), body, Buffer.from([0xbe, 0xef])]);
}

const received = [];
const server = net.createServer((sock) => {
  let buf = Buffer.alloc(0);
  sock.on('data', (d) => {
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 4 && buf.readUInt16BE(2) <= buf.length) {
      const len = buf.readUInt16BE(2);
      const items = decodePayload(buf.subarray(4, len - 2));
      buf = buf.subarray(len);
      received.push(items);
      if (items[0] === 'Remote') {
        const cmd = items[3];
        // Antworten absichtlich in zwei Teilen schicken (TCP-Fragmentierung testen)
        const r = reply(cmd === 'bogus()' ? 'Warn: Failed to process command' : cmd === 'god' ? 'Spam: Command executed without errors' : `ok ${cmd}`);
        sock.write(r.subarray(0, 5));
        setTimeout(() => sock.write(r.subarray(5)), 10);
      }
    }
  });
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  const c = new W3Client({ port, timeout: 1000 });
  await c.connect();
  assert.ok(c.isConnected());
  const [a, b, d] = await Promise.all([c.exec('god'), c.exec('addmoney(1000)'), c.exec('bogus()')]);
  assert.deepStrictEqual(a, { ok: true, output: '' });
  assert.deepStrictEqual(b, { ok: true, output: 'ok addmoney(1000)' });
  assert.strictEqual(d.ok, false);
  const binds = received.filter((r) => r[0] === 'BIND').map((r) => r[1]);
  assert.ok(binds.includes('Remote') && binds.includes('scripts'), 'BIND fehlt');
  console.log('✓ Verbinden, BIND, exec, Antwort-Zuordnung und Fehlererkennung funktionieren');

  let closed = false;
  c.on('close', () => { closed = true; });
  server.close();
  for (const s of [...(server._connections ? [] : [])]) s.destroy();
  c.disconnect();
  assert.ok(!c.isConnected());
  const r = await c.exec('god');
  assert.strictEqual(r.ok, false);
  console.log('✓ Trennung wird sauber erkannt');
  console.log('\nAlle Tests bestanden.');
  process.exit(0);
});

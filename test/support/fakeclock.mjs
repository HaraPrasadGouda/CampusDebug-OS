// TEST-ONLY clock (loaded with `node --import`; never part of the app).
// Reads the wanted "now" (ISO) from FAKE_NOW_FILE; time keeps ticking from it.
import fs from 'node:fs';
const RealDate = Date;
const file = process.env.FAKE_NOW_FILE;
let lastRaw = null, offset = 0;
function off() {
  try {
    const raw = fs.readFileSync(file, 'utf8').trim();
    if (raw !== lastRaw) { lastRaw = raw; offset = raw ? RealDate.parse(raw) - RealDate.now() : 0; }
  } catch { offset = 0; }
  return offset;
}
class FakeDate extends RealDate {
  constructor(...a) { if (a.length === 0) super(RealDate.now() + off()); else super(...a); }
  static now() { return RealDate.now() + off(); }
}
globalThis.Date = FakeDate;
// The HTTP Date header follows the fake clock too (the app's serverNow()
// reads it); Node's own header uses the real clock.
import http from 'node:http';
const _wh = http.ServerResponse.prototype.writeHead;
http.ServerResponse.prototype.writeHead = function (...a) {
  try { if (!this.headersSent && !this.getHeader('date')) this.setHeader('Date', new FakeDate().toUTCString()); } catch {}
  return _wh.apply(this, a);
};

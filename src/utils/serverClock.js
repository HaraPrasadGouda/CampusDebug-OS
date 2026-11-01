/**
 * Server-clock offset, read from the HTTP `Date` header of our own API
 * responses. The rotating day-scholar leave QR carries `issuedAt`, and the
 * gate refuses a QR older than ~60 s — so a phone whose clock is a few
 * minutes off must not make every fresh QR look stale (or a stale one look
 * fresh). Both the student card (signing) and the guard (checking) use
 * serverNow() instead of Date.now(). A small difference (<2 s, the header's
 * 1-second resolution) is ignored.
 */
let offsetMs = 0;

export function noteServerDate(res) {
  try {
    const hdr = res && res.headers && typeof res.headers.get === 'function' ? res.headers.get('Date') : null;
    if (!hdr) return;
    const serverMs = Date.parse(hdr);
    if (!Number.isFinite(serverMs)) return;
    const diff = serverMs + 500 - Date.now(); // header is truncated to the second
    offsetMs = Math.abs(diff) < 2000 ? 0 : diff;
  } catch { /* keep the last offset */ }
}

export function serverNow() {
  return Date.now() + offsetMs;
}

/**
 * CampusDebug OS — gate QR checking on the phone (Fix 5).
 *
 * Gate QRs (hosteller gate pass + day-scholar leave) are now SIGNED ON THE
 * SERVER with a private Ed25519 key that never leaves the server
 * (passSigning.js). This file holds NO secret: the guard phone downloads the
 * PUBLIC key (GET /api/pass-public-key, saved on the phone for offline use)
 * and can only CHECK a QR, never make one. Student phones get ready-signed
 * QRs from POST /api/pass-token (utils/passQr.js).
 *
 * Old QRs (v1: HMAC with a key that shipped inside the app, or the unkeyed
 * FNV fallback) are refused.
 *
 * Verification is pure JavaScript (tweetnacl), so it also works when the app
 * is opened over a LAN IP (no secure context / no crypto.subtle).
 */
import nacl from 'tweetnacl';

// Must match passSigning.js on the server.
export const PASS_QR_DOMAIN = 'CampusDebugOS-GateQR-v2\n';
const PUBLIC_KEY_STORE = 'campus_gate_qr_public_key';

/**
 * Rotating QR timing (hosteller pass AND day-scholar leave). The student
 * phone shows a new QR every LEAVE_QR_ROTATE_MS; the gate (guard phone AND
 * server) refuses one older than LEAVE_QR_MAX_AGE_MS, so a screenshot or a
 * forwarded photo stops working within a minute.
 */
export const LEAVE_QR_ROTATE_MS = 25 * 1000;   // student card shows a new QR
export const LEAVE_QR_MAX_AGE_MS = 60 * 1000;  // gate refuses older than this
export const LEAVE_QR_MAX_FUTURE_MS = 30 * 1000; // allowed clock skew ahead

function b64ToBytes(b64) {
  const bin = atob(b64);
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}
function fromB64(b64) {
  return new TextDecoder().decode(b64ToBytes(b64));
}

function readPublicKey() {
  try {
    const k = JSON.parse(localStorage.getItem(PUBLIC_KEY_STORE) || 'null');
    return k && k.publicKey && k.keyId ? k : null;
  } catch { return null; }
}

/**
 * Download the server's PUBLIC gate key and keep it on the phone, so QRs can
 * be checked with no network. Called by the guard screen when online.
 */
export async function refreshPassPublicKey() {
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), 5000) : null;
    const r = await fetch('/api/pass-public-key', ctl ? { signal: ctl.signal } : undefined);
    if (timer) clearTimeout(timer);
    const j = await r.json();
    if (j?.success && j.publicKey && j.keyId) {
      try {
        localStorage.setItem(PUBLIC_KEY_STORE, JSON.stringify({ publicKey: j.publicKey, keyId: j.keyId, savedAt: Date.now() }));
      } catch { /* storage full / private mode */ }
      return j;
    }
  } catch { /* offline — keep the saved key */ }
  return null;
}

/**
 * REMOVED in Fix 5: phones no longer sign gate passes (the old signing key
 * shipped inside the app, so anyone could forge a pass). The server signs
 * (POST /api/pass-token). Kept only so an old import keeps building; it never
 * signs anything.
 */
export async function generateSignedPassToken() {
  throw new Error('Gate QRs are signed by the server now (POST /api/pass-token).');
}

/**
 * Is a token's issuedAt inside the gate window? nowMs should be the
 * server-corrected clock (utils/serverClock.serverNow). Used for BOTH the
 * hosteller pass QR and the day-scholar leave QR.
 */
export function leaveQrFreshness(payload, nowMs = Date.now()) {
  const t = Date.parse(payload && payload.issuedAt);
  if (!Number.isFinite(t)) return { fresh: false, ageMs: null };
  const ageMs = nowMs - t;
  return { fresh: ageMs <= LEAVE_QR_MAX_AGE_MS && ageMs >= -LEAVE_QR_MAX_FUTURE_MS, ageMs };
}

/**
 * Verify a scanned token on the guard phone (works offline once the public
 * key was downloaded). Freshness (60 s) is checked by the caller.
 * @param {string} rawTokenBase64
 * @returns {Promise<{ valid: boolean, kind?: string, payload?: Object, isExpired?: boolean, message: string }>}
 */
export async function verifySignedPassToken(rawTokenBase64) {
  try {
    const tokenObj = JSON.parse(fromB64(String(rawTokenBase64 || '').trim()));
    if (!tokenObj || tokenObj.v !== 2 || tokenObj.alg !== 'Ed25519' || typeof tokenObj.p !== 'string' || typeof tokenObj.s !== 'string') {
      return { valid: false, message: 'Old or unsigned QR format — not accepted any more. Ask the student to open the app and show the live QR.' };
    }

    let key = readPublicKey();
    // No key yet, or the server's key changed: fetch it (only possible online).
    if ((!key || key.keyId !== tokenObj.kid) && !(typeof navigator !== 'undefined' && navigator.onLine === false)) {
      await refreshPassPublicKey();
      key = readPublicKey();
    }
    if (!key) {
      return { valid: false, message: 'This guard phone has not downloaded the gate key yet — connect it to the internet once, then scan again.' };
    }

    const isSignatureValid = nacl.sign.detached.verify(
      new TextEncoder().encode(PASS_QR_DOMAIN + tokenObj.p),
      b64ToBytes(tokenObj.s),
      b64ToBytes(key.publicKey)
    );
    if (!isSignatureValid) {
      return {
        valid: false,
        message: key.keyId !== tokenObj.kid
          ? 'Signature mismatch: this QR was signed with a different gate key than the one on this phone. Connect the guard phone to the internet once and scan again.'
          : 'Cryptographic signature mismatch! Tampered or counterfeit pass.'
      };
    }

    const payload = JSON.parse(tokenObj.p);

    // Check expiry
    const hasReturnWindow = !!payload.validUntil
      && new Date(payload.validUntil).getTime() > 0;
    const expiryTime = hasReturnWindow ? new Date(payload.validUntil).getTime() : 0;
    const now = Date.now();
    const isExpired = hasReturnWindow && now > expiryTime;

    // Expiry does NOT void a cryptographically genuine token — it must NOT
    // block a RETURN scan. The gate rules: an expired pass can't take a
    // student OUT of campus, but a student standing outside must always be
    // able to come back IN (the scan is then recorded as LATE, with the
    // lateness flag shipped to the staff register). The caller decides
    // using the isExpired flag once the scan direction is known.
    if (isExpired) {
      return {
        valid: true,
        isExpired: true,
        kind: payload.kind || 'PASS',
        payload,
        message: `Signature valid — pass window elapsed (expired ${new Date(payload.validUntil).toLocaleTimeString()}). A return scan will be recorded LATE.`
      };
    }

    return {
      valid: true,
      isExpired: false,
      kind: payload.kind || 'PASS',
      payload,
      message: payload.kind === 'LEAVE'
        ? 'Leave QR verified — gate checks it is live and approved.'
        : 'Cryptographically Verified & Active.'
    };
  } catch (err) {
    return { valid: false, message: 'Malformed QR token: ' + err.message };
  }
}

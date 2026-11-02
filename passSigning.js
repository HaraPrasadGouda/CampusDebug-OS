/**
 * CampusDebug OS — gate QR signing (server side only).
 *
 * Gate QRs (hosteller gate pass + day-scholar leave) are signed HERE with an
 * Ed25519 PRIVATE key that never leaves the server. Phones only ever get the
 * PUBLIC key (GET /api/pass-public-key), which can check a QR but cannot make
 * one — so reading the app bundle no longer lets anyone forge a pass.
 *
 * Key: PASS_SIGNING_PRIVATE_KEY in .env (base64 PKCS#8 DER, or a PEM block).
 * Make one with:  node scripts/genPassKeys.js
 *
 * QR token (v2) = base64( JSON { v: 2, alg: 'Ed25519', kid, p, s } )
 *   p   = the payload as a JSON string (signed exactly as sent, no re-ordering)
 *   s   = base64 Ed25519 signature over  PASS_QR_DOMAIN + p
 *   kid = short id of the public key (lets a phone notice a changed key)
 */
import crypto from 'crypto';

export const PASS_QR_DOMAIN = 'CampusDebugOS-GateQR-v2\n';
export const PASS_QR_ROTATE_MS = 25 * 1000;     // student phone shows a new QR
export const PASS_QR_MAX_AGE_MS = 60 * 1000;    // gate refuses older than this
export const PASS_QR_MAX_FUTURE_MS = 30 * 1000; // allowed clock skew ahead
// Tokens handed out per request: the current one + the next ones, each with
// its own issuedAt 25 s apart, so the QR keeps rotating if the student's
// phone loses network. 36 × 25 s = 15 min.
export const PASS_QR_BATCH = 36;

let privateKey = null;
let publicKey = null;
let publicKeyB64 = '';
let keyId = '';
let temporaryKey = false;

const HOW_TO = [
    '   Fix: run   node scripts/genPassKeys.js',
    '   and copy the PASS_SIGNING_PRIVATE_KEY=... line it prints into your .env',
    '   (give teammates the SAME value, then restart the server).'
].join('\n');

export function initPassSigning() {
    const raw = String(process.env.PASS_SIGNING_PRIVATE_KEY || '').trim();
    privateKey = null;
    temporaryKey = false;
    if (raw) {
        try {
            const k = raw.includes('-----BEGIN')
                ? crypto.createPrivateKey(raw.replace(/\\n/g, '\n'))
                : crypto.createPrivateKey({ key: Buffer.from(raw, 'base64'), format: 'der', type: 'pkcs8' });
            if (k.asymmetricKeyType !== 'ed25519') throw new Error(`it is a ${k.asymmetricKeyType} key, an Ed25519 key is needed`);
            privateKey = k;
        } catch (e) {
            console.error(`❌ PASS_SIGNING_PRIVATE_KEY in .env could not be read (${e.message}).\n${HOW_TO}`);
        }
    } else {
        console.error(`❌ PASS_SIGNING_PRIVATE_KEY is not set in .env — gate QRs need it.\n${HOW_TO}`);
    }
    if (!privateKey) {
        // Keep the app usable: a throw-away key for THIS run only. QRs still
        // work while the server stays up, but the key changes on every
        // restart (guard phones re-download it when online).
        privateKey = crypto.generateKeyPairSync('ed25519').privateKey;
        temporaryKey = true;
        console.error('⚠️  Using a TEMPORARY gate QR key until the server restarts. Offline guard phones need to go online once after every restart. Set PASS_SIGNING_PRIVATE_KEY to fix this.');
    }
    publicKey = crypto.createPublicKey(privateKey);
    const rawPub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
    publicKeyB64 = rawPub.toString('base64');
    keyId = crypto.createHash('sha256').update(rawPub).digest('hex').slice(0, 8);
    if (!temporaryKey) console.log(`🔏 Gate QR signing key loaded (Ed25519, key id ${keyId})`);
    return { keyId, temporary: temporaryKey };
}

export function passPublicKeyInfo() {
    if (!publicKey) initPassSigning();
    return { alg: 'Ed25519', keyId, publicKey: publicKeyB64, temporary: temporaryKey };
}

export function signPassQr(payload) {
    if (!privateKey) initPassSigning();
    const p = JSON.stringify(payload);
    const s = crypto.sign(null, Buffer.from(PASS_QR_DOMAIN + p, 'utf8'), privateKey).toString('base64');
    return Buffer.from(JSON.stringify({ v: 2, alg: 'Ed25519', kid: keyId, p, s }), 'utf8').toString('base64');
}

/**
 * Check a scanned QR token. Returns { ok: true, payload } or
 * { ok: false, reason }. Old v1 tokens (HMAC key that shipped in the app,
 * or the unkeyed FNV fallback) are refused.
 */
export function verifyPassQr(rawToken) {
    if (!publicKey) initPassSigning();
    if (!String(rawToken || '').trim()) {
        return { ok: false, reason: 'Signed QR missing in this scan — reload the guard app (new version) and scan the live QR again. Nothing recorded.' };
    }
    let obj;
    try {
        obj = JSON.parse(Buffer.from(String(rawToken || '').trim(), 'base64').toString('utf8'));
    } catch {
        return { ok: false, reason: 'Malformed QR token. Nothing recorded.' };
    }
    if (!obj || obj.v !== 2 || obj.alg !== 'Ed25519' || typeof obj.p !== 'string' || typeof obj.s !== 'string') {
        return { ok: false, oldFormat: true, reason: 'Old or unsigned QR format — not accepted any more. Ask the student to open the app and show the live QR. Nothing recorded.' };
    }
    let good = false;
    try {
        good = crypto.verify(null, Buffer.from(PASS_QR_DOMAIN + obj.p, 'utf8'), publicKey, Buffer.from(obj.s, 'base64'));
    } catch { good = false; }
    if (!good) return { ok: false, reason: 'QR signature is not valid (forged, tampered, or signed with another key). Nothing recorded.' };
    try {
        return { ok: true, payload: JSON.parse(obj.p) };
    } catch {
        return { ok: false, reason: 'Malformed QR payload. Nothing recorded.' };
    }
}

/** Is issuedAt inside the gate window, judged at refMs? */
export function passQrFresh(payload, refMs = Date.now()) {
    const t = Date.parse(payload && payload.issuedAt);
    if (!Number.isFinite(t)) return false;
    const age = refMs - t;
    return age <= PASS_QR_MAX_AGE_MS && age >= -PASS_QR_MAX_FUTURE_MS;
}

/** A batch of tokens for one pass/leave: now, now+25 s, now+50 s, … */
export function signPassQrBatch(basePayload, count = PASS_QR_BATCH, nowMs = Date.now()) {
    const n = Math.max(1, Math.min(PASS_QR_BATCH, Number(count) || PASS_QR_BATCH));
    const out = [];
    for (let i = 0; i < n; i++) {
        const issuedAt = new Date(nowMs + i * PASS_QR_ROTATE_MS).toISOString();
        out.push({ issuedAt, token: signPassQr({ ...basePayload, issuedAt }) });
    }
    return out;
}

/**
 * Offline-token decoder/verifier (debug tool).
 * Usage: node scripts/decodeToken.cjs <base64-token-from-QR>
 * Prints the decoded payload and whether the HMAC matches the campus seed.
 */
const crypto = require('crypto');
require('dotenv').config();
// Signing key comes from .env (same HMAC_SECRET the server uses).
const SEED = process.env.HMAC_SECRET || '';
if (!SEED) console.warn('⚠️ HMAC_SECRET missing in .env — signature check will always fail.');

const raw = process.argv[2] || '';
if (!raw.trim()) {
  console.log('Paste the full base64 token from the QR (Guard Scanner "Direct Base64 Token Verification" box).');
  process.exit(1);
}

function recomputeSig(payload) {
  const canonical = JSON.stringify({
    passId: payload.passId,
    studentId: payload.studentId,
    rollNo: payload.rollNo,
    destination: payload.destination,
    reason: payload.reason,
    validUntil: payload.validUntil,
    issuedAt: payload.issuedAt
  });
  return crypto.createHmac('sha256', SEED).update(canonical).digest('hex');
}

(async () => {
  try {
    const obj = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
    const p = obj.payload || {};
    console.log('--- decoded token ---');
    console.log(JSON.stringify({ ...p, signature: (p.signature || '').slice(0, 16) + '…' }, null, 2));
    const sig = recomputeSig(p);
    const match = sig === p.signature;
    console.log('--- validation ---');
    console.log('signature match :', match, '(' + sig.slice(0, 16) + '… vs ' + (p.signature || 'NONE').slice(0, 16) + '…)');
    if (p.validUntil) {
      const exp = new Date(p.validUntil).getTime();
      console.log('validUntil      :', p.validUntil, '→', exp > Date.now() ? 'STILL VALID' : 'EXPIRED ' + Math.round((Date.now() - exp) / 60000) + ' min ago');
    } else {
      console.log('validUntil      : MISSING');
    }
  } catch (e) {
    console.log('❌ Not a valid CampusDebug token (base64/JSON decode failed):', e.message);
    console.log('Received length:', raw.length, 'first chars:', raw.slice(0, 40));
  }
})();
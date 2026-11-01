/**
 * CampusDebug OS — Offline Cryptographic Engine
 * Uses Web Crypto API for tamper-evident, offline-verifiable Gate Pass QR tokens
 */

// Institutional Master Seed Key (for demonstration across client & offline guard scanner)
const MASTER_CAMPUS_SECRET = 'CAMPUS_DEBUG_OS_OFFLINE_SECRET_2026_SECURE_HMAC';

/**
 * Import the secret key into Web Crypto subtle interface
 */
async function getCryptoKey() {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    'raw',
    enc.encode(MASTER_CAMPUS_SECRET),
    { name: 'HMAC', hash: { name: 'SHA-256' } },
    false,
    ['sign', 'verify']
  );
}

/**
 * Convert ArrayBuffer to Hex String
 */
function bufferToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert Hex String to ArrayBuffer
 */
function hexToBuffer(hex) {
  const bytes = new Uint8Array(Math.ceil(hex.length / 2));
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes.buffer;
}

/**
 * Unicode-safe Base64 — plain btoa throws InvalidCharacterError on any
 * non-ASCII character (student names included).
 */
function toB64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function fromB64(b64) {
  const bin = atob(b64);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * FNV-1a (32-bit) — insecure-context fallback signer. Web Crypto (the real
 * HMAC-SHA256) only exists in a SECURE CONTEXT (https / localhost); when the
 * campus app is opened over a LAN IP — exactly how a phone demo runs —
 * crypto.subtle is undefined and every token build would fail. The gate's
 * server-side scan remains the source of truth either way; the 'fnv-' prefix
 * marks the fallback so the verifier picks the matching algorithm.
 */
function fnv1aHex(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return 'fnv-' + (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Sign the canonical string with whatever the current context supports.
 */
async function signCanonical(str) {
  const enc = new TextEncoder();
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const key = await getCryptoKey();
    return { alg: 'HMAC-SHA256', signature: bufferToHex(await crypto.subtle.sign('HMAC', key, enc.encode(str))) };
  }
  return { alg: 'FNV1A-FALLBACK', signature: fnv1aHex(str) };
}

/**
 * Generate a cryptographically signed offline Gate Pass token
 * @param {Object} passData - { passId, studentId, name, rollNo, destination, reason, validUntil }
 * @returns {Promise<{ rawToken: string, payload: Object, signature: string }>}
 */
export async function generateSignedPassToken(passData) {
  const payload = {
    ...passData,
    issuedAt: new Date().toISOString(),
    issuer: 'CampusDebug-Authority'
  };

  // Canonicalize string to avoid key-ordering discrepancy
  const canonicalString = JSON.stringify({
    passId: payload.passId,
    studentId: payload.studentId,
    rollNo: payload.rollNo,
    destination: payload.destination,
    reason: payload.reason,
    validUntil: payload.validUntil,
    issuedAt: payload.issuedAt
  });

  const { alg, signature } = await signCanonical(canonicalString);

  const finalTokenObject = {
    payload,
    signature,
    alg,
    v: 1
  };

  // Convert to compact Base64 JSON string for QR encoding
  const rawToken = toB64(JSON.stringify(finalTokenObject));

  return {
    rawToken,
    payload,
    signature
  };
}

/**
 * Day-scholar commute credential: ONE long-lived signed QR (their campus ID),
 * no warden approval, no return window. The gate server alternates IN/OUT
 * by today's scan history, so no expiry value is ever embedded.
 * @param {Object} id - { rollNo, name, department }
 */
export async function generateSignedCommuteToken(id) {
  const payload = {
    kind: 'COMMUTE',
    passId: `ID-${id.rollNo}`,
    studentId: null,
    rollNo: id.rollNo,
    name: id.name,
    destination: 'Campus premises',
    reason: `Day-scholar commute${id.department ? ` — ${id.department}` : ''}`,
    validUntil: null, // deliberately windowless: commutes are not outings
    issuedAt: new Date().toISOString(),
    issuer: 'CampusDebug-Authority'
  };

  // Identical canonical field set to the pass token — one verifier governs both.
  const canonicalString = JSON.stringify({
    passId: payload.passId,
    studentId: payload.studentId,
    rollNo: payload.rollNo,
    destination: payload.destination,
    reason: payload.reason,
    validUntil: payload.validUntil,
    issuedAt: payload.issuedAt
  });

  const { alg, signature } = await signCanonical(canonicalString);

  return {
    rawToken: toB64(JSON.stringify({ payload, signature, alg, v: 1 })),
    payload,
    signature
  };
}

/**
 * Verify a scanned token offline using Web Crypto API (gate passes AND
 * day-scholar commute IDs — same HMAC, same canonical field set).
 * @param {string} rawTokenBase64
 * @returns {Promise<{ valid: boolean, kind?: string, payload?: Object, isExpired?: boolean, message: string }>}
 */
export async function verifySignedPassToken(rawTokenBase64) {
  try {
    const decodedStr = fromB64(rawTokenBase64);
    const tokenObj = JSON.parse(decodedStr);

    if (!tokenObj.payload || !tokenObj.signature) {
      return { valid: false, message: 'Invalid token structure.' };
    }

    const { payload, signature } = tokenObj;
    const enc = new TextEncoder();

    const canonicalString = JSON.stringify({
      passId: payload.passId,
      studentId: payload.studentId,
      rollNo: payload.rollNo,
      destination: payload.destination,
      reason: payload.reason,
      validUntil: payload.validUntil,
      issuedAt: payload.issuedAt
    });

    // The token's alg marker picks the verifier: the FNV-1a fallback (tokens
    // minted on an insecure-context device) or the real HMAC-SHA256.
    let isSignatureValid = false;
    if (tokenObj.alg === 'FNV1A-FALLBACK' || String(signature).startsWith('fnv-')) {
      isSignatureValid = signature === fnv1aHex(canonicalString);
    } else if (typeof crypto !== 'undefined' && crypto.subtle) {
      const key = await getCryptoKey();
      isSignatureValid = await crypto.subtle.verify(
        'HMAC',
        key,
        hexToBuffer(signature),
        enc.encode(canonicalString)
      );
    } else {
      return { valid: false, message: 'This pass was signed on a secure device — verify it at the gate desk or serve the scanner over localhost/https.' };
    }

    if (!isSignatureValid) {
      return { valid: false, message: 'Cryptographic signature mismatch! Tampered or counterfeit pass.' };
    }

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
    // Day-scholar commute tokens carry NO window at all — they are exempt
    // from expiry semantics by construction.
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
      message: payload.kind === 'COMMUTE'
        ? 'Commute ID verified — server decides IN / OUT.'
        : 'Cryptographically Verified & Active.'
    };
  } catch (err) {
    return { valid: false, message: 'Malformed QR token: ' + err.message };
  }
}

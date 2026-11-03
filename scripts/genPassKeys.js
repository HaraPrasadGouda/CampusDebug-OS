#!/usr/bin/env node
/**
 * Prints a NEW Ed25519 key pair for gate QR signing (Fix 5).
 *
 *   node scripts/genPassKeys.js
 *
 * Copy the PASS_SIGNING_PRIVATE_KEY=... line into your .env (one line, no
 * quotes) and give teammates the SAME value. Keep it secret: anyone with it
 * can make valid gate passes. Never commit it. The public key is printed only
 * for reference — the server hands it to guard phones by itself.
 * This script prints to the screen only; it writes no file.
 */
import crypto from 'crypto';

const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const priv = privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64');
const rawPub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
const keyId = crypto.createHash('sha256').update(rawPub).digest('hex').slice(0, 8);

console.log('# Gate QR signing key (Ed25519) — put this line in .env, keep it secret:');
console.log(`PASS_SIGNING_PRIVATE_KEY=${priv}`);
console.log('');
console.log(`# Public key (safe to share, served at /api/pass-public-key): ${rawPub.toString('base64')}`);
console.log(`# Key id: ${keyId}`);

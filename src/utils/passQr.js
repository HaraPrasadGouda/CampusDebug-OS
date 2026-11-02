/**
 * Student side of the rotating gate QR (Fix 5) — hosteller gate pass AND
 * day-scholar leave.
 *
 * The phone no longer signs anything. While online it asks the server
 * (POST /api/pass-token, login required, only for the student's OWN approved
 * pass / leave) for a small batch of ready-signed QRs: the current one plus
 * the next ones, each with its own issuedAt 25 s apart (~60 min in total).
 * The batch is kept on the phone, so the QR keeps changing every 25 s even if
 * the network drops at the gate. While online the batch is refreshed every
 * 2 minutes and the moment the network comes back.
 */
import { useEffect, useState } from 'react';
import { noteServerDate, serverNow } from './serverClock';
import { getAccessToken } from './authClient';
import { LEAVE_QR_ROTATE_MS } from './crypto';

const STORE_KEY = 'campus_gate_qr_batches';
const REFRESH_MS = 2 * 60 * 1000;
// Show a QR only while it is at most 50 s old (the gate accepts 60 s), so a
// QR on screen always has a few seconds of life left when it is scanned.
const SHOW_MAX_AGE_MS = 50 * 1000;

function readStore() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; } catch { return {}; }
}
function writeStore(st) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(st)); } catch { /* storage full / private mode */ }
}
function live(list, now) {
  return (Array.isArray(list) ? list : []).filter(t => t && t.token && Date.parse(t.issuedAt) + SHOW_MAX_AGE_MS > now);
}
function saveBatch(key, tokens) {
  const now = serverNow();
  const st = readStore();
  for (const k of Object.keys(st)) { st[k] = live(st[k], now); if (!st[k].length) delete st[k]; }
  st[key] = live(tokens, now);
  writeStore(st);
}
function dropBatch(key) {
  const st = readStore();
  delete st[key];
  writeStore(st);
}

/** The QR to show right now: the newest one whose issuedAt has arrived. */
export function pickQrToken(list, now = serverNow()) {
  let best = null;
  for (const t of live(list, now)) {
    const ms = Date.parse(t.issuedAt);
    if (ms <= now + 2000 && (!best || ms > best.ms)) best = { ...t, ms };
  }
  return best;
}

export async function fetchQrBatch(kind, id) {
  const tok = getAccessToken();
  const r = await fetch('/api/pass-token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
    body: JSON.stringify({ kind, id })
  });
  noteServerDate(r);
  let j = null;
  try { j = await r.json(); } catch { /* not JSON */ }
  if (r.ok && j?.success && Array.isArray(j.tokens)) {
    saveBatch(`${kind}:${id}`, j.tokens);
    return { ok: true, tokens: j.tokens };
  }
  return { ok: false, status: r.status, error: j?.reason || j?.error || `Server answered ${r.status}` };
}

/**
 * React hook: the live QR for one pass/leave.
 * stage: IDLE | LOADING | READY | OFFLINE (no usable QR saved, no network)
 *        | DENIED (server says this pass/leave has no gate QR)
 */
export function useRotatingQr(kind, id, enabled = true) {
  const key = `${kind}:${id}`;
  const [list, setList] = useState([]);
  const [stage, setStage] = useState('IDLE');
  const [denyReason, setDenyReason] = useState('');
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!enabled || !id) { setList([]); setStage('IDLE'); setDenyReason(''); return undefined; }
    let alive = true;
    setList(readStore()[key] || []);
    setStage('LOADING');
    setDenyReason('');
    const load = async () => {
      try {
        const res = await fetchQrBatch(kind, id);
        if (!alive) return;
        if (res.ok) { setList(res.tokens); setStage('READY'); }
        else if (res.status === 403 || res.status === 404) {
          dropBatch(key); setList([]); setStage('DENIED'); setDenyReason(res.error);
        } else setStage('OFFLINE'); // server trouble: keep the saved batch
      } catch {
        if (alive) setStage('OFFLINE'); // no network: keep the saved batch
      }
    };
    load();
    const iv = setInterval(load, REFRESH_MS);
    const tick = setInterval(() => setTick(t => t + 1), 1000);
    const onOnline = () => load();
    window.addEventListener('online', onOnline);
    return () => { alive = false; clearInterval(iv); clearInterval(tick); window.removeEventListener('online', onOnline); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  const now = serverNow();
  const cur = stage === 'DENIED' ? null : pickQrToken(list, now);
  return {
    token: cur ? cur.token : null,
    // seconds until the next QR replaces this one
    secondsLeft: cur ? Math.max(1, Math.ceil((cur.ms + LEAVE_QR_ROTATE_MS - now) / 1000)) : 0,
    stage: cur ? 'READY' : (stage === 'READY' ? 'OFFLINE' : stage),
    denyReason
  };
}

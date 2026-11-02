/**
 * GUARD PHONE — OFFLINE DAY-SCHOLAR LEAVE CHECK.
 * Whenever the guard app is online it downloads today's mentor-APPROVED,
 * not-yet-scanned day-scholar leaves (GET /api/leave-scan/approved) and keeps
 * them here. With no network, a signed + fresh leave QR whose leave id is in
 * this list is let out ONCE on this phone; the exit waits in the outbox and
 * the server re-checks it when the phone is back online.
 * localStorage (not a new IndexedDB store) so the shared DB version stays as is.
 */
import { normalizePassNumber } from './passNumber';

const LIST_KEY = 'campus_guard_leave_list';
const PASS_CACHE_KEY = 'campus_guard_pass_cache';
const USED_KEY = 'campus_guard_leave_used';

const readJson = (key, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v ?? fallback; } catch { return fallback; }
};
const writeJson = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage full / private mode */ }
};
const dayStartMs = (ms = Date.now()) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

export async function refreshApprovedLeaves() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  try {
    const r = await fetch('/api/leave-scan/approved');
    if (!r.ok) return null;
    const j = await r.json();
    if (!j?.success || !Array.isArray(j.leaves)) return null;
    const snap = { fetchedAt: Date.now(), gateCloseAt: j.gateCloseAt || null, leaves: j.leaves };
    writeJson(LIST_KEY, snap);
    return snap;
  } catch { return null; }
}

export function getCachedApprovedLeaves() {
  return readJson(LIST_KEY, null);
}

export function getUsedLeaves() {
  return readJson(USED_KEY, {});
}

export function markLeaveUsedLocally(leaveId, info) {
  const used = getUsedLeaves();
  used[String(leaveId)] = { ...(used[String(leaveId)] || {}), ...info };
  // Keep the last 2 days only.
  const cutoff = dayStartMs() - 24 * 3600e3;
  for (const [k, v] of Object.entries(used)) {
    if (!v?.scannedAt || Date.parse(v.scannedAt) < cutoff) delete used[k];
  }
  writeJson(USED_KEY, used);
  return used[String(leaveId)];
}

/**
 * Can this (already signature-checked, already fresh) leave QR go out
 * offline on this phone? Returns { ok, reason }.
 */
export function checkLeaveOffline(payload, nowMs = Date.now()) {
  const leaveId = String(payload?.leaveId || '');
  const roll = String(payload?.rollNo || '').trim().toLowerCase();
  const used = getUsedLeaves()[leaveId];
  if (used) {
    const at = used.scannedAt ? new Date(used.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return { ok: false, reasonKind: 'state', reason: `${payload?.name || 'Student'} — this leave QR was already used at this gate${at ? ` at ${at}` : ''}. One-way leave, no second scan. Nothing recorded.` };
  }
  const snap = getCachedApprovedLeaves();
  if (!snap || !Array.isArray(snap.leaves) || !snap.fetchedAt || snap.fetchedAt < dayStartMs(nowMs)) {
    return { ok: false, reasonKind: 'state', reason: "Offline — this phone has no approved-leave list for today yet. Connect the guard phone to the internet once (it downloads the list), then scan again. Nothing recorded." };
  }
  if (snap.gateCloseAt && nowMs >= Date.parse(snap.gateCloseAt) && Date.parse(snap.gateCloseAt) >= dayStartMs(nowMs)) {
    return { ok: false, reasonKind: 'state', reason: `${payload?.name || 'Student'} — leave gate closed for today (approved leaves expire at gate close). Nothing recorded.` };
  }
  const hit = snap.leaves.find(l => String(l.id) === leaveId);
  if (!hit || String(hit.rollNo || '').trim().toLowerCase() !== roll) {
    const at = new Date(snap.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return { ok: false, reasonKind: 'state', reason: `${payload?.name || 'Student'} — NOT APPROVED in this phone's offline list (last updated ${at}). If the mentor approved it after that, connect to the internet and scan again. Nothing recorded.` };
  }
  return { ok: true, leave: hit };
}

/**
 * MANUAL PASS-NUMBER ENTRY OFFLINE (same phone list idea as above).
 * When online the guard phone also keeps ONLY approved, not-yet-used hostel
 * gate passes (GP-…) and day-scholar leaves (LV-…): number, name, roll,
 * branch, destination/reason, valid till. GET /api/guard/pass-cache (GUARD only).
 * One-time use on this phone uses the same "used" record as leave QR scans.
 */
export async function refreshGuardPassCache() {
  if (typeof navigator !== 'undefined' && !navigator.onLine) return null;
  try {
    const r = await fetch('/api/guard/pass-cache');
    if (!r.ok) return null;
    const j = await r.json();
    if (!j?.success || !Array.isArray(j.passes)) return null;
    const snap = { fetchedAt: Date.now(), gateCloseAt: j.gateCloseAt || null, passes: j.passes };
    writeJson(PASS_CACHE_KEY, snap);
    return snap;
  } catch { return null; }
}

export function getGuardPassCache() {
  return readJson(PASS_CACHE_KEY, null);
}

// Key in the shared one-time-use record: leave id for a leave (so a leave QR
// scan and a typed LV- number count as the SAME use), pass number for a pass.
export const usedKeyFor = (entry) => String(entry?.kind === 'LEAVE' ? entry.leaveId : entry?.number);

/** Typed number, no network: { ok, entry } or { ok:false, reason }. */
export function checkPassNumberOffline(input, nowMs = Date.now()) {
  const number = normalizePassNumber(input);
  if (!/^(GP-\d{6}|LV-[A-Z0-9]{1,12})$/.test(number)) {
    return { ok: false, reason: 'Enter the pass number (e.g. GP-984163 or LV-3F9A2C).' };
  }
  const snap = getGuardPassCache();
  if (!snap || !Array.isArray(snap.passes) || !snap.fetchedAt || snap.fetchedAt < dayStartMs(nowMs)) {
    return { ok: false, reason: 'Offline — this phone has no pass list for today yet. Connect the guard phone to the internet once (it downloads the list), then try again. Nothing recorded.' };
  }
  const at = new Date(snap.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const hits = snap.passes.filter(p => normalizePassNumber(p.number) === number);
  if (hits.length !== 1) {
    return { ok: false, reason: hits.length > 1
      ? `${number} matches two passes in this phone's list — scan the QR or wait for internet. Nothing recorded.`
      : `${number} — NOT FOUND in this phone's offline list (approved, not-yet-used passes only; last updated ${at}). Do not let the student out on this number. If it was approved just now, connect to the internet and try again. Nothing recorded.` };
  }
  const entry = hits[0];
  const used = getUsedLeaves()[usedKeyFor(entry)];
  if (used) {
    const t = used.scannedAt ? new Date(used.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    return { ok: false, entry, reason: `${entry.name || 'Student'} — ${number} was already used at this gate${t ? ` at ${t}` : ''}. One exit only. Nothing recorded.` };
  }
  const till = Date.parse(entry.validUntil || '');
  if (Number.isFinite(till) && nowMs > till) {
    return { ok: false, entry, reason: `${entry.name || 'Student'} — ${number} expired at ${new Date(till).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Cannot permit exit. Nothing recorded.` };
  }
  return { ok: true, entry, fetchedAt: snap.fetchedAt };
}

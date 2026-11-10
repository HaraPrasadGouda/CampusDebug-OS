// Warden complaint card — pure helpers (server + UI + tests share them).
// Nothing here reads the network or the DOM. Phone numbers are NOT added here:
// the server already keeps technician phones off student payloads
// (studentSafeTicket); the warden card reads them from the staff payload.

export const OVERDUE_AFTER_HOURS = 12;
export const OVERDUE_AFTER_MS = OVERDUE_AFTER_HOURS * 3600 * 1000;

const CLOSED_STATUSES = ['RESOLVED', 'CLOSED'];

// The moment a student filed the complaint (ISO or ms), or null. This is the
// clock for the 12-hour rule: it starts at filing, not at assignment or at the
// warden's call.
export function filedAtMs(ticket) {
  const raw = ticket?.created_at ?? ticket?.reportedAt ?? ticket?.createdAt ?? ticket?.createdAtMs ?? null;
  if (!raw) return null;
  const ms = typeof raw === 'number' ? raw : new Date(raw).getTime();
  return Number.isFinite(ms) && ms > 0 ? ms : null;
}

// Resolved by the student, closed by the warden, or in a resolved status.
export function isComplaintDone(ticket) {
  const status = String(ticket?.status || '').toUpperCase();
  return !!(ticket?.studentResolvedAt || ticket?.student_resolved_at || ticket?.closedAt || ticket?.closed_at)
    || CLOSED_STATUSES.includes(status);
}

// Needs-you rule: a complaint still open 12 hours after the student filed it.
// Returns { overdue, hours } (hours = hours since filing). Resolved or closed
// complaints never flag; a complaint with no readable filing time never flags.
export function overdueState(ticket, now = Date.now()) {
  const at = filedAtMs(ticket);
  if (!at || isComplaintDone(ticket)) return { overdue: false, hours: null };
  const elapsed = now - at;
  return { overdue: elapsed >= OVERDUE_AFTER_MS, hours: Math.max(0, elapsed / 3600000) };
}

// Admin rule: a complaint still open 48 hours after the student filed it is
// escalated to the admin dashboard. Same filing clock as the 12-hour rule.
// Returns { escalated, hours } (hours = hours since filing).
export const ADMIN_ESCALATE_AFTER_HOURS = 48;
export const ADMIN_ESCALATE_AFTER_MS = ADMIN_ESCALATE_AFTER_HOURS * 3600 * 1000;
export function adminEscalationState(ticket, now = Date.now()) {
  const at = filedAtMs(ticket);
  if (!at || isComplaintDone(ticket)) return { escalated: false, hours: null };
  const elapsed = now - at;
  return { escalated: elapsed >= ADMIN_ESCALATE_AFTER_MS, hours: Math.max(0, elapsed / 3600000) };
}

// Once-only warden push decision (pure). True when the complaint has just
// crossed the 12-hour line and no push has been recorded for it yet.
// `pushedAt` is the ISO time a push was already sent (null/undefined if none).
export function shouldSendOverduePush(ticket, pushedAt, now = Date.now()) {
  if (pushedAt) return false;
  return overdueState(ticket, now).overdue;
}

// Text of the warden push for one overdue complaint. No phone numbers here.
export function overduePushPayload(ticket) {
  const place = complaintPlace(ticket?.location);
  const where = [place.block, place.room ? `Room ${place.room}` : ''].filter(Boolean).join(', ') || 'hostel';
  const category = String(ticket?.category || 'Complaint');
  return {
    title: `${OVERDUE_AFTER_HOURS}h passed: ${category} not resolved`,
    body: `${category} complaint from ${where} was filed ${OVERDUE_AFTER_HOURS} hours ago and is still open. Open the Needs-you list to call the technician.`,
  };
}

// "Hostel Block B, Room 101" -> { block: "Block B", room: "101" }.
// Anything it cannot read stays '' (never invented).
export function complaintPlace(location) {
  const loc = String(location || '');
  const blk = (/Hostel\s+([^,]+)/i.exec(loc) || [])[1] || (/Block\s+([A-Za-z0-9]+)/i.exec(loc) || [])[1] || '';
  const room = (/Room\s+([^,]+)/i.exec(loc) || [])[1] || '';
  const b = blk.trim().replace(/^block\s*/i, '');
  return { block: b ? `Block ${b}` : '', room: room.trim() };
}

// The warden card's fields, in one place: category, technician name + role,
// block and room, problem text, filing time, overdue flag. The phone is
// returned as-is from the technician object (warden payload only).
export function wardenCardFields(ticket, now = Date.now()) {
  const place = complaintPlace(ticket?.location);
  const tech = ticket?.technician || null;
  const { overdue, hours } = overdueState(ticket, now);
  return {
    category: ticket?.category || 'Issue',
    technicianName: tech?.name || ticket?.assignedTo || null,
    technicianRole: tech?.role || null,
    technicianPhone: tech?.phone || null,
    block: place.block,
    room: place.room,
    problem: String(ticket?.description || ticket?.raw_text || ticket?.complaintText || '').trim(),
    filedAt: filedAtMs(ticket),
    overdue,
    overdueHours: hours,
  };
}

// Cluster view (minimal): open complaints grouped by category + block.
// Only groups with at least `min` open complaints are returned, biggest first.
// Complaints with no readable block are not grouped.
export function openComplaintClusters(tickets = [], { min = 2 } = {}) {
  const groups = new Map();
  for (const t of tickets || []) {
    if (isComplaintDone(t)) continue;
    const { block } = complaintPlace(t.location);
    if (!block) continue;
    const category = String(t.category || 'Issue').trim();
    const key = `${category.toLowerCase()}|${block.toLowerCase()}`;
    const g = groups.get(key) || { key, category, block, count: 0, ids: [] };
    g.count += 1;
    g.ids.push(String(t.id ?? t.shortCode ?? g.count));
    groups.set(key, g);
  }
  return [...groups.values()].filter(g => g.count >= min).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

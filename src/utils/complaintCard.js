// Warden complaint card — pure helpers (server + UI + tests share them).
// Nothing here reads the network or the DOM. Phone numbers are NOT added here:
// the server already keeps technician phones off student payloads
// (studentSafeTicket); the warden card reads them from the staff payload.

export const OVERDUE_AFTER_HOURS = 12;
export const OVERDUE_AFTER_MS = OVERDUE_AFTER_HOURS * 3600 * 1000;

const CLOSED_STATUSES = ['RESOLVED', 'CLOSED'];

// The moment a complaint was handed to its technician (ISO or ms), or null.
export function assignedAtMs(ticket) {
  const raw = ticket?.assignedAt ?? ticket?.assigned_at ?? null;
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

// Needs-you rule: assigned to a technician, not resolved within 12 hours of
// assignment. Returns { overdue, hours } (hours = hours since assignment).
export function overdueState(ticket, now = Date.now()) {
  const at = assignedAtMs(ticket);
  if (!at || isComplaintDone(ticket)) return { overdue: false, hours: null };
  const elapsed = now - at;
  return { overdue: elapsed >= OVERDUE_AFTER_MS, hours: Math.max(0, elapsed / 3600000) };
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
// block and room, problem text, assigned time, overdue flag. The phone is
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
    assignedAt: assignedAtMs(ticket),
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

/**
 * DAY-SCHOLAR LEAVE — one shared reading of "which of today's leaves is the
 * active one". Used by BOTH the Leave modal and the dashboard's Active Gate
 * Pass card, so the two can never disagree about the state.
 * Precedence (unchanged from the modal): PENDING → APPROVED-not-scanned →
 * OUT → REJECTED/EXPIRED. Only leaves created today (local time) count.
 */
export function pickTodaysLeave(leaves = [], now = new Date()) {
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const todays = (leaves || []).filter(l => l && l.created_at && new Date(l.created_at) >= todayStart);
  const pending = todays.find(l => l.status === 'PENDING');
  const live = todays.find(l => l.status === 'APPROVED' && !l.scanned_at);
  const out = todays.find(l => l.status === 'OUT');
  const decided = todays.find(l => l.status === 'REJECTED' || l.status === 'EXPIRED');
  const activeLeave = pending || live || out || decided || null;
  return { todays, pending, live, out, decided, activeLeave };
}

// A leave that can still change on someone else's device (mentor decision
// or guard scan) — worth polling quickly.
export function isLeaveLive(leave) {
  return !!leave && (leave.status === 'PENDING' || (leave.status === 'APPROVED' && !leave.scanned_at));
}

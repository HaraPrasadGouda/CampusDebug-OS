import { serverNow } from './serverClock';

/**
 * Day-scholar leave window = college hours (09:00 – 16:30, same day).
 * The SERVER is the real check (server.js leaveWindowOpen); this copy only
 * greys out the "Send to Mentor" button. Change both together.
 */
const OPEN_MIN = 9 * 60;        // 09:00
const CLOSE_MIN = 16 * 60 + 30; // 16:30 gate close
export const LEAVE_WINDOW_MSG = 'Day-scholar leave can be requested only between 9:00 AM and 4:30 PM (college hours).';

export function isLeaveWindowOpen(nowMs = serverNow()) {
  const d = new Date(nowMs);
  const m = d.getHours() * 60 + d.getMinutes();
  return m >= OPEN_MIN && m < CLOSE_MIN;
}

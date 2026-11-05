import { serverNow } from './serverClock';

/**
 * "On Leave Today" (and changing the substitute) is offered only during
 * college hours, same day: 7:00 AM until the last period ends (P6 4:30 PM).
 * The SERVER is the real check (server.js coverWindowOpen); this copy only
 * greys out the buttons. "I'm here now" works any time.
 */
export const COVER_OPEN_MIN = 7 * 60;         // 07:00 college start
export const COVER_CUTOFF_MIN = 16 * 60 + 30; // 16:30 — P6 end
export const COVER_WINDOW_LABEL = '7:00 AM–4:30 PM';

export function isCoverWindowOpen(nowMs = serverNow()) {
  const d = new Date(nowMs);
  const m = d.getHours() * 60 + d.getMinutes();
  return m >= COVER_OPEN_MIN && m < COVER_CUTOFF_MIN;
}

// "Dr. Priya Mishra" stays as is; a bare name gets "Prof ".
export function profName(name) {
  const n = String(name || '').trim();
  if (!n) return 'a colleague';
  return /^(dr|prof|professor|mr|mrs|ms)\b\.?/i.test(n) ? n : `Prof ${n}`;
}

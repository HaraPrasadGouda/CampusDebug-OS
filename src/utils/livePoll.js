// Gentle polling helpers (Fix 2).
// The dashboards used to hit the server every 3 s, even in a background tab.
// These helpers let a poll skip its tick while the page is hidden and refresh
// straight away when the user comes back (tab visible / window focus / online).

import { LIVE_UPDATES_EVENT } from './liveUpdates';

export const POLL_ACTIVE_MS = 15000; // something can change soon (pending pass, pending queue)
export const POLL_IDLE_MS = 30000;   // nothing waiting on anyone

export function isPageHidden() {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

// Calls cb when the page becomes visible again, the window gets focus or the
// network comes back, and when Settings → Live updates is switched back ON.
// focus + visibilitychange usually fire together, so calls
// closer than minGapMs are merged into one. Returns an unsubscribe function.
export function onPageActive(cb, minGapMs = 1500) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  let last = 0;
  const fire = () => {
    if (isPageHidden()) return;
    const now = Date.now();
    if (now - last < minGapMs) return;
    last = now;
    cb();
  };
  const onVisibility = () => { if (!isPageHidden()) fire(); };
  const onLive = (e) => { if (e?.detail?.on) fire(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', fire);
  window.addEventListener('online', fire);
  window.addEventListener(LIVE_UPDATES_EVENT, onLive);
  return () => {
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', fire);
    window.removeEventListener('online', fire);
    window.removeEventListener(LIVE_UPDATES_EVENT, onLive);
  };
}

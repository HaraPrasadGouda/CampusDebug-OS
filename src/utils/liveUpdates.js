// Settings → "Live updates" (one switch for the whole app).
//
// ON (default): screens that show a status someone else can change — a gate
// pass waiting for the warden, a leave waiting for the mentor, the guard's
// register, staff queues — refresh themselves on a timer while the tab is
// visible. OFF: no timers hit the server; a screen still refreshes when you
// open it, come back to the app, or after your own action.
//
// Stored per device in localStorage; a change is broadcast as a window event
// so every open screen follows it at once (no reload).
import { useEffect, useState } from 'react';

export const LIVE_UPDATES_KEY = 'campus_live_updates';
export const LIVE_UPDATES_EVENT = 'campus_live_updates_changed';

export function getLiveUpdates() {
  try {
    return localStorage.getItem(LIVE_UPDATES_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setLiveUpdates(on) {
  try { localStorage.setItem(LIVE_UPDATES_KEY, on ? 'on' : 'off'); } catch { /* private mode */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(LIVE_UPDATES_EVENT, { detail: { on: !!on } }));
  }
}

// True when a timer tick may fetch: the switch is ON and the tab is visible.
export function canAutoRefresh() {
  if (!getLiveUpdates()) return false;
  return !(typeof document !== 'undefined' && document.visibilityState === 'hidden');
}

// Calls cb(on) whenever the switch changes (this tab or another tab).
export function onLiveUpdatesChange(cb) {
  if (typeof window === 'undefined') return () => {};
  const onEvent = (e) => cb(e?.detail?.on ?? getLiveUpdates());
  const onStorage = (e) => { if (e.key === LIVE_UPDATES_KEY) cb(getLiveUpdates()); };
  window.addEventListener(LIVE_UPDATES_EVENT, onEvent);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(LIVE_UPDATES_EVENT, onEvent);
    window.removeEventListener('storage', onStorage);
  };
}

export function useLiveUpdates() {
  const [on, setOn] = useState(getLiveUpdates);
  useEffect(() => onLiveUpdatesChange(setOn), []);
  return [on, setLiveUpdates];
}

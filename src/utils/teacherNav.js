// Teacher navigation state (phone bottom bar + laptop SECTIONS list + the tab pages).
// One tiny store shared by App (bottom bar / sidebar) and TeacherDashboard (the active page),
// so switching tabs never re-renders the whole app and the data is still fetched only once.
import { useSyncExternalStore } from 'react';

export const TEACHER_TABS = [
  { id: 'today', label: 'Today' },
  { id: 'students', label: 'Students' },
  { id: 'classes', label: 'Classes' },
  { id: 'me', label: 'Me' }
];
const IDS = TEACHER_TABS.map(t => t.id);

// Deep links: /?tab=students, #students or #tab=students (notification taps open "/", which lands on Today).
export function tabFromUrl(loc = (typeof window !== 'undefined' ? window.location : null)) {
  if (!loc) return null;
  try {
    const q = new URLSearchParams(loc.search || '').get('tab');
    if (IDS.includes(q)) return q;
    const h = String(loc.hash || '').replace(/^#\/?/, '').replace(/^tab=/, '');
    if (IDS.includes(h)) return h;
  } catch { /* ignore */ }
  return null;
}

let state = { tab: tabFromUrl() || 'today', counts: { today: 0, students: 0 }, anchor: null };
const listeners = new Set();
const scrolls = {};
const emit = () => listeners.forEach(l => l());

export const getTeacherNav = () => state;
export const subscribeTeacherNav = (cb) => { listeners.add(cb); return () => listeners.delete(cb); };
export const useTeacherNav = () => useSyncExternalStore(subscribeTeacherNav, getTeacherNav, getTeacherNav);

export function setTeacherTab(tab, anchor = null) {
  if (!IDS.includes(tab)) return;
  if (tab === state.tab && !anchor) return;
  state = { ...state, tab, anchor };
  emit();
}
// The dashboard calls this once the new tab is on screen: where to scroll / which tool to open (then it is cleared).
export function takeAnchor() { const a = state.anchor; state.anchor = null; return a; }
export function setTeacherCounts(counts) {
  const c = { today: counts.today || 0, students: counts.students || 0 };
  if (c.today === state.counts.today && c.students === state.counts.students) return;
  state = { ...state, counts: c };
  emit();
}
export const rememberScroll = (tab, y) => { scrolls[tab] = y; };
export const savedScroll = (tab) => scrolls[tab] || 0;
export const resetTeacherNav = () => { state = { tab: tabFromUrl() || 'today', counts: { today: 0, students: 0 }, anchor: null }; };

// Switch tab: remember where this tab was scrolled, show the other one (its saved scroll is restored by the dashboard).
export function goTeacherTab(tab, anchor = null) {
  if (typeof document !== 'undefined' && tab !== state.tab) {
    const el = document.getElementById('app-scroll');
    if (el) rememberScroll(state.tab, el.scrollTop);
  }
  setTeacherTab(tab, anchor);
}

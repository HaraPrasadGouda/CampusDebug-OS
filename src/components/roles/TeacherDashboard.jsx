import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2, X, Users, Coffee, RefreshCw, Clock, LogOut, Search, GraduationCap, ShieldAlert, Sun, CalendarDays, MapPin, UserCheck, ChevronRight, ArrowRightLeft
} from 'lucide-react';
import { getAccessToken } from '../../utils/authClient';
import AttendanceMarkModal from '../modals/AttendanceMarkModal';
import { leaveNumber } from '../../utils/passNumber';
import CoverPickerModal from '../teacher/CoverPickerModal';
import CoveringSection from '../teacher/CoveringSection';
import { isCoverWindowOpen, COVER_WINDOW_LABEL, profName } from '../../utils/teacherCover';
import { isLeaveWindowOpen, LEAVE_WINDOW_LABEL } from '../../utils/leaveWindow';
import TeacherHero from '../teacher/TeacherHero';
import CoverBoardSection, { slotFromCard } from '../teacher/CoverBoardSection';
import PeriodTimeline from '../teacher/PeriodTimeline';
import TeacherInsights from '../teacher/TeacherInsights';
import useCoverBoard from '../teacher/useCoverBoard';
import { fmtMinLabel } from '../../utils/teacherApi';

// Day-scholar leave mentor console. scoped server-side: a TEACHER's queue
// only ever contains their own mentees (+ leaves routed to them while they
// cover for an absent mentor). The admin is not part of the leave flow.

const statusChips = {
  NO_REQUEST_TODAY: { cls: 'bg-slate-50 text-slate-600 border-slate-200', label: 'No request today' },
  PENDING: { cls: 'bg-amber-50 text-amber-800 border-amber-200', label: 'Pending with you' },
  APPROVED_NOT_OUT: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Approved — not yet out' },
  OUT: { cls: 'bg-sky-50 text-sky-700 border-sky-200', label: 'Out of campus (leave)' },
  REJECTED: { cls: 'bg-rose-50 text-rose-700 border-rose-200', label: 'Rejected today' },
  EXPIRED: { cls: 'bg-slate-50 text-slate-600 border-slate-200', label: 'Expired' }
};

const LIST_PREVIEW = 5;
const SCAN_PREVIEW = 6;

const timeHM = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

// Server timetable day keys are 'MON'..'SAT' (THUR spelled like the solver).
const TT_TEACHER_TODAY = ['MON', 'MON', 'TUE', 'WED', 'THUR', 'FRI', 'SAT'][new Date().getDay()] || 'MON';

export default function TeacherDashboard({ onNotification, searchQuery = '', session = null }) {
  const [queue, setQueue] = useState(null);          // server queue payload
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [toggling, setToggling] = useState(false);
  const [localSearch, setLocalSearch] = useState('');
  // Mentor-scoped day-scholar gate log (server filters to THIS mentor's
  // own mentees — the warden never sees this data, only the mentor does).
  const [dsScans, setDsScans] = useState(null);
  // Long lists show the first few rows + "View all" (layout only).
  // My Mentees is kept separate: a summary card, the list opens on tap.
  const [menteesOpen, setMenteesOpen] = useState(false);
  const [showAllScans, setShowAllScans] = useState(false);
  // Mentor-created leave (keypad-phone day scholars): which mentee row has the
  // reason box open, the draft, and the last error for that row.
  const [mlRoll, setMlRoll] = useState(null);
  const [mlReason, setMlReason] = useState('');
  const [mlBusy, setMlBusy] = useState(false);
  const [mlErr, setMlErr] = useState('');
  // One "Create leave for student" button opens a picker (replaces the
  // per-row buttons); after success it shows the LV number.
  const [mlOpen, setMlOpen] = useState(false);
  const [mlQuery, setMlQuery] = useState('');
  const [mlDone, setMlDone] = useState(null);

  // --- My Teaching Timetable (Phase 2): the solver publishes engagement for
  //     THIS faculty (matched on the FAC-staff roll). Today's classes first.
  const [ttMine, setTtMine] = useState(null);
  // Attendance marking (Phase 3): opened straight from today's timetable row.
  const [markSlot, setMarkSlot] = useState(null);
  // HARD LOCK state: `${sectionKey}|${period}` -> the saved record. A class
  // that appears here shows a "Marked ✓ Locked" chip instead of a Mark button.
  const [ttMarked, setTtMarked] = useState({});
  // Substitute cover: the "who covers me" picker, and the separate Covering
  // view (the substitute's own home stays as it is).
  const [pickerOpen, setPickerOpen] = useState(false);
  const [coverView, setCoverView] = useState(false);
  const [declineFor, setDeclineFor] = useState(null);
  const [declining, setDeclining] = useState(false);
  // Cover board (cards I can take / that I took) — polled every 20 s.
  const { board, reload: reloadBoard } = useCoverBoard(true);

  useEffect(() => {
    if (!menteesOpen && !mlOpen) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { setMenteesOpen(false); setMlOpen(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menteesOpen, mlOpen]);

  const todayKey = () => {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${m}-${day}`;
  };

  const loadTimetable = async (withState) => {
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/timetable/mine', tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
      const j = await r.json();
      if (j?.success && withState) setTtMine(j);
    } catch { /* offline: keep whatever we had */ }
  };

  // Which of TODAY's classes are already marked (and therefore locked)?
  const loadMarked = async () => {
    try {
      const tok = getAccessToken();
      const r = await fetch(`/api/attendance/sessions?date=${todayKey()}`, tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
      const j = await r.json();
      if (j?.success) {
        const map = {};
        for (const s of (j.sessions || [])) if (s.sectionKey) map[`${s.sectionKey}|${s.period}`] = s;
        setTtMarked(map);
      }
    } catch { /* offline: locks re-sync on the next poll */ }
  };

  const load = async (withSpinner) => {
    if (withSpinner) setLoading(true);
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/leave-requests/queue', tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
      const j = await r.json();
      if (j?.success) setQueue(j);
      else if (onNotification) onNotification(j?.error || 'Could not load your leave queue.', 'error');
    } catch {
      if (onNotification) onNotification('Offline — the leave queue needs connectivity right now.', 'error');
    }
    if (withSpinner) setLoading(false);
  };

  // Mentor-scoped day-scholar gate log — the server resolves this teacher's
  // own mentees (mentor_roll) and returns ONLY their LEAVE/COMMUTE scans.
  const loadScans = async () => {
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/teacher/day-scholar-scans', tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
      const j = await r.json();
      if (j?.success) setDsScans(j);
    } catch { /* offline: the gate log re-syncs on the next poll */ }
  };

  // In-app heads-up the first time this device sees a new cover today (the
  // server also pushes it to registered devices).
  useEffect(() => {
    for (const g of (queue?.covering || []).filter(x => x.active)) {
      const key = `cover_seen_${todayKey()}_${g.mentorRoll}`;
      try {
        if (localStorage.getItem(key)) continue;
        localStorage.setItem(key, '1');
      } catch { /* private mode: show every time */ }
      onNotification?.(`Today you're covering ${profName(g.mentorName)}'s leave approvals — ${g.pendingCount} pending ${g.pendingCount === 1 ? 'request' : 'requests'}.`, 'info');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(queue?.covering || []).filter(x => x.active).map(g => g.mentorRoll).join(',')]);

  useEffect(() => {
    load(true);
    loadTimetable(true);
    loadMarked();
    loadScans();
    const iv = setInterval(() => { load(false); loadMarked(); loadScans(); }, 20000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const decide = async (leaveId, action) => {
    setBusyId(leaveId);
    try {
      const tok = getAccessToken();
      const r = await fetch(`/api/leave-requests/${leaveId}/decide`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ action, note: noteDraft })
      });
      const j = await r.json();
      if (j?.success) {
        setNoteDraft('');
        if (onNotification) onNotification(
          action === 'APPROVED' ? `Approved — leave number ${leaveNumber(j.leave?.id)} sent to the student. They tell the guard this number (or show the Campus-QR).` : 'Request rejected — the student has been notified.',
          'success'
        );
        load(false);
      } else if (onNotification) {
        onNotification(j?.error || 'Decision was not recorded.', 'error');
      }
    } catch {
      if (onNotification) onNotification('Offline — decision not recorded.', 'error');
    }
    setBusyId(null);
  };

  // Mentor creates a leave for a mentee who has no smartphone. The server
  // records it as APPROVED by this mentor and SMSes the LV number.
  const createLeave = async (roll) => {
    setMlBusy(true); setMlErr('');
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/leave-requests/mentor-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ studentRoll: roll, reason: mlReason })
      });
      const j = await r.json();
      if (j?.success) {
        setMlDone({ number: j.number, roll });
        setMlRoll(null); setMlReason('');
        if (onNotification) onNotification(`Leave ${j.number} approved — SMS sent to the student. Tell them the number too.`, 'success');
        load(false);
      } else {
        setMlErr(j?.error || 'Leave was not created.');
      }
    } catch {
      setMlErr('Offline — leave not created.');
    }
    setMlBusy(false);
  };

  // Substitute: "Can't cover" — hands the colleague's work back to them.
  const declineCover = async (mentorRoll) => {
    setDeclining(true);
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/leave-requests/teacher-absent/decline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ mentorRoll })
      });
      const j = await r.json();
      onNotification?.(j?.success ? j.message : (j?.error || 'Could not hand the work back.'), j?.success ? 'success' : 'error');
      if (j?.success) { setDeclineFor(null); setCoverView(false); load(false); }
    } catch {
      onNotification?.('Offline — could not hand the work back.', 'error');
    }
    setDeclining(false);
  };

  // onLeave=true carries the colleague picked in the cover picker
  // (substituteRoll null = "no one is present, mark me anyway").
  const toggleAbsent = async (onLeave, substituteRoll = null) => {
    setToggling(true);
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/leave-requests/teacher-absent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify(onLeave && substituteRoll ? { onLeave, substituteRoll } : { onLeave })
      });
      const j = await r.json();
      if (j?.success) {
        if (onNotification) onNotification(
          j.message || (j.onLeave
            ? (j.delegatedTo
              ? `Marked On Leave — ${profName(j.delegatedToName || j.delegatedTo)} approves your students' leaves today; your classes are on the cover board.`
              : 'Marked On Leave — no other teacher is present, so requests stay in your queue.')
            : 'Welcome back — your mentees\' pending requests are yours again.'),
          'success'
        );
        setPickerOpen(false);
        load(false);
        reloadBoard();
      } else if (onNotification) {
        onNotification(j?.error || 'Could not update your leave status.', 'error');
        if (j?.windowClosed) { setPickerOpen(false); load(false); }
      }
    } catch {
      if (onNotification) onNotification('Offline — could not update your leave status.', 'error');
    }
    setToggling(false);
  };


  const filterText = (searchQuery || localSearch).trim().toLowerCase();

  // Wish greeting — same time-of-day logic the student dashboard uses.
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };
  // Faculty names carry honorifics ("Dr. Mitali Bose") — strip them so the
  // card says "Good morning, Mitali!" and never "Good morning, Dr.!"
  const honorifics = /^(dr|prof|professor|mr|mrs|ms|md)\.?\s+/i;
  const teacherFirstName = (session?.name || 'Teacher').replace(honorifics, '').trim().split(' ')[0] || 'Teacher';

  // TIME GATE (client mirror of the server rule): a class's Mark card opens
  // 10 minutes before the period starts. `s.time` = '09:15 AM - 10:15 AM'.
  const periodStartMin = (time) => {
    const first = String(time || '').split('-')[0].trim();
    const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(first);
    if (!m) return null;
    let h = parseInt(m[1], 10) % 12;
    if (/pm/i.test(m[3])) h += 12;
    return h * 60 + parseInt(m[2], 10);
  };
  const markOpen = (s) => {
    const om = periodStartMin(s.time);
    if (om == null) return true;                     // unknown time → let the server decide
    const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
    return nowMin >= om - 10;
  };
  const openLabel = (s) => {
    const o = periodStartMin(s.time) - 10;
    if (Number.isNaN(o)) return 'class time';
    const h = Math.floor(o / 60), m = o % 60;
    return `${h > 12 ? h - 12 : h || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  };
  const markedRec = (s) => ttMarked[`${s.sectionKey}|${s.period}`];
  const pendingLeaves = (queue?.leaves || []).filter(l => l.status === 'PENDING')
    .filter(l => !filterText || `${l.student_name} ${l.student_roll} ${l.reason}`.toLowerCase().includes(filterText));
  const decidedToday = (queue?.leaves || []).filter(l => l.status !== 'PENDING' && l.created_at && new Date(l.created_at).toDateString() === new Date().toDateString())
    .filter(l => !filterText || `${l.student_name} ${l.student_roll} ${l.reason}`.toLowerCase().includes(filterText));
  const mentees = (queue?.mentees || [])
    .filter(m => !filterText || `${m.full_name} ${m.roll_number}`.toLowerCase().includes(filterText));
  // Covering today: absent mentors whose day scholars the server handed to me.
  const coverGroups = (queue?.covering || []).map(g => ({
    ...g,
    mentees: (g.mentees || []).filter(m => !filterText || `${m.full_name} ${m.roll_number}`.toLowerCase().includes(filterText))
  }));
  // My own leave state + the college-hours window for "On Leave Today".
  const myState = queue?.onLeaveState || {};
  const onLeave = !!myState.onLeave;
  const coverOpen = myState.windowOpen !== false && isCoverWindowOpen();
  // "Create leave for student" follows the leave window (server: leaveWindowOpen).
  const createOpen = isLeaveWindowOpen();
  const windowLabel = myState.windowLabel || COVER_WINDOW_LABEL;
  const myClassesToday = ttMine ? (ttMine.slots || []).filter(s => s.day === TT_TEACHER_TODAY).length : 0;
  // ---- Teacher home model: today's rows (my classes + covers I took), hero ticks ----
  const nowM = new Date().getHours() * 60 + new Date().getMinutes();
  const myCards = myState.myCards || [];
  const cardFor = (s) => myCards.find(c => c.sectionKey === s.sectionKey && c.period === s.period) || null;
  const coverSummaryText = myCards.length
    ? ` (${myCards.filter(c => c.status === 'taken').length} taken, ${myCards.filter(c => c.status === 'open').length} waiting, ${myCards.filter(c => c.status === 'cancelled').length} cancelled)` : '';
  const ownToday = (ttMine?.slots || []).filter(s => s.day === TT_TEACHER_TODAY).map(s => {
    const start = Number.isFinite(s.startMin) ? s.startMin : (periodStartMin(s.time) ?? 0);
    const end = Number.isFinite(s.endMin) ? s.endMin : start + 60;
    return { ...s, cover: false, startMin: start, endMin: end, span: s.span || 1, startLabel: fmtMinLabel(start).replace(' AM', '').replace(' PM', ''), sectionText: s.sectionLabel || s.departmentLabel, card: cardFor(s), slot: s };
  });
  const coverRows = (board?.mine || []).map(c => ({
    ...c, cover: true, startLabel: fmtMinLabel(c.startMin).replace(' AM', '').replace(' PM', ''), sectionText: c.sectionLabel || c.short,
    subject: c.takenBy?.subject, card: null, slot: slotFromCard(c)
  }));
  const dayRows = [...ownToday, ...coverRows].sort((a, b) => a.startMin - b.startMin);
  const heroTicks = dayRows.map(r => ({
    label: r.periodLabel,
    state: r.card?.status === 'cancelled' ? 'cancelled' : r.card ? 'gone' : onLeave && !r.cover ? 'gone' : markedRec(r) || nowM >= r.endMin ? 'done' : nowM >= r.startMin ? 'live' : r.cover ? 'cover' : 'upcoming'
  }));
  const nextRow = dayRows.find(r => nowM < r.endMin && !r.card);
  const heroNext = nextRow ? { label: `${nextRow.periodLabel} ${nextRow.short || nextRow.sectionText}`, when: nowM >= nextRow.startMin ? 'in progress' : `${nextRow.time}` } : null;
  const openCoverN = (board?.open || []).length;
  const heroStats = [
    { label: 'Classes today', value: dayRows.length },
    { label: 'Cover open', value: openCoverN, hot: openCoverN > 0 },
    { label: 'Pending leaves', value: pendingLeaves.length, hot: pendingLeaves.length > 0 }
  ];
  const dateLabel = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });

  // Who may get a mentor-created leave (rule unchanged): day scholars with
  // no live request today. Others show why, greyed, in the picker.
  const canCreateFor = (m) => String(m.resident_type || '').toLowerCase() === 'dayscholar'
    && ['NO_REQUEST_TODAY', 'REJECTED', 'EXPIRED'].includes(m.todayStatus || 'NO_REQUEST_TODAY');
  const notEligibleWhy = (m) => (String(m.resident_type || '').toLowerCase() !== 'dayscholar'
    ? 'Hosteller — warden handles'
    : m.todayStatus === 'PENDING' ? 'Already pending today' : 'Already approved today');

  // One mentee row (status chip + LV number chip). Used for my own mentees and,
  // with `covering`, for an absent mentor's day scholars I am covering today
  // (their live leave id comes from the server). Leaves are created from the
  // single "Create leave for student" button, not per row.
  const renderMenteeRow = (m, covering = false) => {
    const chip = statusChips[m.todayStatus] || statusChips.NO_REQUEST_TODAY;
    const liveLeave = m.todayStatus !== 'APPROVED_NOT_OUT' ? null
      : covering ? (m.liveLeaveId ? { id: m.liveLeaveId } : null)
        : (queue?.leaves || []).find(l => l.student_roll === m.roll_number && l.status === 'APPROVED' && !l.scanned_at);
    return (
      <div key={m.id} className="bg-slate-50/60 border border-slate-200 rounded-xl px-3.5 py-3">
        <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 grow basis-full sm:basis-0">
            <div className="text-xs font-bold text-slate-900 truncate">
              {m.full_name}
              <span className="text-[11px] font-normal text-slate-500 font-mono"> ({m.roll_number})</span>
            </div>
            <div className="text-[11px] text-slate-500 font-medium mt-0.5">{m.department || '—'}</div>
          </div>
          <div className="flex flex-1 sm:flex-none sm:ml-auto items-center justify-between sm:justify-end gap-2">
            <span className={`shrink-0 text-[10px] font-extrabold px-2.5 py-1 rounded-full border ${chip.cls}`}>
              {chip.label}
            </span>
            <span className="flex items-center justify-end shrink-0 sm:w-[6.5rem]">
            {liveLeave && (
              <span className="shrink-0 font-mono text-[11px] font-extrabold text-emerald-800 bg-emerald-50 border border-emerald-300 px-2.5 py-1 rounded-lg" title="Leave number — the student tells the guard this">
                {leaveNumber(liveLeave.id)}
              </span>
            )}
            </span>
          </div>
        </div>
      </div>
    );
  };

  // Picker list for "Create leave for student": my mentees + the day scholars
  // I cover today; eligible first, then the rest (greyed, with the reason).
  const mlPool = [
    ...(queue?.mentees || []),
    ...(queue?.covering || []).flatMap(g => (g.mentees || []).map(m => ({ ...m, coverFor: g.mentorName })))
  ];
  const mlQ = mlQuery.trim().toLowerCase();
  const mlList = mlPool
    .filter(m => !mlQ || `${m.full_name} ${m.roll_number}`.toLowerCase().includes(mlQ))
    .sort((p, q) => Number(canCreateFor(q)) - Number(canCreateFor(p)));
  const mlPicked = mlPool.find(m => m.roll_number === mlRoll) || null;
  const openCreateLeave = () => { setMlOpen(true); setMlQuery(''); setMlRoll(null); setMlReason(''); setMlErr(''); setMlDone(null); };
  const closeCreateLeave = () => { setMlOpen(false); setMlRoll(null); setMlErr(''); setMlDone(null); };

  // Section switcher chips (layout only): each chip scrolls to its own card.
  const ttTodayCount = ttMine ? (ttMine.slots || []).filter(s => s.day === TT_TEACHER_TODAY).length : null;
  const sectionChips = [
    { id: 'td-approvals', label: 'Approval Queue', count: pendingLeaves.length, dot: 'bg-amber-500', hot: pendingLeaves.length > 0 },
    ...(decidedToday.length > 0 ? [{ id: 'td-decisions', label: "Today's Decisions", count: decidedToday.length, dot: 'bg-violet-500' }] : []),
    { id: 'td-cover', label: 'Cover board', count: openCoverN, dot: 'bg-indigo-500', hot: openCoverN > 0 },
    { id: 'td-timetable', label: 'My day', count: ttTodayCount, dot: 'bg-teal-500' },
    { id: 'td-mentees', label: 'My Mentees', count: mentees.length, dot: 'bg-cyan-500' },
    { id: 'td-gatelog', label: 'Gate Log', count: dsScans ? (dsScans.scans || []).length : null, dot: 'bg-blue-500' },
    { id: 'td-insights', label: 'Tools', count: null, dot: 'bg-violet-500' },
    { id: 'td-status', label: queue?.onLeaveState?.onLeave ? 'On Leave Today' : 'Present today', count: null, dot: queue?.onLeaveState?.onLeave ? 'bg-amber-500' : 'bg-emerald-500', phoneOnly: true }
  ];
  const jumpToSection = (id) => (id === 'td-mentees'
    ? setMenteesOpen(true)
    : document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  // Summary tiles for the collapsed My Mentees card (existing status labels).
  const menteeStats = ['PENDING', 'APPROVED_NOT_OUT', 'OUT', 'NO_REQUEST_TODAY'].map(k => ({
    k, ...statusChips[k], n: mentees.filter(m => (m.todayStatus || 'NO_REQUEST_TODAY') === k).length
  }));

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-4xl xl:max-w-6xl 2xl:max-w-none mx-auto w-full">
      {coverView ? (
        <CoveringSection
          groups={coverGroups}
          onBack={() => setCoverView(false)}
          decide={decide}
          busyId={busyId}
          noteDraft={noteDraft}
          setNoteDraft={setNoteDraft}
          onCreateLeave={openCreateLeave}
          createOpen={createOpen}
          createLabel={LEAVE_WINDOW_LABEL}
          onMark={setMarkSlot}
          markOpen={markOpen}
          openLabel={openLabel}
          renderMenteeRow={renderMenteeRow}
          windowLabel={windowLabel}
        />
      ) : (<>

      {/* 0. Teacher hero — indigo identity, day strip of period ticks (same card language as the student wish card) */}
      <TeacherHero greeting={getGreeting()} firstName={teacherFirstName} dateLabel={dateLabel} periods={heroTicks} next={heroNext} stats={heroStats} note={onLeave ? `You're on leave today — your classes are on the cover board${coverSummaryText}.` : (ttMine && dayRows.length === 0 ? 'No classes on your timetable today — your teaching desk is clear.' : null)} />

      {/* Present today / On Leave Today — the absent teacher picks who covers
          (same day, 7:00 AM–4:30 PM). "I'm here now" works any time. */}
      <section id="td-status" className={`scroll-mt-[124px] rounded-2xl border px-4 py-3 sm:py-3.5 shadow-sm ${onLeave ? (myState.declinedBy ? 'bg-rose-50/60 border-rose-300' : 'bg-amber-50/60 border-amber-300') : 'bg-white border-slate-200/50'}`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3 min-w-0">
            {onLeave
              ? <Coffee className={`w-5 h-5 mt-0.5 shrink-0 ${myState.declinedBy ? 'text-rose-600' : 'text-amber-600'}`} />
              : <Sun className="w-5 h-5 text-slate-500 mt-0.5 shrink-0" />}
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-slate-900 break-words">
                {!onLeave
                  ? 'Present today'
                  : myState.delegatedTo
                    ? `On Leave Today · Covered by ${profName(myState.delegatedToName || myState.delegatedTo)}`
                    : myState.declinedBy
                      ? `${profName(myState.declinedBy.name)} can't cover — pick another teacher`
                      : 'On Leave Today · no colleague present'}
              </p>
              <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                {!onLeave
                  ? (coverOpen
                    ? 'Taking a day off? Pick a present colleague to approve your students\' leaves. Your classes go on the cover board.'
                    : `On Leave Today can be set ${windowLabel}, same day.`)
                  : myState.delegatedTo
                    ? `They approve your mentees' leaves today. Your classes are on the cover board${coverSummaryText}. Came in after all? Tap "I'm here now".`
                    : myState.declinedBy
                      ? 'Your leave requests are back with you until you pick someone else. Your classes are on the cover board.'
                      : 'Nobody else is present, so your leave requests stay with you. Your classes are on the cover board.'}
              </p>
            </div>
          </div>
          <div className="shrink-0 flex flex-col items-stretch sm:items-end gap-1">
            <div className="flex gap-2">
              {onLeave && (
                <button
                  type="button"
                  disabled={toggling || !queue || !coverOpen}
                  onClick={() => setPickerOpen(true)}
                  className={`flex-1 sm:flex-none px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-extrabold transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed border-2 flex items-center justify-center gap-1.5 ${myState.declinedBy && !myState.delegatedTo ? 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600' : 'bg-white hover:bg-amber-50 text-amber-800 border-amber-300'}`}
                >
                  <ArrowRightLeft className="w-3.5 h-3.5" />
                  {myState.delegatedTo ? 'Change' : 'Pick a teacher'}
                </button>
              )}
              <button
                type="button"
                disabled={toggling || !queue || (!onLeave && !coverOpen)}
                onClick={() => (onLeave ? toggleAbsent(false) : setPickerOpen(true))}
                aria-describedby={!coverOpen ? 'td-cover-closed' : undefined}
                className={`flex-1 sm:flex-none px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-extrabold transition-colors cursor-pointer disabled:cursor-not-allowed border-2 ${
                  onLeave
                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600 disabled:opacity-60'
                    : coverOpen
                      ? 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500 disabled:opacity-60'
                      : 'bg-slate-100 text-slate-400 border-slate-200'
                }`}
              >
                {toggling ? 'Working…' : onLeave ? "I'm here now" : 'On Leave Today'}
              </button>
            </div>
            {!coverOpen && (
              <p id="td-cover-closed" className="text-[11px] font-semibold text-slate-500 flex items-center gap-1 sm:justify-end">
                <Clock className="w-3 h-3 shrink-0" /> {onLeave ? 'Change available' : 'Available'} {windowLabel}
              </p>
            )}
          </div>
        </div>
      </section>

      {/* Covering for an absent colleague — ONE compact card (shown even with
          0 pending); everything of theirs opens in the separate Covering view,
          so this home stays as is. "Can't cover" hands it back. */}
      {coverGroups.map(g => (
        <div key={g.mentorRoll} className={`rounded-2xl border-2 shadow-sm overflow-hidden ${g.active ? 'border-indigo-200 bg-gradient-to-r from-indigo-50 to-white' : 'border-slate-200 bg-white'}`}>
          <button
            type="button"
            onClick={() => { setCoverView(true); window.scrollTo?.({ top: 0 }); }}
            className="w-full text-left px-4 py-3 min-h-[60px] flex items-center gap-3 hover:bg-indigo-50/60 transition-colors cursor-pointer"
          >
            <span className={`w-10 h-10 rounded-xl text-white flex items-center justify-center shrink-0 ${g.active ? 'bg-indigo-600' : 'bg-slate-500'}`}>
              <UserCheck className="w-5 h-5" />
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-sm font-extrabold text-slate-900 break-words">
                {g.active ? `Covering ${profName(g.mentorName)}` : `${profName(g.mentorName)} is back`}
              </span>
              <span className="block text-[11px] font-semibold text-slate-600 mt-0.5">
                {g.active
                  ? <><span className={g.pendingCount > 0 ? 'text-amber-700' : ''}>{g.pendingCount} pending</span> · leave approvals</>
                  : 'Their leave approvals are back with them'}
              </span>
            </span>
            <ChevronRight className="w-5 h-5 text-indigo-600 shrink-0" />
          </button>
          {g.active && (declineFor === g.mentorRoll ? (
            <div className="border-t border-indigo-100 bg-white px-4 py-3 space-y-2">
              <p className="text-xs text-slate-700 leading-snug">Hand {profName(g.mentorName)}'s work back? They get a notification to pick another teacher.</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setDeclineFor(null)} className="flex-1 min-h-[44px] rounded-xl border-2 border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs cursor-pointer transition-colors">Keep covering</button>
                <button type="button" disabled={declining} onClick={() => declineCover(g.mentorRoll)} className="flex-1 min-h-[44px] rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-60 text-white font-bold text-xs cursor-pointer transition-colors">{declining ? 'Working…' : "Yes, I can't cover"}</button>
              </div>
            </div>
          ) : (
            <div className="border-t border-indigo-100/70 px-4 py-1.5 flex justify-end">
              <button type="button" onClick={() => setDeclineFor(g.mentorRoll)} className="min-h-[44px] px-3 rounded-xl text-[11px] font-bold text-rose-700 hover:bg-rose-50 cursor-pointer transition-colors">Can't cover</button>
            </div>
          ))}
        </div>
      ))}

      {/* Cover board — classes of absent colleagues I may take (free + my section) */}
      <CoverBoardSection board={board} reload={() => { reloadBoard(); loadMarked(); }} onNotification={onNotification} onMark={setMarkSlot} markOpen={markOpen} openLabel={openLabel} markedRec={markedRec} onLeave={onLeave} myCards={myCards} />

      {/* Header */}
      <div className="bg-white/90 backdrop-blur-sm border border-slate-200/50 rounded-2xl p-4 sm:p-5 shadow-sm flex flex-row flex-wrap sm:flex-nowrap items-start sm:items-center justify-between gap-3">
        <div className="min-w-0 basis-full sm:basis-auto sm:flex-1">
          <h2 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-cyan-700" />
            Faculty Mentor Console
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Day-scholar leave approvals are YOURS to make — every decision is explicit, nothing auto-approves.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
          {queue?.pendingCount > 0 && (
            <span className="hidden sm:inline-block text-[11px] font-mono font-bold text-amber-800 bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-full">
              {queue.pendingCount} Pending
            </span>
          )}
          <div className="flex-1 sm:flex-none flex flex-col items-stretch sm:items-end gap-1">
            <button
              type="button"
              onClick={openCreateLeave}
              disabled={!createOpen}
              aria-describedby={!createOpen ? 'td-create-closed' : undefined}
              className="min-h-[44px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap disabled:bg-slate-100 disabled:text-slate-400 disabled:border disabled:border-slate-200 disabled:shadow-none disabled:cursor-not-allowed"
            >
              <UserCheck className="w-4 h-4" />
              Create leave for student
            </button>
            {!createOpen && (
              <p id="td-create-closed" className="text-[11px] font-semibold text-slate-500 flex items-center gap-1 sm:justify-end">
                <Clock className="w-3 h-3 shrink-0" /> Available {LEAVE_WINDOW_LABEL}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => load(true)}
            className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
            title="Refresh queue"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Section switcher — tap a chip to jump to that section (layout only) */}
      <nav aria-label="Dashboard sections" className="sticky top-[51px] sm:top-[54px] z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 bg-[#F1F5F9]/90 backdrop-blur-md">
        <div className="flex gap-2 overflow-x-auto scrollbar-none -mx-4 pl-4 pr-16 sm:mx-0 sm:pl-0 xl:pr-0 xl:flex-wrap [mask-image:linear-gradient(to_right,#000_calc(100%_-_64px),rgba(0,0,0,0.12))] [-webkit-mask-image:linear-gradient(to_right,#000_calc(100%_-_64px),rgba(0,0,0,0.12))] xl:[mask-image:none] xl:[-webkit-mask-image:none]">
          {sectionChips.map(s => (
            <button
              key={s.id}
              type="button"
              onClick={() => jumpToSection(s.id)}
              className={`${s.phoneOnly ? 'xl:hidden ' : ''}shrink-0 min-h-[44px] inline-flex items-center gap-2 pl-3 pr-2.5 rounded-full bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700 whitespace-nowrap shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors cursor-pointer`}
            >
              <span className={`w-2 h-2 rounded-full ${s.dot}`} />
              {s.label}
              {s.count != null && (
                <span className={`min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-mono font-extrabold flex items-center justify-center ${s.hot ? (s.id === 'td-cover' ? 'bg-indigo-600 text-white' : 'bg-amber-500 text-white') : 'bg-slate-100 text-slate-600'}`}>
                  {s.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* Search (sidebar search + local input both apply) */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="Search students or reasons…"
          className="w-full min-h-[44px] pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white/90 text-sm outline-none focus:border-slate-400 transition-colors"
        />
      </div>

      {/* Sections: phone = one column (Approvals first); laptop (xl) = two equal-height
          columns — Approvals + Decisions + Gate Log on the left, Timetable + availability +
          My Mentees (summary; the list opens on tap) on the right */}
      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-12 xl:items-stretch">
        <div className="contents xl:flex xl:flex-col xl:gap-4 xl:col-span-6">
      {/* APPROVAL QUEUE — the always-works path */}
      <section id="td-approvals" className="order-2 xl:grow xl:flex xl:flex-col scroll-mt-[124px] bg-white border-2 border-amber-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-2 px-4 sm:px-5 py-3 bg-gradient-to-r from-amber-50 to-white border-b border-amber-100">
          <h3 className="text-[15px] font-bold text-slate-900 flex items-center gap-2 whitespace-nowrap">
            <span className="w-9 h-9 rounded-xl bg-amber-100/70 text-amber-700 border border-amber-200 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </span>
            Approval Queue
          </h3>
          <span className={`shrink-0 text-[11px] font-mono font-bold px-2 py-1 rounded-full border ${pendingLeaves.length > 0 ? 'text-white bg-amber-500 border-amber-500' : 'text-slate-600 bg-slate-50 border-slate-200'}`}>{pendingLeaves.length} waiting</span>
        </div>
        <div className="p-4 sm:p-5 xl:flex-1 xl:flex xl:flex-col">

        {loading && !queue ? (
          <div className="py-8 text-center text-xs text-slate-500 font-semibold">Loading your queue…</div>
        ) : pendingLeaves.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 space-y-1 xl:my-auto">
            <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
            <p className="font-bold text-slate-600">Queue is clear</p>
            <p className="text-[11px]">New mentee requests appear here instantly (plus a push if Background Alerts are on).</p>
          </div>
        ) : (
          <div className="space-y-3">
            {pendingLeaves.map(leave => (
              <div key={leave.id} className="rounded-2xl border-2 border-amber-200 bg-amber-50/40 p-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-extrabold text-slate-900">
                      {leave.student_name} <span className="font-mono text-[11px] text-slate-500">({leave.student_roll})</span>
                    </p>
                    <p className="text-xs text-slate-700 mt-1 leading-relaxed">
                      <strong>Reason:</strong> {leave.reason}
                    </p>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      Requested {timeHM(leave.created_at)} • one-way leave — approved exit, back next working day
                    </p>
                    {onLeave && leave.routed_to && leave.routed_to === myState.delegatedTo && (
                      <p className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5">
                        <ArrowRightLeft className="w-3 h-3" /> With {profName(myState.delegatedToName || myState.delegatedTo)} today
                      </p>
                    )}
                  </div>
                </div>
<textarea
                  rows={3}
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Optional note to the student (e.g. come back after the appointment)"
                  maxLength={200}
                  className="block w-full min-h-[44px] sm:h-[44px] rounded-xl border border-amber-200 bg-white p-2.5 text-xs outline-none focus:border-amber-400 transition-colors resize-none"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === leave.id}
                    onClick={() => decide(leave.id, 'APPROVED')}
                    className="flex-1 py-2.5 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Approve
                  </button>
                  <button
                    type="button"
                    disabled={busyId === leave.id}
                    onClick={() => decide(leave.id, 'REJECTED')}
                    className="flex-1 py-2.5 min-h-[44px] rounded-xl bg-white hover:bg-rose-50 disabled:opacity-60 text-rose-700 border-2 border-rose-200 font-bold text-xs cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                  >
                    <X className="w-4 h-4" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        </div>
      </section>

      {/* Today's decided requests (audit trail) */}
      {decidedToday.length > 0 && (
        <section id="td-decisions" className="order-3 scroll-mt-[124px] bg-white border border-violet-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 bg-gradient-to-r from-violet-50 to-white border-b border-violet-100">
          <h3 className="text-[15px] font-bold text-slate-900 flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-violet-100/70 text-violet-700 border border-violet-200 flex items-center justify-center shrink-0">
              <ShieldAlert className="w-4 h-4" />
            </span>
            Today's Decisions
          </h3>
          <span className="shrink-0 text-[11px] font-mono font-bold text-violet-800 bg-violet-50 border border-violet-200 px-2.5 py-1 rounded-full">{decidedToday.length}</span>
          </div>
          <div className="p-4 sm:p-5 space-y-2.5">
          {decidedToday.map(l => (
            <div key={l.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="text-slate-700 font-semibold truncate">
                {l.student_name} <span className="text-slate-400 font-mono text-[10px]">({l.student_roll})</span>
              </span>
              <span className={`shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${
                l.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : l.status === 'OUT' ? 'bg-sky-50 text-sky-700 border-sky-200'
                    : l.status === 'REJECTED' ? 'bg-rose-50 text-rose-700 border-rose-200'
                      : 'bg-slate-50 text-slate-600 border-slate-200'
              }`}>
                {l.status === 'OUT' ? `OUT ${timeHM(l.scanned_at)}` : l.status}
              </span>
            </div>
          ))}
          </div>
        </section>
      )}
      {/* My Mentees — kept separate: a summary card here, the full list opens
          only on tap (bottom sheet on phone, side panel on laptop) */}
      <section id="td-mentees" className="order-5 xl:grow xl:flex xl:flex-col scroll-mt-[124px] bg-white border border-cyan-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 bg-gradient-to-r from-cyan-50 to-white border-b border-cyan-100">
          <h3 className="text-[15px] font-bold text-slate-900 flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-cyan-100/70 text-cyan-700 border border-cyan-200 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </span>
            My Mentees
          </h3>
          <span className="shrink-0 text-[11px] font-mono font-bold text-cyan-800 bg-cyan-50 border border-cyan-200 px-2.5 py-1 rounded-full">{mentees.length} students</span>
        </div>
        <div className="p-4 sm:p-5 flex flex-col gap-3 xl:flex-1 xl:justify-center">
        {mentees.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 space-y-1">
            <Users className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="font-bold text-slate-600">No mentees assigned to you yet</p>
            <p className="text-[11px]">The mentor→student mapping is set by the college roster.</p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {menteeStats.map(s => (
                <div key={s.k} className={`min-h-[60px] rounded-xl border px-3 py-2 flex flex-col justify-center ${s.cls}`}>
                  <p className="text-2xl font-extrabold font-mono leading-none">{s.n}</p>
                  <p className="text-[10px] font-bold mt-1 leading-tight">{s.label}</p>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setMenteesOpen(true)}
              className="w-full min-h-[44px] rounded-xl border border-cyan-200 bg-cyan-50/50 hover:bg-cyan-50 text-cyan-800 text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <Users className="w-4 h-4" />
              {`View all (${mentees.length})`}
            </button>
          </>
        )}
        </div>
      </section>
        </div>

        <div className="contents xl:flex xl:flex-col xl:gap-4 xl:col-span-6">
      {/* My day — today's classes as a period timeline (+ covers I took) */}
      <PeriodTimeline rows={dayRows} loaded={!!ttMine} onMark={setMarkSlot} markOpen={markOpen} openLabel={openLabel} markedRec={markedRec} nowMin={nowM} />

      {/* Mentor's Day-Scholar Gate Log — server-scoped to THIS mentor's own
          mentees. The warden has no access to this data (moved out of the
          warden register deliberately). Shows LEAVE exits + COMMUTE in/outs. */}
      <section id="td-gatelog" className="order-6 xl:grow xl:flex xl:flex-col scroll-mt-[124px] bg-white border border-blue-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-4 sm:px-5 py-3 bg-gradient-to-r from-blue-50 to-white border-b border-blue-100">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-9 h-9 rounded-xl bg-blue-100/70 text-blue-700 border border-blue-200 flex items-center justify-center shrink-0">
                <UserCheck className="w-4 h-4" />
              </span>
              <h3 className="text-[15px] font-bold text-slate-900 leading-snug min-w-0">
                My Day-Scholars&apos; Gate Log
              </h3>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={loadScans}
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-blue-200 bg-white hover:bg-blue-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                title="Refresh gate log"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 mt-1 leading-snug">
            Visible ONLY to you — your own mentees&apos; campus in/out and mentor-approved leave exits, straight from the gate scanner.
          </p>
          {dsScans && (
            <span className="inline-block mt-1.5 text-[11px] font-mono font-bold text-blue-800 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full">
              {dsScans.menteeCount} day scholars
            </span>
          )}
        </div>
        <div className="p-4 sm:p-5 space-y-3 xl:flex-1 xl:flex xl:flex-col">
        {!dsScans || (dsScans.scans || []).length === 0 ? (
          <div className="py-3 flex flex-col items-center justify-center text-center gap-1.5 text-slate-500 xl:my-auto">
            <span className="w-12 h-12 rounded-full bg-blue-50 border border-blue-100 text-blue-500 flex items-center justify-center mb-1">
              <UserCheck className="w-6 h-6" />
            </span>
            <p className="text-sm font-bold text-slate-700">
              {dsScans && dsScans.registerOk === false ? 'Gate register not connected yet' : 'No gate scans for your mentees yet'}
            </p>
            <p className="text-[11px] max-w-xs">Scans appear here the moment the guard reads a mentee&apos;s Campus-QR.</p>
          </div>
        ) : (
          <div className={`space-y-2 pr-1 ${showAllScans ? 'max-h-96 overflow-y-auto' : ''}`}>
            {(showAllScans ? dsScans.scans : dsScans.scans.slice(0, SCAN_PREVIEW)).map(row => {
              const cat = String(row.category || '').toUpperCase();
              const isLeave = cat === 'LEAVE';
              return (
                <div key={row.id} className="bg-slate-50/60 border border-slate-200 rounded-xl px-3.5 py-3 flex flex-wrap sm:flex-nowrap items-center gap-x-3 gap-y-1.5 sm:gap-3">
                  <span className={`shrink-0 text-[10px] font-mono font-extrabold px-2.5 py-1 rounded-full w-fit border ${isLeave
                    ? 'text-amber-800 bg-amber-100 border-amber-200'
                    : row.direction === 'IN'
                      ? 'text-emerald-800 bg-emerald-100 border-emerald-200'
                      : 'text-sky-800 bg-sky-100 border-sky-200'}`}>
                    {isLeave ? '↑ LEAVE OUT' : row.direction === 'IN' ? '↓ IN' : '↑ OUT'}
                  </span>
                  <div className="min-w-0 flex-1 basis-full order-last sm:order-none sm:basis-auto">
                    <div className="text-xs font-bold text-slate-900 truncate">
                      {row.student_name || 'Student'}
                      <span className="text-[11px] font-normal text-slate-500 font-mono"> ({row.student_roll})</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                      {isLeave ? 'Mentor-approved leave exit' : 'Campus commute scan'} • by {row.scanned_by || 'Guard'}
                    </div>
                  </div>
                  <div className="shrink-0 ml-auto sm:ml-0 text-[10px] font-mono text-slate-500">
                    {row.scanned_at ? new Date(row.scanned_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {dsScans && (dsScans.scans || []).length > SCAN_PREVIEW && (
          <button
            type="button"
            onClick={() => setShowAllScans(v => !v)}
            className="w-full min-h-[44px] rounded-xl border border-blue-200 bg-blue-50/50 hover:bg-blue-50 text-blue-800 text-xs font-bold transition-colors cursor-pointer"
          >
            {showAllScans ? 'Show less' : `View all (${dsScans.scans.length})`}
          </button>
        )}
        </div>
      </section>
        </div>

      </div>

      {/* Teaching tools: class analytics · lesson plan · my leaves */}
      <TeacherInsights />

      </>)}

      {/* "On Leave Today" — pick who covers (also used for "Change") */}
      <CoverPickerModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onConfirm={(roll) => toggleAbsent(true, roll)}
        currentRoll={onLeave ? (myState.delegatedTo || null) : null}
        busy={toggling}
      />

      {/* My Mentees list — opens only on tap. Phone: bottom sheet; laptop: side panel */}
      {menteesOpen && createPortal(
        <div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-labelledby="td-mentees-panel-title">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => setMenteesOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[88dvh] sm:inset-y-0 sm:left-auto sm:right-0 sm:max-h-none sm:w-[34rem] bg-white rounded-t-3xl sm:rounded-none sm:rounded-l-3xl shadow-2xl flex flex-col overflow-hidden">
            <div className="sm:hidden mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-300" />
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 bg-gradient-to-r from-cyan-50 to-white border-b border-cyan-100">
              <h3 id="td-mentees-panel-title" className="text-[15px] font-bold text-slate-900 flex items-center gap-2.5 min-w-0">
                <span className="w-9 h-9 rounded-xl bg-cyan-100/70 text-cyan-700 border border-cyan-200 flex items-center justify-center shrink-0">
                  <Users className="w-4 h-4" />
                </span>
                My Mentees
              </h3>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-mono font-bold text-cyan-800 bg-cyan-50 border border-cyan-200 px-2.5 py-1 rounded-full">{mentees.length} students</span>
                <button
                  type="button"
                  onClick={() => setMenteesOpen(false)}
                  aria-label="Close"
                  className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="px-4 sm:px-5 pt-3">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
                placeholder="Search students or reasons…"
                className="w-full min-h-[44px] pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white/90 text-sm outline-none focus:border-slate-400 transition-colors"
              />
            </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {mentees.length === 0 ? (
              <div className="py-8 text-center text-xs text-slate-500 space-y-1">
                <Users className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="font-bold text-slate-600">No mentees assigned to you yet</p>
                <p className="text-[11px]">The mentor→student mapping is set by the college roster.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {mentees.map(m => renderMenteeRow(m))}
              </div>
            )}
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Create leave for student — one picker for my mentees + today's covered
          day scholars (keypad-phone students). Phone: full-height bottom sheet;
          laptop: centred modal. Same createLeave() call as before. */}
      {mlOpen && createPortal(
        <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="td-create-leave-title">
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={closeCreateLeave} />
          <div className="relative w-full sm:max-w-lg h-[92dvh] sm:h-auto sm:max-h-[85vh] bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200/80 flex flex-col overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-10 h-10 rounded-2xl bg-slate-900 flex items-center justify-center text-white shrink-0">
                  <UserCheck className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 id="td-create-leave-title" className="text-base font-bold text-slate-900">Create leave for student</h3>
                  <p className="text-xs text-slate-500">For keypad-phone students without the app</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeCreateLeave}
                aria-label="Close"
                className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {mlDone ? (
              <div className="p-5 sm:p-6 text-center space-y-3 overflow-y-auto">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto" />
                <div className="text-2xl font-extrabold font-mono tracking-wide text-slate-900">{mlDone.number}</div>
                <p className="text-xs text-slate-600 font-medium leading-relaxed">
                  {`Leave ${mlDone.number} approved — SMS sent to the student. Tell them the number too.`}
                </p>
                <button
                  type="button"
                  onClick={closeCreateLeave}
                  className="w-full min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  Done
                </button>
              </div>
            ) : mlPicked ? (
              <div className="p-4 sm:p-5 space-y-3 overflow-y-auto">
                <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-3.5 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-bold text-slate-900 truncate">{mlPicked.full_name}</div>
                    <div className="text-[11px] font-mono text-slate-500 mt-0.5 truncate">{mlPicked.roll_number} • {mlPicked.department || '—'}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setMlRoll(null); setMlErr(''); }}
                    className="min-h-[44px] px-3 text-[11px] font-bold text-emerald-700 hover:text-emerald-900 cursor-pointer shrink-0"
                  >
                    Change
                  </button>
                </div>
                <label className="block text-[11px] font-bold text-slate-600" htmlFor="ml-reason">
                  Reason (student has no smartphone — leave is approved at once, number goes by SMS)
                </label>
                <input
                  id="ml-reason"
                  type="text"
                  value={mlReason}
                  onChange={e => setMlReason(e.target.value)}
                  placeholder="e.g. Fever, going home"
                  maxLength={200}
                  autoFocus
                  className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
                />
                {mlErr && <p className="text-[11px] font-bold text-rose-600">{mlErr}</p>}
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={mlBusy || mlReason.trim().length < 5}
                    onClick={() => createLeave(mlPicked.roll_number)}
                    className="flex-1 min-h-[44px] px-4 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    {mlBusy ? 'Creating…' : 'Approve & send SMS'}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMlRoll(null); setMlErr(''); }}
                    className="min-h-[44px] px-4 rounded-xl border border-slate-300 bg-white text-slate-700 text-xs font-bold hover:bg-slate-50 transition"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="px-4 sm:px-5 pt-3 pb-2">
                  <div className="relative">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      value={mlQuery}
                      onChange={(e) => setMlQuery(e.target.value)}
                      placeholder="Name or roll number"
                      aria-label="Find the student"
                      className="w-full min-h-[44px] pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-slate-50 text-sm outline-none focus:border-slate-400 transition-colors"
                    />
                  </div>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 pb-[max(1rem,env(safe-area-inset-bottom))] space-y-2">
                  {mlList.length === 0 ? (
                    <p className="py-8 text-center text-xs text-slate-500">No student matched that name or roll number.</p>
                  ) : mlList.map(m => {
                    const ok = canCreateFor(m);
                    const chip = statusChips[m.todayStatus] || statusChips.NO_REQUEST_TODAY;
                    return (
                      <button
                        key={`${m.coverFor || 'mine'}-${m.roll_number}`}
                        type="button"
                        disabled={!ok}
                        onClick={() => { setMlRoll(m.roll_number); setMlReason(''); setMlErr(''); }}
                        className={`w-full min-h-[56px] text-left rounded-xl border px-3.5 py-2.5 flex items-center justify-between gap-3 transition-colors ${ok
                          ? 'bg-white border-slate-200 hover:bg-emerald-50 hover:border-emerald-300 cursor-pointer'
                          : 'bg-slate-50 border-slate-100 opacity-60 cursor-not-allowed'}`}
                      >
                        <span className="min-w-0">
                          <span className="block text-xs font-bold text-slate-900 break-words">
                            {m.full_name} <span className="text-[11px] font-normal text-slate-500 font-mono whitespace-nowrap">({m.roll_number})</span>
                          </span>
                          <span className="block text-[11px] text-slate-500 font-medium mt-0.5 truncate">
                            {m.coverFor ? `Covering for ${m.coverFor}` : (m.department || '—')}
                          </span>
                        </span>
                        <span className={`shrink-0 text-[10px] font-extrabold px-2.5 py-1 rounded-full border ${ok ? chip.cls : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                          {ok ? chip.label : notEligibleWhy(m)}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* Phase 3: attendance marking overlay, opened from a timetable row */}
      <AttendanceMarkModal
        isOpen={!!markSlot}
        slot={markSlot}
        onClose={() => setMarkSlot(null)}
        onMarked={(rec, statement) => {
          if (rec?.sectionKey) setTtMarked(prev => ({ ...prev, [`${rec.sectionKey}|${rec.period}`]: rec }));
          onNotification?.(statement, 'success');
          if (rec?.coveredFor) load(false); // a covered class: refresh the Covering view's lock chips
        }}
      />
    </div>
  );
}

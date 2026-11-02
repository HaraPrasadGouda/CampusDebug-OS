import React, { useState, useEffect } from 'react';
import {
  CheckCircle2, X, Users, Coffee, RefreshCw, Clock, LogOut, Search, GraduationCap, ShieldAlert, Sun, CalendarDays, MapPin, UserCheck
} from 'lucide-react';
import { getAccessToken } from '../../utils/authClient';
import AttendanceMarkModal from '../modals/AttendanceMarkModal';
import { leaveNumber } from '../../utils/passNumber';

// Day-scholar leave mentor console. scoped server-side: a TEACHER's queue
// only ever contains their own mentees (+ leaves routed to them while they
// cover for an absent mentor). The admin is not part of the leave flow.

const statusChips = {
  NO_REQUEST_TODAY: { cls: 'bg-slate-50 text-slate-600 border-slate-200', label: 'No request today' },
  PENDING: { cls: 'bg-amber-50 text-amber-800 border-amber-200', label: 'Pending with you' },
  APPROVED_NOT_OUT: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Approved — not yet out' },
  OUT: { cls: 'bg-sky-50 text-sky-700 border-sky-200', label: 'Out of campus (leave)' },
  REJECTED: { cls: 'bg-rose-50 text-rose-700 border-rose-200', label: 'Rejected today' },
  EXPIRED: { cls: 'bg-slate-50 text-slate-600 border-slate-200', label: 'Expired (16:30 close)' }
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
  const [showAllMentees, setShowAllMentees] = useState(false);
  const [showAllScans, setShowAllScans] = useState(false);
  // Mentor-created leave (keypad-phone day scholars): which mentee row has the
  // reason box open, the draft, and the last error for that row.
  const [mlRoll, setMlRoll] = useState(null);
  const [mlReason, setMlReason] = useState('');
  const [mlBusy, setMlBusy] = useState(false);
  const [mlErr, setMlErr] = useState('');

  // --- My Teaching Timetable (Phase 2): the solver publishes engagement for
  //     THIS faculty (matched on the FAC-staff roll). Today's classes first.
  const [ttMine, setTtMine] = useState(null);
  // Attendance marking (Phase 3): opened straight from today's timetable row.
  const [markSlot, setMarkSlot] = useState(null);
  // HARD LOCK state: `${sectionKey}|${period}` -> the saved record. A class
  // that appears here shows a "Marked ✓ Locked" chip instead of a Mark button.
  const [ttMarked, setTtMarked] = useState({});

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

  const toggleAbsent = async (onLeave) => {
    setToggling(true);
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/leave-requests/teacher-absent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ onLeave })
      });
      const j = await r.json();
      if (j?.success) {
        if (onNotification) onNotification(
          j.message || (j.onLeave
            ? (j.delegatedTo
              ? `Marked On Leave — ${j.delegatedTo} handles your mentees' leaves today.`
              : 'Marked On Leave — no other teacher is present, so requests stay in your queue.')
            : 'Welcome back — your mentees\' pending requests are yours again.'),
          'success'
        );
        load(false);
      } else if (onNotification) {
        onNotification(j?.error || 'Toggle failed.', 'error');
      }
    } catch {
      if (onNotification) onNotification('Offline — toggle failed.', 'error');
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
  })).filter(g => g.mentees.length > 0);

  // One mentee row (status chip, LV number chip, "Create leave" + reason box).
  // Used for my own mentees and, with `covering`, for an absent mentor's
  // day scholars I am covering today (their live leave id comes from the server).
  const renderMenteeRow = (m, covering = false) => {
    const chip = statusChips[m.todayStatus] || statusChips.NO_REQUEST_TODAY;
    const isDS = String(m.resident_type || '').toLowerCase() === 'dayscholar';
    const canCreate = isDS && ['NO_REQUEST_TODAY', 'REJECTED', 'EXPIRED'].includes(m.todayStatus || 'NO_REQUEST_TODAY');
    const liveLeave = m.todayStatus !== 'APPROVED_NOT_OUT' ? null
      : covering ? (m.liveLeaveId ? { id: m.liveLeaveId } : null)
        : (queue?.leaves || []).find(l => l.student_roll === m.roll_number && l.status === 'APPROVED' && !l.scanned_at);
    const formOpen = mlRoll === m.roll_number;
    return (
      <div key={m.id} className="bg-slate-50/60 border border-slate-200 rounded-xl px-3.5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="min-w-0 grow basis-full sm:basis-[15rem]">
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
            {liveLeave && (
              <span className="shrink-0 font-mono text-[11px] font-extrabold text-emerald-800 bg-emerald-50 border border-emerald-300 px-2.5 py-1 rounded-lg" title="Leave number — the student tells the guard this">
                {leaveNumber(liveLeave.id)}
              </span>
            )}
            {canCreate && !formOpen && (
              <button
                type="button"
                onClick={() => { setMlRoll(m.roll_number); setMlReason(''); setMlErr(''); }}
                className="shrink-0 min-h-[44px] px-3.5 rounded-xl border border-cyan-300 bg-white text-cyan-800 text-xs font-bold hover:bg-cyan-50 active:scale-[0.98] transition"
              >
                Create leave
              </button>
            )}
          </div>
        </div>
        {formOpen && (
          <div className="mt-3 pt-3 border-t border-slate-200 space-y-2">
            <label className="block text-[11px] font-bold text-slate-600" htmlFor={`ml-${m.roll_number}`}>
              Reason (student has no smartphone — leave is approved at once, number goes by SMS)
            </label>
            <input
              id={`ml-${m.roll_number}`}
              type="text"
              value={mlReason}
              onChange={e => setMlReason(e.target.value)}
              placeholder="e.g. Fever, going home"
              maxLength={200}
              className="w-full min-h-[44px] px-3 rounded-xl border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400"
            />
            {mlErr && <p className="text-[11px] font-bold text-rose-600">{mlErr}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                disabled={mlBusy || mlReason.trim().length < 5}
                onClick={() => createLeave(m.roll_number)}
                className="flex-1 sm:flex-none min-h-[44px] px-4 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
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
        )}
      </div>
    );
  };

  // Section switcher chips (layout only): each chip scrolls to its own card.
  const ttTodayCount = ttMine ? (ttMine.slots || []).filter(s => s.day === TT_TEACHER_TODAY).length : null;
  const sectionChips = [
    { id: 'td-approvals', label: 'Approval Queue', count: pendingLeaves.length, dot: 'bg-amber-500', hot: pendingLeaves.length > 0 },
    ...(coverGroups.length > 0 ? [{ id: 'td-covering', label: 'Covering', count: coverGroups.reduce((n, g) => n + g.mentees.length, 0), dot: 'bg-indigo-500', hot: true }] : []),
    ...(decidedToday.length > 0 ? [{ id: 'td-decisions', label: "Today's Decisions", count: decidedToday.length, dot: 'bg-violet-500' }] : []),
    { id: 'td-timetable', label: 'Timetable', count: ttTodayCount, dot: 'bg-teal-500' },
    { id: 'td-mentees', label: 'My Mentees', count: mentees.length, dot: 'bg-cyan-500' },
    { id: 'td-gatelog', label: 'Gate Log', count: dsScans ? (dsScans.scans || []).length : null, dot: 'bg-blue-500' },
    { id: 'td-status', label: queue?.onLeaveState?.onLeave ? 'On Leave Today' : 'Present today', count: null, dot: queue?.onLeaveState?.onLeave ? 'bg-amber-500' : 'bg-emerald-500', phoneOnly: true }
  ];
  const jumpToSection = (id) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-4xl xl:max-w-6xl 2xl:max-w-none mx-auto w-full">

      {/* 0. Wish Card — identical to the student dashboard's greeting banner:
          plain text on mobile, carded with the campus backdrop on desktop */}
      <div className="relative md:overflow-hidden rounded-none sm:rounded-2xl md:rounded-3xl bg-transparent sm:bg-white/90 sm:backdrop-blur-sm border-0 sm:border sm:border-slate-200/50 shadow-none sm:shadow-sm p-0 sm:p-5 md:p-8 flex flex-col md:flex-row md:items-center justify-between md:min-h-[140px] pb-1 sm:pb-0 -mt-1 sm:mt-0">
        <div className="relative z-10 max-w-lg">
          <h1 className="text-2xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            <span>{getGreeting()}, {teacherFirstName}!</span>
            <span className="text-xl sm:text-3xl animate-bounce">👋</span>
          </h1>
          <p className="text-[11px] sm:text-sm text-slate-500 mt-1.5 font-medium leading-relaxed">
            Your mentor console — approvals, timetable and mentee welfare in one place.
          </p>
        </div>
        <div className="hidden md:block absolute right-0 top-0 bottom-0 w-1/2 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-r from-white via-white/50 to-transparent z-10"></div>
          <img
            src="/campus_banner.jpg"
            alt="Campus"
            className="w-full h-full object-cover object-right opacity-80"
          />
        </div>
      </div>

      {/* Header */}
      <div className="bg-white/90 backdrop-blur-sm border border-slate-200/50 rounded-2xl p-4 sm:p-5 shadow-sm flex flex-row items-start sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-extrabold text-slate-900 tracking-tight flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-cyan-700" />
            Faculty Mentor Console
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Day-scholar leave approvals are YOURS to make — every decision is explicit, nothing auto-approves.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {queue?.pendingCount > 0 && (
            <span className="hidden sm:inline-block text-[11px] font-mono font-bold text-amber-800 bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-full">
              {queue.pendingCount} Pending
            </span>
          )}
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
        <div className="flex gap-2 overflow-x-auto scrollbar-none -mx-4 px-4 sm:mx-0 sm:px-0 xl:flex-wrap">
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
                <span className={`min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-mono font-extrabold flex items-center justify-center ${s.hot ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600'}`}>
                  {s.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>

      {/* Sections: phone = one column (Approvals first); laptop (xl) = Approvals + Decisions
          on the left, Timetable + availability + Mentees on the right, Gate Log full width below */}
      <div className="flex flex-col gap-4 xl:grid xl:grid-cols-12 xl:items-start">
        <div className="contents xl:flex xl:flex-col xl:gap-4 xl:col-span-6">
      {/* Search (sidebar search + local input both apply) */}
      <div className="order-1 relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="Search students or reasons…"
          className="w-full min-h-[44px] pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white/90 text-sm outline-none focus:border-slate-400 transition-colors"
        />
      </div>

      {/* APPROVAL QUEUE — the always-works path */}
      <section id="td-approvals" className="order-2 scroll-mt-[124px] bg-white border-2 border-amber-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 bg-gradient-to-r from-amber-50 to-white border-b border-amber-100">
          <h3 className="text-[15px] font-bold text-slate-900 flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-amber-100/70 text-amber-700 border border-amber-200 flex items-center justify-center shrink-0">
              <Clock className="w-4 h-4" />
            </span>
            Approval Queue
          </h3>
          <span className={`shrink-0 text-[11px] font-mono font-bold px-2.5 py-1 rounded-full border ${pendingLeaves.length > 0 ? 'text-white bg-amber-500 border-amber-500' : 'text-slate-600 bg-slate-50 border-slate-200'}`}>{pendingLeaves.length} waiting</span>
        </div>
        <div className="p-4 sm:p-5">

        {loading && !queue ? (
          <div className="py-8 text-center text-xs text-slate-500 font-semibold">Loading your queue…</div>
        ) : pendingLeaves.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 space-y-1">
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
                  </div>
                </div>
                <input
                  value={noteDraft}
                  onChange={(e) => setNoteDraft(e.target.value)}
                  placeholder="Optional note to the student (e.g. come back after the appointment)"
                  maxLength={200}
                  className="w-full min-h-[44px] rounded-xl border border-amber-200 bg-white p-2.5 text-xs outline-none focus:border-amber-400 transition-colors"
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

      {/* Covering for an absent mentor — today only: their day scholars, with
          "Create leave" (keypad-phone students). Their pending requests are
          already in the Approval Queue above. */}
      {coverGroups.map(g => (
        <section key={g.mentorRoll} id="td-covering" className="order-2 scroll-mt-[124px] bg-white border-2 border-indigo-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 bg-gradient-to-r from-indigo-50 to-white border-b border-indigo-100">
            <h3 className="text-[15px] font-bold text-slate-900 flex items-center gap-2.5 min-w-0">
              <span className="w-9 h-9 rounded-xl bg-indigo-100/70 text-indigo-700 border border-indigo-200 flex items-center justify-center shrink-0">
                <UserCheck className="w-4 h-4" />
              </span>
              <span className="min-w-0">Covering for {g.mentorName}</span>
            </h3>
            <span className="shrink-0 text-[11px] font-mono font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-full">{g.mentees.length} students</span>
          </div>
          <div className="p-4 sm:p-5 space-y-3">
            <p className="text-[11px] text-slate-500 leading-snug">
              {g.mentorName} is on leave today. Their day scholars' requests come to you — approve them in the queue, or create a leave here for a student without a smartphone.
            </p>
            <div className="space-y-2">
              {g.mentees.map(m => renderMenteeRow(m, true))}
            </div>
          </div>
        </section>
      ))}

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
        </div>

        <div className="contents xl:flex xl:flex-col xl:gap-4 xl:col-span-6">
      {/* My Teaching Timetable (Phase 2) — today's engagement sheet */}
      <section id="td-timetable" className="order-4 scroll-mt-[124px] rounded-2xl border border-teal-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-2 px-4 py-3 bg-gradient-to-r from-teal-50 to-white border-b border-teal-100">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-teal-100/70 text-teal-700 flex items-center justify-center border border-teal-200 shrink-0">
              <CalendarDays className="w-4 h-4" />
            </div>
            <h3 className="text-[15px] font-bold text-slate-900">My Teaching Timetable</h3>
          </div>
          <span className="shrink-0 text-[11px] font-bold text-teal-800 bg-teal-50 border border-teal-200 rounded-full px-2.5 py-1">
            Today · {ttMine ? `${(ttMine.slots || []).filter(s => s.day === TT_TEACHER_TODAY).length} classes` : '…'}
          </span>
        </div>
        {ttMine && (ttMine.slots || []).filter(s => s.day === TT_TEACHER_TODAY).length > 0 ? (
          <div className="space-y-1.5 p-3 sm:p-4">
            {ttMine.slots
              .filter(s => s.day === TT_TEACHER_TODAY)
              .sort((a, b) => a.period - b.period)
              .map((s, i) => (
                <div key={`${s.day}-${s.period}-${i}`} className="flex flex-wrap sm:flex-nowrap items-center gap-x-2.5 gap-y-1.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] font-black text-teal-700 bg-teal-50 border border-teal-200 rounded-md px-1.5 py-0.5 shrink-0">{s.periodLabel}</span>
                  <div className="flex-1 min-w-0 basis-[calc(100%-3rem)] sm:basis-auto">
                    <p className="text-xs font-bold text-slate-900 truncate">
                      {s.subject} <span className={s.kind === 'lab' ? 'text-[9px] font-black text-violet-700' : ''}>{s.kind === 'lab' ? '(LAB)' : ''}</span>
                    </p>
                    <p className="text-[10px] text-slate-500 font-medium truncate">{s.sectionLabel || s.departmentLabel}<span className="hidden xl:inline 2xl:hidden"> · {s.time}</span></p>
                  </div>
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 shrink-0 ml-[42px] sm:ml-0">
                    <MapPin className="w-3 h-3" />{s.room}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400 shrink-0 hidden sm:block xl:hidden 2xl:block">{s.time}</span>
                  {s.kind !== 'study' && (markedRec(s) ? (
                    <span
                      className="flex items-center gap-1 text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1 shrink-0 ml-auto sm:ml-0"
                      title={`LOCKED — ${markedRec(s).takenByName || 'A teacher'} saved this class with ${(markedRec(s).present || []).length} present. Only an admin can unlock it.`}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      Marked {(markedRec(s).present || []).length}/50 · Locked
                    </span>
                  ) : !markOpen(s) ? (
                    <span
                      className="flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 shrink-0 ml-auto sm:ml-0"
                      title={`Marking opens at ${openLabel(s)} — 10 minutes before the class starts. No early marking.`}
                    >
                      <Clock className="w-3 h-3" />
                      Opens {openLabel(s)}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setMarkSlot(s)}
                      className="flex items-center gap-1 text-[10px] font-black text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-3 min-h-[44px] transition-colors cursor-pointer shrink-0 ml-auto sm:ml-0"
                      title={`Mark attendance for ${s.subject} · ${s.periodLabel}`}
                    >
                      <UserCheck className="w-3 h-3" />
                      Mark
                    </button>
                  ))}
                </div>
              ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500 font-medium px-4 py-4">
            {ttMine ? 'No classes for you today — enjoy a quieter campus day.' : 'Schedule loads when the server timetable engine is reachable.'}
          </p>
        )}
      </section>

      {/* On Leave Today — 1-tap delegation */}
      <section id="td-status" className={`order-7 xl:order-4 scroll-mt-[124px] rounded-2xl border p-4 shadow-sm ${queue?.onLeaveState?.onLeave ? 'bg-amber-50/60 border-amber-300' : 'bg-white border-slate-200/50'}`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            {queue?.onLeaveState?.onLeave
              ? <Coffee className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              : <Sun className="w-5 h-5 text-slate-500 mt-0.5 shrink-0" />}
            <div>
              <p className="text-sm font-extrabold text-slate-900">
                {queue?.onLeaveState?.onLeave
                  ? (queue.onLeaveState.delegatedTo ? `On Leave Today — covered by ${queue.onLeaveState.delegatedTo}` : 'On Leave Today — no colleague present')
                  : 'Present today'}
              </p>
              <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                {queue?.onLeaveState?.onLeave
                  ? (queue.onLeaveState.delegatedTo
                    ? 'Your substitute approves, rejects and creates leaves for your mentees today. Tap "Back Today" when you return.'
                    : 'Nobody else is present, so your mentees\' requests stay in your queue. Tap "Back Today" when you return.')
                  : 'Taking a day off? One tap hands your mentees\' leaves to a present colleague for today — approve, reject and create.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={toggling || !queue}
            onClick={() => toggleAbsent(!(queue?.onLeaveState?.onLeave))}
            className={`shrink-0 px-4 py-2.5 min-h-[44px] rounded-xl text-xs font-extrabold transition-colors cursor-pointer disabled:opacity-60 border-2 ${
              queue?.onLeaveState?.onLeave
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                : 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500'
            }`}
          >
            {toggling ? 'Working…' : queue?.onLeaveState?.onLeave ? 'Back Today' : 'On Leave Today'}
          </button>
        </div>
      </section>

      {/* My Mentees */}
      <section id="td-mentees" className="order-5 scroll-mt-[124px] bg-white border border-cyan-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 bg-gradient-to-r from-cyan-50 to-white border-b border-cyan-100">
          <h3 className="text-[15px] font-bold text-slate-900 flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-cyan-100/70 text-cyan-700 border border-cyan-200 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </span>
            My Mentees
          </h3>
          <span className="shrink-0 text-[11px] font-mono font-bold text-cyan-800 bg-cyan-50 border border-cyan-200 px-2.5 py-1 rounded-full">{mentees.length} students</span>
        </div>
        <div className="p-4 sm:p-5 space-y-3">
        {mentees.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 space-y-1">
            <Users className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="font-bold text-slate-600">No mentees assigned to you yet</p>
            <p className="text-[11px]">The mentor→student mapping is set by the college roster.</p>
          </div>
        ) : (
          <div className={`space-y-2 pr-1 ${showAllMentees || filterText ? 'max-h-96 overflow-y-auto' : ''}`}>
            {(showAllMentees || filterText ? mentees : mentees.slice(0, LIST_PREVIEW)).map(m => renderMenteeRow(m))}
          </div>
        )}
        {mentees.length > LIST_PREVIEW && !filterText && (
          <button
            type="button"
            onClick={() => setShowAllMentees(v => !v)}
            className="w-full min-h-[44px] rounded-xl border border-cyan-200 bg-cyan-50/50 hover:bg-cyan-50 text-cyan-800 text-xs font-bold transition-colors cursor-pointer"
          >
            {showAllMentees ? 'Show less' : `View all (${mentees.length})`}
          </button>
        )}
        </div>
      </section>
        </div>

      {/* Mentor's Day-Scholar Gate Log — server-scoped to THIS mentor's own
          mentees. The warden has no access to this data (moved out of the
          warden register deliberately). Shows LEAVE exits + COMMUTE in/outs. */}
      <section id="td-gatelog" className="order-6 xl:col-span-12 scroll-mt-[124px] bg-white border border-blue-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-start justify-between gap-3 px-4 sm:px-5 py-3 bg-gradient-to-r from-blue-50 to-white border-b border-blue-100">
          <div className="flex items-start gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-blue-100/70 text-blue-700 border border-blue-200 flex items-center justify-center shrink-0">
              <UserCheck className="w-4 h-4" />
            </span>
            <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-slate-900 leading-9">
              My Day-Scholars&apos; Gate Log
            </h3>
            <p className="text-[11px] text-slate-500 -mt-1 leading-snug">
              Visible ONLY to you — your own mentees&apos; campus in/out and mentor-approved leave exits, straight from the gate scanner.
            </p>
            {dsScans && (
              <span className="inline-block mt-1.5 text-[11px] font-mono font-bold text-blue-800 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full">
                {dsScans.menteeCount} day scholars
              </span>
            )}
            </div>
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
        <div className="p-4 sm:p-5 space-y-3">
        {!dsScans || (dsScans.scans || []).length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 space-y-1">
            <UserCheck className="w-7 h-7 text-slate-300 mx-auto" />
            <p className="font-semibold text-slate-600">
              {dsScans && dsScans.registerOk === false ? 'Gate register not connected yet' : 'No gate scans for your mentees yet'}
            </p>
            <p className="text-[11px]">Scans appear here the moment the guard reads a mentee&apos;s Campus-QR.</p>
          </div>
        ) : (
          <div className={`space-y-2 pr-1 xl:grid xl:grid-cols-2 xl:gap-2 xl:space-y-0 ${showAllScans ? 'max-h-96 overflow-y-auto' : ''}`}>
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

      {/* Phase 3: attendance marking overlay, opened from a timetable row */}
      <AttendanceMarkModal
        isOpen={!!markSlot}
        slot={markSlot}
        onClose={() => setMarkSlot(null)}
        onMarked={(rec, statement) => {
          if (rec?.sectionKey) setTtMarked(prev => ({ ...prev, [`${rec.sectionKey}|${rec.period}`]: rec }));
          onNotification?.(statement, 'success');
        }}
      />
    </div>
  );
}

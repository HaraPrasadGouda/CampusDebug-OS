import React, { useState, useEffect } from 'react';
import {
  CheckCircle2, X, Users, Coffee, RefreshCw, Clock, LogOut, Search, GraduationCap, ShieldAlert, Sun, CalendarDays, MapPin, UserCheck
} from 'lucide-react';
import { getAccessToken } from '../../utils/authClient';
import AttendanceMarkModal from '../modals/AttendanceMarkModal';

// Day-scholar leave mentor console. scoped server-side: a TEACHER's queue
// only ever contains their own mentees (+ leaves routed to them by the
// absence delegation system) — ADMIN sees everything, TEACHER sees theirs.

const statusChips = {
  NO_REQUEST_TODAY: { cls: 'bg-slate-50 text-slate-600 border-slate-200', label: 'No request today' },
  PENDING: { cls: 'bg-amber-50 text-amber-800 border-amber-200', label: 'Pending with you' },
  APPROVED_NOT_OUT: { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Approved — not yet out' },
  OUT: { cls: 'bg-sky-50 text-sky-700 border-sky-200', label: 'Out of campus (leave)' },
  REJECTED: { cls: 'bg-rose-50 text-rose-700 border-rose-200', label: 'Rejected today' },
  EXPIRED: { cls: 'bg-slate-50 text-slate-600 border-slate-200', label: 'Expired (16:30 close)' }
};

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
          action === 'APPROVED' ? 'Approved — the student must show their Campus-QR at the gate; nothing auto-approved.' : 'Request rejected — the student has been notified.',
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

  const toggleAbsent = async (onLeave) => {
    setToggling(true);
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/leave-requests/teacher-absent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ onLeave, delegate: 'AUTO' })
      });
      const j = await r.json();
      if (j?.success) {
        if (onNotification) onNotification(
          j.onLeave
            ? (j.delegatedTo === 'ADMIN'
              ? 'Marked On Leave — your pending approvals escalated to the ADMIN queue.'
              : `Marked On Leave — pending approvals delegate to ${j.delegatedTo}.`)
            : 'Welcome back — your mentees\' pending requests are yours again.',
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

  return (
    <div className="p-4 sm:p-6 space-y-4 max-w-4xl mx-auto w-full">

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
      <div className="bg-white/90 backdrop-blur-sm border border-slate-200/50 rounded-2xl p-4 sm:p-5 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
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
            <span className="text-[11px] font-mono font-bold text-amber-800 bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-full">
              {queue.pendingCount} Pending
            </span>
          )}
          <button
            type="button"
            onClick={() => load(true)}
            className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
            title="Refresh queue"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* My Teaching Timetable (Phase 2) — today's engagement sheet */}
      <div className="bg-white border border-teal-100 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center border border-teal-200">
              <CalendarDays className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-800">My Teaching Timetable</h3>
          </div>
          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-2 py-0.5">
            Today · {ttMine ? `${(ttMine.slots || []).filter(s => s.day === TT_TEACHER_TODAY).length} classes` : '…'}
          </span>
        </div>
        {ttMine && (ttMine.slots || []).filter(s => s.day === TT_TEACHER_TODAY).length > 0 ? (
          <div className="space-y-1.5">
            {ttMine.slots
              .filter(s => s.day === TT_TEACHER_TODAY)
              .sort((a, b) => a.period - b.period)
              .map((s, i) => (
                <div key={`${s.day}-${s.period}-${i}`} className="flex items-center gap-2.5 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100">
                  <span className="text-[10px] font-black text-teal-700 bg-teal-50 border border-teal-200 rounded-md px-1.5 py-0.5 shrink-0">{s.periodLabel}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-slate-900 truncate">
                      {s.subject} <span className={s.kind === 'lab' ? 'text-[9px] font-black text-violet-700' : ''}>{s.kind === 'lab' ? '(LAB)' : ''}</span>
                    </p>
                    <p className="text-[10px] text-slate-500 font-medium truncate">{s.sectionLabel || s.departmentLabel}</p>
                  </div>
                  <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500 shrink-0">
                    <MapPin className="w-3 h-3" />{s.room}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400 shrink-0 hidden sm:block">{s.time}</span>
                  {s.kind !== 'study' && (markedRec(s) ? (
                    <span
                      className="flex items-center gap-1 text-[10px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1 shrink-0"
                      title={`LOCKED — ${markedRec(s).takenByName || 'A teacher'} saved this class with ${(markedRec(s).present || []).length} present. Only an admin can unlock it.`}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                      Marked {(markedRec(s).present || []).length}/50 · Locked
                    </span>
                  ) : !markOpen(s) ? (
                    <span
                      className="flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 shrink-0"
                      title={`Marking opens at ${openLabel(s)} — 10 minutes before the class starts. No early marking.`}
                    >
                      <Clock className="w-3 h-3" />
                      Opens {openLabel(s)}
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setMarkSlot(s)}
                      className="flex items-center gap-1 text-[10px] font-black text-white bg-teal-600 hover:bg-teal-700 rounded-lg px-2 py-1 transition-colors cursor-pointer shrink-0"
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
          <p className="text-xs text-slate-500 font-medium">
            {ttMine ? 'No classes for you today — enjoy a quieter campus day.' : 'Schedule loads when the server timetable engine is reachable.'}
          </p>
        )}
      </div>

      {/* On Leave Today — 1-tap delegation */}
      <div className={`rounded-2xl border p-4 shadow-sm ${queue?.onLeaveState?.onLeave ? 'bg-amber-50/60 border-amber-300' : 'bg-white border-slate-200/50'}`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            {queue?.onLeaveState?.onLeave
              ? <Coffee className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
              : <Sun className="w-5 h-5 text-slate-500 mt-0.5 shrink-0" />}
            <div>
              <p className="text-sm font-extrabold text-slate-900">
                {queue?.onLeaveState?.onLeave
                  ? `On Leave Today — routed to ${queue.onLeaveState.delegatedTo === 'ADMIN' ? 'the ADMIN queue' : queue.onLeaveState.delegatedTo}`
                  : 'Present today'}
              </p>
              <p className="text-[11px] text-slate-500 leading-snug mt-0.5">
                {queue?.onLeaveState?.onLeave
                  ? 'Your mentees\' pending requests are delegated. Tap "Back Today" when you return.'
                  : 'Taking a day off? One tap hands your pending approvals to a present colleague (or the ADMIN queue if none is available) — never the warden.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={toggling || !queue}
            onClick={() => toggleAbsent(!(queue?.onLeaveState?.onLeave))}
            className={`shrink-0 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-colors cursor-pointer disabled:opacity-60 border-2 ${
              queue?.onLeaveState?.onLeave
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                : 'bg-amber-500 hover:bg-amber-600 text-white border-amber-500'
            }`}
          >
            {toggling ? 'Working…' : queue?.onLeaveState?.onLeave ? 'Back Today' : 'On Leave Today'}
          </button>
        </div>
      </div>

      {/* Search (sidebar search + local input both apply) */}
      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          placeholder="Search students or reasons…"
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white/90 text-sm outline-none focus:border-slate-400 transition-colors"
        />
      </div>

      {/* APPROVAL QUEUE — the always-works path */}
      <div className="bg-white/90 backdrop-blur-sm border border-slate-200/50 rounded-2xl p-4 sm:p-5 space-y-3 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-amber-600" />
            Approval Queue
          </h3>
          <span className="text-[11px] font-mono text-slate-500">{pendingLeaves.length} waiting</span>
        </div>

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
                  className="w-full rounded-xl border border-amber-200 bg-white p-2.5 text-xs outline-none focus:border-amber-400 transition-colors"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === leave.id}
                    onClick={() => decide(leave.id, 'APPROVED')}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Approve
                  </button>
                  <button
                    type="button"
                    disabled={busyId === leave.id}
                    onClick={() => decide(leave.id, 'REJECTED')}
                    className="flex-1 py-2.5 rounded-xl bg-white hover:bg-rose-50 disabled:opacity-60 text-rose-700 border-2 border-rose-200 font-bold text-xs cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                  >
                    <X className="w-4 h-4" /> Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* My Mentees */}
      <div className="bg-white/90 backdrop-blur-sm border border-slate-200/50 rounded-2xl p-4 sm:p-5 space-y-3 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-cyan-700" />
            My Mentees
          </h3>
          <span className="text-[11px] font-mono text-slate-500">{mentees.length} students</span>
        </div>
        {mentees.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 space-y-1">
            <Users className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="font-bold text-slate-600">No mentees assigned to you yet</p>
            <p className="text-[11px]">The mentor→student mapping is set by the college roster.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {mentees.map(m => {
              const chip = statusChips[m.todayStatus] || statusChips.NO_REQUEST_TODAY;
              return (
                <div key={m.id} className="bg-slate-50/60 border border-slate-200 rounded-xl px-3.5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-slate-900 truncate">
                      {m.full_name}
                      <span className="text-[11px] font-normal text-slate-500 font-mono"> ({m.roll_number})</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium mt-0.5">{m.department || '—'}</div>
                  </div>
                  <span className={`shrink-0 text-[10px] font-extrabold px-2.5 py-1 rounded-full border ${chip.cls}`}>
                    {chip.label}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Mentor's Day-Scholar Gate Log — server-scoped to THIS mentor's own
          mentees. The warden has no access to this data (moved out of the
          warden register deliberately). Shows LEAVE exits + COMMUTE in/outs. */}
      <div className="bg-white/90 backdrop-blur-sm border border-slate-200/50 rounded-2xl p-4 sm:p-5 space-y-3 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <div>
            <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-blue-700" />
              My Day-Scholars&apos; Gate Log
            </h3>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Visible ONLY to you — your own mentees&apos; campus in/out and mentor-approved leave exits, straight from the gate scanner.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {dsScans && (
              <span className="text-[11px] font-mono font-bold text-slate-700 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-full">
                {dsScans.menteeCount} day scholars
              </span>
            )}
            <button
              type="button"
              onClick={loadScans}
              className="p-2 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              title="Refresh gate log"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
        {!dsScans || (dsScans.scans || []).length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500 space-y-1">
            <UserCheck className="w-7 h-7 text-slate-300 mx-auto" />
            <p className="font-semibold text-slate-600">
              {dsScans && dsScans.registerOk === false ? 'Gate register not connected yet' : 'No gate scans for your mentees yet'}
            </p>
            <p className="text-[11px]">Scans appear here the moment the guard reads a mentee&apos;s Campus-QR.</p>
          </div>
        ) : (
          <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
            {dsScans.scans.map(row => {
              const cat = String(row.category || '').toUpperCase();
              const isLeave = cat === 'LEAVE';
              return (
                <div key={row.id} className="bg-slate-50/60 border border-slate-200 rounded-xl px-3.5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                  <span className={`shrink-0 text-[10px] font-mono font-extrabold px-2.5 py-1 rounded-full w-fit border ${isLeave
                    ? 'text-amber-800 bg-amber-100 border-amber-200'
                    : row.direction === 'IN'
                      ? 'text-emerald-800 bg-emerald-100 border-emerald-200'
                      : 'text-sky-800 bg-sky-100 border-sky-200'}`}>
                    {isLeave ? '↑ LEAVE OUT' : row.direction === 'IN' ? '↓ IN' : '↑ OUT'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-bold text-slate-900 truncate">
                      {row.student_name || 'Student'}
                      <span className="text-[11px] font-normal text-slate-500 font-mono"> ({row.student_roll})</span>
                    </div>
                    <div className="text-[11px] text-slate-500 font-medium mt-0.5">
                      {isLeave ? 'Mentor-approved leave exit' : 'Campus commute scan'} • by {row.scanned_by || 'Guard'}
                    </div>
                  </div>
                  <div className="shrink-0 text-[10px] font-mono text-slate-500">
                    {row.scanned_at ? new Date(row.scanned_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Today's decided requests (audit trail) */}
      {decidedToday.length > 0 && (
        <div className="bg-white/90 backdrop-blur-sm border border-slate-200/50 rounded-2xl p-4 sm:p-5 space-y-2 shadow-sm">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2 border-b border-slate-100 pb-3">
            <ShieldAlert className="w-4 h-4 text-slate-500" />
            Today's Decisions
          </h3>
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
      )}

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

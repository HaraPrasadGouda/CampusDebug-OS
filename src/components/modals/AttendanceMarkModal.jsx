import React, { useState, useEffect, useMemo } from 'react';
import {
  X, Search, Check, Users, Wifi, WifiOff, Clock, MapPin, ShieldAlert, UserCheck
} from 'lucide-react';
import { getAccessToken } from '../../utils/authClient';

// SESSION ATTENDANCE MARKING (Phase 3)
// Plain rule, stated straight on the card: a TICKED roll is PRESENT, a
// BLANK roll is ABSENT. The record saved server-side stamps the class
// (department + subject + period + date) and WHO took it — the teacher's
// real login (`taken_by ... for <class · period>`).
// Gate suggestion chips (OUT of campus per today's scans) are ONLINE ONLY:
// they come from live pass_scans, so when offline the chips never render
// and nothing pretends to know where a student is.

const todayKey = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

export default function AttendanceMarkModal({ isOpen, onClose, slot, onMarked }) {
  const [students, setStudents] = useState(null);   // roster
  const [marks, setMarks] = useState({});           // roll -> true (present)
  const [hints, setHints] = useState({});           // roll -> {state, since} | ONLINE ONLY
  const [online, setOnline] = useState(navigator.onLine);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [rosterErr, setRosterErr] = useState('');
  const [editing, setEditing] = useState(false);     // true when this class already has a saved record today

  useEffect(() => {
    if (!isOpen) return;
    const upd = () => setOnline(navigator.onLine);
    window.addEventListener('online', upd);
    window.addEventListener('offline', upd);
    return () => { window.removeEventListener('online', upd); window.removeEventListener('offline', upd); };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !slot) return;
    let alive = true;
    setEditing(false); setStudents(null); setMarks({}); setHints({}); setQuery(''); setRosterErr('');

    (async () => {
      try {
        const tok = getAccessToken();
        const H = tok ? { Authorization: `Bearer ${tok}` } : {};
        // Step 4: the SECTION is the roster — 50 students of this exact class.
        const r = await fetch(`/api/attendance/roster?section=${encodeURIComponent(slot.sectionKey)}`, { headers: H });
        const j = await r.json();
        if (!alive) return;
        if (j?.success) {
          setStudents(j.students || []);
        } else {
          setRosterErr(j?.error || 'Roster could not be loaded.');
        }
      } catch {
        if (alive) setRosterErr('Offline — the roster needs connectivity the first time.');
      }

      // Prefill ticks from an earlier mark of THE SAME class/period today.
      try {
        const tok = getAccessToken();
        const s = await fetch(`/api/attendance/sessions?date=${todayKey()}`, tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
        const sj = await s.json();
        if (!alive) return;
        const mine = (sj?.sessions || []).find(x =>
          String(x.sectionKey) === String(slot.sectionKey) && Number(x.period) === Number(slot.period));
        if (mine && Array.isArray(mine.present)) {
          const pre = {};
          mine.present.forEach(roll => { pre[roll] = true; });
          setMarks(pre);
          setEditing(true);
        }
      } catch { /* first mark of the day — nothing to prefill */ }

      // Gate hints: ONLINE ONLY. Offline -> empty {} and the chips hide.
      if (navigator.onLine) {
        try {
          const tok = getAccessToken();
          const g = await fetch('/api/attendance/gate-hints', tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
          const gj = await g.json();
          if (alive && gj?.success && gj.connected) setHints(gj.hints || {});
        } catch { /* chips stay hidden */ }
      }
    })();

    return () => { alive = false; };
  }, [isOpen, slot]);

  const filtered = useMemo(() => {
    if (!students) return [];
    const q = query.trim().toLowerCase();
    if (!q) return students;
    return students.filter(s => `${s.roll} ${s.name}`.toLowerCase().includes(q));
  }, [students, query]);

  const presentCount = useMemo(() => Object.values(marks).filter(Boolean).length, [marks]);

  if (!isOpen || !slot) return null;

  const toggle = (roll) => setMarks(m => ({ ...m, [roll]: !m[roll] }));
  const markAll = () => setMarks(Object.fromEntries((students || []).map(s => [s.roll, true])));
  const clearAll = () => setMarks({});

  const save = async () => {
    setBusy(true);
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/attendance/mark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({
          sectionKey: slot.sectionKey,
          department: slot.departmentLabel || slot.department,
          subjectCode: slot.subjectCode,
          subject: slot.subject,
          day: slot.day,
          period: slot.period,
          kind: slot.kind || 'lecture',
          present: Object.keys(marks).filter(k => marks[k]),
          ...(editing ? { date: todayKey() } : {})
        })
      });
      const j = await r.json();
      if (j?.success) {
        if (onMarked) onMarked(j.record, j.statement);
        onClose();
      } else {
        setRosterErr(j?.error || 'Save failed.');
      }
    } catch {
      setRosterErr('Offline — attendance needs connectivity to save.');
    }
    setBusy(false);
  };

  const since = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-2xl w-full border border-slate-200/80 shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">

        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="w-9 h-9 rounded-xl bg-teal-50 border border-teal-200 text-teal-700 flex items-center justify-center shrink-0">
                <UserCheck className="w-5 h-5" />
              </div>
              <h3 className="font-bold text-slate-900 tracking-tight text-lg leading-tight truncate">{editing ? 'Edit Attendance' : 'Mark Attendance'}</h3>
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md border shrink-0 ${slot.kind === 'lab' ? 'bg-violet-100 text-violet-800 border-violet-200' : 'bg-teal-100 text-teal-800 border-teal-200'}`}>
                {slot.kind === 'lab' ? 'LAB' : 'LECTURE'}
              </span>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-1 break-words sm:truncate">
              {slot.subjectCode} · {slot.subject} — {slot.sectionLabel || slot.departmentLabel || slot.department} · {slot.periodLabel || `P${slot.period}`}
              {slot.time ? ` · ${slot.time}` : ''}
              {slot.room ? ` · ${slot.room}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors cursor-pointer shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Rule + toolbar */}
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-100 flex flex-wrap items-center gap-x-3 gap-y-2 shrink-0">
          <span className="text-[11px] font-bold text-slate-600">
            <Check className="w-3.5 h-3.5 inline text-emerald-600 -mt-0.5" /> Tick = present · blank = absent
          </span>
          <span className="text-[11px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2 py-0.5">
            {students ? `Present ${presentCount}` : '…'}
          </span>
          <span className="text-[11px] font-black text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5">
            {students ? `Absent ${(students || []).length - presentCount}` : ''}
          </span>
          <div className="hidden sm:block flex-1" />
          <div className="relative flex-1 min-w-[12.5rem] sm:flex-none">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search roll / name…"
              className="pl-8 pr-3 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-teal-300 w-full sm:w-48"
            />
          </div>
          <button onClick={markAll} disabled={!students} className="text-[11px] font-black text-white bg-emerald-600 border border-emerald-600 rounded-lg px-3 py-1.5 hover:bg-emerald-700 transition-colors cursor-pointer disabled:opacity-40 shadow-sm">
            ✓ ALL PRESENT
          </button>
          <button onClick={clearAll} disabled={!students} className="text-[10px] font-black text-slate-600 bg-white border border-slate-200 rounded-lg px-2 py-1.5 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-40">
            CLEAR
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {rosterErr && (
            <div className="mx-1 mb-2 rounded-xl bg-rose-50 border border-rose-200 px-3 py-2 text-[11px] font-bold text-rose-800">{rosterErr}</div>
          )}
          {!students && !rosterErr ? (
            <div className="py-10 text-center">
              <p className="text-sm font-bold text-slate-600">Loading class roster…</p>
              <p className="text-xs text-slate-400 mt-1">Department directory + today's gate state</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {filtered.map(s => {
                const isPresent = !!marks[s.roll];
                const hint = hints[s.roll];
                const isOut = hint && hint.state === 'OUT';
                return (
                  <button
                    key={s.roll}
                    type="button"
                    onClick={() => toggle(s.roll)}
                    className={`text-left rounded-xl border px-2.5 py-1.5 transition-all cursor-pointer ${
                      isPresent
                        ? 'bg-emerald-600 border-emerald-600 shadow-sm'
                        : 'bg-white border-slate-200 hover:border-teal-300'
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className={`w-3.5 h-3.5 rounded-[4px] border flex items-center justify-center shrink-0 ${isPresent ? 'bg-white border-white' : 'border-slate-300 bg-white'}`}>
                        {isPresent && <Check className="w-2.5 h-2.5 text-emerald-600" />}
                      </span>
                      <span className={`text-[11px] font-black truncate ${isPresent ? 'text-white' : 'text-slate-800'}`}>{s.roll}</span>
                    </div>
                    <p className={`text-[10px] font-semibold truncate mt-0.5 ${isPresent ? 'text-emerald-50' : 'text-slate-500'}`}>{s.name}</p>
                    {isOut && (
                      <span className="inline-flex items-center gap-1 mt-0.5 text-[9px] font-black text-amber-800 bg-amber-100 border border-amber-300 rounded-full px-1.5 py-[1px]">
                        <ShieldAlert className="w-2.5 h-2.5" />
                        GATE OUT{hint.since ? ` ${since(hint.since)}` : ''} — suggest absent
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-3 bg-slate-50 border-t border-slate-100 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between shrink-0">
          <span className={`flex items-center gap-1.5 text-[10px] font-bold ${online ? 'text-slate-500' : 'text-amber-700'}`}>
            {online ? <Wifi className="w-3 h-3 text-emerald-600" /> : <WifiOff className="w-3 h-3" />}
            {online ? 'Gate suggestions are on' : 'Offline — gate suggestions hidden'}
          </span>
          <div className="flex items-stretch gap-2 sm:items-center">
            <button onClick={onClose} className="text-xs font-bold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer shrink-0 px-4 min-h-[44px] sm:min-h-0 sm:px-2">Cancel</button>
            <button
              onClick={save}
              disabled={busy || !students}
              className="flex flex-1 sm:flex-none items-center justify-center gap-1.5 px-4 py-2 min-h-[44px] sm:min-h-0 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-bold text-center leading-tight cursor-pointer transition-all shadow-sm min-w-0"
            >
              <Check className={`w-4 h-4 ${busy ? 'animate-pulse' : ''}`} />
              {busy ? 'Saving…' : `${editing ? 'Save changes' : 'Save'} — present ${presentCount}/${(students || []).length}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

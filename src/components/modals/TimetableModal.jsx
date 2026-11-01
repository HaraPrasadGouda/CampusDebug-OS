import React, { useState, useEffect } from 'react';
import {
  Calendar,
  Clock,
  MapPin,
  User,
  X,
  BookOpen,
  CheckCircle2,
  Coffee,
  Utensils,
  BookMarked,
  FlaskConical
} from 'lucide-react';
import { saveLocal, getLocalById } from '../../utils/db';
import { getAccessToken } from '../../utils/authClient';

// REAL generated timetable (Phase 2): the schedule is produced by the
// server's timetable solver and served by /api/timetable. This modal is a
// VIEWER: it renders the student's own department schedule with teacher +
// room on every class, break/lunch strips, and a live "now" highlight.
// The last payload is cached in IndexedDB so it still opens offline — when
// the cache is from an older version than the server's, the banner shows
// its age instead of pretending it is live.

const DEPT_FALLBACKS = { // shown only if the server's schedule doesn't cover this dept yet
  label: 'your department'
};

const kindStyle = {
  lecture: { chip: 'bg-emerald-100 text-emerald-800 border-emerald-200', dot: 'bg-emerald-500', label: 'LECTURE', icon: BookOpen },
  lab: { chip: 'bg-violet-100 text-violet-800 border-violet-200', dot: 'bg-violet-500', label: 'LAB', icon: FlaskConical },
  study: { chip: 'bg-slate-100 text-slate-600 border-slate-200', dot: 'bg-slate-400', label: 'SELF-STUDY', icon: BookMarked },
  free: { chip: 'bg-sky-100 text-sky-700 border-sky-200', dot: 'bg-sky-300', label: 'FREE PERIOD', icon: Coffee }
};

const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

// Minute-of-day → "09:15 AM" for slot time labels.
const fmtMin = (m) => {
  const h24 = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0');
  return `${h24 > 12 ? h24 - 12 : h24 || 12}:${mm} ${h24 >= 12 ? 'PM' : 'AM'}`;
};

export default function TimetableModal({ isOpen, onClose, department = '', course = '', section = '' }) {
  const [data, setData] = useState(null);          // server payload (fresh) or IndexedDB cache (offline)
  const [isCache, setIsCache] = useState(false);
  const [syncedAt, setSyncedAt] = useState(null);  // when THIS device last pulled the schedule live
  const [selectedDay, setSelectedDay] = useState(null);
  const [nowMin, setNowMin] = useState(nowMinutes());

  useEffect(() => {
    if (!isOpen) return;
    setSelectedDay(null); // recompute below after load (server DAY key format: MON..SAT)
    setNowMin(nowMinutes());
    setSyncedAt(null); // re-sync stamp: this open must prove its own freshness
    let alive = true;

    (async () => {
      // Offline-first: show the cached copy instantly, then refresh from server.
      // The cache read is raced against a timeout so a blocked IndexedDB
      // upgrade (another tab holding an old DB version open) can never
      // stall the LIVE fetch — the schedule itself still arrives.
      let cached = null;
      try {
        cached = await Promise.race([
          getLocalById('timetable', 'tt-latest'),
          new Promise(res => setTimeout(() => res(null), 3000))
        ]);
      } catch { /* no cache yet */ }
      if (cached && !cached.stale) { if (alive) { setData(cached.payload); setIsCache(true); } }

      try {
        const tok = getAccessToken();
        const r = await fetch('/api/timetable', tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
        const j = await r.json();
        if (j?.success && Array.isArray(j.slots)) {
          if (alive) { setData(j); setIsCache(false); setSyncedAt(Date.now()); }
          saveLocal('timetable', { id: 'tt-latest', stale: false, payload: j }).catch(() => {});
        } else if (!cached) {
          if (alive) setData(null);
        }
      } catch {
        if (!cached && alive) setData(null);
      }
    })();

    const iv = setInterval(() => setNowMin(nowMinutes()), 30000);
    return () => { alive = false; clearInterval(iv); };
  }, [isOpen]);

  if (!isOpen) return null;

  const todayIdx = (() => {
    const map = ['MON', 'MON', 'TUE', 'WED', 'THUR', 'FRI', 'SAT'];
    return map[new Date().getDay()] || 'MON';
  })();
  const days = data?.days || [];
  const grid = data?.grid || [];
  const activeDay = selectedDay || todayIdx;

  // Student's OWN section schedule (course|department|section from the live
  // roster). Falls back to the whole-department filter for legacy profiles
  // that predate the course/section columns.
  const sectionKey = course && section ? `${course}|${department}|${section}` : '';
  let mySlots = [];
  let myTitle = '';
  if (data) {
    if (sectionKey) {
      mySlots = data.slots.filter(s => s.sectionKey === sectionKey);
      const sec = (data.sections || []).find(s => s.key === sectionKey);
      myTitle = sec?.label || `${course} ${department} — Section ${section}`;
    }
    if (!mySlots.length) {
      mySlots = data.slots.filter(s => s.departmentLabel === department || s.department === department);
      myTitle = myTitle || department || 'your department';
    }
  }
  const slotsForDay = mySlots
    .filter(s => s.day === activeDay)
    .sort((a, b) => a.startMin - b.startMin);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-lg w-full border border-slate-200/80 shadow-2xl overflow-hidden my-auto">

        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-200/60 text-emerald-600 flex items-center justify-center shadow-xs shrink-0">
              <Calendar className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 tracking-tight text-lg leading-tight">Class Timetable</h3>
              <p className="text-xs text-slate-500 font-medium">
                {data ? myTitle : (department || 'your department')} • Auto-generated, clash-free
              </p>
            </div>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors cursor-pointer shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Live/Source banner */}
        <div className={`px-6 py-2 text-xs font-semibold flex items-center gap-2 border-b ${isCache ? 'bg-amber-50 text-amber-800 border-amber-100' : data ? 'bg-emerald-50 text-emerald-800 border-emerald-100' : 'bg-slate-50 text-slate-600 border-slate-100'}`}>
          {isCache
            ? <><Clock className="w-3.5 h-3.5" /> Offline copy — from {data?.generatedAt ? new Date(data.generatedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'your last online visit'}</>
            : data
              ? <><CheckCircle2 className="w-3.5 h-3.5" /> Synced {syncedAt ? `just now · ${new Date(syncedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</>
              : <><Clock className="w-3.5 h-3.5" /> Loading schedule…</>}
        </div>

        {!data ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-bold text-slate-700">Timetable not available offline yet</p>
            <p className="text-xs text-slate-500 mt-1">Connect once so your schedule is fetched and cached — then it works fully offline.</p>
          </div>
        ) : !mySlots.length ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm font-bold text-slate-700">No schedule published for {myTitle || department || 'your section'} yet</p>
            <p className="text-xs text-slate-500 mt-1">Ask the admin console to include your section in the next generation.</p>
          </div>
        ) : (
          <>
            {/* Day chips */}
            <div className="px-4 pt-3 pb-2 flex gap-1.5 overflow-x-auto">
              {days.map((d) => (
                <button
                  key={d}
                  onClick={() => setSelectedDay(d)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer shrink-0 ${
                    d === activeDay
                      ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                      : d === todayIdx
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {d === 'THUR' ? 'THU' : d}{d === todayIdx ? ' •' : ''}
                </button>
              ))}
            </div>

            {/* Day rows */}
            <div className="px-4 pb-4 pt-1 space-y-1.5 max-h-[55vh] overflow-y-auto">
              {grid.map((g) => {
                if (g.label === 'BREAK' || g.label === 'LUNCH') {
                  const IntervalIcon = g.label === 'BREAK' ? Coffee : Utensils;
                  return (
                    <div key={g.label} className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-100">
                      <IntervalIcon className="w-3.5 h-3.5 text-slate-400" />
                      <span className="text-[11px] font-bold text-slate-500 flex-1">{g.title || (g.label === 'BREAK' ? 'Short Break' : 'Lunch Break')}</span>
                      <span className="text-[10px] font-semibold text-slate-400">{g.start} - {g.end}</span>
                    </div>
                  );
                }

                const slot = slotsForDay.find(s => s.periodLabel === g.label);
                if (!slot) return null;

                // Time label straight from the slot's own minutes — a span-2
                // block (2-hour PPT double, lab) carries endMin of its TAIL
                // period, so it prints the full 2-hour range (9:15 - 11:15),
                // never the start period's 1-hour range. Slots without timings
                // (ancient cache) fall back to the grid row's own bounds.
                const timeLabel = slot.startMin != null && slot.endMin != null
                  ? `${fmtMin(slot.startMin)} - ${fmtMin(slot.endMin)}`
                  : `${g.start} - ${g.end}`;

                const isToday = activeDay === todayIdx;
                const isLive = isToday && nowMin >= slot.startMin && nowMin < (slot.endMin != null ? slot.endMin : g.endMin);
                const isPast = isToday && nowMin >= (slot.endMin != null ? slot.endMin : g.endMin);
                const ks = kindStyle[slot.kind] || kindStyle.study;
                const KIcon = ks.icon;

                return (
                  <div
                    key={`${g.label}-${slot.subjectCode}`}
                    className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border transition-all ${
                      isLive ? 'bg-emerald-50/80 border-emerald-300 ring-1 ring-emerald-300' : isPast ? 'opacity-55 bg-white border-slate-100' : 'bg-white border-slate-200/70 hover:border-emerald-200'
                    }`}
                  >
                    <div className="w-8 shrink-0 text-center">
                      <span className={`block text-[10px] font-black ${isLive ? 'text-emerald-700' : 'text-slate-400'}`}>{g.label}</span>
                      {isLive && <span className="block mt-0.5 mx-auto w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-[13px] font-bold text-slate-900 leading-tight">{slot.subject}</span>
                        <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-md border ${ks.chip}`}>{ks.label}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2.5 text-[11px] text-slate-500 font-medium flex-wrap">
                        {(slot.kind === 'lecture' || slot.kind === 'lab') && slot.teacherName && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3 text-slate-400" />
                            {slot.teacherName}{slot.teacherId ? ` (${slot.teacherId})` : ''}
                          </span>
                        )}
                        {slot.room && (
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3 h-3 text-slate-400" />
                            {slot.room}
                          </span>
                        )}
                        <span className="flex items-center gap-1">
                          <KIcon className="w-3 h-3 text-slate-400" />
                          {timeLabel}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Footer */}
            <div className="px-6 py-3.5 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
              <p className="text-[10px] text-slate-400 font-medium flex items-center gap-1.5">
                <BookOpen className="w-3 h-3" />
                Solver-verified: no teacher double-booked · offline ready
              </p>
              <button onClick={onClose} className="text-xs font-bold text-emerald-700 hover:text-emerald-900 transition-colors cursor-pointer">
                Close Timetable
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

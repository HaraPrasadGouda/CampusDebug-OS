import React, { useState, useEffect } from 'react';
import { getAccessToken } from '../utils/authClient';

// FACULTY FINDER DROPDOWN — lives directly under the header search bar.
// When a student types a teacher's name, this dropdown appears inline with
// where each matching teacher can likely be found RIGHT NOW, resolved
// server-side from the published timetable:
//   teaching slot in progress → room + subject (green "In Class Now")
//   between classes           → next class info (amber "Free Now")
//   marked absent today       → plain "Absent Today" (rose)
//   nothing scheduled         → slate "No Class Today"

const STRIP = /^(dr|prof|professor|mr|mrs|ms|md)\.?\s+/i;

const chipFor = (status) => {
  switch (status) {
    case 'ABSENT_TODAY': return { cls: 'text-rose-700 bg-rose-50 border-rose-200', label: 'Absent Today' };
    case 'TEACHING_NOW': return { cls: 'text-emerald-700 bg-emerald-50 border-emerald-200', label: 'In Class Now' };
    case 'FREE_NOW': return { cls: 'text-amber-800 bg-amber-50 border-amber-200', label: 'Free Now' };
    case 'DAY_OVER': return { cls: 'text-slate-600 bg-slate-50 border-slate-200', label: 'Classes Over' };
    default: return { cls: 'text-slate-600 bg-slate-50 border-slate-200', label: 'No Class Today' };
  }
};

export default function FacultyFinderDropdown({ searchQuery = '', onNavigate }) {
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const q = (searchQuery || '').trim();
    if (q.length < 2) { setResults([]); setOpen(false); return; }
    const t = setTimeout(async () => {
      try {
        const tok = getAccessToken();
        const r = await fetch(`/api/faculty/whereabouts?q=${encodeURIComponent(q)}`, tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
        const j = await r.json();
        const found = j?.success ? (j.results || []) : [];
        setResults(found);
        setOpen(found.length > 0);
      } catch { /* offline: dropdown just stays quiet */ }
    }, 250);
    return () => clearTimeout(t);
  }, [searchQuery]);

  if (!open || !results.length) return null;

  return (
    <div className="absolute left-0 right-0 top-full mt-2 z-40 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden animate-in fade-in duration-150">
      <div className="px-3.5 pt-2.5 pb-1.5 text-[10px] font-mono font-bold uppercase tracking-wider text-cyan-700 bg-cyan-50/60 border-b border-cyan-100">
        🧭 Faculty Finder — where they are right now
      </div>
      <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
        {results.map((t) => {
          const chip = chipFor(t.status);
          const initials = (t.name || '?').replace(STRIP, '').split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
          return (
            <div
              key={t.roll}
              onClick={() => { setOpen(false); onNavigate && onNavigate(); }}
              className="px-3.5 py-2.5 flex items-center gap-3 hover:bg-slate-50 cursor-pointer transition-colors"
            >
              <span className="w-9 h-9 shrink-0 rounded-full bg-cyan-50 border border-cyan-200 text-cyan-800 text-[11px] font-black flex items-center justify-center">
                {initials}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-900 truncate">
                  {t.name}
                  {t.department && <span className="text-[10px] font-medium text-slate-400 ml-1.5">· {t.department}</span>}
                </div>
                <div className="text-[11px] text-slate-600 font-medium mt-0.5 leading-snug">{t.where}</div>
              </div>
              <span className={`shrink-0 text-[10px] font-extrabold px-2.5 py-1 rounded-full border ${chip.cls}`}>
                {chip.label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="px-3.5 py-1.5 text-[10px] text-slate-400 bg-slate-50 border-t border-slate-100">
        Expected location from the live timetable — room assignments can change at short notice.
      </div>
    </div>
  );
}

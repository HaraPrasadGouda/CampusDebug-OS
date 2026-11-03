import React, { useEffect, useState } from 'react';
import { X, CalendarCheck, CheckCircle2, XCircle, Calendar } from 'lucide-react';

// The student's own attendance, straight from GET /api/attendance/me (every
// class a teacher marked in the app for this student's section). When no
// class has been marked in the app yet, the college-record percentage from
// the profile is shown instead, labelled as such. Nothing is invented.
export default function MyAttendanceModal({ isOpen, onClose, recordPct }) {
  const [data, setData] = useState(null);   // null = loading
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    let alive = true;
    setData(null); setError(null);
    fetch('/api/attendance/me', { cache: 'no-store' })
      .then(r => r.json().catch(() => ({})).then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!alive) return;
        if (ok && j?.success) setData(j); else setError(j?.error || 'Could not load attendance.');
      })
      .catch(() => alive && setError('You are offline — attendance will load when you are back online.'));
    return () => { alive = false; };
  }, [isOpen]);

  if (!isOpen) return null;

  const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
  const appPct = data?.percentage;
  const pct = appPct != null ? appPct : (recordPct != null ? Number(recordPct) : null);
  const fromRecord = appPct == null && pct != null;
  const tone = pct == null ? 'text-slate-500' : pct >= 75 ? 'text-emerald-700' : 'text-rose-600';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
      <div
        className="bg-white border-2 border-emerald-200 rounded-2xl sm:rounded-3xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-100/70 border-b-2 border-emerald-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-[#dcfce7] text-[#16a34a] flex items-center justify-center shrink-0">
              <CalendarCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-base font-extrabold text-slate-900">My Attendance</h3>
              <p className="text-xs text-slate-600">Classes marked by your teachers</p>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="w-11 h-11 rounded-full bg-white/70 hover:bg-white text-slate-600 flex items-center justify-center shrink-0 cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto">
          {/* Summary */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 min-w-0">
              <p className="text-[11px] font-bold text-slate-600">Overall</p>
              <p className={`text-2xl font-extrabold leading-tight ${tone}`}>{data === null && !error ? '…' : pct != null ? `${pct}%` : '—'}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 min-w-0">
              <p className="text-[11px] font-bold text-slate-600">Present</p>
              <p className="text-2xl font-extrabold leading-tight text-slate-900">{data ? data.presentCount : '—'}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 min-w-0">
              <p className="text-[11px] font-bold text-slate-600">Classes</p>
              <p className="text-2xl font-extrabold leading-tight text-slate-900">{data ? data.totalMarkedSessions : '—'}</p>
            </div>
          </div>
          {fromRecord && (
            <p className="text-[11px] text-slate-500 leading-snug">Overall is from your college record — no class has been marked in the app yet.</p>
          )}
          {pct != null && pct < 75 && (
            <p className="text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">Below 75% — talk to your mentor.</p>
          )}

          {/* Class list */}
          <div>
            <p className="text-xs font-extrabold text-slate-800 mb-2">Recent classes</p>
            {error ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-600">{error}</div>
            ) : data === null ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-xs text-slate-500">Loading…</div>
            ) : sessions.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-5 text-center">
                <Calendar className="w-6 h-6 text-slate-400 mx-auto mb-1.5" />
                <p className="text-xs font-bold text-slate-700">No classes marked yet</p>
                <p className="text-[11px] text-slate-500 mt-0.5">Each class appears here as soon as your teacher marks attendance.</p>
              </div>
            ) : (
              <ul className="space-y-1.5">
                {sessions.slice(0, 40).map(s => (
                  <li key={s.id} className="flex items-center gap-2.5 rounded-xl border border-slate-200 bg-white px-3 py-2 min-w-0">
                    {s.present
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      : <XCircle className="w-4 h-4 text-rose-500 shrink-0" />}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-slate-900 break-words">{s.subject || s.subjectCode || 'Class'}</p>
                      <p className="text-[11px] text-slate-500">{s.date}{s.period ? ` · Period ${s.period}` : ''}{s.takenByName ? ` · ${s.takenByName}` : ''}</p>
                    </div>
                    <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full border shrink-0 ${s.present ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                      {s.present ? 'Present' : 'Absent'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

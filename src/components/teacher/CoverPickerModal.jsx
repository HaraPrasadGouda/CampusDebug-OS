import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, UserCheck, CheckCircle2, CalendarDays, Users, AlertTriangle } from 'lucide-react';
import { getAccessToken } from '../../utils/authClient';
import { profName } from '../../utils/teacherCover';

// "On Leave Today" picker: the absent teacher chooses WHO covers them.
// Present colleagues only (not me, not on leave), same department first, each
// tagged against MY REMAINING periods today: "Free" or "Busy in P3", plus
// "Already covering N". A summary of what moves sits above Confirm.
// Phone: bottom sheet; laptop: centred modal.
export default function CoverPickerModal({ isOpen, onClose, onConfirm, currentRoll = null, busy = false }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    if (!isOpen) return undefined;
    let alive = true;
    setData(null); setErr(''); setQuery(''); setPicked(null);
    (async () => {
      try {
        const tok = getAccessToken();
        const r = await fetch('/api/leave-requests/teacher-absent/candidates', tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
        const j = await r.json();
        if (!alive) return;
        if (j?.success) setData(j); else setErr(j?.error || 'Could not load the teacher list.');
      } catch {
        if (alive) setErr('Offline — the teacher list needs connectivity.');
      }
    })();
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => { alive = false; window.removeEventListener('keydown', onKey); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const all = useMemo(() => (data?.candidates || []).filter(c => c.roll !== currentRoll), [data, currentRoll]);
  const q = query.trim().toLowerCase();
  const shown = all.filter(c => !q || `${c.name} ${c.department || ''} ${c.roll}`.toLowerCase().includes(q));
  const sameDept = shown.filter(c => c.sameDept);
  const otherDept = shown.filter(c => !c.sameDept);
  const handOver = data?.handOver || [];
  const startedCount = (data?.myClasses || []).length - handOver.length;
  const pendingN = data?.pendingLeaves || 0;
  const chosen = all.find(c => c.roll === picked) || null;

  if (!isOpen) return null;

  const row = (c) => {
    const sel = picked === c.roll;
    return (
      <button
        key={c.roll}
        type="button"
        role="radio"
        aria-checked={sel}
        onClick={() => setPicked(c.roll)}
        className={`w-full text-left flex items-center gap-3 px-3 py-2.5 min-h-[56px] rounded-2xl border-2 transition-colors cursor-pointer ${sel ? 'border-indigo-500 bg-indigo-50/70' : 'border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50'}`}
      >
        <span className={`w-10 h-10 rounded-xl flex items-center justify-center font-extrabold text-sm shrink-0 ${sel ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-700'}`}>
          {sel ? <CheckCircle2 className="w-5 h-5" /> : String(c.name || '?').replace(/^(dr|prof)\.?\s*/i, '').charAt(0).toUpperCase()}
        </span>
        <span className="flex-1 min-w-0">
          <span className="block text-sm font-bold text-slate-900 break-words">{c.name}</span>
          <span className="block text-[11px] text-slate-500 font-medium">{c.department || 'Department not set'}</span>
          {c.alreadyCovering > 0 && (
            <span className="flex flex-wrap gap-1 mt-1">
              {c.alreadyCovering > 0 && <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md px-1.5 py-0.5">Already covering {c.alreadyCovering}</span>}
            </span>
          )}
        </span>
      </button>
    );
  };

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="td-cover-picker-title">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" onClick={() => !busy && onClose?.()} />
      <div className="relative w-full sm:max-w-lg h-[92dvh] sm:h-auto sm:max-h-[88vh] bg-white rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200/80 flex flex-col overflow-hidden">
        <div className="sm:hidden mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-300" />
        <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shrink-0">
              <UserCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 id="td-cover-picker-title" className="text-base font-bold text-slate-900">{currentRoll ? 'Change who covers you' : 'Who covers for you today?'}</h3>
              <p className="text-xs text-slate-500">They approve your students' leaves · classes go on the cover board</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !busy && onClose?.()}
            aria-label="Close"
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 hover:text-slate-800 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 sm:px-5 py-4 space-y-4">
          {/* What goes where: leaves -> the substitute; classes -> the cover board (nobody is assigned) */}
          <div className="rounded-2xl border border-teal-200 bg-teal-50/50 p-3">
            <p className="text-[11px] font-bold uppercase tracking-wider text-teal-800 flex items-center gap-1.5">
              <CalendarDays className="w-3.5 h-3.5" /> Goes to your substitute
            </p>
            {!data ? (
              <p className="text-xs text-slate-500 mt-1.5">Loading…</p>
            ) : (
              <p className="text-xs text-slate-700 mt-1.5 font-semibold">
                {pendingN} pending {pendingN === 1 ? 'leave request' : 'leave requests'} + every new one today
              </p>
            )}
            {data && (
              <div className="mt-2.5 pt-2.5 border-t border-teal-200/70">
                <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-800">Your classes → cover board</p>
                {handOver.length > 0 ? (
                  <>
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                      {handOver.map(s => (
                        <span key={`${s.sectionKey}-${s.period}`} className="text-[11px] font-semibold text-slate-700 bg-white border border-indigo-200 rounded-lg px-2 py-1">
                          <span className="font-black text-indigo-700">{s.periodLabel}</span> {s.subjectCode} · {s.short}
                        </span>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1.5">Nobody is assigned. Free teachers of that section can take each one{startedCount > 0 ? `; ${startedCount} already started` : ''}.</p>
                  </>
                ) : (
                  <p className="text-[11px] text-slate-500 mt-1.5">No classes left today, so nothing goes on the board.</p>
                )}
              </div>
            )}
          </div>

          {err && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-700 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> <span>{err}</span>
            </div>
          )}

          {data && all.length === 0 && (
            <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-slate-50/70 px-4 py-6 text-center space-y-2">
              <Users className="w-9 h-9 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-slate-700">No other teacher is present today</p>
              <p className="text-xs text-slate-500 leading-relaxed">Everyone else is marked on leave. You can still mark yourself on leave — but your leave requests then stay with you until a colleague is back.</p>
            </div>
          )}

          {data && all.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search teacher or department…"
                className="w-full min-h-[44px] pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm outline-none focus:border-indigo-400 transition-colors"
              />
            </div>
          )}

          {data && all.length > 0 && shown.length === 0 && (
            <p className="text-xs text-slate-500 text-center py-4">No teacher matches “{query}”.</p>
          )}

          {sameDept.length > 0 && (
            <div className="space-y-2" role="radiogroup" aria-label="Teachers in your department">
              <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">Your department · {sameDept.length}</p>
              {sameDept.map(row)}
            </div>
          )}
          {otherDept.length > 0 && (
            <div className="space-y-2" role="radiogroup" aria-label="Teachers in other departments">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Other departments · {otherDept.length}</p>
              {otherDept.map(row)}
            </div>
          )}
        </div>

        {chosen && (
          <div className="border-t border-indigo-100 bg-indigo-50/70 px-4 sm:px-5 py-2.5 text-xs text-indigo-900 leading-snug" aria-live="polite">
            <strong>{pendingN} pending {pendingN === 1 ? 'leave' : 'leaves'}</strong> will go to <strong>{profName(chosen.name)}</strong>
            {handOver.length > 0 ? <> · your {handOver.length} {handOver.length === 1 ? 'class goes' : 'classes go'} on the cover board.</> : '.'}
          </div>
        )}
        <div className="border-t border-slate-100 px-4 sm:px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-white flex flex-col-reverse sm:flex-row gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onClose?.()}
            className="sm:flex-1 min-h-[44px] rounded-xl border-2 border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-sm transition-colors cursor-pointer disabled:opacity-60"
          >
            Cancel
          </button>
          {data && all.length === 0 && !currentRoll ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm?.(null)}
              className="sm:flex-[2] min-h-[44px] rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-sm transition-colors cursor-pointer disabled:opacity-60"
            >
              {busy ? 'Working…' : 'Mark On Leave anyway'}
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !chosen}
              onClick={() => chosen && onConfirm?.(chosen.roll)}
              className="sm:flex-[2] min-h-[44px] px-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-bold text-sm transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {busy ? 'Working…' : chosen ? 'Confirm' : 'Select a teacher'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

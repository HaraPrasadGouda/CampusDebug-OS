import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Ban, Undo2 } from 'lucide-react';
import { tfetch } from '../../utils/teacherApi';

// Admin / dean banner: a class of an absent teacher that nobody took.
// Shows 30 min before the period (amber) and at its start (rose: students now
// see "Class cancelled"). Renders nothing when everything is covered.
export default function AdminCoverAlerts({ onNotification, compact = false, onOpenHome = null }) {
  const [banners, setBanners] = useState([]);
  const [busy, setBusy] = useState(null);
  const load = useCallback(async () => {
    const r = await tfetch('/api/admin/cover-board');
    if (r.ok) setBanners(r.banners || []);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  if (!banners.length) return null;
  // Tool pages show one slim line; the full cards live on Home, Send Notice and Timetable.
  if (compact) {
    const n = banners.length;
    const final = banners.some(b => b.level === 'final');
    return (
      <button type="button" id="admin-cover-alerts" data-testid="cover-slim" role="alert" onClick={() => onOpenHome?.()}
        className={`w-full min-h-[44px] rounded-xl border px-3 py-2 flex items-center gap-2.5 text-left cursor-pointer transition-colors ${final ? 'bg-rose-50 border-rose-300 hover:bg-rose-100' : 'bg-amber-50 border-amber-300 hover:bg-amber-100'}`}>
        <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 text-white ${final ? 'bg-rose-600' : 'bg-amber-500'}`}>
          {final ? <Ban className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
        </span>
        <span className={`flex-1 min-w-0 text-[13px] font-extrabold ${final ? 'text-rose-900' : 'text-amber-900'}`}>{n} {n === 1 ? 'class needs' : 'classes need'} a cover</span>
        <span className="text-[12px] font-bold text-slate-700 shrink-0">Open on Home</span>
      </button>
    );
  }
  const cancel = async (b) => {
    setBusy(b.id);
    const r = await tfetch(`/api/admin/cover-board/${encodeURIComponent(b.id)}/cancel`, 'POST', {});
    onNotification?.(r.message || r.error || 'Done', r.ok ? 'success' : 'error');
    await load(); setBusy(null);
  };
  const undo = async (b) => {
    setBusy(b.id);
    const r = await tfetch(`/api/admin/cover-board/${encodeURIComponent(b.id)}/undo-cancel`, 'POST', {});
    onNotification?.(r.message || r.error || 'Done', r.ok ? 'success' : 'error');
    await load(); setBusy(null);
  };
  return (
    <div className="space-y-2" id="admin-cover-alerts" role="alert">
      {banners.map(b => (
        <div key={b.id} className={`rounded-2xl border-2 px-4 py-3 flex flex-wrap sm:flex-nowrap items-center gap-3 shadow-sm ${b.level === 'final' ? 'bg-rose-50 border-rose-300' : 'bg-amber-50 border-amber-300'}`}>
          <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white ${b.level === 'final' ? 'bg-rose-600' : 'bg-amber-500'}`}>
            {b.level === 'final' ? <Ban className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          </span>
          <div className="flex-1 basis-0 min-w-[10rem] sm:min-w-0">
            <p className={`text-sm font-extrabold break-words ${b.level === 'final' ? 'text-rose-900' : 'text-amber-900'}`}>{b.text}</p>
            <p className="text-[11px] font-medium text-slate-600 mt-0.5">{b.level === 'final' ? 'Students of that section see "Class cancelled" and cannot be marked.' : 'Phone the teachers of that section, or mark the class cancelled.'}</p>
          </div>
          {b.canCancel && (
            <button type="button" disabled={busy === b.id} onClick={() => cancel(b)} className="w-full sm:w-auto min-h-[44px] px-4 rounded-xl bg-white border-2 border-amber-400 hover:bg-amber-100 text-amber-900 text-xs font-extrabold cursor-pointer transition-colors disabled:opacity-60">
              Mark class cancelled
            </button>
          )}
          {b.canUndo && (
            <button type="button" data-testid="undo-cancel" disabled={busy === b.id} onClick={() => undo(b)} className="w-full sm:w-auto min-h-[44px] px-4 rounded-xl bg-white border-2 border-rose-400 hover:bg-rose-100 text-rose-900 text-xs font-extrabold cursor-pointer transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-1.5">
              <Undo2 className="w-4 h-4" /> Undo
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

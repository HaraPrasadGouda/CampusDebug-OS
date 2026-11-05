import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Ban } from 'lucide-react';
import { tfetch } from '../../utils/teacherApi';

// Admin / dean banner: a class of an absent teacher that nobody took.
// Shows 30 min before the period (amber) and at its start (rose: students now
// see "Class cancelled"). Renders nothing when everything is covered.
export default function AdminCoverAlerts({ onNotification }) {
  const [banners, setBanners] = useState([]);
  const [busy, setBusy] = useState(null);
  const load = useCallback(async () => {
    const r = await tfetch('/api/admin/cover-board');
    if (r.ok) setBanners(r.banners || []);
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);
  if (!banners.length) return null;
  const cancel = async (b) => {
    setBusy(b.id);
    const r = await tfetch(`/api/admin/cover-board/${encodeURIComponent(b.id)}/cancel`, 'POST', {});
    onNotification?.(r.message || r.error || 'Done', r.ok ? 'success' : 'error');
    await load(); setBusy(null);
  };
  return (
    <div className="space-y-2" id="admin-cover-alerts" role="alert">
      {banners.map(b => (
        <div key={b.id} className={`rounded-2xl border-2 px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3 shadow-sm ${b.level === 'final' ? 'bg-rose-50 border-rose-300' : 'bg-amber-50 border-amber-300'}`}>
          <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-white ${b.level === 'final' ? 'bg-rose-600' : 'bg-amber-500'}`}>
            {b.level === 'final' ? <Ban className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
          </span>
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-extrabold break-words ${b.level === 'final' ? 'text-rose-900' : 'text-amber-900'}`}>{b.text}</p>
            <p className="text-[11px] font-medium text-slate-600 mt-0.5">{b.level === 'final' ? 'Students of that section see "Class cancelled" and cannot be marked.' : 'Phone the teachers of that section, or mark the class cancelled.'}</p>
          </div>
          {b.canCancel && (
            <button type="button" disabled={busy === b.id} onClick={() => cancel(b)} className="min-h-[44px] px-4 rounded-xl bg-white border-2 border-amber-400 hover:bg-amber-100 text-amber-900 text-xs font-extrabold cursor-pointer transition-colors disabled:opacity-60">
              Mark class cancelled
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

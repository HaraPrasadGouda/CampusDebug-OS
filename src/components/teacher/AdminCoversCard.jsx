import React, { useEffect, useState } from 'react';
import { UserCheck, RefreshCw } from 'lucide-react';
import { getAccessToken } from '../../utils/authClient';
import { profName } from '../../utils/teacherCover';

// Admin: today's teacher absences and who covers them (read-only, small).
export default function AdminCoversCard({ bare = false, onRows } = {}) {
  const [rows, setRows] = useState(null);
  const load = async () => {
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/admin/teacher-covers', tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
      const j = await r.json();
      const next = j?.success ? (j.rows || []) : [];
      setRows(next);
      if (onRows) onRows(next);
    } catch { setRows(prev => prev || []); }
  };
  useEffect(() => { load(); const iv = setInterval(load, 30000); return () => clearInterval(iv); }, []);
  return (
    <div className={bare ? 'space-y-2' : 'rounded-xl border border-indigo-200 p-3 space-y-2'} id="admin-teacher-covers">
      {!bare && <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
          <UserCheck className="w-4 h-4 text-indigo-600" /> Today's absences & covers
          <span className="text-[10px] font-mono font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">{rows ? rows.length : '…'}</span>
        </p>
        <button type="button" onClick={load} aria-label="Refresh" className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 cursor-pointer">
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>}
      {!rows ? (
        <p className="text-xs text-slate-500">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-slate-500">Every teacher is present today — no covers running.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map(r => (
            <div key={r.roll} className={bare ? 'flex flex-col gap-0.5 text-xs bg-slate-50 border border-slate-100 rounded-xl px-3 py-2.5' : 'flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs bg-slate-50 border border-slate-100 rounded-lg px-3 py-2'}>
              <span className="min-w-0">
                <span className="font-bold text-slate-900">{profName(r.name)}</span>
                <span className="text-slate-500"> · on leave</span>
              </span>
              <span className={`text-[11px] font-semibold ${r.coveredBy ? 'text-indigo-700' : 'text-rose-700'}`}>
                {r.coveredBy
                  ? `Leave requests go to ${profName(r.coveredBy.name)} (${r.pending} pending)`
                  : r.declinedBy ? 'Leave substitute declined — not covered yet' : 'No leave substitute — leaves stay with them'}
                {` · ${(r.cards?.open || 0) === 0 ? 'all classes covered' : `${r.cards.open} ${r.cards.open === 1 ? 'class' : 'classes'} still need a cover`}${(r.cards?.taken || 0) ? ` (${r.cards.taken} taken)` : ''}`}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

import React, { useEffect, useState } from 'react';
import { ArrowLeft, UserCheck, Clock, CheckCircle2, X, CalendarDays, MapPin, Users, Plus, LogOut, LogIn } from 'lucide-react';
import { getAccessToken } from '../../utils/authClient';
import { profName } from '../../utils/teacherCover';

const timeHM = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—');

// The substitute's "Covering" view — everything of the absent colleague in
// one place, today only, in two tabs: Leaves (approve / reject / create) and
// Students (their day scholars + their day-scholar gate log). Their CLASSES
// are not handed over any more — they are on the cover board. The substitute's own home is
// untouched; this view is opened from the one compact card on it.
export default function CoveringSection({
  groups = [], onBack, decide, busyId, noteDraft, setNoteDraft, onCreateLeave,
  onMark, markOpen, openLabel, renderMenteeRow, createOpen = true, createLabel = '9:00 AM–4:30 PM'
}) {
  const [sel, setSel] = useState(null);
  const [tab, setTab] = useState(null);
  const [scans, setScans] = useState({});
  const g = groups.find(x => x.mentorRoll === sel) || groups[0] || null;
  const activeTab = tab || 'leaves';

  useEffect(() => {
    if (!g || !g.active || activeTab !== 'students') return undefined;
    let alive = true;
    (async () => {
      try {
        const tok = getAccessToken();
        const r = await fetch(`/api/teacher/day-scholar-scans?mentor=${encodeURIComponent(g.mentorRoll)}`, tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
        const j = await r.json();
        if (alive) setScans(p => ({ ...p, [g.mentorRoll]: j?.success ? (j.scans || []) : [] }));
      } catch { if (alive) setScans(p => ({ ...p, [g.mentorRoll]: p[g.mentorRoll] || [] })); }
    })();
    return () => { alive = false; };
  }, [g?.mentorRoll, g?.active, activeTab]);

  const back = (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        className="min-h-[44px] pl-2.5 pr-3.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 font-bold text-xs flex items-center gap-1.5 shadow-sm transition-colors cursor-pointer shrink-0"
      >
        <ArrowLeft className="w-4 h-4" /> My dashboard
      </button>
      <h2 className="text-base sm:text-lg font-extrabold text-slate-900 min-w-0">Covering today</h2>
    </div>
  );

  if (!g) {
    return (
      <div className="space-y-4">
        {back}
        <div className="rounded-2xl border-2 border-dashed border-slate-200 bg-white px-4 py-10 text-center space-y-2">
          <UserCheck className="w-10 h-10 text-slate-300 mx-auto" />
          <p className="text-sm font-bold text-slate-700">You're not covering anyone right now</p>
          <p className="text-xs text-slate-500">When a colleague picks you while on leave, their leave approvals appear here.</p>
        </div>
      </div>
    );
  }

  const pending = (g.leaves || []).filter(l => l.status === 'PENDING');
  const decided = (g.leaves || []).filter(l => l.status !== 'PENDING');
  const students = g.mentees || [];
  const log = scans[g.mentorRoll];
  const tabs = g.active
    ? [{ id: 'leaves', label: 'Leaves', n: pending.length }, { id: 'students', label: 'Students', n: students.length }]
    : [{ id: 'leaves', label: 'Leaves', n: pending.length }];

  return (
    <div className="space-y-4">
      {back}

      {groups.length > 1 && (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label="Colleagues you cover">
          {groups.map(x => (
            <button key={x.mentorRoll} type="button" role="tab" aria-selected={x.mentorRoll === g.mentorRoll}
              onClick={() => { setSel(x.mentorRoll); setTab(null); }}
              className={`min-h-[44px] px-3.5 rounded-xl border-2 text-xs font-bold transition-colors cursor-pointer ${x.mentorRoll === g.mentorRoll ? 'border-indigo-500 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}>
              {profName(x.mentorName)}
            </button>
          ))}
        </div>
      )}

      {/* Who + what, at a glance */}
      <section className={`rounded-2xl border-2 shadow-sm p-4 sm:p-5 ${g.active ? 'border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-white' : 'border-slate-200 bg-white'}`}>
        <div className="flex items-start gap-3">
          <span className={`w-11 h-11 rounded-2xl text-white flex items-center justify-center shrink-0 ${g.active ? 'bg-indigo-600' : 'bg-slate-500'}`}>
            <UserCheck className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-700">{g.active ? 'Covering' : 'Back on duty'}</p>
            <p className="text-base font-extrabold text-slate-900 break-words">{profName(g.mentorName)}</p>
            <p className="text-xs text-slate-500 font-medium">
              {g.mentorDept || 'Department not set'} · {g.active ? 'today only' : 'their work is back with them — only the class you were taking stays with you'}
            </p>
          </div>
        </div>
      </section>

      {/* Tabs */}
      <div className="grid gap-1 p-1 rounded-2xl bg-slate-100 border border-slate-200" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }} role="tablist" aria-label="Covered work">
        {tabs.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={activeTab === t.id} onClick={() => setTab(t.id)}
            className={`min-h-[44px] rounded-xl text-xs font-extrabold transition-colors cursor-pointer flex items-center justify-center gap-1.5 ${activeTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
            {t.label}
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${activeTab === t.id ? (t.id === 'leaves' && t.n > 0 ? 'bg-amber-500 text-white' : 'bg-indigo-50 text-indigo-700') : 'bg-white/70 text-slate-500'}`}>{t.n}</span>
          </button>
        ))}
      </div>

      {/* LEAVES */}
      {activeTab === 'leaves' && (
        <section className="bg-white border-2 border-amber-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="p-4 sm:p-5 space-y-3">
            {pending.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500 space-y-1">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                <p className="font-bold text-slate-600">No pending requests</p>
                <p className="text-[11px]">New requests from {profName(g.mentorName)}'s day scholars come here today (with a notification).</p>
              </div>
            ) : (
              <div className="grid gap-3 xl:grid-cols-2">
                {pending.map(leave => (
                  <div key={leave.id} className="rounded-2xl border-2 border-amber-200 bg-amber-50/40 p-4 space-y-3">
                    <div className="min-w-0">
                      <p className="text-sm font-extrabold text-slate-900 break-words">
                        {leave.student_name} <span className="font-mono text-[11px] text-slate-500">({leave.student_roll})</span>
                      </p>
                      <p className="text-xs text-slate-700 mt-1 leading-relaxed"><strong>Reason:</strong> {leave.reason}</p>
                      <p className="text-[11px] text-slate-500 mt-0.5">Requested {timeHM(leave.created_at)}</p>
                    </div>
                    <input
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Optional note to the student"
                      maxLength={200}
                      className="w-full min-h-[44px] rounded-xl border border-amber-200 bg-white p-2.5 text-xs outline-none focus:border-amber-400 transition-colors"
                    />
                    <div className="flex gap-2">
                      <button type="button" disabled={busyId === leave.id} onClick={() => decide(leave.id, 'APPROVED')}
                        className="flex-1 py-2.5 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white font-bold text-xs cursor-pointer transition-colors flex items-center justify-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4" /> Approve
                      </button>
                      <button type="button" disabled={busyId === leave.id} onClick={() => decide(leave.id, 'REJECTED')}
                        className="flex-1 py-2.5 min-h-[44px] rounded-xl bg-white hover:bg-rose-50 disabled:opacity-60 text-rose-700 border-2 border-rose-200 font-bold text-xs cursor-pointer transition-colors flex items-center justify-center gap-1.5">
                        <X className="w-4 h-4" /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {decided.length > 0 && (
              <div className="pt-1 space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Decided today</p>
                {decided.map(l => (
                  <div key={l.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-700 font-semibold truncate">{l.student_name}</span>
                    <span className={`shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${l.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : l.status === 'REJECTED' ? 'bg-rose-50 text-rose-700 border-rose-200' : 'bg-slate-50 text-slate-600 border-slate-200'}`}>{l.status}</span>
                  </div>
                ))}
              </div>
            )}
            <button type="button" onClick={onCreateLeave} disabled={!createOpen}
              aria-describedby={!createOpen ? 'cov-create-closed' : undefined}
              className="w-full min-h-[44px] rounded-xl border-2 border-dashed border-indigo-200 bg-indigo-50/40 hover:bg-indigo-50 text-indigo-700 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors cursor-pointer disabled:bg-slate-50 disabled:border-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed">
              <Plus className="w-4 h-4" /> Create leave for a student without the app
            </button>
            {!createOpen && (
              <p id="cov-create-closed" className="text-[11px] font-semibold text-slate-500 flex items-center justify-center gap-1">
                <Clock className="w-3 h-3 shrink-0" /> Available {createLabel}
              </p>
            )}
          </div>
        </section>
      )}

      {/* STUDENTS */}
      {activeTab === 'students' && (
        <div className="flex flex-col gap-4 xl:grid xl:grid-cols-2 xl:items-start">
          <section className="bg-white border border-indigo-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 bg-gradient-to-r from-indigo-50 to-white border-b border-indigo-100">
              <h3 className="text-[15px] font-bold text-slate-900 flex items-center gap-2.5 min-w-0">
                <span className="w-9 h-9 rounded-xl bg-indigo-100/70 text-indigo-700 border border-indigo-200 flex items-center justify-center shrink-0"><Users className="w-4 h-4" /></span>
                Their day scholars
              </h3>
              <span className="shrink-0 text-[11px] font-mono font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-full">{students.length}</span>
            </div>
            <div className="p-4 sm:p-5 space-y-2">
              {students.length === 0
                ? <p className="text-xs text-slate-500 text-center py-6">No day scholars are mapped to {profName(g.mentorName)}.</p>
                : students.map(m => renderMenteeRow(m, true))}
            </div>
          </section>
          <section className="bg-white border border-blue-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3 bg-gradient-to-r from-blue-50 to-white border-b border-blue-100">
              <h3 className="text-[15px] font-bold text-slate-900 flex items-center gap-2.5 min-w-0">
                <span className="w-9 h-9 rounded-xl bg-blue-100/70 text-blue-700 border border-blue-200 flex items-center justify-center shrink-0"><LogOut className="w-4 h-4" /></span>
                Their gate log
              </h3>
              <span className="shrink-0 text-[11px] font-mono font-bold text-blue-800 bg-blue-50 border border-blue-200 px-2.5 py-1 rounded-full">{log ? log.length : '…'}</span>
            </div>
            <div className="p-4 sm:p-5 space-y-2">
              {!log ? (
                <p className="text-xs text-slate-500 text-center py-6">Loading…</p>
              ) : log.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500 space-y-1">
                  <LogIn className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="font-bold text-slate-600">No gate scans yet</p>
                  <p className="text-[11px]">Leave exits and commute in/out of {profName(g.mentorName)}'s day scholars show here.</p>
                </div>
              ) : log.slice(0, 20).map(sc => (
                <div key={sc.id} className="flex items-center justify-between gap-2 text-xs bg-slate-50/60 border border-slate-200 rounded-xl px-3 py-2">
                  <span className="min-w-0">
                    <span className="block font-bold text-slate-900 truncate">{sc.student_name}</span>
                    <span className="block text-[10px] text-slate-500">{String(sc.category || '').toUpperCase() === 'LEAVE' ? 'Leave exit' : 'Commute'} · {timeHM(sc.scanned_at)}</span>
                  </span>
                  <span className={`shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${String(sc.direction).toUpperCase() === 'OUT' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>{String(sc.direction || '').toUpperCase() || '—'}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

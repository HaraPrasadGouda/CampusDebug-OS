import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Sparkles, AlertTriangle, Check, Save, Phone, ChevronDown, History, Settings, Users, RefreshCw } from 'lucide-react';

// Warden "Cleaning" panel: per block - settings (days + window + the 2 cleaners),
// today's / last result with who answered, history of the last cleaning days, red alerts.
// Data: GET /api/cleaning/warden. Settings: POST /api/cleaning/settings (warden only).

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS = {
  cleaned: { label: 'Cleaned', tile: 'bg-emerald-50 border-emerald-200 text-emerald-900', dot: 'bg-emerald-500' },
  not_cleaned: { label: 'Not cleaned', tile: 'bg-rose-50 border-rose-200 text-rose-900', dot: 'bg-rose-500' },
  no_reply: { label: 'No reply', tile: 'bg-amber-50 border-amber-200 text-amber-900', dot: 'bg-amber-500' },
  vacant: { label: 'Vacant', tile: 'bg-slate-50 border-slate-200 text-slate-700', dot: 'bg-slate-400' },
  open: { label: 'Awaiting', tile: 'bg-sky-50 border-sky-200 text-sky-900', dot: 'bg-sky-400' }
};
const fmtDate = (ymd) => {
  if (!ymd) return '—';
  const d = new Date(`${ymd}T00:00:00`);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
};

function Tile({ k, n }) {
  const s = STATUS[k];
  return (
    <div className={`rounded-xl border px-3 py-2.5 min-w-0 ${s.tile}`}>
      <p className="text-[22px] font-extrabold font-mono leading-none">{n}</p>
      <p className="text-[11px] font-bold mt-1 leading-tight">{s.label}</p>
    </div>
  );
}

// Pure view, also used by the screenshot harness.
export function CleaningPanelView({ data, onSave = async () => ({ ok: true }), canEdit = true }) {
  const blocks = data?.blocks || [];
  const [sel, setSel] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const b = blocks[Math.min(sel, Math.max(blocks.length - 1, 0))];
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setDraft(b ? { weekdays: b.settings.weekdays, startTime: b.settings.startTime, endTime: b.settings.endTime } : null); setMsg(null); setShowAll(false); }, [b?.block, b?.settings?.weekdays?.join(','), b?.settings?.startTime, b?.settings?.endTime]); // eslint-disable-line react-hooks/exhaustive-deps

  const alerts = data?.alerts || [];
  const dirty = useMemo(() => !!(b && draft) && (draft.weekdays.join(',') !== b.settings.weekdays.join(',') || draft.startTime !== b.settings.startTime || draft.endTime !== b.settings.endTime), [b, draft]);

  const save = async () => {
    setSaving(true); setMsg(null);
    const r = await onSave(b.block, draft);
    setSaving(false);
    setMsg(r.ok ? { ok: true, text: 'Saved' } : { ok: false, text: r.error || 'Could not save' });
  };

  return (
    <div className="space-y-4">
      {data?.setupPending && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 px-3.5 py-3 text-[12px] font-bold text-amber-900 flex items-start gap-2.5" role="status">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>Setup pending: the cleaning tables are not in the database yet, so answers and settings are kept on this server only. Run migration.sql to switch to the database.</span>
        </div>
      )}

      {alerts.length > 0 && (
        <div className="rounded-xl border-2 border-rose-300 bg-rose-50 p-3.5 space-y-2" data-testid="cleaning-alerts">
          <p className="text-[13px] font-extrabold text-rose-800 flex items-center gap-2"><AlertTriangle className="w-4 h-4" /> Red alert: still not fixed after 2 tries</p>
          <ul className="space-y-1.5">
            {alerts.map((a) => (
              <li key={`${a.block}-${a.room}-${a.date}`} className="bg-white border border-rose-200 rounded-lg px-3 py-2 text-[12.5px] font-bold text-slate-800 flex items-center justify-between gap-2">
                <span className="min-w-0 break-words">{a.block} · Room {a.room}</span>
                <span className="shrink-0 text-[11px] font-mono text-rose-700 bg-rose-100 border border-rose-200 rounded-full px-2 py-0.5">Not fixed {a.notFixedCount}×</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {blocks.length === 0 ? (
        <div className="min-h-[200px] flex flex-col items-center justify-center text-center px-4 py-10">
          <span className="w-14 h-14 rounded-full ring-8 flex items-center justify-center mb-4 bg-cyan-50 text-cyan-700 ring-cyan-100"><Sparkles className="w-7 h-7" /></span>
          <p className="text-sm font-semibold text-slate-800">No hostel rooms found yet</p>
          <p className="text-xs text-slate-500 mt-1 max-w-sm">Cleaning checks start once students have a hostel block and room on their profile.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="tablist">
            {blocks.map((x, i) => (
              <button key={x.block} type="button" role="tab" aria-selected={i === sel} onClick={() => setSel(i)}
                className={`min-h-[44px] px-4 rounded-xl text-[13px] font-extrabold border shrink-0 cursor-pointer ${i === sel ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-700 border-slate-200'}`}>
                {x.block}{x.counts.not_cleaned > 0 ? <span className="ml-1.5 text-[11px] font-mono bg-rose-600 text-white rounded-full px-1.5 py-0.5">{x.counts.not_cleaned}</span> : null}
              </button>
            ))}
          </div>

          {b && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {/* Result */}
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[13px] font-extrabold text-slate-900 flex items-center gap-2"><Users className="w-4 h-4 text-cyan-700" /> {b.block} · {fmtDate(b.date)}</p>
                  <span className="text-[11px] font-bold text-slate-500">{b.rooms.length} rooms</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {['cleaned', 'not_cleaned', 'no_reply', 'vacant'].map((k) => <Tile key={k} k={k} n={b.counts[k] || 0} />)}
                </div>

                <div>
                  <p className="text-[12px] font-extrabold text-rose-800 mb-1.5">Not cleaned ({b.rooms.filter((r) => r.status === 'not_cleaned').length})</p>
                  {b.rooms.filter((r) => r.status === 'not_cleaned').length === 0 ? (
                    <p className="text-[12px] text-slate-500 font-medium rounded-lg bg-slate-50 border border-dashed border-slate-200 px-3 py-4 text-center">No room reported dirty for this day.</p>
                  ) : (
                    <ul className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {b.rooms.filter((r) => r.status === 'not_cleaned').map((r) => (
                        <li key={r.room} className="rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-2 min-w-0">
                          <p className="text-[13px] font-extrabold text-slate-900 flex items-center justify-between gap-2">Room {r.room}
                            {r.notFixedCount > 0 && <span className="text-[10.5px] font-mono text-rose-700">Not fixed {r.notFixedCount}×</span>}
                          </p>
                          <p className="text-[11.5px] text-slate-600 font-semibold break-words">Answered No by {r.answeredByName || 'a roommate'}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <button type="button" onClick={() => setShowAll((v) => !v)} className="w-full min-h-[44px] rounded-xl border border-slate-200 text-[12.5px] font-bold text-slate-700 flex items-center justify-center gap-1.5 cursor-pointer">
                  All rooms ({b.rooms.length}) <ChevronDown className={`w-4 h-4 transition ${showAll ? 'rotate-180' : ''}`} />
                </button>
                {showAll && (
                  <ul className="grid grid-cols-1 min-[420px]:grid-cols-2 gap-1.5 max-h-[420px] overflow-y-auto pr-0.5">
                    {b.rooms.map((r) => {
                      const s = STATUS[r.status] || STATUS.open;
                      return (
                        <li key={r.room} className="rounded-lg border border-slate-200 px-2.5 py-2 flex items-start gap-2 min-w-0">
                          <span className={`w-2.5 h-2.5 rounded-full mt-1 shrink-0 ${s.dot}`} />
                          <span className="min-w-0 text-[12px] leading-snug">
                            <b className="font-extrabold text-slate-900">{r.room}</b> <span className="text-slate-600 font-semibold">{s.label}</span>
                            {r.answeredByName && <span className="block text-[11px] text-slate-500 break-words">{r.answeredByName}: {r.answer === 'yes' ? 'Yes' : 'No'}</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* Settings + cleaners + history */}
              <div className="space-y-4 min-w-0">
                <div className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
                  <p className="text-[13px] font-extrabold text-slate-900 flex items-center gap-2"><Settings className="w-4 h-4 text-cyan-700" /> Cleaning days · {b.block}</p>
                  {draft && (
                    <>
                      <div className="grid grid-cols-7 gap-1.5">
                        {DAYS.map((d, i) => {
                          const on = draft.weekdays.includes(i);
                          return (
                            <button key={d} type="button" disabled={!canEdit} aria-pressed={on}
                              onClick={() => setDraft((v) => {
                                const next = on ? v.weekdays.filter((x) => x !== i) : [...v.weekdays, i].sort();
                                return { ...v, weekdays: next.length ? next : v.weekdays };
                              })}
                              className={`min-h-[44px] rounded-lg text-[12px] font-extrabold border cursor-pointer ${on ? 'bg-cyan-600 text-white border-cyan-600' : 'bg-white text-slate-600 border-slate-200'}`}>{d}</button>
                          );
                        })}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="text-[11px] font-bold text-slate-500">Cleaning starts
                          <input type="time" value={draft.startTime} disabled={!canEdit} onChange={(e) => setDraft((v) => ({ ...v, startTime: e.target.value }))} className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 px-2.5 text-[14px] font-bold text-slate-900 bg-white" />
                        </label>
                        <label className="text-[11px] font-bold text-slate-500">Cleaning ends
                          <input type="time" value={draft.endTime} disabled={!canEdit} onChange={(e) => setDraft((v) => ({ ...v, endTime: e.target.value }))} className="mt-1 w-full min-h-[44px] rounded-lg border border-slate-300 px-2.5 text-[14px] font-bold text-slate-900 bg-white" />
                        </label>
                      </div>
                      <p className="text-[11px] text-slate-500 font-medium leading-snug">Students are asked from the end time for 8 hours (default 1 PM to 9 PM).</p>
                      {canEdit && (
                        <button type="button" disabled={!dirty || saving} onClick={save}
                          className="w-full min-h-[44px] rounded-xl bg-cyan-600 hover:bg-cyan-700 disabled:opacity-40 text-white text-[13px] font-extrabold flex items-center justify-center gap-2 cursor-pointer">
                          <Save className="w-4 h-4" /> {saving ? 'Saving…' : 'Save settings'}
                        </button>
                      )}
                      {msg && <p className={`text-[12px] font-bold ${msg.ok ? 'text-emerald-700' : 'text-rose-700'}`} role="status">{msg.ok && <Check className="inline w-3.5 h-3.5 mr-1" />}{msg.text}</p>}
                    </>
                  )}
                  <div className="border-t border-slate-100 pt-3">
                    <p className="text-[12px] font-extrabold text-slate-800 mb-1.5">Cleaners of {b.block}</p>
                    {b.cleaners.length === 0 ? (
                      <p className="text-[12px] text-slate-500 font-medium">No cleaners set for this block yet. Complaints are saved without one.</p>
                    ) : (
                      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {b.cleaners.slice(0, 2).map((c) => (
                          <li key={c.id} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 min-w-0">
                            <p className="text-[13px] font-extrabold text-slate-900 break-words">{c.name}</p>
                            {c.phone && <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 min-h-[44px] text-[12px] font-mono font-bold text-slate-700"><Phone className="w-3.5 h-3.5" />{c.phone}</a>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-3.5">
                  <p className="text-[13px] font-extrabold text-slate-900 flex items-center gap-2 mb-2"><History className="w-4 h-4 text-cyan-700" /> Last cleaning days</p>
                  {b.history.length === 0 ? (
                    <p className="text-[12px] text-slate-500 font-medium rounded-lg bg-slate-50 border border-dashed border-slate-200 px-3 py-4 text-center">History appears after the first cleaning day closes.</p>
                  ) : (
                    <ul className="divide-y divide-slate-100">
                      {b.history.map((h) => (
                        <li key={h.date} className="py-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                          <span className="text-[12.5px] font-extrabold text-slate-800">{fmtDate(h.date)}</span>
                          <span className="flex flex-wrap gap-1.5 text-[11px] font-mono font-bold">
                            <span className="px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-800">{h.counts.cleaned} clean</span>
                            <span className="px-1.5 py-0.5 rounded bg-rose-50 text-rose-800">{h.counts.not_cleaned} not</span>
                            <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800">{h.counts.no_reply} no reply</span>
                            <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">{h.counts.vacant} vacant</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function CleaningPanel({ role = 'WARDEN', onAlertCount = () => {} }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/cleaning/warden');
      const j = await r.json();
      if (!r.ok || !j.success) throw new Error(j.error || 'Could not load cleaning data');
      setData(j); setError(''); onAlertCount((j.alerts || []).length);
    } catch (e) { setError(e.message || 'Could not load cleaning data'); }
  }, [onAlertCount]);

  useEffect(() => { load(); const iv = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60000); return () => clearInterval(iv); }, [load]);

  const save = async (block, s) => {
    try {
      const r = await fetch('/api/cleaning/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ block, weekdays: s.weekdays, startTime: s.startTime, endTime: s.endTime }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) return { ok: false, error: j.error };
      await load();
      return { ok: true };
    } catch { return { ok: false, error: 'Network error' }; }
  };

  if (error && !data) {
    return (
      <div className="min-h-[200px] flex flex-col items-center justify-center text-center px-4 py-10">
        <span className="w-14 h-14 rounded-full ring-8 flex items-center justify-center mb-4 bg-rose-50 text-rose-600 ring-rose-100"><AlertTriangle className="w-7 h-7" /></span>
        <p className="text-sm font-semibold text-slate-800">Cleaning data unavailable</p>
        <p className="text-xs text-slate-500 mt-1 max-w-sm">{error}</p>
        <button type="button" onClick={load} className="mt-3 min-h-[44px] px-4 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 flex items-center gap-1.5 cursor-pointer"><RefreshCw className="w-3.5 h-3.5" /> Try again</button>
      </div>
    );
  }
  if (!data) return <p className="text-xs font-semibold text-slate-500 py-8 text-center">Loading cleaning data…</p>;
  return <CleaningPanelView data={data} onSave={save} canEdit={role === 'WARDEN'} />;
}

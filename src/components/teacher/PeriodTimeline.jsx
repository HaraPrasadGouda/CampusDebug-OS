import React from 'react';
import { CalendarDays, MapPin, Clock, UserCheck, CheckCircle2, Lock, Ban, LifeBuoy } from 'lucide-react';

// "My day" — today's classes period by period as a timeline: time rail on the
// left (done = green, live = amber, upcoming = indigo), one card per class.
// Classes I took from the cover board sit in the same rail, tagged COVER.
// When I'm on leave each of my classes says what happened to it on the board.
export default function PeriodTimeline({ rows, loaded, onMark, markOpen, openLabel, markedRec, nowMin }) {
  const lookState = (r) => (nowMin >= r.endMin ? 'done' : nowMin >= r.startMin ? 'live' : 'next');
  const dot = { done: 'bg-emerald-500', live: 'bg-amber-400 ring-4 ring-amber-100', next: 'bg-indigo-500' };
  return (
    <section id="td-timetable" className="order-4 xl:grow scroll-mt-[124px] rounded-2xl border border-indigo-100 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-gradient-to-r from-indigo-50 to-white border-b border-indigo-100">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center border border-indigo-200 shrink-0"><CalendarDays className="w-4 h-4" /></div>
          <h3 className="text-[15px] font-extrabold text-slate-900">My day</h3>
        </div>
        <span className="shrink-0 text-[11px] font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-full px-2.5 py-1">
          Today · {loaded ? `${rows.length} ${rows.length === 1 ? 'class' : 'classes'}` : '…'}
        </span>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-500 flex items-center justify-center mb-2.5"><CalendarDays className="w-7 h-7" /></div>
          <p className="text-sm font-extrabold text-slate-900">{loaded ? 'No classes for you today' : 'Loading your day…'}</p>
          <p className="text-xs text-slate-500 font-medium mt-1">{loaded ? 'Enjoy a quieter campus day. Covers you take from the cover board will show here.' : 'Schedule loads when the server timetable engine is reachable.'}</p>
        </div>
      ) : (
        <ol className="p-3 sm:p-4">
          {rows.map((r, i) => {
            const st = lookState(r);
            const rec = markedRec(r);
            return (
              <li key={`${r.sectionKey}|${r.period}|${i}`} className="flex gap-3">
                <div className="flex flex-col items-center w-11 shrink-0">
                  <span className="text-[10px] font-extrabold text-slate-500 leading-tight text-center">{r.startLabel}</span>
                  <span className={`mt-1 w-3 h-3 rounded-full shrink-0 ${r.card?.status === 'cancelled' ? 'bg-rose-500' : dot[st]}`} />
                  {i < rows.length - 1 && <span className="flex-1 w-0.5 bg-slate-200 my-1 min-h-[16px]" />}
                </div>
                <div className={`flex-1 min-w-0 mb-2.5 rounded-xl border px-3 py-2.5 ${st === 'live' ? 'border-amber-300 bg-amber-50/60' : r.cover ? 'border-sky-200 bg-sky-50/50' : 'border-slate-100 bg-slate-50'}`}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] font-black text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md px-1.5 py-0.5">{r.periodLabel}{r.span > 1 ? `–P${r.period + r.span - 1}` : ''}</span>
                    {r.kind === 'lab' && <span className="text-[10px] font-black text-violet-700 bg-violet-50 border border-violet-200 rounded-md px-1.5 py-0.5">LAB</span>}
                    {r.cover && <span className="text-[10px] font-black text-sky-700 bg-sky-100 border border-sky-200 rounded-md px-1.5 py-0.5 inline-flex items-center gap-1"><LifeBuoy className="w-3 h-3" />COVER</span>}
                    {st === 'live' && <span className="text-[10px] font-black text-amber-800 bg-amber-100 border border-amber-300 rounded-md px-1.5 py-0.5">LIVE</span>}
                  </div>
                  <p className="text-sm font-bold text-slate-900 mt-1 break-words">{r.subject}</p>
                  <p className="text-[11px] text-slate-500 font-medium">{r.sectionText}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-slate-500 font-medium">
                    <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{r.time}</span>
                    <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{r.room || '—'}</span>
                  </div>
                  <div className="mt-2">
                    {r.card ? (
                      r.card.status === 'taken' ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1.5"><Lock className="w-3 h-3" />{r.card.takenBy?.name} is taking this</span>
                      ) : r.card.status === 'cancelled' ? (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5"><Ban className="w-3 h-3" />Class cancelled — nobody took it</span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5"><LifeBuoy className="w-3 h-3" />On the cover board — no taker yet</span>
                      )
                    ) : rec ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5" title={`LOCKED — ${rec.takenByName || 'A teacher'} saved this class with ${(rec.present || []).length} present. Only an admin can unlock it.`}>
                        <CheckCircle2 className="w-3 h-3" />Marked {(rec.present || []).length} · Locked
                      </span>
                    ) : !markOpen(r) ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1.5" title={`Marking opens at ${openLabel(r)} — 10 minutes before the class starts. No early marking.`}>
                        <Clock className="w-3 h-3" />Opens {openLabel(r)}
                      </span>
                    ) : (
                      <button type="button" onClick={() => onMark(r.slot)} className="inline-flex items-center justify-center gap-1.5 text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl px-4 min-h-[44px] transition-colors cursor-pointer" title={`Mark attendance for ${r.subject} · ${r.periodLabel}`}>
                        <UserCheck className="w-3.5 h-3.5" />Mark attendance
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

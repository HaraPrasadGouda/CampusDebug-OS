import React, { useState } from 'react';
import { LifeBuoy, Clock, MapPin, Lock, UserCheck, Hand, Undo2, Users } from 'lucide-react';
import { tfetch, nowMin } from '../../utils/teacherApi';

// COVER BOARD (request model — nothing is assigned). A card shows here only if
// I'm free in that period AND I teach that section (the server decides).
// "Le lunga" = I'll take it; the first tap wins. I then teach MY OWN subject
// and take attendance under it.

// An AttendanceMarkModal slot built from a card I took.
export const slotFromCard = (c) => ({
  day: c.day, period: c.period, periodLabel: c.periodLabel, time: c.time, room: c.room,
  subjectCode: c.takenBy?.subjectCode, subject: c.takenBy?.subject, kind: c.kind || 'lecture',
  department: c.department, departmentLabel: c.departmentLabel, sectionKey: c.sectionKey, sectionLabel: c.sectionLabel
});

const Pill = ({ children, cls }) => <span className={`inline-flex items-center gap-1 text-[10px] font-extrabold rounded-full px-2 py-0.5 border ${cls}`}>{children}</span>;

export default function CoverBoardSection({ board, reload, onNotification, onMark, markOpen, openLabel, markedRec, onLeave = false, myCards = [] }) {
  const [busy, setBusy] = useState(null);
  const [pick, setPick] = useState({});            // card id -> chosen subjectCode
  const open = board?.open || [], taken = board?.taken || [], mine = board?.mine || [];
  const total = open.length + mine.length;

  const act = async (c, kind) => {
    setBusy(c.id);
    const r = await tfetch(`/api/teacher/cover-board/${encodeURIComponent(c.id)}/${kind}`, 'POST', kind === 'take' ? { subjectCode: pick[c.id] || undefined } : {});
    onNotification?.(r.message || r.error || 'Done', r.ok ? 'success' : (r.status === 409 ? 'info' : 'error'));
    await reload?.();
    setBusy(null);
  };

  return (
    <section id="td-cover" className="scroll-mt-[124px] rounded-2xl border border-indigo-200 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-gradient-to-r from-indigo-50 to-white border-b border-indigo-100">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-sm"><LifeBuoy className="w-4 h-4" /></div>
          <div className="min-w-0">
            <h3 className="text-[15px] font-extrabold text-slate-900 leading-tight">Cover board</h3>
            <p className="text-[11px] text-slate-500 font-medium leading-snug">Only teachers who are free and teach that section see these.</p>
          </div>
        </div>
        <span className={`shrink-0 text-[11px] font-extrabold rounded-full px-2.5 py-1 border ${open.length ? 'bg-amber-100 text-amber-800 border-amber-300' : 'bg-slate-50 text-slate-500 border-slate-200'}`}>
          {open.length ? `${open.length} open` : 'none open'}
        </span>
      </div>

      <div className="p-3 sm:p-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3 items-start">
        {/* I'm on leave: where each of MY classes stands on the board */}
        {onLeave && (
          <div className="col-span-full rounded-2xl border-2 border-amber-200 bg-amber-50/50 p-3.5">
            <p className="text-sm font-extrabold text-slate-900">Your classes on the board</p>
            <p className="text-[12px] text-slate-600 font-medium mt-0.5">Nobody is assigned — free teachers of each section can take a class. You send no requests.</p>
            {myCards.length === 0 ? (
              <p className="text-[12px] text-slate-500 font-semibold mt-2">No classes left today, so nothing is on the board.</p>
            ) : (
              <ul className="mt-2.5 space-y-1.5">
                {myCards.map(c => (
                  <li key={c.id} className="flex items-center gap-2.5 rounded-xl bg-white border border-slate-200 px-3 py-2">
                    <span className="text-[10px] font-black text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md px-1.5 py-0.5 shrink-0">{c.periodLabel}{c.span > 1 ? `–P${c.period + c.span - 1}` : ''}</span>
                    <span className="flex-1 min-w-0"><span className="block text-[13px] font-bold text-slate-900 break-words">{c.short} · {c.subject}</span><span className="block text-[11px] text-slate-500 font-medium">{c.time}</span></span>
                    {c.status === 'taken' ? <Pill cls="bg-emerald-50 text-emerald-700 border-emerald-200"><Lock className="w-3 h-3" />{c.takenBy?.name}</Pill>
                      : c.status === 'cancelled' ? <Pill cls="bg-rose-50 text-rose-700 border-rose-200">Cancelled</Pill>
                        : <Pill cls="bg-amber-50 text-amber-800 border-amber-300">Waiting</Pill>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Cards I took */}
        {mine.map(c => {
          const started = nowMin() >= c.startMin;
          const rec = markedRec?.(c);
          return (
            <div key={c.id} className="rounded-2xl border-2 border-indigo-300 bg-gradient-to-br from-indigo-50 to-white p-3.5">
              <div className="flex items-start gap-3">
                <span className="text-[11px] font-black text-white bg-indigo-600 rounded-lg px-2 py-1 shrink-0">{c.periodLabel}{c.span > 1 ? `–P${c.period + c.span - 1}` : ''}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-extrabold text-slate-900 break-words">You're taking {c.short}</p>
                  <p className="text-[12px] font-bold text-indigo-700 mt-0.5">{c.time}</p>
                  <p className="text-[12px] text-slate-600 font-medium mt-0.5">Teach <b>{c.takenBy?.subject}</b> — attendance goes under your subject.</p>
                  <p className="text-[11px] text-slate-500 mt-0.5 flex items-center gap-1"><MapPin className="w-3 h-3" />{c.room || 'room as on timetable'} · covering {c.absentName}</p>
                </div>
              </div>
              <div className="flex flex-col sm:flex-row gap-2 mt-3">
                {rec ? (
                  <span className="flex-1 min-h-[44px] rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-extrabold flex items-center justify-center gap-1.5">
                    Marked {(rec.present || []).length} · Locked
                  </span>
                ) : markOpen?.(c) ? (
                  <button type="button" onClick={() => onMark?.(slotFromCard(c))} className="flex-1 min-h-[48px] rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-extrabold flex items-center justify-center gap-1.5 cursor-pointer transition-colors">
                    <UserCheck className="w-4 h-4" /> Mark attendance
                  </button>
                ) : (
                  <span className="flex-1 min-h-[44px] rounded-xl bg-slate-100 border border-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" /> Marking opens {openLabel?.(c)}
                  </span>
                )}
                {!started && !rec && (
                  <button type="button" disabled={busy === c.id} onClick={() => act(c, 'release')} className="min-h-[44px] px-4 rounded-xl border-2 border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer transition-colors disabled:opacity-60">
                    <Undo2 className="w-3.5 h-3.5" /> Can't take it after all
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Open cards — tap "Le lunga" */}
        {open.map(c => {
          const subj = c.subjects || [];
          const chosen = pick[c.id] || subj[0]?.subjectCode;
          const chosenSubj = subj.find(s => s.subjectCode === chosen) || subj[0];
          const urgent = c.minutesToStart <= 30;
          return (
            <div key={c.id} className={`rounded-2xl border-2 p-3.5 ${urgent ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-white'}`}>
              <div className="flex items-start gap-3">
                <span className="text-[11px] font-black text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1 shrink-0">{c.periodLabel}{c.span > 1 ? `–P${c.period + c.span - 1}` : ''}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-base font-extrabold text-slate-900 leading-tight">{c.short}</p>
                  <p className="text-[12px] font-bold text-indigo-700 mt-0.5">{c.time}</p>
                  <p className="text-[12px] text-slate-600 font-medium mt-0.5 break-words">Free period needs cover · absent: <b>{c.absentName}</b> · {c.subject}</p>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-slate-500">
                    <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3" />{c.room || 'room as on timetable'}</span>
                    <span className={`inline-flex items-center gap-1 font-bold ${urgent ? 'text-amber-700' : ''}`}><Clock className="w-3 h-3" />{c.minutesToStart > 0 ? `starts in ${c.minutesToStart} min` : 'starting now'}</span>
                  </div>
                </div>
              </div>
              {subj.length > 1 && (
                <div className="mt-2.5">
                  <p className="text-[11px] font-bold text-slate-500 mb-1">You teach more than one subject here — pick one:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {subj.map(s => (
                      <button key={s.subjectCode} type="button" onClick={() => setPick(p => ({ ...p, [c.id]: s.subjectCode }))}
                        className={`min-h-[44px] px-3 rounded-xl border-2 text-xs font-bold cursor-pointer transition-colors ${chosen === s.subjectCode ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'}`}>{s.subject}</button>
                    ))}
                  </div>
                </div>
              )}
              <button type="button" disabled={busy === c.id} onClick={() => act(c, 'take')}
                className="mt-3 w-full min-h-[52px] py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 disabled:opacity-60 text-white text-sm font-extrabold flex items-center justify-center gap-2 cursor-pointer transition-colors shadow-sm">
                <Hand className="w-5 h-5 shrink-0" />
                <span className="flex flex-col items-start leading-tight text-left min-w-0">
                  <span>{busy === c.id ? 'Taking…' : "I'll take it"}</span>
                  <span className="text-[11px] font-semibold text-indigo-100 break-words">I'll teach {chosenSubj?.subject || 'my subject'}</span>
                </span>
              </button>
            </div>
          );
        })}

        {/* Taken by a colleague — closed for me */}
        {taken.map(c => (
          <div key={c.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-3.5 flex items-center gap-3 opacity-90">
            <span className="text-[11px] font-black text-slate-500 bg-white border border-slate-200 rounded-lg px-2 py-1 shrink-0">{c.periodLabel}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-700">{c.short} <span className="text-slate-400 font-semibold text-xs">· {c.time}</span></p>
              <p className="text-[12px] text-slate-500 font-semibold flex items-center gap-1"><Lock className="w-3 h-3 shrink-0" />{c.takenBy?.name} is taking this</p>
            </div>
          </div>
        ))}

        {/* Empty state */}
        {total === 0 && taken.length === 0 && !onLeave && (
          <div className="col-span-full rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 px-4 py-6 text-center">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center mb-2.5"><Users className="w-7 h-7" /></div>
            <p className="text-sm font-extrabold text-slate-900">Nothing needs cover right now</p>
            <p className="text-[12px] text-slate-500 font-medium mt-1 leading-relaxed max-w-sm mx-auto">
              When a colleague is on leave, their classes show here — only to teachers who are free in that period and teach that section. Tap <b>I&apos;ll take it</b> to take one.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

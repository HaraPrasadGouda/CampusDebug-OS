import React from 'react';
import { Sparkles } from 'lucide-react';

// Teacher home hero — the teacher's own identity (deep indigo, a day strip of
// period ticks, "next up") built from the same card language as the student's
// wish card: rounded-3xl, soft shapes, bold greeting, one glance of the day.
//
// periods: [{ label:'P1', state:'done'|'live'|'next'|'upcoming'|'cover'|'cancelled'|'gone' }]
const tickCls = {
  done: 'bg-emerald-400', live: 'bg-amber-300 animate-pulse', next: 'bg-white/90', upcoming: 'bg-white/35',
  cover: 'bg-sky-300', cancelled: 'bg-rose-400', gone: 'bg-white/15'
};

export default function TeacherHero({ greeting, firstName, dateLabel, periods = [], next, stats, note }) {
  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-900 via-indigo-700 to-violet-600 text-white p-5 sm:p-6 md:p-8 shadow-lg shadow-indigo-900/20">
      {/* soft shapes */}
      <div className="pointer-events-none absolute -right-10 -top-12 w-48 h-48 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute right-16 -bottom-16 w-40 h-40 rounded-full bg-fuchsia-400/20" />
      <div className="relative z-10 flex flex-col md:flex-row md:items-end md:justify-between gap-5">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-200 flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5" /> {dateLabel}
          </p>
          <h1 className="mt-1.5 text-2xl md:text-3xl font-extrabold tracking-tight break-words">{greeting}, {firstName}!</h1>
          <p className="mt-1 text-[13px] md:text-sm text-indigo-100 font-medium leading-snug">
            {note
              ? note
              : next
              ? <>Next up: <b className="text-white">{next.label}</b> <span className="opacity-90">· {next.when}</span></>
              : 'No more classes today — your teaching desk is clear.'}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2 md:w-[22rem] shrink-0">
          {stats.map(s => (
            <div key={s.label} className={`rounded-2xl px-3 py-2.5 border ${s.hot ? 'bg-amber-300/20 border-amber-200/50' : 'bg-white/10 border-white/15'}`}>
              <p className="text-xl font-extrabold leading-none flex items-center gap-1.5">{s.value}</p>
              <p className="text-[10px] font-bold uppercase tracking-wide text-indigo-100 mt-1.5 leading-tight">{s.label}</p>
            </div>
          ))}
        </div>
      </div>
      {/* day strip: one tick per period */}
      <div className={`relative z-10 ${periods.length ? 'mt-5' : ''}`} role="img" aria-label={`Today: ${periods.map(p => `${p.label} ${p.state}`).join(', ') || 'no classes'}`}>
        {periods.length > 0 ? (
          <>
            <div className="flex gap-1.5">
              {periods.map(p => <span key={p.label} className={`h-2 flex-1 rounded-full ${tickCls[p.state] || tickCls.upcoming}`} />)}
            </div>
            <div className="flex gap-1.5 mt-1.5">
              {periods.map(p => <span key={p.label} className="flex-1 text-center text-[10px] font-bold text-indigo-100">{p.label}</span>)}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[10px] font-semibold text-indigo-100">
              <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-emerald-400" />done</span>
              <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-amber-300" />live</span>
              <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-white/80" />upcoming</span>
              <span className="inline-flex items-center gap-1"><i className="w-2 h-2 rounded-full bg-sky-300" />cover</span>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}


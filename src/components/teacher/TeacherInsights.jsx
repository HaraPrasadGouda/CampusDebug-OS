import React, { useState, useEffect, useCallback } from 'react';
import { BarChart3, BookOpenCheck, CalendarOff, Plus, Check, Trash2, AlertTriangle, ChevronDown } from 'lucide-react';
import { tfetch } from '../../utils/teacherApi';

// Three compact teacher tools in ONE card (tabs): class analytics, lesson plan,
// my leaves. Analytics = real attendance records; lesson plan = server file
// store per teacher; leaves = the log of "On Leave Today" taps.

const TABS = [
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'plan', label: 'Lesson plan', icon: BookOpenCheck },
  { id: 'leaves', label: 'My leaves', icon: CalendarOff }
];
const pctCls = (p) => (p == null ? 'bg-slate-300' : p >= 75 ? 'bg-emerald-500' : p >= 60 ? 'bg-amber-500' : 'bg-rose-500');
const Empty = ({ icon: Icon, title, text }) => (
  <div className="rounded-2xl border border-dashed border-indigo-200 bg-indigo-50/40 px-4 py-7 text-center">
    <div className="mx-auto w-14 h-14 rounded-2xl bg-indigo-100 text-indigo-600 flex items-center justify-center mb-2.5"><Icon className="w-7 h-7" /></div>
    <p className="text-sm font-extrabold text-slate-900">{title}</p>
    <p className="text-[12px] text-slate-500 font-medium mt-1 leading-relaxed max-w-sm mx-auto">{text}</p>
  </div>
);

function Analytics() {
  const [d, setD] = useState(null);
  const [open, setOpen] = useState({});
  const [all, setAll] = useState({});
  useEffect(() => { tfetch('/api/teacher/analytics').then(r => setD(r.ok ? r : { sections: [], err: r.error })); }, []);
  if (!d) return <p className="text-xs text-slate-500 px-1 py-6 text-center">Reading attendance records…</p>;
  if (!d.sections.length) return <Empty icon={BarChart3} title="No classes to analyse yet" text={d.err || 'Once you have classes on the timetable and attendance is marked, subject-wise percentages appear here.'} />;
  return (
    <div className="space-y-4">
      {d.sections.map(sec => (
        <div key={sec.sectionKey} className="rounded-2xl border border-slate-200 overflow-hidden">
          <div className="flex items-center justify-between px-3.5 py-2.5 bg-slate-50 border-b border-slate-200">
            <p className="text-sm font-extrabold text-slate-900">{sec.short}</p>
            <span className="text-[11px] font-bold text-slate-500">{sec.students} {sec.students === 1 ? 'student' : 'students'}</span>
          </div>
          <div className="divide-y divide-slate-100">
            {sec.subjects.map(s => {
              const k = `${sec.sectionKey}|${s.subjectCode}`;
              const rows = all[k] ? s.below75 : s.below75.slice(0, 6);
              return (
                <div key={k} className="px-3.5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[13px] font-bold text-slate-900 min-w-0 break-words">{s.subject}</p>
                    <p className="text-sm font-extrabold text-slate-900 shrink-0">{s.avgPct == null ? '—' : `${s.avgPct}%`}</p>
                  </div>
                  <div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden relative">
                    <div className={`h-full rounded-full ${pctCls(s.avgPct)}`} style={{ width: `${Math.min(100, s.avgPct || 0)}%` }} />
                    <span className="absolute top-0 bottom-0 w-0.5 bg-slate-500/60" style={{ left: '75%' }} title="75% line" />
                  </div>
                  <p className="text-[11px] text-slate-500 font-medium mt-1">{s.sessions} {s.sessions === 1 ? 'class' : 'classes'} marked · class average{s.avgPct == null ? ' (no records yet)' : ''}</p>
                  {s.below75.length > 0 ? (
                    <div className="mt-2">
                      <button type="button" onClick={() => setOpen(o => ({ ...o, [k]: !o[k] }))} className="w-full min-h-[44px] rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-extrabold px-3 flex items-center justify-between cursor-pointer">
                        <span className="inline-flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{s.below75.length} below 75%</span>
                        <ChevronDown className={`w-4 h-4 transition-transform ${open[k] ? 'rotate-180' : ''}`} />
                      </button>
                      {open[k] && (
                        <ul className="mt-1.5 rounded-xl border border-rose-100 divide-y divide-rose-50 bg-white">
                          {rows.map(st => (
                            <li key={st.roll} className="flex items-center gap-2 px-3 py-2">
                              <span className="flex-1 min-w-0"><span className="block text-xs font-bold text-slate-800 truncate">{st.name}</span><span className="block text-[10px] font-mono text-slate-400">{st.roll}</span></span>
                              <span className="text-xs font-extrabold text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2 py-0.5">{st.pct}%</span>
                            </li>
                          ))}
                          {s.below75.length > 6 && !all[k] && (
                            <li><button type="button" onClick={() => setAll(a => ({ ...a, [k]: true }))} className="w-full min-h-[44px] text-xs font-bold text-indigo-700 cursor-pointer">Show all {s.below75.length}</button></li>
                          )}
                        </ul>
                      )}
                    </div>
                  ) : (s.sessions > 0 && <p className="mt-2 text-[11px] font-bold text-emerald-700">Everyone is at 75% or above 🎉</p>)}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function LessonPlan() {
  const [classes, setClasses] = useState(null);
  const [plans, setPlans] = useState({});
  const [sel, setSel] = useState(0);
  const [title, setTitle] = useState('');
  useEffect(() => {
    // Open on the first subject that already has topics (else the first one).
    Promise.all([tfetch('/api/teacher/my-classes'), tfetch('/api/teacher/lesson-plan')]).then(([c, p]) => {
      const cl = c.ok ? c.classes : [], pl = p.ok ? (p.plans || {}) : {};
      setClasses(cl); setPlans(pl);
      const i = cl.findIndex(x => (pl[`${x.sectionKey}|${x.subjectCode}`] || []).length > 0);
      if (i > 0) setSel(i);
    });
  }, []);
  const post = useCallback(async (body) => {
    const r = await tfetch('/api/teacher/lesson-plan', 'POST', body);
    if (r.ok) setPlans(r.plans || {});
  }, []);
  if (!classes) return <p className="text-xs text-slate-500 px-1 py-6 text-center">Loading…</p>;
  if (!classes.length) return <Empty icon={BookOpenCheck} title="No subjects on your timetable" text="Your lesson plans are per subject and section. They show up here once you have classes on the published timetable." />;
  const c = classes[Math.min(sel, classes.length - 1)];
  const key = `${c.sectionKey}|${c.subjectCode}`;
  const topics = plans[key] || [];
  const done = topics.filter(t => t.done).length;
  const pct = topics.length ? Math.round((done / topics.length) * 100) : 0;
  const add = async (e) => { e.preventDefault(); const t = title.trim(); if (!t) return; setTitle(''); await post({ sectionKey: c.sectionKey, subjectCode: c.subjectCode, action: 'add', title: t }); };
  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-none">
        {classes.map((x, i) => (
          <button key={`${x.sectionKey}|${x.subjectCode}`} type="button" onClick={() => setSel(i)}
            className={`shrink-0 min-h-[44px] px-3 rounded-xl border-2 text-xs font-bold text-left cursor-pointer transition-colors ${i === sel ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-700 border-slate-200'}`}>
            {x.subject}<span className={`block text-[10px] font-semibold ${i === sel ? 'text-indigo-100' : 'text-slate-400'}`}>{x.short}</span>
          </button>
        ))}
      </div>
      <div className="mt-2 rounded-2xl border border-slate-200 p-3.5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-extrabold text-slate-900">Syllabus done</p>
          <p className="text-lg font-extrabold text-indigo-700">{pct}%</p>
        </div>
        <div className="mt-1.5 h-2.5 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500" style={{ width: `${pct}%` }} /></div>
        <p className="text-[11px] text-slate-500 font-medium mt-1">{done} of {topics.length} topics covered</p>
        <ul className="mt-2 divide-y divide-slate-100">
          {topics.map(t => (
            <li key={t.id} className="flex items-center gap-2 py-1">
              <button type="button" aria-label={t.done ? 'Mark not done' : 'Mark done'} onClick={() => post({ sectionKey: c.sectionKey, subjectCode: c.subjectCode, action: 'toggle', id: t.id })}
                className={`w-11 h-11 shrink-0 rounded-xl border-2 flex items-center justify-center cursor-pointer transition-colors ${t.done ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-white border-slate-300 text-transparent hover:border-indigo-400'}`}><Check className="w-5 h-5" /></button>
              <span className={`flex-1 min-w-0 text-[13px] font-semibold break-words ${t.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{t.title}</span>
              <button type="button" aria-label="Remove topic" onClick={() => post({ sectionKey: c.sectionKey, subjectCode: c.subjectCode, action: 'remove', id: t.id })} className="w-11 h-11 shrink-0 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 flex items-center justify-center cursor-pointer"><Trash2 className="w-4 h-4" /></button>
            </li>
          ))}
        </ul>
        {topics.length === 0 && <p className="text-[12px] text-slate-500 font-medium py-3 text-center">No topics yet — add the first one below, then tick them as you finish.</p>}
        <form onSubmit={add} className="mt-2 flex gap-2">
          <input value={title} onChange={e => setTitle(e.target.value)} maxLength={120} placeholder="Add a topic, e.g. Process scheduling" className="flex-1 min-w-0 min-h-[44px] px-3 rounded-xl border border-slate-200 text-sm outline-none focus:border-indigo-400" />
          <button type="submit" aria-label="Add topic" className="min-w-[44px] min-h-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center cursor-pointer"><Plus className="w-5 h-5" /></button>
        </form>
      </div>
    </div>
  );
}

function MyLeaves() {
  const [d, setD] = useState(null);
  useEffect(() => { tfetch('/api/teacher/my-leaves').then(r => setD(r.ok ? r : { leaves: [], semesterDays: 0, yearDays: 0 })); }, []);
  if (!d) return <p className="text-xs text-slate-500 px-1 py-6 text-center">Loading…</p>;
  const fmt = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return (
    <div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white p-3.5"><p className="text-3xl font-extrabold leading-none">{d.semesterDays}</p><p className="text-[11px] font-bold text-indigo-100 mt-1.5 leading-tight">leave {d.semesterDays === 1 ? 'day' : 'days'} this semester<span className="block font-semibold opacity-80">{d.semester?.label}</span></p></div>
        <div className="rounded-2xl bg-slate-50 border border-slate-200 p-3.5"><p className="text-3xl font-extrabold leading-none text-slate-900">{d.yearDays}</p><p className="text-[11px] font-bold text-slate-500 mt-1.5 leading-tight">leave {d.yearDays === 1 ? 'day' : 'days'} this year</p></div>
      </div>
      {d.leaves.length === 0 ? (
        <div className="mt-3"><Empty icon={CalendarOff} title="No leave recorded" text='Every time you tap "On Leave Today" the day is counted here. Nothing recorded yet — a clean attendance record.' /></div>
      ) : (
        <ul className="mt-3 rounded-2xl border border-slate-200 divide-y divide-slate-100">
          {d.leaves.map(l => (
            <li key={l.date} className="flex items-center gap-3 px-3.5 py-2.5 min-h-[44px]">
              <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
              <span className="flex-1 min-w-0"><span className="block text-[13px] font-bold text-slate-800">{fmt(l.date)}</span><span className="block text-[11px] text-slate-500 font-medium truncate">{l.substitute ? `Leaves covered by ${l.substitute}` : 'No substitute'}{l.to ? ' · back the same day' : ''}</span></span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-slate-400 font-medium mt-2">Counted from the day this feature started{d.trackedSince ? ` (first record ${d.trackedSince})` : ''}; earlier leaves were never stored.</p>
    </div>
  );
}

export default function TeacherInsights() {
  const [tab, setTab] = useState('analytics');
  return (
    <section id="td-insights" className="scroll-mt-[124px] rounded-2xl border border-indigo-100 bg-white shadow-sm overflow-hidden">
      <div className="px-4 pt-3 pb-0 bg-gradient-to-r from-indigo-50 to-white border-b border-indigo-100">
        <h3 className="text-[15px] font-extrabold text-slate-900 mb-2">Teaching tools</h3>
        <div role="tablist" className="flex gap-1">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.id} role="tab" aria-selected={tab === t.id} type="button" onClick={() => setTab(t.id)}
                className={`flex-1 min-w-0 min-h-[56px] py-1.5 px-1 rounded-t-xl text-[11px] leading-tight font-extrabold flex flex-col items-center justify-center gap-1 cursor-pointer border-b-2 transition-colors ${tab === t.id ? 'text-indigo-700 border-indigo-600 bg-white' : 'text-slate-500 border-transparent hover:text-slate-800'}`}>
                <Icon className="w-4 h-4 shrink-0" /><span className="text-center break-words">{t.label}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="p-3 sm:p-4">
        {tab === 'analytics' && <Analytics />}
        {tab === 'plan' && <LessonPlan />}
        {tab === 'leaves' && <MyLeaves />}
      </div>
    </section>
  );
}

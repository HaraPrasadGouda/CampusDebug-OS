import React from 'react';
import {
  BellRing, X, ClipboardCheck, Users, ChevronRight, CheckCircle2, Clock, FilePlus, LogIn, BookOpen,
  Megaphone, CalendarOff, BellOff, Bell, UserCheck, ShieldCheck, Lock, Ban, LifeBuoy
} from 'lucide-react';

// Presentational pieces of the new teacher navigation (Today / Me). No data fetching here:
// TeacherDashboard owns the data and passes plain props.

// 'Turn on alerts' banner - only while push is off on this device; dismissible.
export function AlertsBanner({ onTurnOn, onDismiss, busy, msg }) {
  return (
    <div data-testid="alerts-banner" className="rounded-2xl bg-amber-50 border border-amber-200 pl-3.5 pr-0.5 py-1 min-h-[56px]">
      <div className="flex items-center gap-2">
        <p className="flex-1 min-w-0 text-[12px] font-bold text-slate-800 leading-snug flex items-start gap-2">
          <BellRing className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <span>Turn on alerts so you never miss a cover request or leave approval</span>
        </p>
        <button type="button" onClick={onTurnOn} disabled={busy} className="min-h-[44px] px-3 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-xs font-extrabold shrink-0 cursor-pointer">{busy ? 'Working…' : 'Turn on'}</button>
        <button type="button" aria-label="Dismiss" onClick={onDismiss} className="w-10 min-h-[44px] rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 shrink-0 cursor-pointer"><X className="w-4 h-4" /></button>
      </div>
      {msg && <p className="text-[11px] font-semibold text-rose-700 pb-2 pr-3">{msg}</p>}
    </div>
  );
}

// One row of 'Needs you now' (amber = own approvals, violet = covering).
export function NeedsRow({ tone = 'amber', count, title, sub, onClick, testId }) {
  const t = tone === 'violet'
    ? { box: 'border-violet-200 from-violet-50', ico: 'bg-violet-100 text-violet-700 border-violet-200', chev: 'text-violet-700', Icon: Users }
    : { box: 'border-amber-200 from-amber-50', ico: 'bg-amber-100 text-amber-700 border-amber-200', chev: 'text-amber-700', Icon: ClipboardCheck };
  const { Icon } = t;
  return (
    <button type="button" data-testid={testId} onClick={onClick} className={`w-full text-left rounded-2xl border-2 ${t.box} bg-gradient-to-r to-white p-2.5 flex items-center gap-2.5 min-h-[64px] cursor-pointer`}>
      <span className={`relative w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${t.ico}`}>
        <Icon className="w-5 h-5" aria-hidden="true" />
        <b className="absolute -top-2 -right-2 min-w-[22px] h-[22px] px-1 rounded-full bg-rose-500 text-white text-[11px] font-extrabold flex items-center justify-center ring-2 ring-white">{count}</b>
      </span>
      <span className="min-w-0 flex-1">
        <b className="block text-[14px] font-extrabold text-slate-900 leading-tight break-words">{title}</b>
        <span className="block text-[11px] text-slate-600 font-medium leading-snug">{sub}</span>
      </span>
      <ChevronRight className={`w-5 h-5 shrink-0 ${t.chev}`} aria-hidden="true" />
    </button>
  );
}

export function NeedsHeading({ count }) {
  return (
    <div className="flex items-center justify-between px-1">
      <h2 className="text-[17px] font-extrabold text-slate-900 flex items-center gap-2">
        Needs you now
        <span data-testid="needs-badge" className="min-w-[26px] h-[26px] px-1.5 rounded-full bg-rose-500 text-white text-[12px] font-extrabold inline-flex items-center justify-center">{count}</span>
      </h2>
    </div>
  );
}

// Quiet day: nothing pending and no cover cards.
export function AllClearCard() {
  return (
    <div data-testid="all-clear" className="rounded-2xl border-2 border-emerald-200 bg-gradient-to-r from-emerald-50 to-white p-3 flex items-center gap-3 min-h-[64px]">
      <span className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 border border-emerald-200 flex items-center justify-center shrink-0"><CheckCircle2 className="w-5 h-5" aria-hidden="true" /></span>
      <span className="min-w-0">
        <b className="block text-[15px] font-extrabold text-emerald-900 leading-tight">All clear</b>
        <span className="block text-[12px] text-slate-600 font-medium">Nothing needs you right now</span>
      </span>
    </div>
  );
}

export function NextClassCard({ row, minsLeft, markState, onMark }) {
  if (!row) return null;
  const live = minsLeft <= 0;
  return (
    <div data-testid="next-class" className="rounded-[22px] bg-white border-2 border-indigo-200 p-3.5 shadow-[0_4px_14px_rgba(79,70,229,0.12)]">
      <p className="text-[11px] font-extrabold uppercase tracking-wider text-indigo-700 mb-2">Next class</p>
      <div className="flex gap-2.5 items-start">
        <span className="text-xs font-black text-white bg-indigo-600 rounded-lg px-2 py-0.5 shrink-0">{row.periodLabel}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[17px] font-extrabold text-slate-900 leading-tight break-words">{row.subject}</p>
          <p className="text-[13px] font-semibold text-slate-600 mt-0.5 break-words">{row.sectionText}{row.room ? ` · Room ${row.room}` : ''}</p>
          <p className="text-[13px] font-extrabold text-amber-700 mt-1.5 flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" aria-hidden="true" />{live ? 'in progress' : `starts in ${minsLeft} min`}</p>
        </div>
      </div>
      {markState === 'open' && (
        <button type="button" data-testid="next-class-mark" onClick={onMark} className="mt-3 w-full min-h-[52px] rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white text-[15px] font-extrabold flex items-center justify-center gap-2 cursor-pointer"><UserCheck className="w-5 h-5" aria-hidden="true" />Mark attendance</button>
      )}
      {markState === 'later' && (
        <p className="mt-3 w-full min-h-[44px] rounded-2xl bg-slate-100 border border-slate-200 text-slate-600 text-[13px] font-bold flex items-center justify-center gap-1.5"><Clock className="w-4 h-4" aria-hidden="true" />Marking opens {row.openAt}</p>
      )}
      {markState === 'done' && (
        <p className="mt-3 w-full min-h-[44px] rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[13px] font-extrabold flex items-center justify-center gap-1.5"><CheckCircle2 className="w-4 h-4" aria-hidden="true" />Attendance marked</p>
      )}
    </div>
  );
}

export function QuickActions({ onCreateLeave, onGateLog, onLessonPlan, createOpen = true }) {
  const items = [
    { id: 'qa-create-leave', label: 'Create leave', Icon: FilePlus, onClick: onCreateLeave, disabled: !createOpen },
    { id: 'qa-gate-log', label: 'Gate log', Icon: LogIn, onClick: onGateLog },
    { id: 'qa-lesson-plan', label: 'Lesson plan', Icon: BookOpen, onClick: onLessonPlan }
  ];
  return (
    <div className="grid grid-cols-3 gap-2" data-testid="quick-actions">
      {items.map(({ id, label, Icon, onClick, disabled }) => (
        <button key={id} type="button" data-testid={id} onClick={onClick} disabled={disabled}
          className="min-h-[76px] rounded-2xl bg-white border-2 border-slate-200 hover:border-indigo-200 disabled:opacity-50 text-indigo-700 flex flex-col items-center justify-center gap-1.5 px-0.5 py-1.5 cursor-pointer">
          <Icon className="w-[22px] h-[22px]" aria-hidden="true" />
          <span className="text-[11.5px] font-extrabold text-slate-900 leading-tight text-center">{label}</span>
        </button>
      ))}
    </div>
  );
}

// ME: identity card (display only) + exactly three rows: Notices, My leaves, Alerts.
export function MeIdentity({ name, identity }) {
  const initials = String(name || 'T').replace(/^(dr|prof|professor|mr|mrs|ms)\.?\s+/i, '').split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'T';
  return (
    <div data-testid="me-identity" className="rounded-2xl border border-slate-200 bg-white p-3.5 flex items-center gap-3 shadow-sm">
      <span className="w-12 h-12 rounded-2xl bg-gradient-to-br from-cyan-600 to-blue-700 text-white flex items-center justify-center font-extrabold shrink-0">{initials}</span>
      <div className="min-w-0">
        <p className="text-[15px] font-extrabold text-slate-900 break-words">{name || 'Teacher'}</p>
        <p className="text-[12px] font-mono font-semibold text-slate-600 break-words">{identity || '—'} • Faculty Mentor</p>
      </div>
    </div>
  );
}

function MeRow({ id, Icon, tone, title, sub, onClick, right }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} data-testid={id} onClick={onClick}
      className={`w-full text-left flex items-center gap-3 px-3.5 min-h-[64px] bg-white ${onClick ? 'cursor-pointer hover:bg-slate-50' : ''}`}>
      <span className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${tone}`}><Icon className="w-5 h-5" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <b className="block text-[14px] font-extrabold text-slate-900 leading-tight">{title}</b>
        <span className="block text-[12px] text-slate-500 font-medium leading-snug">{sub}</span>
      </span>
      {right}
    </Tag>
  );
}

export function MeRows({ onNotices, myLeavesOpen, onToggleLeaves, alerts }) {
  const { on, busy, toggle, msg } = alerts;
  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden divide-y divide-slate-100" data-testid="me-rows">
      <MeRow id="me-notices" Icon={Megaphone} tone="bg-indigo-50 text-indigo-700 border-indigo-200" title="Notices" sub="Campus notice board" onClick={onNotices} right={<ChevronRight className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />} />
      <MeRow id="me-leaves" Icon={CalendarOff} tone="bg-amber-50 text-amber-700 border-amber-200" title="My leaves" sub="Your own leave history" onClick={onToggleLeaves}
        right={<ChevronRight className={`w-5 h-5 text-slate-400 shrink-0 transition-transform ${myLeavesOpen ? 'rotate-90' : ''}`} aria-hidden="true" />} />
      <MeRow id="me-alerts" Icon={on ? Bell : BellOff} tone={on ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-200'} title="Alerts"
        sub={on === null ? 'Checking this device…' : on ? 'On for this device' : 'Off on this device'}
        right={(
          <button type="button" role="switch" aria-checked={!!on} aria-label={on ? 'Turn alerts off' : 'Turn alerts on'} data-testid="me-alerts-toggle" disabled={busy || on === null} onClick={toggle}
            className={`shrink-0 min-h-[44px] px-3.5 rounded-xl text-xs font-extrabold cursor-pointer disabled:opacity-60 ${on ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white'}`}>
            {busy ? 'Working…' : on ? 'Turn off' : 'Turn on'}
          </button>
        )} />
      {msg && <p className="px-3.5 py-2 text-[11px] font-semibold text-rose-700 bg-rose-50">{msg}</p>}
    </div>
  );
}

// Violet group header for the Students tab ("Covering for <teacher>").
export function CoveringGroupHeader({ name, pending, active }) {
  return (
    <div data-testid="covering-group" className="flex items-center gap-2.5 px-1">
      <span className="w-9 h-9 rounded-xl bg-violet-600 text-white flex items-center justify-center shrink-0"><UserCheck className="w-4 h-4" aria-hidden="true" /></span>
      <h2 className="text-[16px] font-extrabold text-slate-900 min-w-0 break-words flex-1">{active ? `Covering for ${name}` : `${name} is back`}</h2>
      {active && pending > 0 && <span className="min-w-[24px] h-6 px-1.5 rounded-full bg-rose-500 text-white text-[12px] font-extrabold inline-flex items-center justify-center">{pending}</span>}
    </div>
  );
}

export const GroupDivider = ({ children }) => (
  <h2 className="px-1 pt-1 text-[16px] font-extrabold text-slate-900 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-cyan-700" aria-hidden="true" />{children}</h2>
);

// CLASSES -> Mark attendance: today's classes with the same Mark flow and time gate as 'My day'.
export function AttendanceList({ rows, loaded, markedRec, markOpen, openLabel, onMark, nowMin }) {
  return (
    <section id="td-attendance" data-testid="attendance-list" className="scroll-mt-[124px] rounded-2xl border border-indigo-100 bg-white shadow-sm overflow-hidden">
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-gradient-to-r from-indigo-50 to-white border-b border-indigo-100">
        <h3 className="text-[15px] font-extrabold text-slate-900 flex items-center gap-2"><span className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 border border-indigo-200 flex items-center justify-center"><UserCheck className="w-4 h-4" aria-hidden="true" /></span>Mark attendance</h3>
        <span className="shrink-0 text-[11px] font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-full px-2.5 py-1">{loaded ? `${rows.length} ${rows.length === 1 ? 'class' : 'classes'} today` : '…'}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs font-semibold text-slate-500">{loaded ? 'No classes for you today.' : 'Loading your classes…'}</p>
      ) : (
        <ul className="p-3 space-y-2">
          {rows.map((r, i) => {
            const rec = markedRec(r);
            const live = nowMin >= r.startMin && nowMin < r.endMin;
            return (
              <li key={`${r.sectionKey}|${r.period}|${i}`} className={`rounded-xl border px-3 py-2.5 ${live ? 'border-amber-300 bg-amber-50/60' : 'border-slate-100 bg-slate-50'}`}>
                <div className="flex items-start gap-2.5">
                  <span className="text-[10px] font-black text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-md px-1.5 py-0.5 shrink-0 mt-0.5">{r.periodLabel}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-bold text-slate-900 break-words leading-tight">{r.subject}{r.cover ? ' · Cover' : ''}</p>
                    <p className="text-[11px] text-slate-500 font-medium break-words">{r.sectionText} · {r.time}</p>
                  </div>
                </div>
                <div className="mt-2">
                  {r.card ? (
                    r.card.status === 'taken'
                      ? <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-sky-800 bg-sky-50 border border-sky-200 rounded-lg px-2.5 py-1.5"><Lock className="w-3 h-3" aria-hidden="true" />{r.card.takenBy?.name} is taking this</span>
                      : r.card.status === 'cancelled'
                        ? <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-2.5 py-1.5"><Ban className="w-3 h-3" aria-hidden="true" />Class cancelled</span>
                        : <span className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5"><LifeBuoy className="w-3 h-3" aria-hidden="true" />On the cover board</span>
                  ) : rec ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-black text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5"><CheckCircle2 className="w-3 h-3" aria-hidden="true" />Marked {(rec.present || []).length} · Locked</span>
                  ) : !markOpen(r) ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-slate-500 bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1.5"><Clock className="w-3 h-3" aria-hidden="true" />Opens {openLabel(r)}</span>
                  ) : (
                    <button type="button" data-testid="classes-mark" onClick={() => onMark(r.slot)} className="inline-flex items-center justify-center gap-1.5 text-xs font-black text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl px-4 min-h-[44px] cursor-pointer"><UserCheck className="w-3.5 h-3.5" aria-hidden="true" />Mark attendance</button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

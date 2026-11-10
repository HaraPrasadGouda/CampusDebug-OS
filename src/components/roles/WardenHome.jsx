import React from 'react';
import { greetingName } from '../../utils/displayName';
import {
  Sparkles, Check, X, MapPin, Clock, AlertTriangle, ClipboardCheck, Wrench, Layers,
  DoorOpen, Gauge, IndianRupee, Users, Plus, ChevronRight
} from 'lucide-react';

// Warden Home ("Needs you now"). Pure presentation: every number and every action comes
// from WardenDashboard (same data it already loads, same approve / reject / dispatch handlers).

const h12 = (ms) => new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }).replace(/\s?(am|pm)/i, (m) => ' ' + m.trim().toUpperCase());

export function untilLabel(iso, now = Date.now()) {
  const ms = new Date(iso).getTime();
  if (!ms || isNaN(ms)) return '—';
  const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
  const dayDiff = Math.floor((new Date(ms).setHours(0, 0, 0, 0) - d0.getTime()) / 86400000);
  const t = h12(ms);
  if (dayDiff === 0) return `today ${t}`;
  if (dayDiff === 1) return `tomorrow ${t}`;
  if (dayDiff > 1 && dayDiff < 7) return `${new Date(ms).toLocaleDateString('en-GB', { weekday: 'short' })} ${t}`;
  return `${new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${t}`;
}

export function agoLabel(ms, now = Date.now()) {
  if (!ms) return null;
  const diff = now - ms;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export function outFor(ms, now = Date.now()) {
  const mins = Math.max(0, Math.floor((now - ms) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

// Latest scan per pass (the server returns newest first, so "last one seen" would be the OLDEST).
export function latestScanByPass(rows) {
  const best = new Map();
  rows.forEach(r => {
    if (!r.pass_ref) return;
    const prev = best.get(r.pass_ref);
    if (!prev || new Date(r.scanned_at || 0).getTime() >= new Date(prev.scanned_at || 0).getTime()) best.set(r.pass_ref, r);
  });
  return Array.from(best.values());
}

const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

function PassCard({ pass, onApprove, onReject }) {
  const pri = !!pass.priority;
  const asked = agoLabel(new Date(pass.createdAt || 0).getTime());
  return (
    <div data-testid="home-pass-card" className={`rounded-2xl border-2 p-3.5 shadow-sm min-w-0 ${pri ? 'border-rose-200 bg-gradient-to-br from-rose-50/70 to-white' : 'border-slate-200 bg-white'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
            {pri ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 uppercase tracking-wide"><AlertTriangle className="w-3 h-3 shrink-0" />Medical priority</span>
            ) : (
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 uppercase tracking-wide">{pass.passType || 'Outing'}</span>
            )}
            <span className="font-mono text-[11px] font-bold text-slate-500 whitespace-nowrap">{pass.id}</span>
          </div>
        </div>
        <button type="button" onClick={() => onReject(pass)} className="min-h-[44px] px-3 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-500 text-[12px] font-bold flex items-center gap-1.5 shrink-0 -mt-1.5 -mr-1 cursor-pointer" aria-label={`Reject pass ${pass.id}`}>
          <X className="w-3.5 h-3.5 shrink-0" />Reject
        </button>
      </div>
      <p className="mt-1 text-[16px] font-extrabold text-slate-900 leading-tight break-words">{pass.name} <span className="font-mono text-[11px] font-semibold text-slate-400 whitespace-nowrap">{pass.rollNo}</span></p>
      {pass.room && <p className="text-[12px] text-slate-500 font-semibold">Room {pass.room}</p>}
      <p className="mt-2 flex items-start gap-1.5 text-[13px] text-slate-800 font-bold leading-snug"><MapPin className="w-4 h-4 mt-0.5 text-indigo-500 shrink-0" /><span className="min-w-0 break-words">{pass.destination || 'Main Campus'}</span></p>
      {pass.reason && <p className="mt-0.5 text-[12px] text-slate-600 italic leading-snug break-words">&ldquo;{pass.reason}&rdquo;</p>}
      <p className="mt-2 flex items-center gap-1.5 text-[12px] font-bold text-amber-700"><Clock className="w-3.5 h-3.5 shrink-0" />Valid until {untilLabel(pass.validUntil)}</p>
      {asked && <p className="mt-0.5 text-[11px] font-semibold text-slate-500 pl-5">Asked {asked}{pass.createdBy === 'WARDEN_ON_BEHALF' ? ' · Warden-desk pass' : ''}</p>}
      <button type="button" onClick={() => onApprove(pass)} className="mt-3 w-full min-h-[52px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-[15px] font-extrabold flex items-center justify-center gap-2 shadow-sm shadow-emerald-700/20 cursor-pointer" aria-label={`Approve and sign pass ${pass.id}`}>
        <Check className="w-5 h-5 shrink-0" />Approve &amp; sign
      </button>
    </div>
  );
}

const TONES = {
  rose: ['border-rose-200 from-rose-50', 'bg-rose-100 text-rose-700 border-rose-200', 'text-rose-700'],
  violet: ['border-violet-200 from-violet-50', 'bg-violet-100 text-violet-700 border-violet-200', 'text-violet-700'],
  cyan: ['border-cyan-200 from-cyan-50', 'bg-cyan-100 text-cyan-700 border-cyan-200', 'text-cyan-700'],
  slate: ['border-slate-200 from-slate-50', 'bg-slate-100 text-slate-700 border-slate-200', 'text-slate-600'],
};

// One summary row. The whole row is one tap target (opens the section); `action` adds a second,
// separate button that does the thing right here (Dispatch).
function SummaryRow({ icon: Icon, tone, title, sub, count, action, onOpen, testid }) {
  const t = TONES[tone] || TONES.slate;
  return (
    <div data-testid={testid} className={`flex items-stretch gap-2 rounded-2xl border-2 ${t[0]} bg-gradient-to-r to-white`}>
      <button type="button" onClick={onOpen} className="flex-1 min-w-0 text-left p-2.5 pr-1 flex items-center gap-3.5 min-h-[64px] cursor-pointer">
        <span className={`relative w-10 h-10 rounded-xl border ${t[1]} flex items-center justify-center shrink-0`}>
          <Icon className="w-5 h-5 shrink-0" />
          {count ? <b className="absolute -top-2 -right-2 min-w-[22px] h-[22px] px-1 rounded-full bg-rose-500 text-white text-[11px] font-extrabold flex items-center justify-center ring-2 ring-white">{count}</b> : null}
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-[14px] font-extrabold text-slate-900 leading-tight">{title}</b>
          {sub && <span className="block text-[11px] text-slate-600 font-medium leading-snug break-words">{sub}</span>}
        </span>
        {!action && <ChevronRight className={`w-5 h-5 shrink-0 ${t[2]}`} />}
      </button>
      {action && action.href && (
        <a href={action.href} aria-label={action.ariaLabel} className="my-2 mr-2.5 shrink-0 min-h-[44px] px-3.5 self-center rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[12px] font-extrabold flex items-center gap-1.5">{action.label}</a>
      )}
      {action && !action.href && (
        <button type="button" onClick={action.onClick} className="my-2 mr-2.5 shrink-0 min-h-[44px] px-3.5 self-center rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[12px] font-extrabold flex items-center cursor-pointer">{action.label}</button>
      )}
    </div>
  );
}

const SECTION_ICONS = {
  passes: [ClipboardCheck, 'bg-emerald-100 text-emerald-700'],
  tickets: [Wrench, 'bg-amber-100 text-amber-700'],
  clusters: [Layers, 'bg-violet-100 text-violet-700'],
  cleaning: [Sparkles, 'bg-cyan-100 text-cyan-700'],
  sla: [Gauge, 'bg-rose-100 text-rose-700'],
  register: [DoorOpen, 'bg-slate-200 text-slate-700'],
  technicians: [Users, 'bg-sky-100 text-sky-700'],
  fees: [IndianRupee, 'bg-emerald-100 text-emerald-700'],
};
const SECTION_LABELS = { passes: 'Pending passes', tickets: 'Student issues', clusters: 'Master incidents', cleaning: 'Cleaning', sla: 'SLA heatmap', register: 'Gate register', technicians: 'Technicians', fees: 'Fee payments' };
const SECTION_ORDER = ['passes', 'tickets', 'clusters', 'cleaning', 'sla', 'register', 'technicians', 'fees'];

function SectionGrid({ chips, onJump, cols }) {
  const byTab = Object.fromEntries(chips.map(c => [c.tab, c]));
  return (
    <div data-testid="home-section-grid" className={`grid gap-2 ${cols}`}>
      {SECTION_ORDER.filter(k => byTab[k]).map(k => {
        const c = byTab[k]; const [Icon, cls] = SECTION_ICONS[k];
        return (
          <button key={k} type="button" onClick={() => onJump(c)} className="min-h-[56px] rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 px-2.5 py-2 flex items-center gap-2 text-left cursor-pointer min-w-0">
            <span className={`w-9 h-9 rounded-xl ${cls} flex items-center justify-center shrink-0`}><Icon className="w-[18px] h-[18px] shrink-0" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-extrabold text-slate-800 leading-tight">{SECTION_LABELS[k]}</span>
              {c.count != null && <span className={`block font-mono text-[12px] font-extrabold ${c.hot ? 'text-rose-600' : 'text-slate-500'}`}>{c.count}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Badge({ n, cls = 'bg-rose-500' }) {
  return <span className={`min-w-[26px] h-[26px] px-1.5 rounded-full ${cls} text-white text-[12px] font-extrabold inline-flex items-center justify-center`}>{n}</span>;
}

function OutRow({ r, first }) {
  const left = new Date(r.scanned_at).getTime();
  return (
    <div data-testid="home-out-row" className={`flex items-center gap-2.5 py-2.5 ${first ? '' : 'border-t border-slate-100'}`}>
      <span className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 text-[12px] font-extrabold flex items-center justify-center shrink-0">{initials(r.student_name)}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-extrabold text-slate-900 leading-tight break-words">{r.student_name || r.student_roll}</p>
        <p className="text-[11px] text-slate-500 font-semibold leading-snug break-words">{r.destination || 'Outside campus'}</p>
        <p className="text-[11px] text-slate-500 font-semibold leading-snug"><span className="whitespace-nowrap">Left {h12(left)}</span></p>
      </div>
      <span className="shrink-0 self-start mt-1 inline-flex items-center gap-1 text-[11px] font-extrabold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 whitespace-nowrap">Out {outFor(left)}</span>
    </div>
  );
}

function OutCard({ gate, registerOk, onJumpRegister, limit }) {
  const rows = gate.outRows.slice(0, limit);
  return (
    <div data-testid="home-out-card" className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-[15px] font-extrabold text-slate-900 flex items-center gap-2">Out right now <Badge n={gate.outNow} cls="bg-slate-700" /></h2>
        <button type="button" onClick={onJumpRegister} className="min-h-[44px] px-1 text-[12px] font-bold text-indigo-600 cursor-pointer">Gate register</button>
      </div>
      {!registerOk ? (
        <p className="py-6 text-center text-[13px] font-semibold text-slate-500">Gate register is not connected yet.</p>
      ) : gate.outNow === 0 ? (
        <div data-testid="home-nobody-out" className="py-5 flex flex-col items-center text-center">
          <span className="w-14 h-14 rounded-full bg-emerald-50 text-emerald-600 ring-8 ring-emerald-100/70 flex items-center justify-center"><Check className="w-7 h-7" /></span>
          <p className="mt-4 text-[16px] font-extrabold text-slate-900">Everyone is back in the hostel</p>
          <p className="mt-0.5 text-[12px] font-semibold text-slate-500">0 students out. Next return: none.</p>
        </div>
      ) : (
        <>
          {rows.map((r, i) => <OutRow key={r.pass_ref || r.id} r={r} first={i === 0} />)}
          {gate.outNow > rows.length && (
            <button type="button" onClick={onJumpRegister} className="mt-1 w-full min-h-[44px] rounded-xl border border-slate-200 bg-slate-50 text-slate-700 text-[12px] font-extrabold cursor-pointer">See all {gate.outNow} in the gate register</button>
          )}
        </>
      )}
    </div>
  );
}

export default function WardenHome({
  session, greeting, dateLabel, passes, passCount, wq, gate, registerOk, chips, isLaptop,
  overdue, unassigned, cleaning, onApprove, onReject, onJump, onCreatePass, onDispatch, passesOpen, onTogglePasses,
}) {
  const firstName = greetingName(session?.name, 'Warden');
  const needs = passCount + overdue.count + unassigned.count + cleaning.count;
  const quiet = needs === 0;
  const limit = isLaptop ? 4 : 2;
  const shownPasses = passesOpen ? passes : passes.slice(0, limit);
  const jump = (tab) => () => onJump(chips.find(c => c.tab === tab));
  const num = (n) => (registerOk ? n : '—');
  const heroTiles = [
    [num(gate.outNow), 'Still out', 'bg-white/10 border-white/15'],
    [num(gate.late), 'Late returns', gate.late > 0 ? 'bg-rose-500/25 border-rose-300/40' : 'bg-white/10 border-white/15'],
    [num(gate.exits), 'Exits today', 'bg-white/10 border-white/15'],
    [num(gate.returns), 'Returns today', 'bg-white/10 border-white/15'],
  ];

  const hero = (
    <div data-testid="home-hero" className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-900 via-indigo-700 to-violet-600 text-white p-4 xl:px-6 xl:py-5 shadow-lg shadow-indigo-900/20">
      <div className="pointer-events-none absolute -right-10 -top-12 w-48 h-48 rounded-full bg-white/10" />
      <div className="pointer-events-none absolute right-16 -bottom-16 w-40 h-40 rounded-full bg-fuchsia-400/20" />
      <div className="relative z-10 xl:flex xl:items-center xl:justify-between xl:gap-6">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-200 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 shrink-0" />{dateLabel}</p>
          <h1 className="mt-1 text-[21px] xl:text-[28px] font-extrabold tracking-tight leading-tight break-words">{greeting}, {firstName}!</h1>
          <p className="mt-0.5 text-[13px] text-indigo-100 font-medium leading-snug">Warden · {session?.department || 'Hostel Administration'}</p>
        </div>
        <div className="mt-3 xl:mt-0 grid grid-cols-4 gap-2 xl:gap-2.5 xl:w-[480px] xl:shrink-0">
          {heroTiles.map(([n, l, c]) => (
            <div key={l} className={`rounded-2xl border ${c} px-2 py-2.5 text-center min-w-0`}>
              <p className="text-[20px] xl:text-[28px] font-extrabold font-mono leading-none">{n}</p>
              <p className="mt-1 text-[10px] xl:text-[12px] font-bold text-indigo-100 leading-tight">{l}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const rows = [];
  if (overdue.count > 0) rows.push(<SummaryRow key="od" testid="home-row-overdue" icon={Wrench} tone="rose" count={overdue.count} title={`${overdue.count} ${overdue.count === 1 ? 'complaint' : 'complaints'} needing you`} sub={overdue.sub} onOpen={jump('tickets')} action={overdue.call ? { label: 'Call', href: `tel:${overdue.call.phone}`, ariaLabel: `Call ${overdue.call.name}` } : null} />);
  if (unassigned.count > 0) rows.push(<SummaryRow key="un" testid="home-row-incident" icon={Layers} tone="violet" count={unassigned.count} title={`${unassigned.count} ${unassigned.count === 1 ? 'incident has' : 'incidents have'} no technician`} sub={unassigned.sub} onOpen={jump('clusters')} action={unassigned.count === 1 && unassigned.first ? { label: 'Dispatch', onClick: () => onDispatch(unassigned.first) } : null} />);
  if (cleaning.count > 0) rows.push(<SummaryRow key="cl" testid="home-row-cleaning" icon={Sparkles} tone="cyan" count={cleaning.count} title={`${cleaning.count} ${cleaning.count === 1 ? 'room' : 'rooms'} not fixed after 2 tries`} sub={cleaning.sub} onOpen={jump('cleaning')} />);
  if (gate.late > 0) rows.push(<SummaryRow key="lt" testid="home-row-late" icon={DoorOpen} tone="slate" title={`${gate.late} late ${gate.late === 1 ? 'return' : 'returns'} today`} sub={gate.lateSub} onOpen={jump('register')} />);

  const quick = (
    <div className="grid grid-cols-3 gap-2">
      <button type="button" onClick={onCreatePass} className="min-h-[76px] rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white flex flex-col items-center justify-center gap-1.5 shadow-sm cursor-pointer px-1"><Plus className="w-5 h-5 shrink-0" /><span className="text-[12px] font-extrabold leading-tight text-center">Create pass</span></button>
      <button type="button" onClick={jump('register')} className="min-h-[76px] rounded-2xl bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-100 flex flex-col items-center justify-center gap-1.5 shadow-sm cursor-pointer px-1"><DoorOpen className="w-5 h-5 shrink-0" /><span className="text-[12px] font-extrabold leading-tight text-center">Gate register</span></button>
      <button type="button" onClick={jump('fees')} className="min-h-[76px] rounded-2xl bg-white hover:bg-indigo-50 text-indigo-700 border border-indigo-100 flex flex-col items-center justify-center gap-1.5 shadow-sm cursor-pointer px-1"><IndianRupee className="w-5 h-5 shrink-0" /><span className="text-[12px] font-extrabold leading-tight text-center">Fee receipts</span></button>
    </div>
  );
  const h2 = (t, extra) => <div className="flex items-center justify-between px-1"><h2 className="text-[17px] font-extrabold text-slate-900 flex items-center gap-2">{t}</h2>{extra}</div>;

  const allClear = (
    <div data-testid="home-all-clear" className="rounded-3xl border-2 border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-4 flex items-center gap-3">
      <span className="w-12 h-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0"><Check className="w-7 h-7" /></span>
      <div className="min-w-0">
        <p className="text-[18px] font-extrabold text-emerald-900 leading-tight">All clear</p>
        <p className="text-[13px] text-emerald-800 font-semibold leading-snug">Nothing needs you right now</p>
        <p className="text-[11px] text-emerald-700/80 font-semibold mt-0.5">No passes waiting · no complaints past deadline</p>
      </div>
    </div>
  );

  const passesBlock = passCount > 0 && (
    <div data-testid="home-passes" className="space-y-3">
      <p className="px-1 text-[12px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5"><ClipboardCheck className="w-4 h-4 text-emerald-600 shrink-0" />Gate passes · {passCount} waiting{wq ? ` · ${passes.length} match “${wq}”` : ''}</p>
      {passes.length === 0 ? (
        <p className="px-1 text-[13px] font-semibold text-slate-500">No passes match “{wq}”.</p>
      ) : (
        <div className="grid gap-3 xl:grid-cols-2">
          {shownPasses.map(p => <PassCard key={p.id} pass={p} onApprove={onApprove} onReject={onReject} />)}
        </div>
      )}
      {passes.length > limit && (
        <button type="button" onClick={onTogglePasses} className="w-full min-h-[48px] rounded-xl border border-emerald-200 bg-emerald-50/60 hover:bg-emerald-50 text-emerald-800 text-[13px] font-extrabold cursor-pointer">{passesOpen ? 'Show fewer passes' : `View all ${passes.length} passes`}</button>
      )}
    </div>
  );

  const grid = <SectionGrid chips={chips.filter(c => c.tab !== 'home')} onJump={onJump} cols="grid-cols-2" />;
  const outCard = <OutCard gate={gate} registerOk={registerOk} onJumpRegister={jump('register')} limit={isLaptop ? 4 : 3} />;

  return (
    <div data-testid="warden-home" className="space-y-3 xl:space-y-0 xl:grid xl:grid-cols-12 xl:gap-5 xl:items-start">
      <div className="xl:col-span-12">{hero}</div>
      <div className="space-y-3 xl:col-span-8 min-w-0">
        {quiet ? (
          <>
            {allClear}
            {outCard}
          </>
        ) : (
          <>
            {h2(<>Needs you now <Badge n={needs} /></>)}
            {passesBlock}
            {!isLaptop && <div className="space-y-3">{rows}</div>}
            {isLaptop && outCard}
          </>
        )}
      </div>
      <div className="space-y-3 xl:col-span-4 min-w-0">
        {!quiet && isLaptop && rows.length > 0 && <div className="space-y-3">{h2('Also needs you')}{rows}</div>}
        {h2('Quick actions')}
        {quick}
        {h2('All sections')}
        {grid}
      </div>
    </div>
  );
}

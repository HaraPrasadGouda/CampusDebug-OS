import React, { useMemo, useState } from 'react';
import {
  Sparkles, AlertTriangle, Ban, Undo2, FileText, Check, ChevronRight, Siren, Send, Receipt,
  KeyRound, UserCheck, Utensils, CheckCircle2, Users, TrendingUp, GraduationCap
} from 'lucide-react';
import AdminCoversCard from '../teacher/AdminCoversCard';
import useCoverBoard from './useCoverBoard';

// Admin / Dean Home — "Needs you now". Everything that waits for a decision is
// on the first screen with its own one-tap action; nothing here is new data:
// cover banners (/api/admin/cover-board), certificate requests
// (/api/document-requests), escalated complaints (the tickets the dashboard
// payload already carries), today's leaves (/api/admin/teacher-covers) and the
// mess forecast the console already loads.
const HONORIFICS = /^(dr|prof|professor|mr|mrs|ms|md)\.?$/i;
function greetingName(full, fallback) {
  const parts = String(full || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  if (HONORIFICS.test(parts[0]) && parts.length > 1) return `${parts[0].replace(/\.?$/, '.')} ${parts[parts.length - 1]}`;
  return parts[0];
}
function readSession() {
  try { return JSON.parse(localStorage.getItem('campusdebug_session')) || {}; } catch { return {}; }
}
const daysAgo = (ms) => {
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return 'today';
  return d === 1 ? '1 day' : `${d} days`;
};
const stamp = (iso) => {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
};
const escalatedHeadline = (t) => {
  const d = String(t.title || t.description || '').trim();
  if (d) return d.length > 90 ? `${d.slice(0, 87).trim()}…` : d;
  return t.category || 'Complaint';
};
const hoursText = (h) => {
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  return `${Math.round(h)} h`;
};

function Counter({ value, label, tone }) {
  const cls = tone === 'rose' ? 'bg-rose-500/30 border-rose-300/40'
    : tone === 'amber' ? 'bg-amber-400/25 border-amber-200/40'
    : 'bg-white/10 border-white/15';
  return (
    <div className={`rounded-2xl border px-2 py-2.5 text-center min-w-0 ${cls}`} data-home-counter={label}>
      <p className="text-[21px] lg:text-2xl font-extrabold font-mono leading-none">{value}</p>
      <p className="mt-1 text-[10px] lg:text-[11px] font-bold text-indigo-100 leading-tight">{label}</p>
    </div>
  );
}

function SectionHead({ title, badge, children }) {
  return (
    <div className="flex items-center gap-2 px-1 pt-1">
      <h2 className="text-[15px] font-extrabold text-slate-900">{title}</h2>
      {badge ? <span className="min-w-[26px] h-[26px] px-1.5 rounded-full bg-rose-500 text-white text-[12px] font-extrabold inline-flex items-center justify-center">{badge}</span> : null}
      {children}
    </div>
  );
}

function CoverNeedRow({ b, busy, onCancel }) {
  return (
    <div data-home-need="cover" className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-3.5 shadow-sm">
      <div className="flex items-start gap-3">
        <span className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0"><AlertTriangle className="w-5 h-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-extrabold text-amber-950 leading-snug break-words">{b.text}</p>
          <p className="mt-0.5 text-[11.5px] font-medium text-slate-600 leading-snug">Phone the teachers of that section, or mark the class cancelled.</p>
        </div>
      </div>
      {b.canCancel && (
        <button type="button" disabled={busy === b.id} onClick={() => onCancel(b)} className="mt-3 w-full min-h-[44px] rounded-xl bg-white border-2 border-amber-400 hover:bg-amber-100 text-amber-900 text-[12.5px] font-extrabold cursor-pointer transition-colors disabled:opacity-60">
          Mark class cancelled
        </button>
      )}
    </div>
  );
}

function CancelledRow({ b, busy, onUndo }) {
  return (
    <div data-home-cancelled className="rounded-xl bg-rose-50 border border-rose-200 p-3 flex flex-wrap items-center gap-3">
      <span className="w-9 h-9 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0"><Ban className="w-4 h-4" /></span>
      <div className="min-w-0 flex-1 basis-40">
        <p className="text-[12.5px] font-extrabold text-rose-950 leading-snug break-words">{b.text}</p>
        <p className="text-[11px] text-slate-600 leading-snug">Students of that section see “Class cancelled”.</p>
      </div>
      {b.canUndo && (
        <button type="button" data-testid="undo-cancel" disabled={busy === b.id} onClick={() => onUndo(b)} className="min-h-[44px] px-3.5 rounded-xl bg-white border-2 border-rose-400 hover:bg-rose-100 text-rose-900 text-[12px] font-extrabold inline-flex items-center justify-center gap-1 cursor-pointer disabled:opacity-60">
          <Undo2 className="w-4 h-4" /> Undo
        </button>
      )}
    </div>
  );
}

export default function AdminHome({
  onNotification, onGo, docRequests, docBusyId, setDocStatus, escalated = [], messForecast, stats, noticePanel, isLg = false
}) {
  const session = useMemo(readSession, []);
  const cover = useCoverBoard(onNotification);
  const [leaveRows, setLeaveRows] = useState(null);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const isDean = String(session.profileRole || '').toUpperCase() === 'DEAN';
  const dateLabel = `${new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })} · ${new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;

  const banners = cover.banners || [];
  const needCover = banners.filter(b => b.level !== 'final');
  const cancelled = banners.filter(b => b.level === 'final');
  const pending = useMemo(() => (docRequests || [])
    .filter(r => r.status !== 'READY_FOR_PICKUP' && r.status !== 'REJECTED')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)), [docRequests]);
  const oldestMs = pending.length ? new Date(pending[0].createdAt).getTime() : 0;
  const shownDocs = pending.slice(0, 3);

  const groups = (needCover.length ? 1 : 0) + (pending.length ? 1 : 0) + (escalated.length ? 1 : 0);
  const clear = groups === 0;

  const plates = messForecast?.meals ? messForecast.meals.reduce((s, m) => s + (m.plates || 0), 0) : null;
  const saved = messForecast?.meals ? messForecast.meals.reduce((s, m) => s + (m.wasteKg || 0), 0) : null;
  const opted = messForecast?.meals ? messForecast.meals.reduce((s, m) => s + (m.optedOut || 0), 0) : null;

  const needsColumn = (
    <div className="space-y-3">
      <SectionHead title="Needs you now" badge={clear ? null : groups} />

      {clear && (
        <div data-home-clear className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm flex items-start gap-3.5">
          <span className="w-11 h-11 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0"><CheckCircle2 className="w-6 h-6" /></span>
          <div className="min-w-0">
            <p className="text-[16px] font-extrabold text-emerald-900 leading-tight">All clear</p>
            <p className="mt-1 text-[12.5px] font-medium text-slate-600 leading-snug">Every class is covered, no certificate requests are waiting and nothing is escalated to you.</p>
          </div>
        </div>
      )}

      {needCover.map(b => <CoverNeedRow key={b.id} b={b} busy={cover.busy} onCancel={cover.cancel} />)}

      {pending.length > 0 && (
        <div data-home-need="docs" className="rounded-2xl bg-white border border-slate-200 p-3.5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <span className="w-10 h-10 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center shrink-0"><FileText className="w-5 h-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-extrabold text-slate-900 leading-tight">{pending.length} certificate request{pending.length === 1 ? '' : 's'}</p>
              {oldestMs > 0 && <p className="text-[11.5px] text-slate-500 font-medium leading-snug">Oldest waiting {daysAgo(oldestMs)}</p>}
            </div>
          </div>
          <div className="space-y-2.5">
            {shownDocs.map(r => {
              const student = r.student;
              const busy = docBusyId === r.id;
              return (
                <div key={r.id} data-home-doc={r.id} className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="whitespace-nowrap text-[10px] font-mono font-extrabold px-2 py-0.5 rounded-full bg-violet-100 border border-violet-200 text-violet-800">{r.ref || String(r.id).slice(0, 8).toUpperCase()}</span>
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10.5px] font-extrabold text-amber-800 bg-amber-50 border-amber-200">{String(r.status).replace(/_/g, ' ')}</span>
                  </div>
                  <p className="mt-1.5 text-[13px] font-extrabold text-slate-900 leading-snug break-words">{student?.name || 'Student'}</p>
                  <p className="text-[10.5px] font-mono font-bold text-slate-500 leading-snug">{[student?.roll, stamp(r.createdAt)].filter(Boolean).join(' · ')}</p>
                  <p className="mt-1 text-[12px] text-slate-600 leading-snug break-words"><b className="text-slate-800">{String(r.docType || '').replace(/_/g, ' ')}</b>{r.remarks ? ` — ${r.remarks}` : ' — no purpose stated'}</p>
                  <div className="mt-2.5 flex items-center gap-3">
                    <button type="button" disabled={busy} onClick={() => setDocStatus(r.id, 'READY_FOR_PICKUP')} className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[12.5px] font-extrabold inline-flex items-center justify-center gap-1.5 cursor-pointer transition-colors">
                      <Check className="w-4 h-4" /> {busy ? 'Saving…' : 'Ready for pickup'}
                    </button>
                    <button type="button" disabled={busy} onClick={() => setDocStatus(r.id, 'REJECTED')} className="min-h-[44px] px-4 rounded-xl bg-white hover:bg-rose-50 border border-rose-200 disabled:opacity-50 text-rose-700 text-[12.5px] font-extrabold cursor-pointer transition-colors">
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <button type="button" data-home-go="docs" onClick={() => onGo('docs')} className="mt-3 w-full min-h-[44px] rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-indigo-700 text-[12.5px] font-extrabold inline-flex items-center justify-center gap-1 cursor-pointer">
            See all {pending.length} request{pending.length === 1 ? '' : 's'} <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {escalated.length > 0 && (
        <div data-home-need="escalated" className="rounded-2xl bg-white border border-slate-200 p-3.5 shadow-sm">
          <div className="flex items-center gap-3 mb-3">
            <span className="w-10 h-10 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0"><Siren className="w-5 h-5" /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-extrabold text-slate-900 leading-tight">{escalated.length} complaint{escalated.length === 1 ? '' : 's'} escalated to you</p>
              <p className="text-[11.5px] text-slate-500 font-medium leading-snug">Hostel SLA breached, auto-escalated</p>
            </div>
          </div>
          <div className="space-y-2.5">
            {escalated.slice(0, 4).map(t => (
              <div key={t.id} data-home-escalated={t.id} className="rounded-xl bg-rose-50/60 border border-rose-200 p-3 flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center shrink-0"><AlertTriangle className="w-4 h-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-extrabold text-slate-900 leading-snug break-words">{escalatedHeadline(t)}</p>
                  {(t.location || t.category) && <p className="text-[11.5px] text-slate-600 leading-snug break-words">{[t.location, escalatedHeadline(t) !== t.category ? t.category : null].filter(Boolean).join(' · ')}</p>}
                  {t.breachedHours != null && <p className="mt-1 text-[11px] font-mono font-extrabold text-rose-700">SLA breached {hoursText(t.breachedHours)} ago</p>}
                </div>
              </div>
            ))}
          </div>
          {escalated.length > 4 && <p className="mt-2.5 text-[11.5px] font-semibold text-slate-500 px-1">+{escalated.length - 4} more escalated</p>}
        </div>
      )}
    </div>
  );

  const quickActions = (
    <div className="space-y-3">
      <SectionHead title="Quick actions" />
      <div className="grid grid-cols-3 gap-2.5">
        <button type="button" data-home-go="dispatcher" onClick={() => onGo('dispatcher')} className="text-left rounded-2xl border bg-gradient-to-br from-indigo-600 to-violet-600 text-white border-transparent p-3 min-h-[84px] flex flex-col justify-between shadow-sm cursor-pointer">
          <span className="w-9 h-9 rounded-xl text-white/90 bg-white/15 flex items-center justify-center"><Send className="w-4 h-4" /></span>
          <span className="text-[12.5px] font-extrabold leading-tight mt-2">Send notice</span>
        </button>
        <button type="button" data-home-go="fees" onClick={() => onGo('fees')} className="text-left rounded-2xl border bg-white text-slate-800 border-slate-200 p-3 min-h-[84px] flex flex-col justify-between shadow-sm cursor-pointer">
          <span className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center"><Receipt className="w-4 h-4" /></span>
          <span className="text-[12.5px] font-extrabold leading-tight mt-2">Fee payments</span>
        </button>
        <button type="button" data-home-go="security" onClick={() => onGo('security')} className="text-left rounded-2xl border bg-white text-slate-800 border-slate-200 p-3 min-h-[84px] flex flex-col justify-between shadow-sm cursor-pointer">
          <span className="w-9 h-9 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center"><KeyRound className="w-4 h-4" /></span>
          <span className="text-[12.5px] font-extrabold leading-tight mt-2">Reset password</span>
        </button>
      </div>
    </div>
  );

  const coversCard = (
    <div data-home-covers className="rounded-2xl bg-white border border-slate-200 p-3.5 shadow-sm">
      <div className="flex items-center gap-2 mb-2.5 flex-wrap">
        <span className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0"><UserCheck className="w-4 h-4" /></span>
        <p className="text-[14px] font-extrabold text-slate-900">Today's covers</p>
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10.5px] font-extrabold text-indigo-800 bg-indigo-50 border-indigo-200">{leaveRows ? `${leaveRows.length} on leave` : '…'}</span>
      </div>
      <div className="space-y-2">
        {cancelled.map(b => <CancelledRow key={b.id} b={b} busy={cover.busy} onUndo={cover.undo} />)}
        <AdminCoversCard bare onRows={setLeaveRows} />
      </div>
    </div>
  );

  const tile = (Icon, tint, value, label, sub, subCls = 'text-slate-500') => (
    <div className="rounded-2xl bg-white border border-slate-200 p-3.5 shadow-sm min-w-0">
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${tint}`}><Icon className="w-4 h-4" /></span>
      <p className="mt-2 text-[22px] font-extrabold font-mono text-slate-900 leading-none break-words">{value}</p>
      <p className="text-[11.5px] font-bold text-slate-500 leading-tight mt-1">{label}</p>
      {sub ? <p className={`text-[11px] font-bold mt-1 leading-tight ${subCls}`}>{sub}</p> : null}
    </div>
  );
  const tiles = (
    <div data-home-tiles className="grid grid-cols-2 gap-2.5">
      {tile(Utensils, 'bg-amber-100 text-amber-700', plates != null ? plates.toLocaleString() : '—', 'Plates today', plates != null ? `${Math.round(saved * 10) / 10} kg saved · ${opted} opted out` : null, 'text-emerald-700')}
      {tile(Users, 'bg-purple-100 text-purple-700', stats.students, 'Enrolled students', stats.blocks != null ? `${stats.blocks} hostel blocks` : null)}
      {tile(TrendingUp, 'bg-emerald-100 text-emerald-700', stats.sla, 'Resolution SLA rate', 'Target: >90%')}
      {tile(GraduationCap, 'bg-sky-100 text-sky-700', stats.teachers, 'Teachers', 'Faculty on roster')}
    </div>
  );

  return (
    <div data-admin-home className="space-y-3 lg:space-y-4">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-indigo-900 via-indigo-700 to-violet-600 text-white p-4 lg:p-6 shadow-lg shadow-indigo-900/20">
        <div className="pointer-events-none absolute -right-10 -top-12 w-48 h-48 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute right-16 -bottom-16 w-40 h-40 rounded-full bg-fuchsia-400/20" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3.5 lg:gap-8">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-widest text-indigo-200 flex items-center gap-1.5"><Sparkles className="w-3.5 h-3.5 shrink-0" /> {dateLabel}</p>
            <h1 className="mt-1 text-[21px] lg:text-3xl font-extrabold tracking-tight leading-tight break-words">{greeting}, {greetingName(session.name, isDean ? 'Dean' : 'Admin')}!</h1>
            <p className="mt-1 text-[13px] lg:text-sm text-indigo-100 font-medium leading-snug">{isDean ? 'Dean' : 'Admin'} · Administration</p>
          </div>
          <div className="grid grid-cols-4 gap-2 lg:w-[26rem] shrink-0">
            <Counter value={leaveRows ? leaveRows.length : '—'} label="On leave" />
            <Counter value={cover.banners ? needCover.length : '—'} label="No cover" tone={needCover.length ? 'rose' : null} />
            <Counter value={docRequests ? pending.length : '—'} label="Requests" tone={pending.length ? 'amber' : null} />
            <Counter value={escalated.length} label="Escalated" tone={escalated.length ? 'rose' : null} />
          </div>
        </div>
      </div>

      {isLg ? (
        <div className="grid grid-cols-12 gap-4 items-start">
          <div className="col-span-7 space-y-3">{needsColumn}</div>
          <div className="col-span-5 space-y-4" data-home-side>
            {noticePanel}
            {coversCard}
            {tiles}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {needsColumn}
          {quickActions}
          {coversCard}
          {tiles}
        </div>
      )}
    </div>
  );
}

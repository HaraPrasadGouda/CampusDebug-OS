import React from 'react';
import { Check, CheckCircle2, RotateCcw, Wrench, Phone, BellRing, Lock, MessageSquare, Bot, UserCog } from 'lucide-react';

// Complaint lifecycle (HARA's anti-cheat flow), shared by the student's
// complaint card and the warden's queue:
//   Reported → Resolved (only the student who filed it) → Closed (only the
//   warden, and only after the student's Resolved — the server enforces it).

const STAGES = ['REPORTED', 'RESOLVED', 'CLOSED'];

// Is this a real server complaint (has the lifecycle fields)?
export function hasLifecycle(t) {
  return !!(t && t.type !== 'gate_pass' && (t.lifecycleStage || t.shortCode));
}

export function lifecycleStageOf(t) {
  if (!t) return 'REPORTED';
  if (t.lifecycleStage) return t.lifecycleStage;
  const s = String(t.status || '').toUpperCase();
  if (s === 'CLOSED' || t.closedAt) return 'CLOSED';
  if (t.studentResolvedAt) return 'RESOLVED';
  return 'REPORTED';
}

export function fmtStamp(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}

export function ticketCode(t) {
  if (!t) return '';
  if (t.shortCode) return `#${t.shortCode}`;
  const s = String(t.id || '');
  return /^[0-9a-f]{8}-/i.test(s) ? `#${s.slice(0, 8).toUpperCase()}` : s;
}

// Three-step progress bar with a timestamp under each reached step.
export function LifecycleProgress({ ticket, viewer = 'student' }) {
  const stage = lifecycleStageOf(ticket);
  const idx = STAGES.indexOf(stage);
  const steps = [
    { label: 'Reported', at: ticket.reportedAt || ticket.created_at || ticket.createdAt },
    { label: 'Resolved', at: ticket.studentResolvedAt, sub: viewer === 'student' ? 'by you' : 'by student' },
    { label: 'Closed', at: ticket.closedAt, sub: 'by warden' }
  ];
  const fill = idx <= 0 ? '0%' : idx === 1 ? '50%' : '100%';
  return (
    <div className="relative w-full pt-1" aria-label={`Progress: ${steps[idx].label}`}>
      <div className="absolute left-[16.66%] right-[16.66%] top-[14px] h-1.5 -translate-y-1/2 rounded-full bg-slate-200">
        <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 transition-all" style={{ width: fill }} />
      </div>
      <div className="relative grid grid-cols-3">
        {steps.map((s, i) => {
          const done = i <= idx;
          return (
            <div key={s.label} className="flex flex-col items-center text-center min-w-0 px-0.5">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center leading-none ring-4 ring-white ${done ? 'bg-emerald-500 text-white' : 'bg-white border-2 border-slate-300'}`}>
                {done && <Check className="w-3 h-3 block" strokeWidth={3.5} />}
              </span>
              <span className={`mt-1 text-[11px] font-bold leading-tight ${done ? 'text-emerald-800' : 'text-slate-500'}`}>{s.label}</span>
              <span className="text-[10px] leading-tight text-slate-500 font-medium break-words">
                {done && s.at ? fmtStamp(s.at) : (i === idx + 1 ? (i === 1 ? (viewer === 'student' ? 'Your tap' : 'Student taps') : 'Warden') : '—')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Tick-style stage bar for any N-stage flow (documents, legacy tickets).
// `stage` = how many steps are done (1..N); `rejected` paints the unfinished steps rose.
export function StageTicks({ labels, stage, rejected = false }) {
  const n = labels.length;
  const idx = Math.min(Math.max(stage, 1), n) - 1;
  const fill = n <= 1 ? '0%' : `${(idx / (n - 1)) * 100}%`;
  const edge = `${50 / n}%`;
  return (
    <div className="relative w-full pt-1" aria-label={`Progress: ${labels[idx]}`}>
      <div className="absolute top-[14px] h-1.5 -translate-y-1/2 rounded-full bg-slate-200" style={{ left: edge, right: edge }}>
        <div className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 transition-all" style={{ width: fill }} />
      </div>
      <div className="relative grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        {labels.map((label, i) => {
          const done = i <= idx;
          const bad = rejected && !done;
          return (
            <div key={label} className="flex flex-col items-center text-center min-w-0 px-0.5">
              <span className={`w-5 h-5 rounded-full flex items-center justify-center leading-none ring-4 ring-white ${done ? 'bg-emerald-500 text-white' : bad ? 'bg-white border-2 border-rose-400' : 'bg-white border-2 border-slate-300'}`}>
                {done && <Check className="w-3 h-3 block" strokeWidth={3.5} />}
              </span>
              <span className={`mt-1 text-[11px] font-bold leading-tight break-words ${done ? 'text-emerald-800' : bad ? 'text-rose-600' : 'text-slate-500'}`}>{label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Student side: Resolved / Not fixed under their own complaint.
export function StudentTicketActions({ ticket, busy, onResolve, onNotFixed, compact = false }) {
  const stage = lifecycleStageOf(ticket);
  const cat = ticket.category || 'hostel';
  const stop = (fn) => (e) => { e.stopPropagation(); if (!busy) fn(ticket); };
  return (
    <div className="space-y-2.5" onClick={(e) => e.stopPropagation()}>
      <LifecycleProgress ticket={ticket} viewer="student" />
      {ticket.technician?.name && stage !== 'CLOSED' && (
        <p className="text-[11px] text-slate-600 font-semibold flex items-center gap-1.5">
          <Wrench className="w-3.5 h-3.5 text-sky-600 shrink-0" />
          <span className="min-w-0">{ticket.technician.name}{ticket.technician.role ? ` · ${ticket.technician.role}` : ''} has been sent your complaint</span>
        </p>
      )}
      {ticket.reminderActive && stage === 'REPORTED' && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11.5px] font-bold text-amber-900 flex items-start gap-2">
          <BellRing className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{compact ? `Was your ${cat} issue fixed? Tap Resolved, or open this complaint if it is not fixed.` : `Was your ${cat} issue fixed? Tap Resolved or Not fixed.`}</span>
        </div>
      )}
      {stage === 'REPORTED' && (
        <div className={compact ? 'grid grid-cols-1 gap-2' : 'grid grid-cols-2 gap-2'}>
          <button type="button" disabled={busy} onClick={stop(onResolve)}
            className="min-h-[44px] px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-[12.5px] font-bold flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98] transition">
            <CheckCircle2 className="w-4 h-4 shrink-0" /> Resolved
          </button>
          {!compact && <button type="button" disabled={busy} onClick={stop(onNotFixed)}
            className="min-h-[44px] px-3 rounded-xl bg-white border-2 border-rose-200 hover:bg-rose-50 disabled:opacity-60 text-rose-700 text-[12.5px] font-bold flex items-center justify-center gap-1.5 cursor-pointer active:scale-[0.98] transition">
            <RotateCcw className="w-4 h-4 shrink-0" /> Not fixed
          </button>}
        </div>
      )}
      {stage === 'REPORTED' && (
        <p className="text-[10.5px] text-slate-500 leading-snug">
          Tap <b>Resolved</b> only after you checked the fix in your room.{!compact && <> <b>Not fixed</b> sends it back to the technician.</>}
          {ticket.notFixedCount > 0 && <> Sent back {ticket.notFixedCount}× so far.</>}
        </p>
      )}
      {stage === 'RESOLVED' && (
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className="text-[11.5px] font-bold text-emerald-800 min-w-0">You marked it resolved · waiting for the warden to close it.</p>
          {!compact && <button type="button" disabled={busy} onClick={stop(onNotFixed)}
            className="min-h-[44px] px-3 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 disabled:opacity-60 text-slate-700 text-[12px] font-bold flex items-center gap-1.5 cursor-pointer">
            <RotateCcw className="w-4 h-4 shrink-0" /> Problem back? Not fixed
          </button>}
        </div>
      )}
      {stage === 'CLOSED' && (
        <p className="text-[11.5px] font-bold text-slate-600">✔ Closed by the warden{ticket.closedAt ? ` · ${fmtStamp(ticket.closedAt)}` : ''}. Complaint done.</p>
      )}
    </div>
  );
}

const SMS_TONES = {
  sent: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  'dry-run': 'bg-slate-100 text-slate-700 border-slate-300',
  simulated: 'bg-slate-100 text-slate-700 border-slate-300',
  covered: 'bg-purple-50 text-purple-800 border-purple-200',
  failed: 'bg-rose-50 text-rose-800 border-rose-200',
  skipped: 'bg-amber-50 text-amber-800 border-amber-200'
};
export function smsLabel(t) {
  const s = t.smsStatus;
  if (!s) return null;
  const again = t.smsKind === 'reopen' ? ' (reopen)' : t.smsKind === 'reassign' ? ' (reassigned)' : '';
  switch (s) {
    case 'sent': return `SMS sent${again}`;
    case 'dry-run': return `SMS dry-run${again} — number not on allowlist`;
    case 'simulated': return `SMS logged only${again} — no SMS gateway`;
    case 'covered': return `No new SMS — same issue as ${t.smsCoveredBy ? `#${t.smsCoveredBy}` : 'an earlier complaint'}`;
    case 'failed': return `SMS failed${again}`;
    case 'skipped': return 'SMS skipped — no phone number';
    default: return `SMS ${s}`;
  }
}

// Warden side: technician card + SMS status + progress + Close (only after
// the student's Resolved; otherwise a lock note — no button at all).
export function WardenTicketLifecycle({ ticket, busy, onClose, reassignSlot }) {
  const stage = lifecycleStageOf(ticket);
  const tech = ticket.technician;
  const autoAssigned = String(ticket.assignedBy || '').toUpperCase() === 'AUTO';
  return (
    <div className="rounded-xl bg-white border border-slate-200 p-3 space-y-3">
      {tech ? (
        <div className="flex flex-wrap items-start gap-2.5 min-w-0">
          <span className="w-9 h-9 rounded-xl bg-sky-50 text-sky-700 border border-sky-200 flex items-center justify-center shrink-0">
            <Wrench className="w-4 h-4" />
          </span>
          <div className="min-w-0 flex-1 basis-[180px]">
            <p className="text-[13px] font-bold text-slate-900 leading-snug">
              {tech.name || tech.id}
              {tech.role && <span className="font-semibold text-slate-500"> · {tech.role}</span>}
            </p>
            <p className="text-[11px] text-slate-600 font-semibold flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5">
              <span className="inline-flex items-center gap-1">
                {autoAssigned ? <Bot className="w-3.5 h-3.5 text-slate-400" /> : <UserCog className="w-3.5 h-3.5 text-slate-400" />}
                {autoAssigned ? 'Auto-assigned' : `Assigned by ${ticket.assignedBy || 'warden'}`}
              </span>
              {ticket.assignedAt && <span className="text-slate-400 font-mono">{fmtStamp(ticket.assignedAt)}</span>}
            </p>
            {smsLabel(ticket) && (
              <span className={`mt-1.5 inline-flex items-center gap-1 text-[10.5px] font-bold px-2 py-0.5 rounded-md border ${SMS_TONES[ticket.smsStatus] || SMS_TONES.simulated}`}>
                <MessageSquare className="w-3 h-3 shrink-0" /> {smsLabel(ticket)}
              </span>
            )}
          </div>
          {tech.phone && (
            <a href={`tel:${tech.phone}`} onClick={(e) => e.stopPropagation()}
              className="shrink-0 min-h-[44px] px-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 text-slate-800 text-[12px] font-bold font-mono flex items-center justify-center gap-1.5"
              aria-label={`Call ${tech.name || 'technician'} ${tech.phone}`}>
              <Phone className="w-3.5 h-3.5 shrink-0" />{tech.phone}
            </a>
          )}
        </div>
      ) : (
        <p className="text-[12px] font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          No technician assigned{ticket.assignedTechId ? ` (${ticket.assignedTechId} not in the technician list)` : ''}.
        </p>
      )}

      <LifecycleProgress ticket={ticket} viewer="warden" />

      {ticket.notFixedCount > 0 && stage !== 'CLOSED' && (
        <p className="text-[11px] font-bold text-rose-700 flex items-center gap-1.5">
          <RotateCcw className="w-3.5 h-3.5 shrink-0" /> Student said "Not fixed" {ticket.notFixedCount}×
        </p>
      )}

      {stage === 'RESOLVED' && (
        <button type="button" disabled={busy} onClick={() => onClose && onClose(ticket)}
          className="w-full min-h-[44px] px-3 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-[12.5px] font-bold flex items-center justify-center gap-2 cursor-pointer">
          <Lock className="w-4 h-4 shrink-0" /> Close complaint
        </button>
      )}
      {stage === 'REPORTED' && (
        <p className="text-[11px] text-slate-500 font-semibold flex items-start gap-1.5 bg-slate-50 border border-dashed border-slate-300 rounded-lg px-3 py-2">
          <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <span>Close appears after the student marks it Resolved in their room.</span>
        </p>
      )}
      {stage === 'CLOSED' && (
        <p className="text-[11.5px] font-bold text-slate-600">✔ Closed{ticket.closedBy ? ` by ${ticket.closedBy}` : ''}{ticket.closedAt ? ` · ${fmtStamp(ticket.closedAt)}` : ''}</p>
      )}
      {stage === 'REPORTED' && reassignSlot}
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { Compass, Clock, Send, QrCode, RefreshCw, CheckCircle2, XCircle, LogOut } from 'lucide-react';
import { useRotatingQr } from '../../utils/passQr';
import { noteServerDate } from '../../utils/serverClock';
import { getStoredProfile, getAccessToken } from '../../utils/authClient';
import { pickTodaysLeave, saveLeaveSnapshot, readLeaveSnapshot } from '../../utils/dayScholarLeave';
import { isLeaveWindowOpen, LEAVE_WINDOW_MSG } from '../../utils/leaveWindow';
import ScannableQR from '../ScannableQR';
import { leaveNumber } from '../../utils/passNumber';

/**
 * DAY-SCHOLAR LEAVE (Phase 1) — replaces the old IN/OUT commute alternation.
 * The QR is per-leave and ROTATING: it exists only while a mentor APPROVED,
 * not-yet-scanned leave exists, carries that leave's id, and is re-signed
 * every ~25 s (the gate refuses one older than ~60 s, so screenshots fail).
 * The exit is ONE-WAY: no return scan, next class counts absent until the next working day.
 * States: apply → PENDING → APPROVED → OUT (or REJECTED / EXPIRED).
 */
export default function LeaveQRModal({ isOpen, onClose, onToast }) {
  const [state, setState] = useState({ phase: 'LOADING' });
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = async (showSpinner) => {
    try {
      if (showSpinner) setRefreshing(true);
      const tok = getAccessToken();
      const r = await fetch('/api/leave-requests/mine', tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
      noteServerDate(r);
      const j = await r.json();
      if (j?.success) {
        setError('');
        saveLeaveSnapshot(getStoredProfile()?.rollNumber, j);
        setState({ phase: 'READY', leaves: j.leaves || [], outToday: j.outToday, hasLiveRequest: j.hasLiveRequest });
      }
    } catch {
      // offline — keep last snapshot; first open with no network: the saved one
      const snap = readLeaveSnapshot(getStoredProfile()?.rollNumber);
      if (snap) setState(prev => prev.phase === 'READY' ? prev : { phase: 'READY', leaves: snap.leaves || [], outToday: snap.outToday, hasLiveRequest: snap.hasLiveRequest });
    }
    if (showSpinner) setRefreshing(false);
  };

  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    load(true);
    const poll = setInterval(() => load(false), 8000);
    // The dashboard polls the same endpoint (fast while a leave is live) and
    // broadcasts each fresh snapshot — adopt it so the modal and the Active
    // Gate Pass card always show the same state at the same moment.
    const onLeaveState = (e) => {
      const j = e?.detail;
      if (!alive || !j?.success) return;
      setState({ phase: 'READY', leaves: j.leaves || [], outToday: j.outToday, hasLiveRequest: j.hasLiveRequest });
    };
    window.addEventListener('campus_leave_state', onLeaveState);
    return () => { alive = false; clearInterval(poll); window.removeEventListener('campus_leave_state', onLeaveState); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Rotating per-leave QR: only while THIS leave is APPROVED and not yet
  // scanned. Fix 5: the SERVER signs it (POST /api/pass-token); the phone
  // keeps a ~60 min batch so it still rotates every ~25 s with no network.
  // No approved leave → no token at all.
  const liveLeaveId = (() => {
    if (!isOpen || state.phase !== 'READY') return null;
    const l = pickTodaysLeave(state.leaves || []).live;
    return l ? String(l.id) : null;
  })();
  const qr = useRotatingQr('LEAVE', liveLeaveId, !!liveLeaveId);
  const token = qr.token;
  const tokenStage = qr.token ? 'READY' : qr.stage;
  const nextQrAt = Date.now() + qr.secondsLeft * 1000;

  if (!isOpen) return null;

  const me = getStoredProfile() || {};
  const qrCaption = [me.fullName, me.rollNumber].filter(Boolean).join(' • ');

  const leaves = state.leaves || [];
  const { todays, pending, live, out, decided } = pickTodaysLeave(leaves);
  const anyStatus = pending?.status || live?.status || out?.status || decided?.status || null;

  const submit = async () => {
    const clean = reason.trim();
    if (clean.length < 5) { setError('Give your mentor a short reason (min 5 characters).'); return; }
    setSubmitting(true);
    setError('');
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/leave-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ reason: clean })
      });
      const j = await r.json();
      if (j?.success) {
        setReason('');
        if (onToast) onToast('Leave request sent to your mentor — approval happens in the app, never automatic.', 'success');
        await load(false);
        // Dashboard card flips to PENDING right away (no wait for its next poll).
        window.dispatchEvent(new CustomEvent('campus_leave_updated', { detail: { leave: j.leave } }));
      } else {
        setError(j?.error || 'Request was not accepted.');
      }
    } catch {
      setError('Network issue — the request was not sent. Try again.');
    }
    setSubmitting(false);
  };

  const statusChip = () => {
    if (!anyStatus) return null;
    const map = {
      PENDING: { cls: 'bg-amber-50 border-amber-300 text-amber-800', icon: Clock, text: 'WAITING FOR MENTOR' },
      APPROVED: { cls: 'bg-emerald-50 border-emerald-300 text-emerald-800', icon: CheckCircle2, text: 'APPROVED — SHOW QR AT GATE' },
      OUT: { cls: 'bg-sky-50 border-sky-300 text-sky-800', icon: LogOut, text: 'OUT OF CAMPUS (LEAVE)' },
      REJECTED: { cls: 'bg-rose-50 border-rose-300 text-rose-700', icon: XCircle, text: 'REQUEST REJECTED' },
      EXPIRED: { cls: 'bg-slate-50 border-slate-300 text-slate-600', icon: XCircle, text: 'EXPIRED' }
    };
    const m = map[anyStatus];
    const Icon = m.icon;
    return (
      <div className={`rounded-xl border px-3 py-2.5 flex items-start gap-2.5 ${m.cls}`}>
        <Icon className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="text-[13px] leading-snug min-w-0">
          <strong className="font-extrabold block text-xs">{m.text}</strong>
          <span className="text-[11px] leading-snug block mt-0.5">
            {anyStatus === 'PENDING' && `Requested ${new Date(pending.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} — your mentor decides in the app. You may also visit them; nothing is approved automatically.`}
            {anyStatus === 'APPROVED' && `Approved by ${live.decided_by_name || 'your mentor'}${live.mentor_note ? ` — note: ${live.mentor_note}` : ''}. Flash the QR below once at the gate; the exit registers and your parent gets an SMS. One-way leave — back on the next working day.`}
            {anyStatus === 'OUT' && `Left campus at ${new Date(out.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, parent informed. The next working day is your return.`}
            {anyStatus === 'REJECTED' && `${decided.decided_by_name || 'Your mentor'} rejected the request${decided.mentor_note ? `: ${decided.mentor_note}` : '.'} Stay in classes today.`}
            {anyStatus === 'EXPIRED' && `The request/leave lapsed at the gate-close cut-off. File a fresh request when you need to leave.`}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-md w-full border border-slate-200/80 shadow-2xl overflow-hidden my-auto">
        {/* Header */}
        <div className="px-4 sm:px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-blue-50 border border-blue-200/60 flex items-center justify-center text-blue-600 shadow-xs shrink-0">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 leading-tight">Day-Scholar Leave</h3>
              <p className="text-xs text-slate-500">Mentor approval • One-way exit • Parent SMS at gate</p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="min-w-[44px] min-h-[44px] p-2 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors cursor-pointer flex items-center justify-center shrink-0">
            ✕
          </button>
        </div>

        <div className="p-4 sm:p-5 space-y-3">
          {state.phase === 'LOADING' && (
            <div className="py-6 text-center text-sm font-bold text-slate-500 flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin" /> Checking your leave status…
            </div>
          )}

          {state.phase === 'READY' && (
            <>
              {statusChip()}

              {/* Leave number: the guard can type it if the QR scan fails. */}
              {live && (
                <p data-testid="leave-number" className="text-[11px] text-slate-600 text-center leading-snug">
                  Leave No: <span className="font-mono font-extrabold text-slate-900 tracking-wide">{leaveNumber(live.id)}</span> · tell the guard this number if the QR scan fails
                </p>
              )}

              {/* Apply — hidden while a live request exists or already OUT
                  (after a REJECTED/EXPIRED request the student may apply again;
                  the server enforces the same rule). */}
              {!(pending || live || out) && (
                <div className="rounded-2xl border border-blue-200 bg-blue-50/50 p-3.5 space-y-2.5">
                  <p className="text-sm font-extrabold text-blue-900">Request leave from your mentor</p>
                  <ul className="text-[11px] text-blue-800 leading-relaxed list-disc pl-4">
                    <li>Apply <strong>at least 1 hour</strong> before you need to leave</li>
                    <li>One pending request at a time — nothing is auto-approved</li>
                    <li>Leave is <strong>one-way</strong>: once out, your next class is absent until the next working day (campus return needs no QR)</li>
                  </ul>
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    maxLength={280}
                    placeholder="Reason (e.g. doctor appointment in the city at 1pm)…"
                    className="w-full rounded-xl border-2 border-blue-200 bg-white p-3 text-sm text-slate-800 outline-none focus:border-blue-500 transition-colors resize-none"
                  />
                  {error && <p className="text-xs font-bold text-rose-600">{error}</p>}
                  {!isLeaveWindowOpen() && <p className="text-xs font-bold text-amber-700">{LEAVE_WINDOW_MSG}</p>}
                  <button
                    type="button"
                    onClick={submit}
                    disabled={submitting || !isLeaveWindowOpen()}
                    className="w-full py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold text-sm transition-colors cursor-pointer flex items-center justify-center gap-2"
                  >
                    <Send className="w-4 h-4" /> {submitting ? 'Sending…' : 'Send to Mentor'}
                  </button>
                </div>
              )}

              {/* Leave QR (rotating, per-leave) — exists only on approval.
                  APPROVED: big, full-width, gate-scannable QR (tap = fullscreen).
                  Otherwise: compact locked card, QR left, status right. */}
              {live && tokenStage === 'READY' ? (
                <div className="rounded-2xl border-2 p-3 flex flex-col min-[380px]:flex-row items-center gap-3 text-center min-[380px]:text-left from-emerald-50 to-teal-50 border-emerald-200 bg-gradient-to-br">
                  {/* Inline QR stays compact (tap = big fullscreen for the guard) */}
                  <div className="w-[170px] min-[380px]:w-[150px] sm:w-[170px] shrink-0">
                    <ScannableQR
                      value={token}
                      caption={qrCaption}
                      hint={`🔄 New QR in ${Math.max(1, Math.ceil((nextQrAt - Date.now()) / 1000))}s`}
                    />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-extrabold text-emerald-800">🟢 QR is LIVE at the gate</p>
                    <p className="text-[11px] text-slate-600 leading-snug mt-1">One scan at the gate records your exit — show this live QR (it changes every few seconds).</p>
                  </div>
                </div>
              ) : (
              <div className={`rounded-2xl border-2 p-3 flex items-center gap-3 text-left ${live ? 'from-emerald-50 to-teal-50 border-emerald-200 bg-gradient-to-br' : 'border-slate-200 bg-slate-50'}`}>
                <div className="bg-white p-2.5 rounded-xl shadow-sm border border-slate-200/70 relative shrink-0">
                  {!live ? (
                    /* Locked (no approved leave yet, or already scanned OUT):
                       no QR is drawn at all — nothing to photograph or re-use.
                       The APPROVED state renders the big ScannableQR above. */
                    <div className="w-[104px] h-[104px] flex items-center justify-center">
                      <QrCode className="w-7 h-7 text-slate-400" />
                    </div>
                  ) : (
                    <div className="w-[104px] h-[104px] flex items-center justify-center text-slate-400 text-[10px] font-mono text-center px-2">
                      {tokenStage === 'OFFLINE' ? 'No internet — connect once to load the live QR' : tokenStage === 'DENIED' ? (qr.denyReason || 'QR not available') : 'Making live QR…'}
                    </div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className={`text-xs font-extrabold ${live ? 'text-emerald-800' : 'text-slate-700'}`}>
                    {live ? '🟢 QR is LIVE at the gate' : 'Leave QR — locked'}
                  </p>
                  <p className="text-[11px] text-slate-600 leading-snug mt-1">
                    {live
                      ? 'One scan at the gate records your exit — show it now.'
                      : 'Opens the gate only while a leave is APPROVED. Without approval the guard sees NOT APPROVED — nothing is recorded.'}
                  </p>
                </div>
              </div>
              )}

              {/* History of today's decisions */}
              {todays.length > 0 && (
                <div className="rounded-xl border border-slate-200 px-3 py-2.5 space-y-1.5">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Today's requests</p>
                  {todays.slice(0, 4).map(l => (
                    <div key={l.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-700 font-semibold truncate">{l.reason}</span>
                      <span className={`shrink-0 text-[10px] font-extrabold px-2 py-0.5 rounded-full border ${
                        l.status === 'APPROVED' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : l.status === 'PENDING' ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : l.status === 'OUT' ? 'bg-sky-50 text-sky-700 border-sky-200'
                              : l.status === 'REJECTED' ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : 'bg-slate-50 text-slate-600 border-slate-200'
                      }`}>
                        {l.status === 'OUT' ? 'OUT' : l.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          <div className="grid grid-cols-2 gap-2.5">
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="w-full min-h-[44px] px-2 rounded-xl border-2 border-slate-200 hover:bg-slate-50 text-slate-600 font-bold text-xs transition-colors cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh status
          </button>

          <button
            onClick={onClose}
            className="w-full min-h-[44px] px-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm transition-colors cursor-pointer whitespace-nowrap"
          >
            Done & Close
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}

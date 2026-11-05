import { useState, useEffect, useRef } from 'react';
import {
  CreditCard,
  X,
  CheckCircle2,
  Landmark,
  Receipt
} from 'lucide-react';
import { getAccessToken, getStoredProfile } from '../../utils/authClient';

// REAL dues modal — no hardcoded bill list.
// The balance shown here is the signed-in student's actual
// profiles.fee_due_balance, refreshed from /api/dashboard-data,
// and "Settle Dues" clears that same column via POST /api/fees/pay.
// It is a DEMO payment (no real money moves): the server records a receipt and the
// same spot then shows a "Paid ₹X" receipt card plus the student's past receipts.
const fmtMoney = (n) => `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`;
const fmtWhen = (iso) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
};

export default function FeeDuesModal({ isOpen, onClose, onFeePaid, session }) {
  const [feeDue, setFeeDue] = useState(
    session?.feeDue != null && session.feeDue !== undefined ? Number(session.feeDue) : null
  );
  const [isProcessingPay, setIsProcessingPay] = useState(false);
  // Settle Dues now asks first: tapping it only switches this same modal to the confirm view.
  // Nothing is paid until "Confirm & Pay".
  const [confirming, setConfirming] = useState(false);
  const payingRef = useRef(false);   // hard guard against a double tap before React re-renders
  const [loadError, setLoadError] = useState(null);
  const [receipts, setReceipts] = useState([]);   // this student's receipts, newest first

  useEffect(() => {
    if (!isOpen) { setConfirming(false); return; }
    let alive = true;
    setLoadError(null);
    // The student's own receipts load alongside the balance — nothing to tap to see them
    fetch('/api/fees/receipts', {
      headers: getAccessToken() ? { Authorization: `Bearer ${getAccessToken()}` } : undefined
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (alive && data?.success && Array.isArray(data.receipts)) setReceipts(data.receipts); })
      .catch(() => { /* offline — receipts just stay as they were */ });
    // Refresh the real balance every time the modal opens
    fetch('/api/dashboard-data', {
      headers: getAccessToken()
        ? { Authorization: `Bearer ${getAccessToken()}` }
        : undefined
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive) return;
        if (!data?.success) return;
        const p = data.profile || {};
        setFeeDue(p.fee_due_balance != null ? Number(p.fee_due_balance) : null);
      })
      .catch(() => { /* offline — keep the session value */ });
    return () => { alive = false; };
  }, [isOpen]);

  // Escape (while asking) goes back to the dues view; it never pays. Does nothing in the plain dues view, as before.
  useEffect(() => {
    if (!isOpen || !confirming) return;
    const onKey = (e) => { if (e.key === 'Escape' && !payingRef.current) setConfirming(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, confirming]);

  // GET /api/dashboard-data returns profile under `.profile` in some builds —
  // normalize: the server response `profile` object nests fields directly.
  // (fee_due_balance arrives flat; nothing else needed here.)

  if (!isOpen) return null;

  const token = getAccessToken();

  const handlePayDues = () => {
    if (payingRef.current) return;   // one request per confirm, however fast the double tap
    payingRef.current = true;
    setIsProcessingPay(true);
    fetch('/api/fees/pay', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({})
    })
      .then((r) => r.json())
      .then((data) => {
        if (data?.success) {
          setFeeDue(0);
          setConfirming(false);
          if (data.receipt) {
            setReceipts((list) => [data.receipt, ...list.filter((x) => x.receipt_id !== data.receipt.receipt_id)]);
          }
          // tell the dashboard card behind the modal so it shows "No Dues" at once
          try { window.dispatchEvent(new CustomEvent('campus_fees_updated', { detail: { feeDue: 0 } })); } catch { /* ignore */ }
          if (onFeePaid) {
            const prev = data.previous != null ? Number(data.previous) : null;
            onFeePaid(
              data.alreadyCleared
                ? 'Your dues were already settled — showing the latest balance.'
                : prev != null
                  ? `${fmtMoney(prev)} paid (demo)${data.receipt ? ` — receipt ${data.receipt.receipt_id}` : ''}.`
                  : 'Campus dues cleared.'
            );
          }
        } else {
          if (onFeePaid) onFeePaid(data?.error || 'Payment could not be completed.', 'error');
        }
      })
      .catch(() => {
        if (onFeePaid) onFeePaid('Network error — dues remain pending.', 'error');
      })
      .finally(() => { payingRef.current = false; setIsProcessingPay(false); });
  };

  const pendingAmount = feeDue != null ? feeDue : null;
  // the confirm view only exists while there is something to pay (if the dues vanish underneath, the normal settled view shows)
  const asking = confirming && pendingAmount != null && pendingAmount > 0;
  const latest = receipts[0] || null;
  // the latest receipt is the big card when nothing is due; everything else goes in the small list below
  const pastReceipts = pendingAmount === 0 && latest ? receipts.slice(1) : receipts;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto"
      onClick={(e) => { if (asking && e.target === e.currentTarget && !isProcessingPay) setConfirming(false); }}
    >
      <div className="bg-white rounded-3xl max-w-lg w-full border border-slate-200/80 shadow-2xl overflow-hidden my-auto">

        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-rose-50 border border-rose-200/60 text-rose-600 flex items-center justify-center shadow-xs shrink-0">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Campus Fee & Clearance Dues
              </h3>
              <p className="text-xs text-slate-500">
                Student Account: {session?.name || getStoredProfile()?.fullName || 'Signed-in student'} ({session?.identity || getStoredProfile()?.rollNumber || '—'})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 -mr-2 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4 text-xs">

          {/* Dues Summary Banner — REAL balance */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <span className="text-slate-500 text-[11px] block">Total Outstanding Balance</span>
              <div className="text-2xl font-bold font-mono text-slate-900 mt-0.5">
                {pendingAmount == null ? '—' : `₹${pendingAmount.toLocaleString('en-IN')}`}
              </div>
            </div>
            <div>
              <span className={`inline-block text-[10px] font-mono px-2.5 py-1 rounded-full font-bold border whitespace-nowrap ${
                pendingAmount === 0
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : pendingAmount == null
                    ? 'bg-slate-100 text-slate-600 border-slate-300'
                    : 'bg-amber-50 text-amber-700 border-amber-200 animate-pulse'
              }`}>
                {pendingAmount === 0 ? 'ALL CLEAR' : pendingAmount == null ? 'LOADING' : 'PENDING'}
              </span>
            </div>
          </div>

          {loadError && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 font-semibold text-[11px]">
              Could not load the latest balance — showing the sign-in value.
            </div>
          )}

          {/* Single honest breakdown row — mirrors the real account balance */}
          {asking ? (
            <div data-testid="fee-confirm" role="alertdialog" aria-live="polite" className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-center space-y-1.5">
              <div className="text-lg font-extrabold text-slate-900 font-mono">Pay {fmtMoney(pendingAmount)}?</div>
              <div className="text-[11px] font-semibold text-slate-600">Demo payment, no real money is charged.</div>
            </div>
          ) : pendingAmount != null && pendingAmount > 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="font-mono text-xs font-bold text-slate-900">Campus Dues Settlement</span>
                </div>
                <div className="text-[11px] font-mono text-slate-500 leading-relaxed">
                  Covers all pending campus dues on your account (mess, exam, hostel, library)
                </div>
                <div className="text-[10px] font-semibold text-slate-400">Demo payment — no real money is charged</div>
              </div>
              <div className="flex items-center sm:justify-end gap-3 shrink-0">
                <span className="text-sm font-bold font-mono text-slate-900">
                  ₹{pendingAmount.toLocaleString('en-IN')}
                </span>
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="px-4 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-all cursor-pointer shadow-sm shrink-0"
                >
                  Settle Dues
                </button>
              </div>
            </div>
          ) : pendingAmount === 0 && latest ? (
            <div data-testid="fee-receipt" className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 text-emerald-900">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span className="text-lg font-extrabold font-mono tracking-tight whitespace-nowrap">Paid {fmtMoney(latest.amount)}</span>
                </div>
                <span className="text-[10px] font-bold px-2 py-1 rounded-full bg-white border border-emerald-200 text-emerald-700 whitespace-nowrap shrink-0">Demo payment</span>
              </div>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11px]">
                <dt className="text-emerald-700/80">Receipt</dt>
                <dd className="font-mono font-bold text-right break-all">{latest.receipt_id}</dd>
                <dt className="text-emerald-700/80">Paid on</dt>
                <dd className="font-semibold text-right">{fmtWhen(latest.paid_at)}</dd>
                <dt className="text-emerald-700/80">Status</dt>
                <dd className="font-semibold text-right">All dues cleared</dd>
              </dl>
            </div>
          ) : pendingAmount === 0 ? (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="font-semibold">All dues are settled. Your campus account is clear.</span>
            </div>
          ) : (
            <div className="p-3.5 bg-white border border-slate-200 rounded-xl text-slate-600 flex items-center gap-2">
              <Landmark className="w-4 h-4 text-slate-400 shrink-0" />
              <span>Balance unavailable right now — try again when you're back online.</span>
            </div>
          )}

          {/* Past receipts — shown as soon as there are any; a long history scrolls inside the box */}
          {!asking && pastReceipts.length > 0 && (
            <div data-testid="fee-past-receipts" className="border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-3.5 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-1.5 text-[11px] font-bold text-slate-600">
                <Receipt className="w-3.5 h-3.5" /> {pendingAmount === 0 && latest ? 'Past receipts' : 'Your receipts'}
                <span className="font-mono text-slate-400">({pastReceipts.length})</span>
              </div>
              <ul className="max-h-44 overflow-y-auto overscroll-contain divide-y divide-slate-100">
                {pastReceipts.map((r) => (
                  <li key={r.receipt_id} className="px-3.5 py-2 flex items-center justify-between gap-3 min-w-0">
                    <div className="min-w-0">
                      <div className="font-mono text-[11px] font-bold text-slate-800 break-all">{r.receipt_id}</div>
                      <div className="text-[10.5px] text-slate-500">{fmtWhen(r.paid_at)} · Demo</div>
                    </div>
                    <span className="font-mono text-xs font-bold text-slate-900 whitespace-nowrap">{fmtMoney(r.amount)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Action Buttons */}
          {asking ? (
            <div className="flex flex-col sm:flex-row sm:justify-end gap-2.5 pt-3 border-t border-slate-200">
              <button
                type="button"
                data-testid="fee-cancel"
                onClick={() => setConfirming(false)}
                disabled={isProcessingPay}
                className="px-5 min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors cursor-pointer disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                data-testid="fee-confirm-pay"
                onClick={handlePayDues}
                disabled={isProcessingPay}
                className="px-5 min-h-[48px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm transition-all cursor-pointer shadow-sm disabled:opacity-60"
              >
                {isProcessingPay ? 'Processing…' : 'Confirm & Pay'}
              </button>
            </div>
          ) : (
          <div className="flex items-center justify-end pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-5 min-h-[44px] rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
          )}
        </div>
      </div>
    </div>
  );
}


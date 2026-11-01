import { useState, useEffect } from 'react';
import {
  CreditCard,
  X,
  CheckCircle2,
  Landmark
} from 'lucide-react';
import { getAccessToken, getStoredProfile } from '../../utils/authClient';

// REAL dues modal — no hardcoded bill list.
// The balance shown here is the signed-in student's actual
// profiles.fee_due_balance, refreshed from /api/dashboard-data,
// and "Settle Dues" clears that same column via POST /api/fees/pay.
export default function FeeDuesModal({ isOpen, onClose, onFeePaid, session }) {
  const [feeDue, setFeeDue] = useState(
    session?.feeDue != null && session.feeDue !== undefined ? Number(session.feeDue) : null
  );
  const [isProcessingPay, setIsProcessingPay] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    setLoadError(null);
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

  // GET /api/dashboard-data returns profile under `.profile` in some builds —
  // normalize: the server response `profile` object nests fields directly.
  // (fee_due_balance arrives flat; nothing else needed here.)

  if (!isOpen) return null;

  const token = getAccessToken();

  const handlePayDues = () => {
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
          if (onFeePaid) {
            const prev = data.previous != null ? Number(data.previous) : null;
            onFeePaid(
              data.alreadyCleared
                ? 'Your dues were already settled — showing the latest balance.'
                : prev != null
                  ? `₹${prev.toLocaleString('en-IN')} settled — campus dues cleared.`
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
      .finally(() => setIsProcessingPay(false));
  };

  const pendingAmount = feeDue != null ? feeDue : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto">
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
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer shrink-0"
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
          {pendingAmount != null && pendingAmount > 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
              <div className="space-y-1">
                <div className="flex items-center space-x-2">
                  <span className="font-mono text-xs font-bold text-slate-900">Campus Dues Settlement</span>
                </div>
                <div className="text-[11px] font-mono text-slate-500 leading-relaxed">
                  Covers all pending campus dues on your account (mess, exam, hostel, library)
                </div>
              </div>
              <div className="flex items-center sm:justify-end gap-3 shrink-0">
                <span className="text-sm font-bold font-mono text-slate-900">
                  ₹{pendingAmount.toLocaleString('en-IN')}
                </span>
                <button
                  onClick={handlePayDues}
                  disabled={isProcessingPay}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs transition-all cursor-pointer shadow-sm shrink-0 disabled:opacity-60"
                >
                  {isProcessingPay ? 'Processing…' : 'Settle Dues'}
                </button>
              </div>
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

          {/* Action Buttons */}
          <div className="flex items-center justify-end pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition-colors cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


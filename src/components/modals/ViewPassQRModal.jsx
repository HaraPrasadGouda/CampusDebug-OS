import React from 'react';
import ScannableQR from '../ScannableQR';
import {
  QrCode,
  X,
  Clock,
  ShieldCheck,
  CheckCircle2,
  MapPin,
  Download,
  Calendar,
  Lock,
  Hourglass,
  XCircle,
  LogIn
} from 'lucide-react';

export default function ViewPassQRModal({ isOpen, onClose, pass }) {
  const [copied, setCopied] = React.useState(false);
  // "Copy scan token" lets the user paste the exact QR payload into the
  // guard's Direct Base64 Token Verification box (mobile debugging).
  const copyToken = () => {
    if (navigator?.clipboard && pass?.token) {
      navigator.clipboard.writeText(pass.token).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      }).catch(() => {});
    }
  };
  if (!isOpen || !pass) return null;

  // Only a warden-approved (and not yet used) pass may show a scannable QR.
  const isApproved = pass.status === 'APPROVED';
  const isUsed = pass.status === 'USED';
  const isReturned = pass.status === 'RETURNED';
  // Return leg: after EXIT the pass stays scannable for the REST OF THE DAY —
  // the guard scans the same QR a second time to register the RETURN.
  const canShowReturnQR = isUsed && !!pass.token;
  const qrCaption = [pass.id, pass.name && `${pass.name}${pass.rollNo ? ` (${pass.rollNo})` : ''}`].filter(Boolean).join(' • ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-md w-full border border-slate-200/80 shadow-2xl overflow-hidden my-auto">

        {/* Modal Header */}
        <div className="px-4 sm:px-5 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-xs shrink-0 ${
              isApproved && !isUsed
                ? 'bg-emerald-50 border border-emerald-200/60 text-emerald-600'
                : canShowReturnQR
                  ? 'bg-blue-50 border border-blue-200/60 text-blue-600'
                  : 'bg-amber-50 border border-amber-200/60 text-amber-600'
            }`}>
              {isApproved && !isUsed
                ? <ShieldCheck className="w-5 h-5" />
                : canShowReturnQR
                  ? <LogIn className="w-5 h-5" />
                  : <Hourglass className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Cryptographic Gate Pass
              </h3>
              <p className="text-xs text-slate-500">
                {isApproved && !isUsed
                  ? 'Warden Approved • HMAC-SHA256 Signed'
                  : canShowReturnQR
                    ? 'Exit Registered • Same QR Logs Your Return'
                    : isReturned
                      ? 'Round Trip Completed • Register Closed'
                      : isUsed
                        ? 'Pass Already Used • Scan Locked'
                        : 'Waiting for Warden Approval'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 space-y-3">

          {!isApproved && !canShowReturnQR && (
            /* ---------- PENDING / REJECTED / RETURNED / USED-without-token:
                 no QR is shown ---------- */
            <div className={`border-2 rounded-xl p-4 flex flex-col items-center justify-center text-center gap-2.5 ${
              isReturned
                ? 'bg-slate-50 border-slate-300'
                : pass.status === 'REJECTED'
                  ? 'bg-rose-50 border-rose-300'
                  : isUsed
                    ? 'bg-slate-50 border-slate-300'
                    : 'bg-amber-50 border-amber-300'
            }`}>
              {pass.status === 'REJECTED' ? (
                <XCircle className="w-10 h-10 text-rose-600" />
              ) : (isUsed || isReturned) ? (
                <Lock className="w-10 h-10 text-slate-500" />
              ) : (
                <Hourglass className="w-10 h-10 text-amber-600 animate-pulse" />
              )}

              <div className={`text-sm font-extrabold tracking-wide font-mono ${
                pass.status === 'REJECTED' ? 'text-rose-800'
                  : (isUsed || isReturned) ? 'text-slate-700' : 'text-amber-800'
              }`}>
                {pass.status === 'REJECTED'
                  ? 'PASS REJECTED BY WARDEN'
                  : isReturned
                    ? 'ROUND TRIP COMPLETED — REGISTER CLOSED'
                    : isUsed
                      ? 'PASS EXPIRED — ALREADY USED AT GATE'
                      : 'WARDEN APPROVAL REQUIRED'}
              </div>

              <p className="text-xs text-slate-600 font-medium leading-relaxed">
                {pass.status === 'REJECTED'
                  ? 'This gate pass was rejected by the Hostel Warden. Please submit a new request with a valid reason.'
                  : isReturned
                    ? 'You have exited and returned to campus — this pass history is complete. A new pass can be requested anytime.'
                    : isUsed
                      ? 'This pass has already been scanned and verified at the Main Gate. It cannot be reused.'
                      : 'A secure QR code is only generated after the Hostel Warden cryptographically signs your pass. Once approved, the scannable QR will appear here automatically.'}
              </p>

              <div className="w-full grid grid-cols-2 gap-2 mt-1 text-left text-xs font-mono">
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 block">Pass ID</span>
                  <span className="font-bold text-slate-800 truncate block">{pass.id}</span>
                </div>
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 block">Current Status</span>
                  <span className="font-bold text-amber-700">{pass.status || 'PENDING'}</span>
                </div>
              </div>
            </div>
          )}

          {isApproved && pass.token && (
            /* ---------- APPROVED (and not yet used): real scannable QR ---------- */
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 sm:p-4 flex flex-col items-center justify-center text-center relative overflow-hidden">

              {/* Active Status Ribbon */}
              <div className="flex items-center space-x-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-full text-xs font-mono font-semibold mb-2.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>ACTIVE & CRYPTO-VERIFIED</span>
              </div>

              <div className="w-full flex flex-col min-[380px]:flex-row items-center gap-3">
              {/* QR Code — compact inline, tap = big fullscreen for the gate (shared with day scholars) */}
              <div className="w-[170px] min-[380px]:w-[150px] sm:w-[170px] shrink-0">
                <ScannableQR value={pass.token || pass.id} caption={qrCaption} />
              </div>

              <div className="min-w-0 w-full flex-1">
              <div className="font-mono text-center min-[380px]:text-left">
                <div className="text-base font-bold text-slate-900 tracking-wider break-words">
                  {pass.id}
                </div>
                <div className="text-xs text-emerald-700 font-semibold mt-0.5 break-words">
                  {pass.name} ({pass.rollNo})
                </div>
              </div>

              {/* Pass Details Grid */}
              <div className="w-full grid grid-cols-2 min-[380px]:grid-cols-1 gap-1.5 mt-2.5 text-left text-xs font-mono">
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 block">Destination</span>
                  <span className="font-bold text-slate-800 truncate block">{pass.destination}</span>
                </div>
                <div className="bg-white p-2 rounded-lg border border-slate-200">
                  <span className="text-[10px] text-slate-500 block">Valid Until</span>
                  <span className="font-bold text-amber-700">
                    {pass.validUntil ? new Date(pass.validUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '09:30 PM'}
                  </span>
                </div>
              </div>
              </div>
              </div>

              {/* Signature Hash Preview */}
              <div className="w-full mt-2.5 px-3 py-1.5 bg-white rounded-lg text-[10px] font-mono text-slate-500 truncate flex items-center justify-between border border-slate-200">
                <span className="text-slate-400">HMAC-SIG:</span>
                <span className="text-emerald-700 truncate ml-1">{pass.signature || 'HMAC-SHA256-VERIFIED'}</span>
              </div>

              <button
                type="button"
                onClick={copyToken}
                className="mt-2 w-full py-2 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                {copied ? 'Copied ✓' : 'Copy scan token'}
              </button>
            </div>
          )}

          {canShowReturnQR && (
            /* ---------- RETURN LEG: the USED pass shows the SAME signed QR.
               The guard scans it once more at the gate, which the server reads
               as a RETURN (the state machine switches direction for USED). ---------- */
            <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-3 sm:p-4 flex flex-col items-center justify-center text-center relative overflow-hidden">

              {/* Return-lane Ribbon */}
              <div className="flex items-center space-x-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-full text-xs font-mono font-bold mb-2.5">
                <LogIn className="w-3.5 h-3.5 shrink-0" />
                <span>EXIT REGISTERED — SHOW AGAIN TO RETURN</span>
              </div>

              <div className="w-full flex flex-col min-[380px]:flex-row items-center gap-3">
              {/* QR Code — compact inline, tap = big fullscreen for the gate (shared with day scholars) */}
              <div className="w-[170px] min-[380px]:w-[150px] sm:w-[170px] shrink-0">
                <ScannableQR value={pass.token || pass.id} caption={qrCaption} />
              </div>

              <div className="min-w-0 w-full flex-1 text-center min-[380px]:text-left">
              <div className="font-mono">
                <div className="text-base font-bold text-slate-900 tracking-wider break-words">
                  {pass.id}
                </div>
                <div className="text-xs text-blue-700 font-semibold mt-0.5 break-words">
                  {pass.name} ({pass.rollNo})
                </div>
              </div>

              <p className="text-[11px] text-blue-800 font-medium leading-relaxed mt-2">
                You have exited campus. Show this same QR at the gate when returning —
                the guard scans it once more and your return is registered in the gate register.
              </p>
              </div>
              </div>

              <button
                type="button"
                onClick={copyToken}
                className="mt-2 w-full py-2 rounded-lg border border-slate-200 bg-white text-[11px] font-bold text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                {copied ? 'Copied ✓' : 'Copy scan token'}
              </button>
            </div>
          )}

          {isApproved && !pass.token && (
            /* ---------- APPROVED but the signed token hasn't synced to this
               device yet — never fake a QR out of the bare pass ID, because
               the guard scanner would reject it as a malformed token. The
               App's /api/pass-status reconciliation delivers the token in a
               few seconds; closing and reopening the modal will show it. ---------- */
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-4 flex flex-col items-center justify-center text-center gap-2.5">
              <Hourglass className="w-10 h-10 text-amber-600 animate-pulse" />
              <div className="text-sm font-extrabold tracking-wide font-mono text-amber-800">
                SIGNATURE SYNCING…
              </div>
              <p className="text-xs text-slate-600 font-medium leading-relaxed">
                Your pass is approved and cryptographically signed by the warden. The secure QR
                arrives on this device within seconds — close this popup and reopen it if it hasn't yet.
              </p>
            </div>
          )}

          <div className="text-center">
            <button
              onClick={onClose}
              className={`w-full min-h-[44px] py-2.5 rounded-lg text-white font-medium text-xs cursor-pointer shadow-sm ${
                canShowReturnQR
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : isApproved ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-slate-900 hover:bg-slate-800'
              }`}
            >
              Done & Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

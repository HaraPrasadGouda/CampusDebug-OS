import React, { useState, useEffect } from 'react';
import { 
  QrCode, 
  X, 
  Clock, 
  ShieldCheck, 
  CheckCircle2, 
  MapPin, 
  FileText, 
  Calendar,
  Lock,
  ArrowRight,
  Send,
  AlertCircle
} from 'lucide-react';
import { saveLocal, queueOfflineAction } from '../../utils/db';
import { getStoredProfile } from '../../utils/authClient';

export default function RequestGatePassModal({ isOpen, onClose, onPassCreated, session }) {
  // Prefill strictly from the REAL signed-in identity — no fabricated
  // student names/rolls in the pass form. Identity sources:
  //   1. the active session (App state), 2. the stored auth profile,
  //   3. empty fields the user must fill (never a made-up name).
  const resolvedIdentity = {
    name: session?.name || getStoredProfile()?.fullName || '',
    rollNo: session?.identity || getStoredProfile()?.rollNumber || ''
  };
  const [formData, setFormData] = useState({
    name: resolvedIdentity.name,
    rollNo: resolvedIdentity.rollNo,
    destination: '',
    reason: '',
    passType: 'Day Pass',
    returnDate: new Date().toISOString().slice(0, 10), // used by Home Leave only
    returnTime: '21:30'
  });
  // Refresh names if the session identity loads after mount
  useEffect(() => {
    setFormData(prev => ({
      ...prev,
      name: resolvedIdentity.name || prev.name,
      rollNo: resolvedIdentity.rollNo || prev.rollNo
    }));
  }, [session?.name, session?.identity]);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [timeError, setTimeError] = useState(null);

  const isHomeLeave = formData.passType === 'Home Leave';
  const isMedical = formData.passType === 'Medical Outing';

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setTimeError(null);

    try {
      const passId = `GP-${Math.floor(100000 + Math.random() * 900000)}`;

      // Calculate validUntil date. Day Pass / Medical Outing are same-day by
      // definition — the chosen time is applied to TODAY only. Home Leave is
      // the one category with a real return DATE (warden discretion governs
      // the length; no hard cap).
      const [hours, minutes] = formData.returnTime.split(':');
      const validAsOf = isHomeLeave
        ? new Date(`${formData.returnDate}T${formData.returnTime}:00`)
        : new Date(new Date().setHours(parseInt(hours, 10), parseInt(minutes, 10), 0, 0));
      const validUntil = validAsOf.toISOString();

      if (validAsOf.getTime() <= Date.now()) {
        setTimeError('Expected return must be later than the current time.');
        setIsSubmitting(false);
        return;
      }

      const passData = {
        id: passId,
        passId,
        studentId: resolvedIdentity.rollNo, // real signed-in roll — no fabricated IDs
        name: formData.name,
        rollNo: formData.rollNo,
        destination: formData.destination,
        reason: formData.reason,
        passType: formData.passType,
        priority: isMedical, // medical outings ride the priority lane for wardens
        validUntil,
        status: 'PENDING', // Enforce state machine: Requires Warden approval
        createdAt: new Date().toISOString(),
        createdAtMs: Date.now()
      };

      // 1. Save in IndexedDB as PENDING
      await saveLocal('gate_passes', passData);

      // 2. Sync pass to backend server for cross-device visibility
      try {
        await fetch('/api/create-pass', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passData })
        });
      } catch (netErr) {
        console.warn('Backend sync failed, stored locally:', netErr);
      }

      // 3. Queue in outbox
      await queueOfflineAction('REQUEST_GATE_PASS', passData);

      // Dispatch custom event for real-time reactive sync across roles
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('campus_gate_pass_updated', {
          detail: { pass: passData }
        }));
      }

      if (onPassCreated) {
        onPassCreated(passData);
      }

      onClose();
    } catch (err) {
      console.error('Failed to submit pass request:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-white rounded-3xl max-w-lg w-full border border-slate-200/80 shadow-2xl overflow-hidden my-auto">
        
        {/* Modal Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 border border-emerald-200/60 text-emerald-600 flex items-center justify-center shadow-xs shrink-0">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Request Campus Gate Pass
              </h3>
              <p className="text-xs text-slate-500">
                Hostel Warden cryptographic authorization
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
        <form onSubmit={handleSubmit} className="p-5 space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-medium mb-1">Student Name</label>
              <input 
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-600"
              />
            </div>
            <div>
              <label className="block text-slate-700 font-medium mb-1">Registration / Roll No</label>
              <input 
                type="text"
                required
                value={formData.rollNo}
                onChange={(e) => setFormData({ ...formData, rollNo: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-slate-800 focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-medium mb-1">Pass Category</label>
              <select
                value={formData.passType}
                onChange={(e) => setFormData({ ...formData, passType: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-600 cursor-pointer"
              >
                <option value="Day Pass">Day Pass</option>
                <option value="Medical Outing">Medical Outing</option>
                <option value="Home Leave">Home Leave</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-700 font-medium mb-1">
                Expected Return {isHomeLeave ? 'Date' : 'Time'}
              </label>
              {isHomeLeave ? (
                <input
                  type="date"
                  required
                  min={new Date().toISOString().slice(0, 10)}
                  value={formData.returnDate}
                  onChange={(e) => setFormData({ ...formData, returnDate: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-slate-800 focus:outline-none focus:border-emerald-600"
                />
              ) : (
                <input
                  type="time"
                  required
                  value={formData.returnTime}
                  onChange={(e) => setFormData({ ...formData, returnTime: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-slate-800 focus:outline-none focus:border-emerald-600"
                />
              )}
            </div>
          </div>

          {isHomeLeave && (
            <div>
              <label className="block text-slate-700 font-medium mb-1">Expected Return Time</label>
              <input
                type="time"
                required
                value={formData.returnTime}
                onChange={(e) => setFormData({ ...formData, returnTime: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 font-mono text-slate-800 focus:outline-none focus:border-emerald-600"
              />
            </div>
          )}
          {isMedical && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-[11px] text-rose-800 font-semibold flex items-center gap-2">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              Medical outings are flagged PRIORITY — routed to the top of the warden's queue.
            </div>
          )}

          {timeError && (
            <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-rose-700 text-[11px] font-semibold">
              {timeError}
            </div>
          )}

          <div>
            <label className="block text-slate-700 font-medium mb-1">Destination</label>
            <div className="relative">
              <MapPin className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input 
                type="text"
                required
                value={formData.destination}
                onChange={(e) => setFormData({ ...formData, destination: e.target.value })}
                placeholder="e.g., City Market, Temple, Hospital, Friend's Place"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          <div>
            <label className="block text-slate-700 font-medium mb-1">Specific Reason</label>
            <div className="relative">
              <FileText className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input 
                type="text"
                required
                value={formData.reason}
                onChange={(e) => setFormData({ ...formData, reason: e.target.value })}
                placeholder="e.g. Purchasing essential electronics & lab equipment"
                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-9 pr-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-600"
              />
            </div>
          </div>

          {/* Workflow Notice */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start space-x-2.5">
            <Clock className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-900 leading-relaxed font-mono">
              State Machine: Request will be routed to the <span className="text-amber-700 font-bold">Hostel Warden</span>. Once approved, the cryptographic HMAC-SHA256 signed QR code will unlock in your feed.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
            <button 
              type="button" 
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button 
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Submitting...' : 'Submit Request to Warden'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

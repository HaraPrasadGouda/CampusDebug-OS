import React, { useState } from 'react';
import { 
  FileText, 
  X, 
  CheckCircle2, 
  Send, 
  ShieldCheck, 
  Download, 
  Clock, 
  Building2,
  FileCheck
} from 'lucide-react';
import { saveLocal, queueOfflineAction } from '../../utils/db';

const DOC_TYPES = [
  { id: 'Bonafide Certificate', label: 'Bonafide Certificate (Internship / Passport / Bank)' },
  { id: 'Hostel No-Dues Clearance', label: 'Hostel No-Dues Clearance (Semester End)' },
  { id: 'Conduct Certificate', label: 'Character & Conduct Certificate' },
  { id: 'Official Fee Receipt', label: 'Tuition & Hostel Fee Receipt (IT Return)' },
  { id: 'Migration / Transfer NOC', label: 'Migration & Transfer NOC Certificate' }
];

export default function DocRequestModal({ isOpen, onClose, onDocRequested }) {
  const [formData, setFormData] = useState({
    docType: 'Bonafide Certificate',
    deliveryMode: 'Digital Verified PDF (Offline Signed)',
    purpose: '',
    urgency: 'Standard (24h SLA)'
  });

  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.purpose.trim()) return;

    setIsSubmitting(true);
    try {
      const docId = `DOC-${Math.floor(1000 + Math.random() * 9000)}`;
      const { getStoredProfile } = await import('../../utils/authClient');
      const newDocRequest = {
        id: docId,
        owner: (getStoredProfile() || {}).rollNumber || null,
        type: 'ticket',
        category: 'Admin Document',
        title: `${formData.docType}: ${formData.purpose}`,
        description: formData.purpose,
        location: 'Academic Registrar Office',
        status: 'PENDING_OFFICE_VERIFICATION',
        statusLabel: 'Pending Admin Verification',
        sla: formData.urgency,
        createdAt: new Date().toISOString(),
        time: 'Just now'
      };

      // Dedicated store — GONE from 'tickets' so the warden's issue queue
      // (which loads the shared tickets ledger) never mistake certificate
      // requests for student complaints.
      await saveLocal('doc_requests', newDocRequest);
      await queueOfflineAction('REQUEST_DOCUMENT', newDocRequest);

      if (onDocRequested) {
        onDocRequested(newDocRequest);
      }

      onClose();
      setFormData({
        docType: 'Bonafide Certificate',
        deliveryMode: 'Digital Verified PDF (Offline Signed)',
        purpose: '',
        urgency: 'Standard (24h SLA)'
      });
    } catch (err) {
      console.error('Doc request error:', err);
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
            <div className="w-10 h-10 rounded-2xl bg-purple-50 border border-purple-200/60 text-purple-600 flex items-center justify-center shadow-xs shrink-0">
              <FileCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Request Official Certificate / Document
              </h3>
              <p className="text-xs text-slate-500">
                Registrar & Academic Cell Direct Dispatch
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
          
          {/* Certificate Type */}
          <div>
            <label className="block text-slate-700 font-semibold mb-1">Select Certificate / Document</label>
            <select
              value={formData.docType}
              onChange={(e) => setFormData({ ...formData, docType: e.target.value })}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-emerald-500 cursor-pointer font-medium"
            >
              {DOC_TYPES.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </div>

          {/* Delivery Mode & SLA */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-700 font-semibold mb-1">Dispatch Format</label>
              <select
                value={formData.deliveryMode}
                onChange={(e) => setFormData({ ...formData, deliveryMode: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-emerald-500 cursor-pointer font-medium"
              >
                <option value="Digital Verified PDF (Offline Signed)">Digital PDF (E-Signed)</option>
                <option value="Physical Signed Hardcopy">Physical Hardcopy</option>
              </select>
            </div>

            <div>
              <label className="block text-slate-700 font-semibold mb-1">Processing Urgency</label>
              <select
                value={formData.urgency}
                onChange={(e) => setFormData({ ...formData, urgency: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-emerald-500 cursor-pointer font-medium"
              >
                <option value="Standard (24h SLA)">Standard (24h SLA)</option>
                <option value="Urgent Visa / Internship (6h SLA)">Urgent (6h SLA)</option>
              </select>
            </div>
          </div>

          {/* Purpose Statement */}
          <div>
            <label className="block text-slate-700 font-semibold mb-1">Reason / Intended Organization</label>
            <textarea
              required
              rows={3}
              value={formData.purpose}
              onChange={(e) => setFormData({ ...formData, purpose: e.target.value })}
              placeholder="e.g., Required for Summer Research Internship application at DRDO / Passport verification..."
              className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-slate-900 focus:outline-none focus:border-emerald-500"
            ></textarea>
          </div>

          {/* Verification Badge Note */}
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start space-x-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-emerald-800 leading-relaxed font-mono">
              Direct Academic ERP Bridge: Upon registrar verification, digitally watermarked certificates with institutional QR seals become available for 1-tap download.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-2 pt-3 border-t border-slate-200">
            <button 
              type="button" 
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button 
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSubmitting ? 'Submitting...' : 'Submit Request'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

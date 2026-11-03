import React, { useState } from 'react';
import { 
  Wrench, 
  X, 
  MapPin, 
  AlertTriangle, 
  Layers, 
  WifiOff, 
  CheckCircle2, 
  Zap, 
  Droplet, 
  Wifi, 
  Home, 
  Sparkles,
  ArrowRight,
  Lock
} from 'lucide-react';
import { saveLocal, queueOfflineAction } from '../../utils/db';
import { getStoredProfile } from '../../utils/authClient';

// API origin comes from the environment (Vite VITE_API_BASE). Empty means
// same-origin, the same pattern the rest of the app's API calls use.
const API_BASE = import.meta.env.VITE_API_BASE || '';

const CATEGORIES = [
  { id: 'Electrical', label: 'Electrical (Fan/Switch)', icon: Zap, color: 'text-amber-600' },
  { id: 'Plumbing', label: 'Plumbing (Water/Tap)', icon: Droplet, color: 'text-sky-600' },
  { id: 'Wi-Fi / LAN', label: 'Wi-Fi / LAN Network', icon: Wifi, color: 'text-emerald-600' },
  { id: 'Furniture', label: 'Bed / Desk / Door', icon: Home, color: 'text-indigo-600' },
  { id: 'Cleanliness', label: 'Washroom / Hygiene', icon: Sparkles, color: 'text-rose-600' }
];

// Who + where come from the signed-in student's real profile (the same
// record the server uses). These fields are shown read-only: the server
// ignores any name/roll/block/room sent in the request and reads them from
// the profile, so a complaint can only ever be filed for your own room.
const NOT_SET = 'Not set in profile';
const readStudentDetails = () => {
  let p = null;
  try { p = getStoredProfile(); } catch { /* profile unavailable */ }
  const val = (...xs) => {
    const v = xs.find(x => x !== undefined && x !== null && String(x).trim() !== '');
    return v === undefined ? '' : String(v).trim();
  };
  return {
    name: val(p?.fullName, p?.full_name, p?.name),
    roll: val(p?.rollNumber, p?.roll_number),
    block: val(p?.hostelBlock, p?.hostel_block),
    room: val(p?.roomNumber, p?.room_number)
  };
};

export default function ReportIssueModal({ isOpen, onClose, onTicketCreated }) {
  const [formData, setFormData] = useState({ category: 'Electrical', description: '' });
  const [submitError, setSubmitError] = useState(null);
  // Re-read on every render so a fresh login always shows the current profile
  const me = readStudentDetails();
  const locationLabel = me.block
    ? [`Hostel ${me.block.replace(/^Hostel\s*/i, '')}`, me.room ? `Room ${me.room}` : ''].filter(Boolean).join(', ')
    : '';

  const [isSubmitting, setIsSubmitting] = useState(false);

  // DAY-SCHOLAR GUARD (defense in depth — the quick-action card and the App
  // level onOpenModal already block the entry): a repair ticket needs the
  // resident present when the technician arrives, so the form must never
  // render for a day scholar, however it got opened.
  let isDayScholar = false;
  try {
    const prof = getStoredProfile();
    isDayScholar = String(prof?.resident_type || prof?.residentType || '').trim().toLowerCase() === 'dayscholar';
  } catch { /* profile unavailable — proceed */ }

  if (!isOpen) return null;

  if (isDayScholar) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm">
        <div className="bg-white rounded-3xl shadow-2xl max-w-sm w-full p-6 text-center space-y-3">
          <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-100 flex items-center justify-center">
            <Lock className="w-6 h-6 text-slate-500" />
          </div>
          <h3 className="text-lg font-extrabold text-slate-900">Hostel Issue — Locked</h3>
          <p className="text-sm text-slate-600 leading-relaxed">
            Repair tickets need a hostel resident present when the technician
            arrives. As a <strong>Day Scholar</strong> you commute from home,
            so this option stays locked for your account.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-slate-700 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.description.trim() || !me.block) return;

    setSubmitError(null);
    setIsSubmitting(true);
    const isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;

    try {
      let createdTicket = null;
      let serverResult = null;

      if (isOnline) {
        try {
          const res = await fetch(`${API_BASE}/api/parse-ticket`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              complaintText: formData.description,
              category: formData.category
            })
          });

          if (!res.ok && res.status >= 400 && res.status < 500) {
            // The server refused it (not a network problem) — say why and
            // keep the form open instead of queuing it as "offline".
            const err = await res.json().catch(() => ({}));
            setSubmitError(err.error || 'This complaint could not be filed.');
            return;
          }
          if (res.ok) {
            serverResult = await res.json();
            if (serverResult && serverResult.ticket) {
              const ai = serverResult.ticket;
              const aiUrgency = ai.urgency || (ai.sla_hours ? (ai.sla_hours <= 1 ? 'CRITICAL' : ai.sla_hours <= 2 ? 'HIGH' : 'MEDIUM') : 'NORMAL');
              // The server (AI + routing engine) decides final status, technician
              // assignment and master-incident linkage — the modal just reflects it.
              createdTicket = {
                id: ai.id || `TKT-${Math.floor(10000 + Math.random() * 90000)}`,
                type: 'ticket',
                title: ai.title || formData.description,
                category: ai.category || formData.category,
                location: ai.location || locationLabel,
                urgency: aiUrgency,
                description: formData.description,
                status: ai.status || 'ASSIGNED',
                statusLabel: ai.statusLabel || 'Reported',
                assignedTo: ai.assignedTo || serverResult.assignedTechnician?.name,
                assignedTechId: ai.assignedTechId || serverResult.assignedTechnician?.id,
                masterId: ai.masterId || serverResult.masterId || undefined,
                masterJoined: ai.masterJoined || serverResult.clustered || undefined,
                clusterFormed: ai.clusterFormed || undefined,
                aiFallback: serverResult.aiFallback || undefined,
                aiCategory: ai.aiCategory || serverResult.aiCategory || undefined, // Fix 4
                sla: ai.sla || (ai.sla_hours ? `SLA: ${ai.sla_hours}h Target` : 'SLA: 4h Standard'),
                sla_hours: ai.sla_hours || 4,
                createdAt: ai.createdAt || new Date().toISOString(),
                time: 'Just now',
                // Lifecycle (Reported → Resolved → Closed) — the card shows
                // the progress bar + Resolved / Not fixed right away.
                shortCode: ai.shortCode || undefined,
                lifecycleStage: ai.lifecycleStage || undefined,
                reportedAt: ai.reportedAt || undefined,
                studentResolvedAt: null,
                closedAt: null,
                notFixedCount: 0,
                technician: ai.technician ? { id: ai.technician.id, name: ai.technician.name, role: ai.technician.role } : null,
                student_id: ai.student_id || undefined
              };

              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('campus_tickets_updated', { detail: serverResult }));
              }
            }
          }
        } catch (apiErr) {
          console.warn('Live Ollama ticket submission failed, falling back to local heuristic:', apiErr.message);
        }
      }

      // Fallback local construction if server fetch failed or offline
      // (deterministic urgency/SLA heuristic — no AI required)
      if (!createdTicket) {
        const descLower = formData.description.toLowerCase();
        const isCritical = descLower.includes('fire') || descLower.includes('spark') || descLower.includes('mcb') || descLower.includes('smoke') || descLower.includes('short circuit');
        const isHigh = descLower.includes('leak') || descLower.includes('overflow') || descLower.includes('burst') || descLower.includes('no water');
        const fallbackUrgency = isCritical ? 'CRITICAL' : isHigh ? 'HIGH' : 'NORMAL';
        const fallbackSlaHours = isCritical ? 1 : isHigh ? 2 : 4;
        const fallbackSLA = isCritical ? 'SLA: 1h Emergency' : isHigh ? 'SLA: 2h Priority' : 'SLA: 4h Standard';
        const ticketId = `TKT-${Math.floor(10000 + Math.random() * 90000)}`;

        createdTicket = {
          id: ticketId,
          type: 'ticket',
          title: `${formData.category}: ${me.room ? `Room #${me.room} - ` : ''}${formData.description}`,
          category: formData.category,
          location: locationLabel,
          urgency: fallbackUrgency,
          description: formData.description,
          status: 'PENDING',
          statusLabel: isOnline ? 'Server offline — queued for routing' : 'Queued (Offline)',
          sla: fallbackSLA,
          sla_hours: fallbackSlaHours,
          createdAt: new Date().toISOString(),
          time: 'Just now'
        };

        // Queue the raw form fields so the sync engine replays this through
        // /api/parse-ticket (full AI classification + routing when back online)
        await queueOfflineAction('CREATE_TICKET', {
          complaintText: formData.description,
          category: formData.category,
          urgency: fallbackUrgency,
          ticket: createdTicket
        });
      }

      try {
        const { getStoredProfile } = await import('../../utils/authClient');
        createdTicket.owner = (getStoredProfile() || {}).rollNumber || null;
      } catch { /* ownership stamp is best-effort */ }
      await saveLocal('tickets', createdTicket);

      if (onTicketCreated) {
        onTicketCreated(createdTicket, isOnline);
      }

      onClose();
      setSubmitError(null);
      setFormData({ category: 'Electrical', description: '' });
    } catch (err) {
      console.error('Failed to submit ticket:', err);
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
            <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200/60 text-amber-600 flex items-center justify-center shadow-xs shrink-0">
              <Wrench className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Report Hostel Maintenance Issue
              </h3>
              <p className="text-xs text-slate-500">
                Auto-clustered into Master Tickets with SLA escalation
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
          
          {/* Category Selector Chips */}
          <div>
            <label className="block text-slate-700 font-medium mb-1.5">Issue Category</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {CATEGORIES.map((cat) => {
                const Icon = cat.icon;
                const isSelected = formData.category === cat.id;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setFormData({ ...formData, category: cat.id })}
                    className={`flex items-center space-x-2 p-2 rounded-lg border text-left transition-all cursor-pointer ${
                      isSelected 
                        ? 'bg-amber-50 border-amber-300 text-slate-900 font-bold shadow-sm' 
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${cat.color} shrink-0`} />
                    <span className="truncate">{cat.id}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Your details — locked, straight from your college profile */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="flex items-center gap-1.5 text-slate-700 font-semibold min-w-0">
                <MapPin className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                <span className="truncate">Your details</span>
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-600 bg-white border border-slate-200 rounded-full px-2 py-0.5 shrink-0">
                <Lock className="w-3 h-3" />
                Locked
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Student Name', me.name, 'col-span-2 sm:col-span-1'],
                ['Roll No.', me.roll, 'col-span-2 sm:col-span-1'],
                ['Hostel Block', me.block, ''],
                ['Room No.', me.room, ''],
              ].map(([label, value, span]) => (
                <div key={label} className={`min-w-0 ${span}`}>
                  <label className="block text-slate-500 font-medium mb-1 text-[11px]">{label}</label>
                  <div
                    aria-readonly="true"
                    title="From your college profile — can't be edited here"
                    className="flex items-center gap-1.5 w-full bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-2 cursor-not-allowed select-text"
                  >
                    <Lock className="w-3 h-3 text-slate-400 shrink-0" />
                    <span className={`min-w-0 break-words ${value ? 'text-slate-800 font-semibold' : 'text-slate-400 italic'} ${label === 'Roll No.' || label === 'Room No.' ? 'font-mono' : ''}`}>
                      {value || NOT_SET}
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-slate-500 leading-snug mt-2">
              {me.block
                ? 'Filled from your college profile and can\'t be changed here. Wrong room? Ask your warden to update your profile.'
                : 'Your hostel block isn\'t set in your profile yet, so a complaint can\'t be filed. Please ask your warden to update it.'}
            </p>
          </div>

          {/* Description Textarea */}
          <div>
            <label className="block text-slate-700 font-medium mb-1">Problem Description</label>
            <textarea
              required
              rows={3}
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              placeholder="e.g. Overhead fan making grinding noise, regulator sparks when turning to speed 4..."
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-600"
            ></textarea>
            <div className="flex items-center space-x-1.5 text-[11px] text-amber-700 font-mono mt-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-600 shrink-0" />
              <span>⚡ Category, Urgency & SLA will be auto-calculated by CampusDebug AI</span>
            </div>
          </div>

          {/* Spatial Clustering Notice */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start space-x-2.5">
            <Layers className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-900 leading-relaxed font-mono">
              Spatial Deduplication Active: If students in {me.block ? me.block.replace(/^Hostel\s*/i, '') : 'your block'} submit identical complaints, tickets collapse into 1 Master Ticket with multi-student confirmation.
            </p>
          </div>

          {submitError && (
            <div role="alert" className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-[11px] text-rose-800 font-semibold">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100">
            <button 
              type="button" 
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium"
            >
              Cancel
            </button>
            <button 
              type="submit"
              disabled={isSubmitting || !me.block}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <span>Logging Ticket...</span>
              ) : (
                <>
                  <span>Submit Ticket</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

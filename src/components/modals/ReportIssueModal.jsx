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

// Prefill location from the logged-in student's session (local action while offline safe)
const readStudentLocation = () => {
  try {
    const s = JSON.parse(localStorage.getItem('campusdebug_session') || 'null');
    if (s?.role === 'Student' && s.room && s.block) {
      return { block: s.block.startsWith('Hostel') ? s.block : `Hostel ${s.block}`, floor: s.floor || '3rd Floor', room: s.room };
    }
  } catch { /* session unavailable */ }
  return { block: 'Hostel Block B', floor: '3rd Floor', room: '304' }; // sensible default
};

export default function ReportIssueModal({ isOpen, onClose, onTicketCreated }) {
  const [formData, setFormData] = useState(() => {
    const loc = readStudentLocation();
    return {
      category: 'Electrical',
      block: loc.block,
      floor: loc.floor,
      room: loc.room,
      description: ''
    };
  });

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
    if (!formData.description.trim()) return;

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
              hostelBlock: formData.block,
              floor: formData.floor,
              room: formData.room,
              category: formData.category
            })
          });

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
                location: ai.location || `${formData.block}, ${formData.floor}, Room ${formData.room}`,
                urgency: aiUrgency,
                description: formData.description,
                status: ai.status || 'ASSIGNED',
                statusLabel: ai.statusLabel || `Routed to ${ai.assignedTo || 'Maintenance'}`,
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
                time: 'Just now'
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
          title: `${formData.category}: Room #${formData.room} - ${formData.description}`,
          category: formData.category,
          location: `${formData.block}, ${formData.floor}, Room ${formData.room}`,
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
          hostelBlock: formData.block,
          floor: formData.floor,
          room: formData.room,
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
      const loc = readStudentLocation();
      setFormData({
        category: 'Electrical',
        block: loc.block,
        floor: loc.floor,
        room: loc.room,
        description: ''
      });
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

          {/* Location Details */}
          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-slate-700 font-medium mb-1">Hostel Block</label>
              <select
                value={formData.block}
                onChange={(e) => setFormData({ ...formData, block: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-slate-800 focus:outline-none focus:border-emerald-600"
              >
                <option value="Hostel Block A">Block A</option>
                <option value="Hostel Block B">Block B</option>
                <option value="Hostel Block C">Block C</option>
                <option value="Girls Hostel 1">Girls Hostel 1</option>
                <option value="Girls Hostel 2">Girls Hostel 2</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-700 font-medium mb-1">Floor</label>
              <select
                value={formData.floor}
                onChange={(e) => setFormData({ ...formData, floor: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-slate-800 focus:outline-none focus:border-emerald-600"
              >
                <option value="Ground Floor">Ground</option>
                <option value="1st Floor">1st Floor</option>
                <option value="2nd Floor">2nd Floor</option>
                <option value="3rd Floor">3rd Floor</option>
                <option value="4th Floor">4th Floor</option>
              </select>
            </div>
            <div>
              <label className="block text-slate-700 font-medium mb-1">Room #</label>
              <input
                type="text"
                required
                value={formData.room}
                onChange={(e) => setFormData({ ...formData, room: e.target.value })}
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2 text-slate-800 font-mono focus:outline-none focus:border-emerald-600"
              />
            </div>
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
              Spatial Deduplication Active: If roommates from Block B 3rd floor submit identical complaints, tickets collapse into 1 Master Ticket with multi-student confirmation.
            </p>
          </div>

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
              disabled={isSubmitting}
              className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm"
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

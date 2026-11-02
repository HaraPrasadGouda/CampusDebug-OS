import React, { useState, useEffect } from 'react';
import { 
  ShieldCheck, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  Layers, 
  AlertTriangle, 
  Users, 
  MapPin, 
  Wrench, 
  QrCode, 
  Check, 
  X, 
  Flame, 
  Sparkles,
  ArrowRight,
  TrendingUp,
  RefreshCw,
  UserCheck,
  ClipboardList
} from 'lucide-react';
import { generateSignedPassToken } from '../../utils/crypto';
import { getAllLocal, saveLocal, queueOfflineAction } from '../../utils/db';
import { getAccessToken } from '../../utils/authClient';
import { notifyGatePassApproved } from '../../utils/notifications';
import WardenCreatePassModal from '../modals/WardenCreatePassModal';

// NO seeded demo data — the warden queue only shows REAL passes/tickets/clusters
// created by actual student activity (IndexedDB + Supabase via /api/dashboard-data).
const INITIAL_PENDING_PASSES = [];
const INITIAL_CLUSTERS = [];

export default function WardenDashboard({ onNotification, masterClusters = [], searchQuery = '' }) {
  const [pendingPasses, setPendingPasses] = useState(INITIAL_PENDING_PASSES);
  const [clusters, setClusters] = useState(
    masterClusters.length > 0 ? masterClusters : INITIAL_CLUSTERS
  );
  const [allTickets, setAllTickets] = useState([]);
  const [activeTab, setActiveTab] = useState('tickets'); // 'tickets' | 'clusters' | 'passes' | 'sla' | 'register'
  const [technicianRoster, setTechnicianRoster] = useState([]);
  const [registerRows, setRegisterRows] = useState([]);
  const [registerOk, setRegisterOk] = useState(false);
  const [showCreatePassModal, setShowCreatePassModal] = useState(false);

  useEffect(() => {
    if (masterClusters.length > 0) {
      setClusters(masterClusters);
    }
  }, [masterClusters]);

  // Master clusters come EXCLUSIVELY from the server similarity engine —
  // no client-side grouping, no synthetic SLA values.
  const displayClusters = React.useMemo(() => clusters, [clusters]);

  // Header search bar (App-level): the warden's lists respect it — tickets,
  // pending passes, clusters and the gate register all filter live.
  const wq = (searchQuery || '').trim().toLowerCase();
  const hit = (...fields) => !wq || fields.some(f => String(f ?? '').toLowerCase().includes(wq));
  const shownTickets = React.useMemo(() =>
    wq ? allTickets.filter(t => hit(t.id, t.title, t.category, t.location, t.description, t.urgency)) : allTickets,
    [allTickets, wq]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownPasses = React.useMemo(() =>
    wq ? pendingPasses.filter(p => hit(p.id, p.name, p.rollNo, p.passType, p.destination, p.reason, p.room)) : pendingPasses,
    [pendingPasses, wq]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownClusters = React.useMemo(() =>
    wq ? displayClusters.filter(c => hit(c.masterId, c.category, c.status, c.impactedRooms, c.students)) : displayClusters,
    [displayClusters, wq]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownRegister = React.useMemo(() =>
    wq ? registerRows.filter(r => hit(r.id, r.student_name, r.student_roll, r.pass_ref, r.destination)) : registerRows,
    [registerRows, wq]); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshWardenData = async () => {
    try {
      const localPasses = await getAllLocal('gate_passes');
      let serverPasses = [];

      try {
        const res = await fetch('/api/dashboard-data');
        if (res.ok) {
          const data = await res.json();
          if (data.masterClusters && data.masterClusters.length > 0) {
            setClusters(data.masterClusters);
          }
          if (data.gatePasses && data.gatePasses.length > 0) {
            serverPasses = data.gatePasses;
          }
          if (data.technicianRoster && data.technicianRoster.length > 0) {
            setTechnicianRoster(data.technicianRoster);
          }
          if (data.tickets && data.tickets.length > 0) {
            setAllTickets(prev => {
              const combined = [...data.tickets, ...prev];
              const map = new Map();
              combined.forEach(t => map.set(t.id, t));
              return Array.from(map.values()).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
            });
          }
        }
      } catch (e) {
        console.warn('Backend dashboard sync offline fallback active');
      }

      // Merge local and server passes
      const allPassesMap = new Map();
      (localPasses || []).forEach(p => allPassesMap.set(p.id, p));
      serverPasses.forEach(p => {
        const existing = allPassesMap.get(p.id);
        allPassesMap.set(p.id, existing ? { ...existing, ...p } : p);
      });

      const unapproved = Array.from(allPassesMap.values()).filter(p => p.status === 'PENDING');
      // Medical outings ride the PRIORITY lane: they rise to the top of the
      // queue regardless of request order, newest-first within each lane.
      setPendingPasses(unapproved.sort((a, b) => {
        if ((b.priority ? 1 : 0) !== (a.priority ? 1 : 0)) return (b.priority ? 1 : 0) - (a.priority ? 1 : 0);
        return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
      }));

      // Gate Register (append-only pass_scans log from the server)
      try {
        const regTok = getAccessToken();
        const rres = await fetch('/api/pass-scans?limit=150',
          regTok ? { headers: { Authorization: `Bearer ${regTok}` } } : undefined);
        if (rres.ok) {
          const rj = await rres.json();
          setRegisterRows(rj.scans || []);
          setRegisterOk(!!rj.registerOk);
        }
      } catch (regErr) {
        console.warn('Gate register fetch offline:', regErr);
      }

      const localTickets = await getAllLocal('tickets');
      // Certificate requests live in their own store AND some legacy rows may
      // still sit in the tickets ledger — either way they are registrar
      // business, never the warden's issue queue.
      const wardenTickets = (localTickets || []).filter(t => t.category !== 'Admin Document');
      if (wardenTickets.length > 0) {
        setAllTickets(prev => {
          const combined = [...wardenTickets, ...prev];
          const map = new Map();
          combined.forEach(t => map.set(t.id, t));
          return Array.from(map.values()).sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        });
      }
    } catch (err) {
      console.warn('Failed to load warden data:', err);
    }
  };

  useEffect(() => {
    refreshWardenData();

    const pollInterval = setInterval(() => {
      refreshWardenData();
    }, 3000);

    const handlePassEvent = () => refreshWardenData();
    const handleTicketEvent = (e) => {
      refreshWardenData();
      if (e.detail?.masterClusters) {
        setClusters(e.detail.masterClusters);
      }
    };

    window.addEventListener('campus_gate_pass_updated', handlePassEvent);
    window.addEventListener('campus_tickets_updated', handleTicketEvent);
    return () => {
      clearInterval(pollInterval);
      window.removeEventListener('campus_gate_pass_updated', handlePassEvent);
      window.removeEventListener('campus_tickets_updated', handleTicketEvent);
    };
  }, []);

  const triggerToast = (msg, type = 'success') => {
    if (onNotification) onNotification(msg, type);
  };

  // 1-Tap Warden Approve Pass (Generates Cryptographic HMAC Signature)
  const handleApprovePass = async (pass) => {
    try {
      // If the pass's return-time window already elapsed at approval time,
      // grant a fresh 4-hour validity so the QR isn't born expired.
      const nowMs = Date.now();
      const passValidMs = pass.validUntil ? new Date(pass.validUntil).getTime() : 0;
      const effectiveValidUntil =
        passValidMs > nowMs ? pass.validUntil : new Date(nowMs + 4 * 3600 * 1000).toISOString();

      // Fix 5: no signing on the warden's device any more — the server signs
      // the student's rotating gate QR on request (POST /api/pass-token).
      const approvedPass = {
        ...pass,
        status: 'APPROVED',
        validUntil: effectiveValidUntil,
        approvedBy: 'Hostel Warden',
        approvedAt: new Date().toISOString()
      };

      await saveLocal('gate_passes', approvedPass);

      try {
        await fetch('/api/create-pass', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passData: approvedPass })
        });
      } catch (netErr) {
        console.warn('Warden approve sync failed, saved locally:', netErr);
      }

      await queueOfflineAction('WARDEN_APPROVE_PASS', approvedPass);

      // Trigger native desktop notification
      notifyGatePassApproved(pass.name, pass.id);

      // Dispatch event to unlock QR code on student view
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('campus_gate_pass_updated', {
          detail: { pass: approvedPass }
        }));
      }

      setPendingPasses(pendingPasses.filter(p => p.id !== pass.id));
      triggerToast(`Pass #${pass.id} Approved! Signed gate QR unlocked for ${pass.name}.`);
    } catch (err) {
      console.error('Approval failed:', err);
      triggerToast('Failed to sign token: ' + err.message, 'error');
    }
  };

  const handleRejectPass = async (pass) => {
    const rejectedPass = {
      ...pass,
      status: 'REJECTED',
      rejectedAt: new Date().toISOString()
    };
    await saveLocal('gate_passes', rejectedPass);
    await queueOfflineAction('WARDEN_REJECT_PASS', rejectedPass);

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('campus_gate_pass_updated', {
        detail: { pass: rejectedPass }
      }));
    }

    setPendingPasses(pendingPasses.filter(p => p.id !== pass.id));
    triggerToast(`Pass #${pass.id} Rejected for ${pass.name}.`, 'warning');
  };

  // Dispatch a technician — hits the real assignment endpoint (master + its linked
  // student complaints all get the technician routed). Offline → buffered in outbox.
  const handleAssignTechnician = async (masterId, techName) => {
    const payload = { masterId, action: 'ASSIGN', techName };
    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (isOnline) {
      try {
        const res = await fetch('/api/technician/action', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        if (res.ok) {
          const data = await res.json();
          setClusters(clusters.map(c => (c.masterId === masterId || c.id === masterId)
            ? { ...c, status: 'IN_PROGRESS', assignedTo: data.assignedTo || techName } : c));
          triggerToast(data.message || `Master Incident ${masterId} assigned to ${techName}. Technician dispatched!`);
          refreshWardenData();
          return;
        }
      } catch (err) {
        console.warn('Dispatch failed — buffering offline:', err.message);
      }
    }
    await queueOfflineAction('TECHNICIAN_ACTION', payload);
    triggerToast('Offline: assignment buffered and will sync when connection returns.', 'warning');
  };

  // Mark Cluster Resolved (calls backend to cascade to all individual tickets)
  const handleResolveCluster = async (masterId) => {
    try {
      const res = await fetch('/api/resolve-cluster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clusterId: masterId })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.masterClusters) {
          setClusters(data.masterClusters);
        } else {
          setClusters(clusters.map(c =>
            (c.masterId === masterId || c.id === masterId)
              ? { ...c, status: 'RESOLVED', slaHoursLeft: 0 }
              : c
          ));
        }

        window.dispatchEvent(new CustomEvent('campus_tickets_updated', {
          detail: { masterClusters: data.masterClusters || clusters }
        }));

        triggerToast(`Master Incident ${masterId} marked as RESOLVED. ${data.resolvedTickets || 0} student tickets auto-resolved. Notifications dispatched!`);
      } else {
        await queueOfflineAction('TECHNICIAN_ACTION', { masterId, action: 'RESOLVE' });
        triggerToast(`Master Incident ${masterId} resolution queued (offline mode).`, 'warning');
      }
    } catch (err) {
      await queueOfflineAction('TECHNICIAN_ACTION', { masterId, action: 'RESOLVE' });
      triggerToast(`Master Incident ${masterId} marked as RESOLVED (offline).`, 'warning');
    }
  };

  // ---- Warden supervisor tool: reassign technician ----
  // (Escalation to Dean isAutomatic — handled server-side by the SLA loop at 4h breach)

  const handleReassign = async (target, technicianId) => {
    if (!technicianId) return;
    const masterId = target.masterId || target.master_incident_id || null;
    const ticketId = masterId ? null : target.id;
    const tech = technicianRoster.find(t => t.id === technicianId);
    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (isOnline) {
      try {
        const res = await fetch('/api/warden/reassign', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ masterId, ticketId, technicianId })
        });
        if (res.ok) {
          const data = await res.json();
          if (masterId) {
            setClusters(clusters.map(c => (c.masterId === masterId || c.id === masterId) ? { ...c, assignedTo: tech.name } : c));
          } else {
            setAllTickets(prev => prev.map(t => String(t.id) === String(ticketId) ? { ...t, assignedTo: tech.name } : t));
          }
          triggerToast(data.message || `Reassigned to ${tech.name}.`);
          refreshWardenData();
          return;
        }
      } catch (err) {
        console.warn('Reassign failed — buffering:', err.message);
      }
    }
    await queueOfflineAction('WARDEN_REASSIGN', { masterId, ticketId, technicianId });
    triggerToast('Reassignment buffered offline — will sync.', 'warning');
  };

  // Warden supervisor close: only available after the STUDENT confirmed the
  // fix ("job done"). Server physically refuses to close unconfirmed tickets.
  const handleCloseTicket = async (target) => {
    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (isOnline) {
      try {
        const res = await fetch(`/api/tickets/${target.id}/close`, { method: 'POST' });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.success) {
          setAllTickets(prev => prev.map(t => String(t.id) === String(target.id)
            ? { ...t, status: 'CLOSED', statusLabel: 'Closed — student confirmed, warden verified', studentConfirmed: true }
            : t));
          triggerToast(`Ticket closed after the student's "job done" confirmation.`);
          refreshWardenData();
          return;
        }
        triggerToast(data?.error || 'Close refused — the student has not confirmed yet.', 'warning');
        return;
      } catch (err) {
        console.warn('Close failed:', err.message);
      }
    }
    triggerToast('Close needs connectivity — the confirmation gate lives on the server.', 'warning');
  };

  // Live relative-time label — cloud rows carry a server-computed `time`;
  // local/offline rows compute from their own createdAt so labels never freeze.
  const ticketTimeMs = (t) => {
    if (!t) return 0;
    if (t.createdAtMs) return t.createdAtMs;
    if (t.createdAt) {
      const p = new Date(t.createdAt).getTime();
      if (!isNaN(p) && p > 0) return p;
    }
    return 0;
  };
  const ticketRelativeTime = (t) => {
    const ms = ticketTimeMs(t);
    if (!ms) return (t && t.time) || 'Recently';
    const diff = Date.now() - ms;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  // Real SLA risk: pending tickets whose 4h SLA window has <1h remaining (or already breached)
  const slaAtRiskCount = allTickets.filter(t => {
    const isPending = ['PENDING', 'IN_PROGRESS', 'ASSIGNED'].includes(String(t.status || '').toUpperCase());
    const ms = t.createdAtMs || (t.createdAt ? new Date(t.createdAt).getTime() : (t.created_at ? new Date(t.created_at).getTime() : 0));
    return isPending && ms > 0 && (Date.now() - ms) > 3 * 3600 * 1000;
  }).length;

  // Real impacted-student count from actual cluster data (not hardcoded)
  const impactedStudentsCount = clusters.reduce(
    (sum, c) => sum + (c.studentsImpacted || c.ticket_count || 0),
    0
  ) || clusters.length;

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      
      {/* Warden Top Overview Stats - 3D Colorful Stat Cards with border-2 & bigger text */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 w-full">
        <div className="bg-gradient-to-br from-[#edf9f5] to-[#e0f5ed] border-2 border-[#bbf7d0] rounded-2xl sm:rounded-3xl p-4 sm:p-5 flex flex-col justify-between shadow-[0_6px_20px_rgba(16,185,129,0.1)] hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
          <div className="flex flex-wrap items-start justify-between gap-1.5">
            <span className="text-xs sm:text-sm font-extrabold text-emerald-950 leading-snug">Pending Gate Passes</span>
            <span className="text-[10px] sm:text-xs font-mono px-2 py-0.5 rounded-full bg-emerald-200/80 text-emerald-900 font-extrabold border border-emerald-300 whitespace-nowrap">
              Sign-off
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between flex-wrap gap-1">
            <span className="text-3xl sm:text-4xl font-extrabold font-mono text-emerald-900">{pendingPasses.length}</span>
            <span className="text-[11px] sm:text-sm text-emerald-800 font-bold">Awaiting action</span>
          </div>
        </div>

        <div className="bg-gradient-to-br from-[#faf5ff] to-[#f3e8ff] border-2 border-[#e9d5ff] rounded-2xl sm:rounded-3xl p-4 sm:p-5 flex flex-col justify-between shadow-[0_6px_20px_rgba(168,85,247,0.1)] hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
          <div className="flex flex-wrap items-start justify-between gap-1.5">
            <span className="text-xs sm:text-sm font-extrabold text-purple-950 leading-snug">Master Clusters</span>
            <span className="text-[10px] sm:text-xs font-mono px-2 py-0.5 rounded-full bg-purple-200/80 text-purple-900 font-extrabold border border-purple-300 whitespace-nowrap">
              AI Grouped
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between flex-wrap gap-1">
            <span className="text-3xl sm:text-4xl font-extrabold font-mono text-purple-900">{clusters.length}</span>
            <span className="text-[11px] sm:text-sm text-purple-800 font-bold">{impactedStudentsCount} Students</span>
          </div>
        </div>

        <div className="bg-gradient-to-br from-[#fff1f2] to-[#ffe4e6] border-2 border-[#fecdd3] rounded-2xl sm:rounded-3xl p-4 sm:p-5 flex flex-col justify-between shadow-[0_6px_20px_rgba(244,63,94,0.1)] hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
          <div className="flex flex-wrap items-start justify-between gap-1.5">
            <span className="text-xs sm:text-sm font-extrabold text-rose-950 leading-snug">Critical SLA At-Risk</span>
            <span className="text-[10px] sm:text-xs font-mono px-2 py-0.5 rounded-full bg-rose-200/80 text-rose-900 font-extrabold border border-rose-300 whitespace-nowrap">
              Escalated
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between flex-wrap gap-1">
            <span className="text-3xl sm:text-4xl font-extrabold font-mono text-rose-600">{slaAtRiskCount}</span>
            <span className="text-[11px] sm:text-sm text-rose-800 font-bold">{slaAtRiskCount > 0 ? '<1h Remaining' : 'No breaches'}</span>
          </div>
        </div>

        <div className="bg-gradient-to-br from-[#eff6ff] to-[#dbeafe] border-2 border-[#bfdbfe] rounded-2xl sm:rounded-3xl p-4 sm:p-5 flex flex-col justify-between shadow-[0_6px_20px_rgba(59,130,246,0.1)] hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
          <div className="flex flex-wrap items-start justify-between gap-1.5">
            <span className="text-xs sm:text-sm font-extrabold text-blue-950 leading-snug">Avg Resolution Time</span>
            <span className="text-[10px] sm:text-xs font-mono px-2 py-0.5 rounded-full bg-blue-200/80 text-blue-900 font-extrabold border border-blue-300 whitespace-nowrap">
              Target: 4h
            </span>
          </div>
          <div className="mt-2.5 flex items-baseline justify-between flex-wrap gap-1">
            <span className="text-3xl sm:text-4xl font-extrabold font-mono text-blue-950">3.2<span className="text-xl font-normal text-blue-800">h</span></span>
            <span className="text-[11px] sm:text-sm text-blue-800 font-bold">Within SLA</span>
          </div>
        </div>
      </section>

      {/* Navigation Tabs — Quick-Action tile grid (like the student dashboard,
          a size smaller): every tab is a compact colored card, so nothing
          ever hides behind a horizontal scroll on phones */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <button
          onClick={() => setActiveTab('tickets')}
          className={`flex items-center gap-2.5 rounded-xl border p-2 text-left transition-all cursor-pointer ${
            activeTab === 'tickets'
              ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-300/40'
              : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
          }`}
        >
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${activeTab === 'tickets' ? 'bg-amber-600 text-white' : 'bg-amber-100 text-amber-600'}`}>
            <Wrench className="w-4 h-4" />
          </span>
          <span className={`text-[11px] font-bold leading-tight ${activeTab === 'tickets' ? 'text-amber-900' : 'text-slate-700'}`}>
            Reported Student Issues ({allTickets.length})
          </span>
        </button>

        <button
          onClick={() => setActiveTab('clusters')}
          className={`flex items-center gap-2.5 rounded-xl border p-2 text-left transition-all cursor-pointer ${
            activeTab === 'clusters'
              ? 'bg-purple-50 border-purple-400 ring-2 ring-purple-300/40'
              : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
          }`}
        >
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${activeTab === 'clusters' ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-600'}`}>
            <Layers className="w-4 h-4" />
          </span>
          <span className={`text-[11px] font-bold leading-tight ${activeTab === 'clusters' ? 'text-purple-900' : 'text-slate-700'}`}>
            Spatial Master Incidents ({clusters.length})
          </span>
        </button>

        <button
          onClick={() => setActiveTab('passes')}
          className={`flex items-center gap-2.5 rounded-xl border p-2 text-left transition-all cursor-pointer ${
            activeTab === 'passes'
              ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-300/40'
              : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
          }`}
        >
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${activeTab === 'passes' ? 'bg-emerald-600 text-white' : 'bg-emerald-100 text-emerald-600'}`}>
            <QrCode className="w-4 h-4" />
          </span>
          <span className={`text-[11px] font-bold leading-tight ${activeTab === 'passes' ? 'text-emerald-900' : 'text-slate-700'}`}>
            Pending Passes ({pendingPasses.length})
          </span>
        </button>

        <button
          onClick={() => setActiveTab('sla')}
          className={`flex items-center gap-2.5 rounded-xl border p-2 text-left transition-all cursor-pointer ${
            activeTab === 'sla'
              ? 'bg-rose-50 border-rose-400 ring-2 ring-rose-300/40'
              : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
          }`}
        >
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${activeTab === 'sla' ? 'bg-rose-600 text-white' : 'bg-rose-100 text-rose-600'}`}>
            <Flame className="w-4 h-4" />
          </span>
          <span className={`text-[11px] font-bold leading-tight ${activeTab === 'sla' ? 'text-rose-900' : 'text-slate-700'}`}>
            SLA Aging Heatmap
          </span>
        </button>

        <button
          onClick={() => setActiveTab('register')}
          className={`flex items-center gap-2.5 rounded-xl border p-2 text-left transition-all cursor-pointer col-span-2 lg:col-span-1 ${
            activeTab === 'register'
              ? 'bg-slate-100 border-slate-700 ring-2 ring-slate-400/30'
              : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm'
          }`}
        >
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${activeTab === 'register' ? 'bg-slate-900 text-white' : 'bg-slate-200 text-slate-800'}`}>
            <ClipboardList className="w-4 h-4" />
          </span>
          <span className={`text-[11px] font-bold leading-tight ${activeTab === 'register' ? 'text-slate-900' : 'text-slate-700'}`}>
            Gate Register ({registerRows.length})
          </span>
        </button>
      </div>

      {/* --- TAB 0: ALL REPORTED STUDENT ISSUES --- */}
      {activeTab === 'tickets' && (
        <section className="bg-white/90 backdrop-blur-sm border border-slate-200/50 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Wrench className="w-5 h-5 text-amber-600" />
                <span>Student Maintenance Complaints Queue</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Real-time log of all individual issues submitted by students across hostel blocks.
              </p>
            </div>
          </div>

          {shownTickets.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
              {wq ? `No issues match "${wq}".` : 'No student maintenance issues logged yet.'}
            </div>
          ) : (
            <div className="space-y-3">
              {shownTickets.map((t) => (
                <div 
                  key={t.id}
                  className="bg-slate-50/70 border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-slate-300 transition-all"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                      <span className="font-mono text-xs font-bold text-amber-700">{t.id}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
                        {t.category}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        {t.location}
                      </span>
                    </div>

                    <div className="text-sm font-bold text-slate-900">
                      {t.title}
                    </div>

                    {t.description && (
                      <div className="text-xs text-slate-600 italic">
                        "{t.description}"
                      </div>
                    )}

                    <div className="flex items-center space-x-3 text-[11px] text-slate-500 font-mono pt-1">
                      <span className="text-amber-700 font-medium">
                        Urgency: {t.urgency || 'Normal'}
                      </span>
                      <span>•</span>
                      <span>{ticketRelativeTime(t)}</span>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0 border-t sm:border-t-0 border-slate-200 pt-3 sm:pt-0 min-w-[190px]">
                    <div className="flex flex-col items-start sm:items-end gap-1.5">
                      <span className="text-xs font-mono px-3 py-1 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-semibold">
                        {(t.statusLabel || t.status || 'REPORTED').replace(/_/g, ' ')}
                      </span>
                      {/* Real SLA countdown from the server (hidden if already escalated) */}
                      {typeof t.slaHoursLeft === 'number' && !['RESOLVED', 'CLOSED', 'ESCALATED_TO_DEAN'].includes(String(t.status).toUpperCase()) && (
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded border font-bold ${
                          t.slaState === 'breached' ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : t.slaHoursLeft < 1 ? 'bg-amber-50 text-amber-800 border-amber-300'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}>
                          <Clock className="w-3 h-3 inline mr-0.5 -mt-0.5" />
                          {t.slaState === 'breached'
                            ? `${Math.abs(t.slaHoursLeft).toFixed(1)}h OVERDUE`
                            : `${t.slaHoursLeft.toFixed(1)}h Left`}
                        </span>
                      )}
                      {t.assignedTo && (
                        <span className="text-[10px] text-sky-700 font-mono flex items-center gap-1">
                          <Wrench className="w-3 h-3" /> {t.assignedTo}
                        </span>
                      )}
                      {t.master_incident_id && (
                        <span className="text-[10px] text-purple-700 font-mono flex items-center gap-1">
                          <Layers className="w-3 h-3" /> Linked to cluster
                        </span>
                      )}
                    </div>

                    {/* Warden supervisor controls — escalation is AUTOMATIC via the
                        SLA loop (4h breach → Dean + student SMS), so no manual
                        escalate button. Warden can still reassign the crew. */}
                    <div className="flex flex-col gap-1.5">
                      {['RESOLVED', 'CLOSED'].includes(String(t.status).toUpperCase()) ? (
                        <>
                          <span className={`text-[10px] font-mono font-bold px-2 ${String(t.status).toUpperCase() === 'CLOSED' ? 'text-slate-500' : 'text-emerald-700'}`}>
                            {String(t.status).toUpperCase() === 'CLOSED' ? '✔ Closed — student confirmed, warden verified' : '✔ Resolved — student notified'}
                          </span>
                          {String(t.status).toUpperCase() === 'RESOLVED' && t.studentConfirmed && (
                            <button
                              onClick={() => handleCloseTicket(t)}
                              className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold cursor-pointer transition-colors"
                            >
                              🔒 Confirm & Close
                            </button>
                          )}
                          {String(t.status).toUpperCase() === 'RESOLVED' && !t.studentConfirmed && (
                            <span className="text-[10px] text-slate-500 font-mono px-2">
                              Awaiting student "job done" confirmation to close
                            </span>
                          )}
                        </>
                      ) : String(t.status).toUpperCase() === 'ESCALATED_TO_DEAN' ? (
                        <span className="text-[10px] text-rose-700 font-mono px-2">
                          🚨 Auto-escalated to Dean (SLA breach)
                        </span>
                      ) : (
                        <>
                          {t.studentConfirmed && (
                            <button
                              onClick={() => handleCloseTicket(t)}
                              className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-[10px] font-bold cursor-pointer transition-colors"
                            >
                              🔒 Confirm & Close
                            </button>
                          )}
                          <select
                            value=""
                            onChange={(e) => handleReassign(t, e.target.value)}
                            className="text-[11px] px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 cursor-pointer"
                          >
                            <option value="">Reassign to…</option>
                            {technicianRoster.map(r => (
                              <option key={r.id} value={r.id}>{r.name} ({r.role})</option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}
      {activeTab === 'passes' && (
        <section className="bg-white/90 backdrop-blur-sm border border-slate-200/50 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3 gap-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-emerald-600" />
                <span>Student Gate Pass Authorization Queue</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Approving creates the signed gate QR (Ed25519) that guard phones can check offline.
              </p>
            </div>
            <button
              onClick={() => setShowCreatePassModal(true)}
              className="shrink-0 px-3 sm:px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <ArrowRight className="w-3.5 h-3.5 rotate-[-90deg] sm:rotate-45" />
              <span className="hidden sm:inline">Create Pass on Behalf</span>
              <span className="sm:hidden">Create</span>
            </button>
          </div>

          {shownPasses.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
              {wq ? `No passes match "${wq}".` : 'All student gate pass requests have been processed.'}
            </div>
          ) : (
            <div className="space-y-3">
              {shownPasses.map((pass) => (
                <div 
                  key={pass.id}
                  className="bg-slate-50/50 border border-slate-200 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:border-slate-300 transition-all"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center space-x-2 flex-wrap gap-y-1">
                      <span className="font-mono text-xs font-bold text-emerald-700">{pass.id}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-medium">
                        {pass.passType}
                      </span>
                      {pass.priority && (
                        <span className="text-[10px] font-mono font-extrabold px-2 py-0.5 rounded text-rose-700 bg-rose-50 border border-rose-200 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" />
                          MEDICAL PRIORITY
                        </span>
                      )}
                      <span className="text-[10px] text-slate-500 font-mono flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        {pass.room ? `Room ${pass.room}` : (pass.destination || 'Main Campus')}
                      </span>
                    </div>

                    <div className="text-sm font-bold text-slate-900">
                      {pass.name} <span className="text-xs font-normal text-slate-500 font-mono">({pass.rollNo})</span>
                    </div>

                    <div className="text-xs text-slate-700">
                      <span className="text-slate-500 font-medium">Destination:</span> {pass.destination}
                    </div>
                    <div className="text-xs text-slate-600 italic">
                      "{pass.reason}"
                    </div>

                    <div className="flex items-center space-x-3 text-[11px] text-slate-500 font-mono pt-1">
                      <span className="flex items-center gap-1 text-amber-700 font-medium">
                        <Clock className="w-3 h-3" />
                        Valid until: {new Date(pass.validUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {pass.createdBy === 'WARDEN_ON_BEHALF' && (
                        <>
                          <span>•</span>
                          <span className="text-slate-600 font-bold">Warden-desk pass</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* 1-Tap Action Buttons */}
                  <div className="flex items-center space-x-2 shrink-0 border-t sm:border-t-0 border-slate-200 pt-3 sm:pt-0">
                    <button
                      onClick={() => handleRejectPass(pass)}
                      className="px-3.5 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-medium text-xs transition-colors cursor-pointer flex items-center space-x-1"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>
                    <button
                      onClick={() => handleApprovePass(pass)}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs transition-all cursor-pointer shadow-sm flex items-center space-x-1.5"
                    >
                      <Check className="w-4 h-4" />
                      <span>1-Tap Approve & Sign</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* --- TAB 2: SPATIAL MASTER INCIDENTS (DEDUPLICATION ENGINE) --- */}
      {activeTab === 'clusters' && (
        <section className="bg-white/90 backdrop-blur-sm border border-slate-200/50 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Layers className="w-5 h-5 text-purple-600" />
                <span>Spatial Incident Deduplication & Clustering</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Multiple individual tickets from the same block/floor are grouped into single Master Incidents to prevent redundant work.
              </p>
            </div>
          </div>

          <div className="space-y-3.5">
            {shownClusters.length === 0 && wq ? (
              <div className="py-12 text-center text-slate-500 text-xs">No clusters match "{wq}".</div>
            ) : shownClusters.map((cluster, idx) => {
              const masterId = cluster.masterId || cluster.id || `MST-CLUSTER-${idx}`;
              const impactedCount = cluster.impactedCount || cluster.studentsImpacted || (cluster.impactedRooms ? cluster.impactedRooms.length : (cluster.students ? cluster.students.length : 0));
              const roomsList = Array.isArray(cluster.students) && cluster.students.length > 0
                ? cluster.students
                : Array.isArray(cluster.impactedRooms)
                ? cluster.impactedRooms
                : [];
              const isResolved = cluster.status === 'RESOLVED';
              return (
                <div 
                  key={masterId}
                  className="bg-slate-50/50 border border-slate-200 rounded-xl p-4 space-y-3 hover:border-slate-300 transition-all"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
                    <div className="flex items-center space-x-2.5">
                      <span className="w-8 h-8 rounded-lg bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600 font-mono text-xs font-bold">
                        <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </span>
                      <div>
                        <div className="flex items-center space-x-2">
                          <span className="font-mono text-xs font-bold text-purple-700">{masterId}</span>
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-200 text-slate-700 font-medium">
                            {cluster.category}
                          </span>
                        </div>
                        <h3 className="text-sm font-bold text-slate-900 mt-0.5">{cluster.title}</h3>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-mono px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200 flex items-center gap-1 font-semibold">
                        <Users className="w-3.5 h-3.5" />
                        <span>{impactedCount} Students Impacted</span>
                      </span>
                    </div>
                  </div>

                  {/* Impacted Rooms & Location */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                    <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                      <span className="text-slate-500 block text-[11px] mb-1">Spatial Location:</span>
                      <span className="font-semibold text-slate-900 flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-purple-600" />
                        {cluster.location}
                      </span>
                    </div>

                    <div className="bg-white p-2.5 rounded-lg border border-slate-200">
                      <span className="text-slate-500 block text-[11px] mb-1">Impacted Rooms:</span>
                      <div className="flex flex-wrap gap-1">
                        {roomsList.map((stu, i) => (
                          <span key={i} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                            {stu}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Dispatch / Resolution Controls */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-200 text-xs">
                    <div className="flex items-center space-x-2 font-mono text-slate-600">
                      <span>Status:</span>
                      <span className={`px-2 py-0.5 rounded-md font-semibold text-[11px] ${
                        isResolved 
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' 
                          : cluster.assignedTo 
                          ? 'bg-sky-50 text-sky-700 border border-sky-200' 
                          : 'bg-amber-50 text-amber-700 border border-amber-200'
                      }`}>
                        {cluster.status} {cluster.assignedTo && `(${cluster.assignedTo})`}
                      </span>
                    </div>

                    <div className="flex items-center space-x-2">
                      {!isResolved && !cluster.assignedTo && (
                        <button
                          onClick={() => {
                            const match = technicianRoster.find(r => r.specialty && String(cluster.category || '').toLowerCase().split(' ').some(w => 
                              w.length > 3 && r.specialty.toLowerCase().includes(w)))
                              || technicianRoster.find(r => r.id === 'TECH-CLEAN-01');
                            handleAssignTechnician(masterId, match ? match.name : 'Technician Team A');
                          }}
                          className="px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-medium transition-all cursor-pointer text-xs flex items-center space-x-1 shadow-sm"
                        >
                          <Wrench className="w-3.5 h-3.5" />
                          <span>Dispatch Specialist</span>
                        </button>
                      )}

                      {!isResolved && (
                        <button
                          onClick={() => handleResolveCluster(cluster.masterId)}
                          className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium transition-all cursor-pointer text-xs flex items-center space-x-1 shadow-sm"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>Resolve Master Ticket</span>
                        </button>
                      )}

                      {/* Warden intervention for unassigned stuck clusters */}
                      {!isResolved && !cluster.assignedTo && (
                        <select
                          value=""
                          onChange={(e) => handleReassign(cluster, e.target.value)}
                          className="text-[11px] px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 cursor-pointer"
                        >
                          <option value="">Assign to…</option>
                          {technicianRoster.map(r => (
                            <option key={r.id} value={r.id}>{r.name} ({r.role})</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* --- TAB 3: SLA AGING HEATMAP (all values derived from live ticket/cluster data) --- */}
      {activeTab === 'sla' && (() => {
        const slaOf = (c) => (typeof c.slaHoursLeft === 'number' ? c.slaHoursLeft : 4);
        const openClusters = displayClusters.filter(c => c.status !== 'RESOLVED' && String(c.status || '').toUpperCase() !== 'CLOSED');
        const onTrack = openClusters.filter(c => slaOf(c) > 2);
        const warnZone = openClusters.filter(c => slaOf(c) <= 2 && slaOf(c) > 0);
        const breached = openClusters.filter(c => slaOf(c) <= 0);
        const breachedTickets = allTickets.filter(t =>
          ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'ESCALATED_TO_DEAN'].includes(String(t.status || '').toUpperCase()) && t.slaState === 'breached'
        );
        return (
          <section className="bg-white/90 backdrop-blur-sm border border-slate-200/80 rounded-3xl p-4 sm:p-6 space-y-5 shadow-xs">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Flame className="w-5 h-5 text-rose-600" />
                <span>SLA Aging Heatmap & Escalation Matrix</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Live countdown from the single SLA engine — anything breached here auto-escalates to the Dean every 60s server tick.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* On Track (>2h left) */}
            <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-4 space-y-3 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>On Track (&gt;2h Left)</span>
                  </span>
                  <span className="text-xs font-mono font-bold text-emerald-800 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded">
                    {onTrack.length} Active
                  </span>
                </div>
                <p className="text-[11px] text-emerald-700 leading-relaxed">
                  Incidents with healthy turnaround buffers. Maintenance crew dispatched.
                </p>
              </div>

              <div className="space-y-1.5 pt-2 border-t border-emerald-200 text-xs">
                {onTrack.slice(0, 2).map((c, i) => (
                  <div key={i} className="bg-white p-2 rounded-lg border border-emerald-100 flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-800 truncate">{c.title || c.category}</span>
                    <span className="font-mono text-emerald-700 font-bold ml-2">{Math.max(slaOf(c), 0).toFixed(1)}h</span>
                  </div>
                ))}
                {onTrack.length === 0 && <p className="text-[11px] text-emerald-700 italic">Nothing in this zone right now.</p>}
              </div>
            </div>

            {/* Approaching Deadline (<1h left) */}
            <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-4 space-y-3 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                    <Clock className="w-4 h-4 text-amber-600" />
                    <span>Approaching Deadline (&lt;1h)</span>
                  </span>
                  <span className="text-xs font-mono font-bold text-amber-800 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded">
                    {warnZone.length} Warning
                  </span>
                </div>
                <p className="text-[11px] text-amber-700 leading-relaxed">
                  Nearing SLA threshold. High-priority SMS alert triggered to lead electrician.
                </p>
              </div>
              <div className="space-y-1.5 pt-2 border-t border-amber-200 text-xs">
                {warnZone.slice(0, 2).map((c, i) => (
                  <div key={i} className="bg-white p-2 rounded-lg border border-amber-100 flex items-center justify-between text-[11px]">
                    <span className="font-semibold text-slate-800 truncate">{c.title || c.category}</span>
                    <span className="font-mono text-amber-700 font-bold ml-2">{Math.max(slaOf(c), 0).toFixed(1)}h</span>
                  </div>
                ))}
                {warnZone.length === 0 && <p className="text-[11px] text-amber-700 italic">Nothing in this zone right now.</p>}
              </div>
            </div>

            {/* Critical / Overdue (0h left) */}
            <div className="bg-rose-50/80 border-2 border-rose-400 rounded-xl p-4 space-y-3 flex flex-col justify-between relative overflow-hidden">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-rose-800 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-rose-600 animate-bounce" />
                    <span>Critical / Overdue (0h Left)</span>
                  </span>
                  <span className="text-xs font-mono font-bold text-rose-800 bg-rose-100 border border-rose-200 px-2 py-0.5 rounded">
                    {breached.length + breachedTickets.length} Critical
                  </span>
                </div>
                <p className="text-[11px] text-rose-700 leading-relaxed">
                  SLA breached! High impact incident requires immediate Dean intervention.
                </p>
              </div>

              <div className="space-y-2 pt-2 border-t border-rose-200">
                {breached.concat(breachedTickets).slice(0, 2).map((c, i) => (
                  <div key={i} className="bg-white p-2.5 rounded-lg border border-rose-200 space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-rose-900 truncate">{c.title || c.category}</span>
                      <span className="font-mono text-rose-600 font-bold text-[11px]">{Math.abs(slaOf(c)).toFixed(1)}h (BREACHED)</span>
                    </div>
                    {(c.studentsImpacted || c.impactedRooms) && (
                      <span className="text-[10px] text-slate-500 block">
                        {c.studentsImpacted || c.impactedRooms?.length || 0} Students Impacted
                      </span>
                    )}
                  </div>
                ))}
                {breached.length + breachedTickets.length === 0 && (
                  <p className="text-[11px] text-rose-700 italic">No SLA breaches. Clean board.</p>
                )}
              </div>
            </div>
          </div>
        </section>
        );
      })()}

      {activeTab === 'register' && (
        <section className="bg-white/90 backdrop-blur-sm border border-slate-200/50 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <ClipboardList className="w-5 h-5 text-slate-900" />
                <span>Main Gate Security Register</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Append-only log of every EXIT and RETURN scan — nothing here is editable, this replaces the paper register.
              </p>
            </div>
            {(() => {
              const today = new Date().toDateString();
              // Commute rows belong to the Day-Scholar register (below) — the
              // pass register stays pure outing analytics.
              const gateRows = registerRows.filter(r => {
                const c = String(r.category || '').toUpperCase();
                return c !== 'COMMUTE' && c !== 'LEAVE';
              });
              const todayRows = gateRows.filter(r => r.scanned_at && new Date(r.scanned_at).toDateString() === today);
              const exits = todayRows.filter(r => r.direction === 'EXIT').length;
              const returns = todayRows.filter(r => r.direction === 'RETURN').length;
              const late = todayRows.filter(r => r.late_return).length;
              // STILL OUT (per-pass matching, never a naive exits-minus-returns):
              // a pass is outside iff its LATEST scan (any day) is an EXIT with
              // no RETURN after it — this also catches last-night carry-overs
              // and can never go negative.
              const lastByPass = new Map();
              gateRows.forEach(r => { if (r.pass_ref) lastByPass.set(r.pass_ref, r); });
              const outNow = Array.from(lastByPass.values()).filter(r => r.direction === 'EXIT').length;
              return (
                <div className="flex items-center gap-2 flex-wrap shrink-0">
                  <span className="text-[11px] font-mono font-bold text-amber-800 bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-full">{exits} Exits Today</span>
                  <span className="text-[11px] font-mono font-bold text-emerald-800 bg-emerald-100 border border-emerald-200 px-2.5 py-1 rounded-full">{returns} Returns Today</span>
                  <span className={`text-[11px] font-mono font-bold px-2.5 py-1 rounded-full border ${outNow > 0 ? 'text-slate-800 bg-slate-100 border-slate-200' : 'text-slate-500 bg-slate-50 border-slate-200'}`}>{outNow} Still Out</span>
                  {late > 0 && (
                    <span className="text-[11px] font-mono font-bold text-rose-700 bg-rose-50 border border-rose-200 px-2.5 py-1 rounded-full">{late} Late Returns</span>
                  )}
                </div>
              );
            })()}
          </div>

          {!registerOk ? (
            <div className="py-10 text-center text-slate-500 text-xs space-y-2">
              <ClipboardList className="w-8 h-8 text-slate-300 mx-auto mb-1" />
              <p className="font-semibold text-slate-600">Register table not connected yet</p>
              <p className="text-[11px]">Run the <code className="font-mono bg-slate-100 px-1.5 py-0.5 rounded">pass_scans</code> CREATE TABLE snippet in the Supabase SQL Editor, then reopen this tab.</p>
            </div>
          ) : registerRows.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              <ClipboardList className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
              No gate scans recorded yet. Entries appear when the guard scans QRs or enters pass numbers.
            </div>
          ) : wq && shownRegister.filter(r => {
            const c = String(r.category || '').toUpperCase();
            return c !== 'COMMUTE' && c !== 'LEAVE';
          }).length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs">
              <ClipboardList className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              No gate scans match "{wq}".
            </div>
          ) : (
            <div className="space-y-2">
              {shownRegister.filter(r => {
                const c = String(r.category || '').toUpperCase();
                return c !== 'COMMUTE' && c !== 'LEAVE';
              }).map((row) => {
                const isExit = row.direction === 'EXIT';
                return (
                  <div key={row.id} className="bg-slate-50/60 border border-slate-200 rounded-xl px-3.5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                    {/* Direction badge */}
                    <span className={`shrink-0 text-[10px] font-mono font-extrabold px-2.5 py-1 rounded-full w-fit ${
                      isExit
                        ? 'text-amber-800 bg-amber-100 border border-amber-200'
                        : 'text-emerald-800 bg-emerald-100 border border-emerald-200'
                    }`}>
                      {isExit ? '↑ OUT (EXIT)' : '↓ IN (RETURN)'}
                    </span>

                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-slate-900 truncate">
                        {row.student_name || 'Student'}
                        <span className="text-[11px] font-normal text-slate-500 font-mono"> ({row.student_roll})</span>
                        <span className="ml-2 text-[10px] font-mono text-emerald-700 font-bold">{row.pass_ref}</span>
                      </div>
                      <div className="text-[11px] text-slate-600 font-medium flex items-center gap-2 flex-wrap mt-0.5">
                        <span className="truncate">{row.destination || '—'}</span>
                        <span>•</span>
                        <span>{row.category || 'Day Pass'}</span>
                        {row.late_return && (
                          <span className="text-[9px] font-mono font-extrabold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                            LATE RETURN
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-2 text-[10px] font-mono text-slate-500 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded font-bold ${
                        row.method === 'MANUAL'
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'bg-slate-100 text-slate-600 border border-slate-200'
                      }`}>
                        {row.method === 'MANUAL' ? 'GP# MANUAL' : 'QR SCAN'}
                      </span>
                      <span>by {row.scanned_by || 'Guard'}</span>
                      <span className="font-bold text-slate-700">
                        {row.scanned_at ? new Date(row.scanned_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* NOTE: the Day-Scholar Leave Register deliberately does NOT live here.
          Day-scholar in/out history is a mentor-welfare concern — it shows in
          the Faculty Mentor Console (teacher dash), scoped server-side to each
          mentor's own mentees. The warden keeps the hosteller pass register. */}
      <WardenCreatePassModal
        isOpen={showCreatePassModal}
        onClose={() => setShowCreatePassModal(false)}
      />

    </div>
  );
}

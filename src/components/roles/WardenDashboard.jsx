import React, { useState, useEffect, useRef } from 'react';
import CleaningPanel from '../CleaningPanel';
import FeePaymentsPanel from '../FeePaymentsPanel';
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
  ClipboardList,
  Phone,
  Receipt
} from 'lucide-react';
import AiCategoryChip from '../AiCategoryChip';
import { WardenTicketLifecycle, hasLifecycle, ticketCode } from '../TicketLifecycle';
import { generateSignedPassToken } from '../../utils/crypto';
import { getAllLocal, saveLocal, queueOfflineAction } from '../../utils/db';
import { getAccessToken } from '../../utils/authClient';
import { notifyGatePassApproved } from '../../utils/notifications';
import WardenCreatePassModal from '../modals/WardenCreatePassModal';
import WardenHome, { latestScanByPass } from './WardenHome';
import { isPageHidden, onPageActive, POLL_ACTIVE_MS, POLL_IDLE_MS } from '../../utils/livePoll';
import { getLiveUpdates } from '../../utils/liveUpdates';

// NO seeded demo data — the warden queue only shows REAL passes/tickets/clusters
// created by actual student activity (IndexedDB + Supabase via /api/dashboard-data).
const INITIAL_PENDING_PASSES = [];
const INITIAL_CLUSTERS = [];

// Shared empty state for the dashboard cards: tinted icon circle + title (+ optional subline),
// centred in the card (fills the card height on laptop where rows are equal height).
const EMPTY_TONES = {
  emerald: 'bg-emerald-50 text-emerald-600 ring-emerald-100',
  purple: 'bg-purple-50 text-purple-600 ring-purple-100',
};
function CardEmptyState({ icon: Icon = CheckCircle2, tone = 'emerald', title, sub }) {
  return (
    <div className="flex-1 min-h-[200px] flex flex-col items-center justify-center text-center px-4 py-10">
      <span className={`w-14 h-14 rounded-full ring-8 flex items-center justify-center mb-4 ${EMPTY_TONES[tone] || EMPTY_TONES.emerald}`}>
        <Icon className="w-7 h-7" />
      </span>
      <p className="text-sm font-semibold text-slate-700 max-w-xs">{title}</p>
      {sub && <p className="text-xs text-slate-500 mt-1 max-w-xs">{sub}</p>}
    </div>
  );
}

export default function WardenDashboard({ onNotification, masterClusters = [], searchQuery = '', session = null }) {
  const [pendingPasses, setPendingPasses] = useState(INITIAL_PENDING_PASSES);
  const [clusters, setClusters] = useState(
    masterClusters.length > 0 ? masterClusters : INITIAL_CLUSTERS
  );
  const [allTickets, setAllTickets] = useState([]);
  const [activeTab, setActiveTab] = useState('home'); // 'home' | 'tickets' | 'clusters' | 'passes' | 'sla' | 'register' | ...
  const [homePassesOpen, setHomePassesOpen] = useState(false);   // Home: show every pending pass instead of the first few
  const [cleaningFirst, setCleaningFirst] = useState(null);      // first red cleaning alert (Home row sub-line)
  const onCleaningAlerts = React.useCallback((list) => setCleaningFirst(list && list[0] ? `${list[0].block} · Room ${list[0].room}` : null), []);
  const [isLaptop, setIsLaptop] = useState(() => typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(min-width: 1280px)').matches : false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(min-width: 1280px)');
    const on = () => setIsLaptop(mq.matches);
    mq.addEventListener ? mq.addEventListener('change', on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener('change', on) : mq.removeListener(on); };
  }, []);
  const [technicianRoster, setTechnicianRoster] = useState([]);   // active technicians (reassign dropdown)
  const [cleaningAlerts, setCleaningAlerts] = useState(0);        // red alerts in the Cleaning panel
  const [technicians, setTechnicians] = useState([]);             // Technicians panel (DB rows + workload)
  const [techError, setTechError] = useState(null);               // "Technician list unavailable"
  const [techLoaded, setTechLoaded] = useState(false);
  const [closingId, setClosingId] = useState(null);
  const [registerRows, setRegisterRows] = useState([]);
  const [registerOk, setRegisterOk] = useState(false);
  const [showCreatePassModal, setShowCreatePassModal] = useState(false);
  // Long lists show the first few rows + "View all" (layout only).
  const [showAll, setShowAll] = useState({});

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
          // Technicians come ONLY from the database — no built-in list.
          setTechnicianRoster(Array.isArray(data.technicianRoster) ? data.technicianRoster : []);
          setTechnicians(Array.isArray(data.technicians) ? data.technicians : []);
          setTechError(data.techniciansError || (Array.isArray(data.technicians) ? null : 'Technician list unavailable'));
          setTechLoaded(true);
          if (data.tickets && data.tickets.length > 0) {
            setAllTickets(prev => {
              // server rows last so a fresh lifecycle state wins over an older copy
              const combined = [...prev, ...data.tickets];
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

  // Fix 2 (polling): was every 3 s. Now every 15 s while passes are waiting
  // for a decision, every 30 s when the queue is empty, paused while the tab
  // is hidden, and refreshed at once when the warden comes back to the tab.
  const pendingCountRef = useRef(0);
  useEffect(() => { pendingCountRef.current = pendingPasses.length; }, [pendingPasses]);

  useEffect(() => {
    refreshWardenData();

    let lastPollAt = Date.now();
    const pollNow = () => {
      lastPollAt = Date.now();
      refreshWardenData();
    };
    const pollInterval = setInterval(() => {
      if (isPageHidden() || !getLiveUpdates()) return; // Settings → Live updates
      const every = pendingCountRef.current > 0 ? POLL_ACTIVE_MS : POLL_IDLE_MS;
      if (Date.now() - lastPollAt >= every) pollNow();
    }, 3000);
    const offPageActive = onPageActive(pollNow);

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
      offPageActive();
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

  const [rejectTarget, setRejectTarget] = useState(null); // pass awaiting the Reject confirm step
  const handleRejectPass = (pass) => setRejectTarget(pass);
  const doRejectPass = async (pass) => {
    const rejectedPass = {
      ...pass,
      status: 'REJECTED',
      rejectedAt: new Date().toISOString()
    };
    await saveLocal('gate_passes', rejectedPass);

    // Fix 3 (lost rejection): tell the server right away, exactly like the
    // approve button does. Before, the rejection only went to the outbox,
    // which had no route for it — the server copy stayed PENDING, the pass
    // came back into this queue on the next refresh and the student never
    // saw "Rejected".
    try {
      await fetch('/api/create-pass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passData: rejectedPass })
      });
    } catch (netErr) {
      console.warn('Warden reject sync failed, saved locally:', netErr);
    }

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

  // One-tap Dispatch for an incident: the category's technician from the DB list — never a made-up name.
  // Used by the incident card and by the Home "no technician" row (same call either way).
  const dispatchSpecialist = (cluster, masterIdArg) => {
    const masterId = masterIdArg || cluster.masterId || cluster.id;
    const match = technicianRoster.find(r => r.category === cluster.category);
    if (!match) { triggerToast(techError ? 'Technician list unavailable — try again shortly.' : `No technician for ${cluster.category || 'this category'} — pick one from "Assign to…".`, 'warning'); return; }
    handleAssignTechnician(masterId, match.name);
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

        triggerToast(data.message || `Master Incident ${masterId} marked resolved. Each student confirms their own complaint before you close it.`);
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
            setAllTickets(prev => prev.map(t => String(t.id) === String(ticketId)
              ? { ...t, assignedTo: tech.name, assignedTechId: tech.id, technician: tech, assignedBy: data.assignedBy || 'Warden', assignedAt: new Date().toISOString(), smsStatus: data.smsStatus || t.smsStatus, smsKind: 'reassign' }
              : t));
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

  // Warden close: the button only exists once the STUDENT marked the
  // complaint Resolved; the server refuses (403) otherwise.
  const handleCloseTicket = async (target) => {
    const isOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
    if (!isOnline) {
      triggerToast('Close needs connectivity — the Resolved check lives on the server.', 'warning');
      return;
    }
    setClosingId(target.id);
    try {
      const res = await fetch(`/api/tickets/${target.id}/close`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        setAllTickets(prev => prev.map(t => String(t.id) === String(target.id)
          ? { ...t, ...(data.ticket || { status: 'CLOSED', lifecycleStage: 'CLOSED', closedAt: data.closedAt, closedBy: data.closedBy }) }
          : t));
        triggerToast(`Complaint ${ticketCode(target)} closed.`);
        refreshWardenData();
      } else {
        triggerToast(data?.error || 'Close refused — the student has not marked it Resolved yet.', 'warning');
      }
    } catch (err) {
      console.warn('Close failed:', err.message);
      triggerToast('Close failed — check the connection and try again.', 'warning');
    } finally {
      setClosingId(null);
    }
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

  // ONE critical-SLA counter for the whole screen (top card, section chip
  // and the heatmap's "Critical" column all read this): open clusters whose
  // SLA is used up + open/escalated tickets the SLA engine marks breached.
  const slaOfCluster = (c) => (typeof c.slaHoursLeft === 'number' ? c.slaHoursLeft : 4);
  const openClustersAll = displayClusters.filter(c => c.status !== 'RESOLVED' && String(c.status || '').toUpperCase() !== 'CLOSED');
  const breachedClustersAll = openClustersAll.filter(c => slaOfCluster(c) <= 0);
  const breachedTicketsAll = allTickets.filter(t =>
    ['PENDING', 'ASSIGNED', 'IN_PROGRESS', 'ESCALATED_TO_DEAN'].includes(String(t.status || '').toUpperCase()) && t.slaState === 'breached'
  );
  const slaAtRiskCount = breachedClustersAll.length + breachedTicketsAll.length;

  // Real average resolution time: resolved/closed tickets in the loaded list,
  // created_at → last update (updated_at is bumped by the DB trigger when the
  // ticket is resolved/closed). null = nothing resolved yet → tile says so.
  const avgResolutionHours = (() => {
    const done = allTickets.map(t => {
      if (!['RESOLVED', 'CLOSED'].includes(String(t.status || '').toUpperCase())) return null;
      const start = t.createdAtMs || (t.created_at ? new Date(t.created_at).getTime() : 0);
      const end = t.updated_at ? new Date(t.updated_at).getTime() : 0;
      return start > 0 && end > start ? (end - start) / 3600000 : null;
    }).filter(h => h !== null);
    return done.length ? done.reduce((a, b) => a + b, 0) / done.length : null;
  })();

  // Real impacted-student count from actual cluster data (not hardcoded)
  const impactedStudentsCount = clusters.reduce(
    (sum, c) => sum + (c.studentsImpacted || c.ticket_count || 0),
    0
  ) || clusters.length;

  // Section switcher chips (layout only): phone/tablet = tabs (only the active card shows);
  // laptop (xl) = all cards visible, a chip scrolls to its card.
  const sectionChips = [
    { tab: 'home', id: 'wd-home', label: 'Home', count: null, dot: 'bg-indigo-500', hot: false },
    { tab: 'passes', id: 'wd-passes', label: 'Pending Passes', count: pendingPasses.length, dot: 'bg-emerald-500', hot: pendingPasses.length > 0, hotCls: 'bg-emerald-600 text-white' },
    { tab: 'tickets', id: 'wd-tickets', label: 'Student Issues', count: allTickets.length, dot: 'bg-amber-500', hot: false },
    { tab: 'technicians', id: 'wd-technicians', label: 'Technicians', count: techError ? '!' : technicians.filter(t => t.active).length, dot: 'bg-sky-500', hot: !!techError, hotCls: 'bg-rose-600 text-white' },
    { tab: 'cleaning', id: 'wd-cleaning', label: 'Cleaning', count: cleaningAlerts > 0 ? cleaningAlerts : null, dot: 'bg-cyan-500', hot: cleaningAlerts > 0, hotCls: 'bg-rose-600 text-white' },
    { tab: 'clusters', id: 'wd-clusters', label: 'Master Incidents', count: clusters.length, dot: 'bg-purple-500', hot: false },
    { tab: 'sla', id: 'wd-sla', label: 'SLA Heatmap', count: slaAtRiskCount > 0 ? slaAtRiskCount : null, dot: 'bg-rose-500', hot: slaAtRiskCount > 0, hotCls: 'bg-rose-600 text-white' },
    { tab: 'register', id: 'wd-register', label: 'Gate Register', count: registerRows.length, dot: 'bg-slate-700', hot: false },
    { tab: 'fees', id: 'wd-fees', label: 'Fee Payments', count: null, dot: 'bg-emerald-500', hot: false }
  ];
  const jumpToSection = (c) => {
    if (!c) return;
    setActiveTab(c.tab);
    if (c.tab === 'home') { requestAnimationFrame(() => window.scrollTo?.({ top: 0 })); return; }
    requestAnimationFrame(() => {
      const el = document.getElementById(c.id);
      if (!el) return;
      const isLaptop = window.matchMedia('(min-width: 1280px)').matches;
      if (isLaptop || el.getBoundingClientRect().top < 124) el.scrollIntoView({ behavior: isLaptop ? 'smooth' : 'auto', block: 'start' });
    });
  };
  const isHome = activeTab === 'home';
  const tabCls = (tab) => (activeTab === tab ? '' : 'max-xl:hidden');
  const PREVIEW = { passes: 5, tickets: 4, clusters: 3, register: 6 };
  const shownGateRows = shownRegister.filter(r => {
    const c = String(r.category || '').toUpperCase();
    return c !== 'COMMUTE' && c !== 'LEAVE';
  });
  const preview = (key, list) => (wq || showAll[key] ? list : list.slice(0, PREVIEW[key]));
  const toggleAll = (key) => setShowAll(v => ({ ...v, [key]: !v[key] }));
  const viewAllCls = 'w-full min-h-[44px] rounded-xl border text-xs font-bold transition-colors cursor-pointer';

  // ---- Home ("Needs you now") numbers: all derived from data this screen already loads ----
  const homeGreeting = (() => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; })();
  const homeGate = (() => {
    const today = new Date().toDateString();
    const gateRows = registerRows.filter(r => { const c = String(r.category || '').toUpperCase(); return c !== 'COMMUTE' && c !== 'LEAVE'; });
    const todayRows = gateRows.filter(r => r.scanned_at && new Date(r.scanned_at).toDateString() === today);
    // STILL OUT: same per-pass rule as the Gate Register header — a pass is outside iff its latest scan is an EXIT.
    const outRows = latestScanByPass(gateRows).filter(r => r.direction === 'EXIT' && r.scanned_at)
      .sort((a, b) => new Date(a.scanned_at).getTime() - new Date(b.scanned_at).getTime());
    const lateRows = todayRows.filter(r => r.late_return);
    const lateNames = Array.from(new Set(lateRows.map(r => r.student_name || r.student_roll).filter(Boolean)));
    return {
      exits: todayRows.filter(r => r.direction === 'EXIT').length,
      returns: todayRows.filter(r => r.direction === 'RETURN').length,
      late: lateRows.length,
      lateSub: lateNames.length ? `${lateNames[0]}${lateNames.length > 1 ? ` and ${lateNames.length - 1} more` : ''} · see gate register` : 'See gate register',
      outNow: outRows.length,
      outRows,
    };
  })();
  const homeOverdue = (() => {
    const list = breachedTicketsAll;
    const t = list[0];
    return {
      count: list.length,
      sub: t ? [t.title || t.category, t.location, typeof t.slaHoursLeft === 'number' ? `${Math.abs(t.slaHoursLeft).toFixed(1)}h overdue` : null].filter(Boolean).join(' · ') : '',
    };
  })();
  const homeUnassigned = (() => {
    const list = openClustersAll.filter(c => !c.assignedTo && !c.technician);
    const c = list[0];
    const n = c ? (c.impactedCount || c.studentsImpacted || c.ticket_count || 0) : 0;
    return {
      count: list.length,
      first: list.length === 1 ? c : null,
      sub: c ? [c.category, c.location, n ? `${n} students` : null].filter(Boolean).join(' · ') + (list.length > 1 ? ` · +${list.length - 1} more` : '') : '',
    };
  })();

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      
      {/* Home (proposal A "Needs you now"): the default screen. Every other section keeps its own KPI strip + chip bar below. */}
      {isHome && (
        <WardenHome
          session={session}
          greeting={homeGreeting}
          dateLabel={new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
          passes={shownPasses}
          passCount={pendingPasses.length}
          wq={wq}
          gate={homeGate}
          registerOk={registerOk}
          chips={sectionChips}
          isLaptop={isLaptop}
          overdue={homeOverdue}
          unassigned={homeUnassigned}
          cleaning={{ count: cleaningAlerts, sub: cleaningFirst }}
          onApprove={handleApprovePass}
          onReject={handleRejectPass}
          onJump={jumpToSection}
          onCreatePass={() => setShowCreatePassModal(true)}
          onDispatch={dispatchSpecialist}
          passesOpen={homePassesOpen}
          onTogglePasses={() => setHomePassesOpen(v => !v)}
        />
      )}

      {/* Warden overview — slim KPI strip (same four numbers, compact so the queues start higher) */}
      {!isHome && (
      <section className="grid grid-cols-2 xl:grid-cols-4 gap-2 sm:gap-3 w-full">
        <div className="bg-gradient-to-br from-[#edf9f5] to-[#e0f5ed] border border-[#bbf7d0] rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <span className="block text-[11px] sm:text-xs font-extrabold text-emerald-950 leading-snug">Pending Gate Passes</span>
            <span className="block text-[10px] sm:text-[11px] text-emerald-800 font-bold leading-snug">Awaiting action · <span className="font-mono whitespace-nowrap">Sign-off</span></span>
          </div>
          <span className="text-2xl sm:text-3xl font-extrabold font-mono text-emerald-900 shrink-0">{pendingPasses.length}</span>
        </div>

        <div className="bg-gradient-to-br from-[#faf5ff] to-[#f3e8ff] border border-[#e9d5ff] rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <span className="block text-[11px] sm:text-xs font-extrabold text-purple-950 leading-snug">Master Clusters</span>
            <span className="block text-[10px] sm:text-[11px] text-purple-800 font-bold leading-snug">{impactedStudentsCount} Students · <span className="font-mono whitespace-nowrap">Auto-grouped</span></span>
          </div>
          <span className="text-2xl sm:text-3xl font-extrabold font-mono text-purple-900 shrink-0">{clusters.length}</span>
        </div>

        <div className="bg-gradient-to-br from-[#fff1f2] to-[#ffe4e6] border border-[#fecdd3] rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <span className="block text-[11px] sm:text-xs font-extrabold text-rose-950 leading-snug">Critical SLA At-Risk</span>
            <span className="block text-[10px] sm:text-[11px] text-rose-800 font-bold leading-snug">{slaAtRiskCount > 0 ? 'SLA breached' : 'No breaches'} · <span className="font-mono">Escalated</span></span>
          </div>
          <span className="text-2xl sm:text-3xl font-extrabold font-mono text-rose-600 shrink-0">{slaAtRiskCount}</span>
        </div>

        <div className="bg-gradient-to-br from-[#eff6ff] to-[#dbeafe] border border-[#bfdbfe] rounded-2xl px-3 py-2.5 sm:px-4 sm:py-3 flex items-center justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <span className="block text-[11px] sm:text-xs font-extrabold text-blue-950 leading-snug">Avg Resolution Time</span>
            <span className="block text-[10px] sm:text-[11px] text-blue-800 font-bold leading-snug">{avgResolutionHours === null ? 'No resolved tickets yet' : avgResolutionHours <= 4 ? 'Within SLA' : 'Above SLA'} · <span className="font-mono whitespace-nowrap">Target: 4h</span></span>
          </div>
          <span className="text-2xl sm:text-3xl font-extrabold font-mono text-blue-950 shrink-0">{avgResolutionHours === null ? '—' : avgResolutionHours < 10 ? avgResolutionHours.toFixed(1) : Math.round(avgResolutionHours)}{avgResolutionHours !== null && <span className="text-base font-normal text-blue-800">h</span>}</span>
        </div>
      </section>
      )}

      {/* Section switcher — tap a chip to jump to that section (layout only) */}
      {!isHome && (
      <nav aria-label="Dashboard sections" className="sticky top-[51px] sm:top-[54px] z-20 -mx-3 sm:-mx-5 lg:-mx-6 px-3 sm:px-5 lg:px-6 py-2 bg-[#F1F5F9]/90 backdrop-blur-md">
        <div className="flex gap-2 overflow-x-auto scrollbar-none -mx-3 px-3 sm:mx-0 sm:px-0 xl:flex-wrap">
          {sectionChips.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => jumpToSection(c)}
              aria-pressed={activeTab === c.tab}
              className={`shrink-0 min-h-[44px] inline-flex items-center gap-2 pl-3 pr-2.5 rounded-full bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 text-xs font-bold text-slate-700 whitespace-nowrap shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors cursor-pointer ${activeTab === c.tab ? 'max-xl:bg-slate-900 max-xl:border-slate-900 max-xl:text-white max-xl:hover:bg-slate-900 max-xl:shadow-md' : ''}`}
            >
              <span className={`w-2 h-2 rounded-full ${c.dot} ${activeTab === c.tab ? 'max-xl:ring-2 max-xl:ring-white' : ''}`} />
              {c.label}
              {c.count != null && (
                <span className={`min-w-[22px] h-[22px] px-1.5 rounded-full text-[11px] font-mono font-extrabold flex items-center justify-center ${c.hot ? c.hotCls : 'bg-slate-100 text-slate-600'} ${activeTab === c.tab && !c.hot ? 'max-xl:bg-white/20 max-xl:text-white' : ''}`}>
                  {c.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </nav>
      )}

      {/* Sections: phone = one column (Pending Passes first); laptop (xl) = passes + issues on the
          left, SLA heatmap + clusters on the right, Gate Register full width below */}
      <div className={isHome ? 'hidden' : 'flex flex-col gap-4 xl:grid xl:grid-cols-12'}>
        <div className="contents">

      {/* --- TAB 0: ALL REPORTED STUDENT ISSUES --- */}
        <section id="wd-tickets" className={`order-2 xl:col-span-7 xl:row-start-2 xl:flex xl:flex-col xl:max-h-[600px] scroll-mt-[124px] min-w-0 bg-white border-2 border-amber-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm ${tabCls('tickets')}`}>
          <div className="flex items-start justify-between gap-3 border-b border-amber-100 pb-3">
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-slate-900 flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-amber-100/70 text-amber-700 border border-amber-200 flex items-center justify-center shrink-0">
                  <Wrench className="w-4 h-4" />
                </span>
                <span>Student Maintenance Complaints Queue</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Real-time log of all individual issues submitted by students across hostel blocks.
              </p>
            </div>
            <span className="shrink-0 text-[11px] font-mono font-bold px-2.5 py-1 rounded-full border text-amber-800 bg-amber-50 border-amber-200">{allTickets.length}</span>
          </div>

          {shownTickets.length === 0 ? (
            <CardEmptyState title={wq ? `No issues match "${wq}".` : 'No student maintenance issues logged yet.'} />
          ) : (
            <div className="space-y-3 xl:flex-1 xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain xl:-mr-2 xl:pr-2">
              {preview('tickets', shownTickets).map((t) => {
                const statusU = String(t.status || '').toUpperCase();
                const lifecycle = hasLifecycle(t);
                const reassign = technicianRoster.length > 0 ? (
                  <select
                    value=""
                    onChange={(e) => handleReassign(t, e.target.value)}
                    aria-label="Reassign technician"
                    className="w-full min-h-[44px] text-xs px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 cursor-pointer"
                  >
                    <option value="">Reassign to…</option>
                    {technicianRoster.map(r => (
                      <option key={r.id} value={r.id}>{r.name} ({r.role})</option>
                    ))}
                  </select>
                ) : null;
                return (
                <div
                  key={t.id}
                  className="bg-slate-50/70 border border-slate-200 rounded-xl p-3.5 sm:p-4 flex flex-col gap-3 hover:border-slate-300 transition-all"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2 sm:gap-4">
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
                      <span className="font-mono text-xs font-bold text-amber-700">{lifecycle ? ticketCode(t) : t.id}</span>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-100 text-amber-800 font-semibold">
                        {t.category}
                      </span>
                      <AiCategoryChip ticket={t} />
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

                  <div className="flex flex-row flex-wrap sm:flex-col items-center sm:items-end gap-1.5 shrink-0 sm:max-w-[230px]">
                      <span className={`text-xs font-mono px-3 py-1 rounded-full border font-semibold ${
                        statusU === 'CLOSED' ? 'bg-slate-100 text-slate-700 border-slate-300'
                          : t.lifecycleStage === 'RESOLVED' ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                          : statusU === 'ESCALATED_TO_DEAN' ? 'bg-rose-50 text-rose-700 border-rose-200'
                          : 'bg-amber-50 text-amber-800 border-amber-200'
                      }`}>
                        {(t.statusLabel || t.status || 'REPORTED').replace(/_/g, ' ')}
                      </span>
                      {/* Real SLA countdown from the server (hidden once resolved/escalated) */}
                      {typeof t.slaHoursLeft === 'number' && !['RESOLVED', 'CLOSED', 'ESCALATED_TO_DEAN'].includes(statusU) && (
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
                      {t.master_incident_id && (
                        <span className="text-[10px] text-purple-700 font-mono flex items-center gap-1">
                          <Layers className="w-3 h-3" /> Linked to cluster
                        </span>
                      )}
                      {statusU === 'ESCALATED_TO_DEAN' && (
                        <span className="text-[10px] text-rose-700 font-mono">🚨 Auto-escalated to Dean (SLA breach)</span>
                      )}
                  </div>
                  </div>

                  {/* Technician + lifecycle. Close shows ONLY after the student's
                      Resolved (server enforces it too). Escalation stays automatic. */}
                  {lifecycle ? (
                    <WardenTicketLifecycle
                      ticket={t}
                      busy={closingId === t.id}
                      onClose={handleCloseTicket}
                      reassignSlot={reassign}
                    />
                  ) : (
                    <p className="text-[11px] text-slate-500 font-mono">Saved on this device only — technician and progress appear once it reaches the server.</p>
                  )}
                </div>
                );
              })}
            </div>
          )}
          {shownTickets.length > PREVIEW.tickets && !wq && (
            <button type="button" onClick={() => toggleAll('tickets')} className={`${viewAllCls} border-amber-200 bg-amber-50/50 hover:bg-amber-50 text-amber-800`}>
              {showAll.tickets ? 'Show less' : `View all (${shownTickets.length})`}
            </button>
          )}
        </section>
        <section id="wd-passes" className={`order-1 xl:col-span-7 xl:row-start-1 xl:flex xl:flex-col xl:max-h-[600px] scroll-mt-[124px] min-w-0 bg-white border-2 border-emerald-300 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm ${tabCls('passes')}`}>
          <div className="flex flex-col sm:flex-row sm:items-start justify-between border-b border-emerald-100 pb-3 gap-3">
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-slate-900 flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-emerald-100/70 text-emerald-700 border border-emerald-200 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-4 h-4" />
                </span>
                <span>Student Gate Pass Authorization Queue</span>
                <span className={`shrink-0 text-[11px] font-mono font-bold px-2.5 py-1 rounded-full border ${pendingPasses.length > 0 ? 'text-white bg-emerald-600 border-emerald-600' : 'text-slate-600 bg-slate-50 border-slate-200'}`}>{pendingPasses.length}</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Approving creates the student's secure gate QR, which guard phones can check even offline.
              </p>
            </div>
            <button
              onClick={() => setShowCreatePassModal(true)}
              className="shrink-0 w-full sm:w-auto justify-center min-h-[44px] px-3 sm:px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
            >
              <ArrowRight className="w-3.5 h-3.5 rotate-[-90deg] sm:rotate-45" />
              <span className="hidden sm:inline">Create Pass on Behalf</span>
              <span className="sm:hidden">Create</span>
            </button>
          </div>

          {shownPasses.length === 0 ? (
            <CardEmptyState title={wq ? `No passes match "${wq}".` : 'All student gate pass requests have been processed.'} />
          ) : (
            <div className="space-y-3 xl:flex-1 xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain xl:-mr-2 xl:pr-2">
              {preview('passes', shownPasses).map((pass) => (
                <div 
                  key={pass.id}
                  className={`border rounded-xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center xl:flex-col xl:items-stretch 2xl:flex-row 2xl:items-center justify-between gap-3 sm:gap-4 hover:border-slate-300 transition-all ${pass.priority ? 'bg-rose-50/30 border-rose-200' : 'bg-slate-50/50 border-slate-200'}`}
                >
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
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

                    <div className="flex items-center flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 font-mono pt-1">
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
                  <div className="flex items-center gap-2 shrink-0 border-t sm:border-t-0 xl:border-t 2xl:border-t-0 border-slate-200 pt-3 sm:pt-0 xl:pt-3 2xl:pt-0">
                    <button
                      onClick={() => handleRejectPass(pass)}
                      className="flex-1 sm:flex-none xl:flex-1 2xl:flex-none min-h-[44px] justify-center px-3.5 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold text-xs transition-colors cursor-pointer flex items-center space-x-1"
                    >
                      <X className="w-3.5 h-3.5" />
                      <span>Reject</span>
                    </button>
                    <button
                      onClick={() => handleApprovePass(pass)}
                      className="flex-[2] sm:flex-none xl:flex-[2] 2xl:flex-none min-h-[44px] justify-center px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition-all cursor-pointer shadow-sm flex items-center space-x-1.5"
                    >
                      <Check className="w-4 h-4" />
                      <span>1-Tap Approve & Sign</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {shownPasses.length > PREVIEW.passes && !wq && (
            <button type="button" onClick={() => toggleAll('passes')} className={`${viewAllCls} border-emerald-200 bg-emerald-50/50 hover:bg-emerald-50 text-emerald-800`}>
              {showAll.passes ? 'Show less' : `View all (${shownPasses.length})`}
            </button>
          )}
        </section>
        </div>

        <div className="contents">

      {/* --- TAB 2: SPATIAL MASTER INCIDENTS (DEDUPLICATION ENGINE) --- */}
        <section id="wd-clusters" className={`order-3 xl:order-2 xl:col-start-8 xl:col-span-5 xl:row-start-2 xl:flex xl:flex-col xl:max-h-[600px] scroll-mt-[124px] min-w-0 bg-white border-2 border-purple-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm ${tabCls('clusters')}`}>
          <div className="flex items-start justify-between gap-3 border-b border-purple-100 pb-3">
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-slate-900 flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-purple-100/70 text-purple-700 border border-purple-200 flex items-center justify-center shrink-0">
                  <Layers className="w-4 h-4" />
                </span>
                <span>Spatial Incident Deduplication & Clustering</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Multiple individual tickets from the same block/floor are grouped into single Master Incidents to prevent redundant work.
              </p>
            </div>
            <span className="shrink-0 text-[11px] font-mono font-bold px-2.5 py-1 rounded-full border text-purple-800 bg-purple-50 border-purple-200">{clusters.length}</span>
          </div>

          {shownClusters.length === 0 ? (
            <CardEmptyState
              icon={Layers}
              tone="purple"
              title={wq ? `No clusters match "${wq}".` : 'No clusters yet'}
              sub={wq ? null : 'Similar complaints will be grouped here'}
            />
          ) : (
          <div className="space-y-3.5 xl:flex-1 xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain xl:-mr-2 xl:pr-2">
            {preview('clusters', shownClusters).map((cluster, idx) => {
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
                  <div className="flex flex-col sm:flex-row sm:items-center xl:flex-col xl:items-start justify-between gap-2 border-b border-slate-200 pb-3">
                    <div className="flex items-center space-x-2.5 min-w-0">
                      <span className="w-8 h-8 rounded-lg bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600 font-mono text-xs font-bold">
                        <Layers className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                      </span>
                      <div>
                        <div className="flex items-center flex-wrap gap-x-2 gap-y-1">
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

                  {/* Lifecycle roll-up of the merged complaints (each student
                      resolves their own; the warden closes each one) */}
                  {typeof cluster.reportedCount === 'number' && cluster.reportedCount > 0 && (
                    <div className="rounded-lg bg-white border border-purple-200 px-3 py-2.5 space-y-1.5">
                      <p className="text-[12.5px] font-bold text-slate-900">
                        {cluster.reportedCount} {cluster.reportedCount === 1 ? 'student' : 'students'} reported · <span className="text-emerald-700">{cluster.resolvedCount || 0} resolved</span> · <span className="text-slate-600">{cluster.closedCount || 0} closed</span>
                      </p>
                      {cluster.technician && (
                        <p className="text-[11.5px] font-semibold text-slate-600 flex items-center gap-1.5">
                          <Wrench className="w-3.5 h-3.5 text-sky-600 shrink-0" />
                          {cluster.technician.name} · {cluster.technician.role} — texted once for the whole incident
                        </p>
                      )}
                      {Array.isArray(cluster.memberCodes) && cluster.memberCodes.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {cluster.memberCodes.map(code => (
                            <span key={code} className="text-[10.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-purple-50 text-purple-800 border border-purple-200">#{code}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Impacted Rooms & Location */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2 gap-3 text-xs">
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
                        {roomsList.length === 0 && <span className="text-xs text-slate-400">—</span>}
                      </div>
                    </div>
                  </div>

                  {/* Dispatch / Resolution Controls */}
                  <div className="flex flex-col sm:flex-row sm:items-center xl:flex-col xl:items-stretch justify-between gap-3 pt-2 border-t border-slate-200 text-xs">
                    <div className="flex items-center flex-wrap gap-2 font-mono text-slate-600">
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

                    <div className="flex flex-wrap items-stretch gap-2">
                      {!isResolved && !cluster.assignedTo && (
                        <button
                          onClick={() => dispatchSpecialist(cluster, masterId)}
                          className="flex-1 sm:flex-none xl:flex-1 min-h-[44px] justify-center px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-700 text-white font-semibold transition-all cursor-pointer text-xs flex items-center space-x-1 shadow-sm"
                        >
                          <Wrench className="w-3.5 h-3.5" />
                          <span>Dispatch Specialist</span>
                        </button>
                      )}

                      {!isResolved && cluster.assignedTo && (
                        <button
                          onClick={() => handleResolveCluster(cluster.masterId)}
                          className="flex-1 sm:flex-none xl:flex-1 min-h-[44px] justify-center px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold transition-all cursor-pointer text-xs flex items-center space-x-1 shadow-sm"
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
                          className="w-full sm:w-auto xl:w-full min-h-[44px] text-xs px-2 py-1.5 rounded-lg border border-slate-300 bg-white text-slate-700 cursor-pointer"
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
          )}
          {shownClusters.length > PREVIEW.clusters && !wq && (
            <button type="button" onClick={() => toggleAll('clusters')} className={`${viewAllCls} border-purple-200 bg-purple-50/50 hover:bg-purple-50 text-purple-800`}>
              {showAll.clusters ? 'Show less' : `View all (${shownClusters.length})`}
            </button>
          )}
        </section>

      {/* --- TAB 3: SLA AGING HEATMAP (all values derived from live ticket/cluster data) --- */}
      {(() => {
        const slaOf = slaOfCluster;
        const openClusters = openClustersAll;
        const onTrack = openClusters.filter(c => slaOf(c) > 2);
        const warnZone = openClusters.filter(c => slaOf(c) <= 2 && slaOf(c) > 0);
        const breached = breachedClustersAll;       // same counter as the top card
        const breachedTickets = breachedTicketsAll;
        return (
          <section id="wd-sla" className={`order-4 xl:order-1 xl:col-start-8 xl:col-span-5 xl:row-start-1 xl:flex xl:flex-col xl:max-h-[600px] scroll-mt-[124px] min-w-0 bg-white border-2 border-rose-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm ${tabCls('sla')}`}>
          <div className="flex items-start justify-between gap-3 border-b border-rose-100 pb-3">
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-slate-900 flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-rose-100/70 text-rose-700 border border-rose-200 flex items-center justify-center shrink-0">
                  <Flame className="w-4 h-4" />
                </span>
                <span>SLA Aging Heatmap & Escalation Matrix</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Live countdown from the single SLA engine — anything breached here auto-escalates to the Dean every 60s server tick.
              </p>
            </div>
            <span className={`shrink-0 text-[11px] font-mono font-bold px-2.5 py-1 rounded-full border ${breached.length + breachedTickets.length > 0 ? 'text-white bg-rose-600 border-rose-600' : 'text-rose-800 bg-rose-50 border-rose-200'}`}>{openClusters.length}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 xl:grid-cols-1 gap-3 sm:gap-4 xl:flex-1 xl:min-h-0 xl:overflow-y-auto xl:overscroll-contain xl:-mr-2 xl:pr-2">
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
                    <span className="font-semibold text-slate-800 min-w-0">{c.title || c.category}</span>
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
                    <span className="font-semibold text-slate-800 min-w-0">{c.title || c.category}</span>
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
                      <span className="font-bold text-rose-900 min-w-0">{c.title || c.category}</span>
                      <span className="font-mono text-rose-600 font-bold text-[11px] shrink-0 ml-2">{Math.abs(slaOf(c)).toFixed(1)}h (BREACHED)</span>
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
        </div>

        {/* --- TECHNICIANS (from the database) — who is on what, and who assigned it --- */}
        <section id="wd-technicians" className={`order-5 xl:col-span-12 xl:row-start-3 scroll-mt-[124px] min-w-0 bg-white border-2 border-sky-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm ${tabCls('technicians')}`}>
          <div className="flex items-start justify-between gap-3 border-b border-sky-100 pb-3">
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-slate-900 flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-sky-100/70 text-sky-700 border border-sky-200 flex items-center justify-center shrink-0">
                  <UserCheck className="w-4 h-4" />
                </span>
                <span>Technicians</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                One per category. New complaints go to them automatically by SMS; a complaint closes only after the student marks it Resolved.
              </p>
            </div>
            <span className="shrink-0 text-[11px] font-mono font-bold px-2.5 py-1 rounded-full border text-sky-800 bg-sky-50 border-sky-200">{technicians.filter(t => t.active).length}</span>
          </div>

          {techError ? (
            <div className="flex-1 min-h-[200px] flex flex-col items-center justify-center text-center px-4 py-10">
              <span className="w-14 h-14 rounded-full ring-8 flex items-center justify-center mb-4 bg-rose-50 text-rose-600 ring-rose-100">
                <AlertTriangle className="w-7 h-7" />
              </span>
              <p className="text-sm font-semibold text-slate-800">Technician list unavailable</p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                The server could not read the technicians table, so new complaints are saved without a technician. Complaints are not lost — assign them here once the list is back.
              </p>
            </div>
          ) : !techLoaded ? (
            <CardEmptyState icon={RefreshCw} tone="emerald" title="Loading technicians…" />
          ) : technicians.length === 0 ? (
            <CardEmptyState icon={UserCheck} title="No technicians in the database yet." sub="Add one technician per category in the technicians table." />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
              {technicians.map((tech) => {
                const s = tech.stats || {};
                const wardens = Object.entries(s.wardens || {});
                return (
                  <div key={tech.id} className={`rounded-xl border p-3.5 space-y-3 ${tech.active ? 'bg-slate-50/70 border-slate-200' : 'bg-slate-100 border-slate-200 opacity-70'}`}>
                    <div className="flex flex-wrap items-start gap-2.5 min-w-0">
                      <span className="w-10 h-10 rounded-xl bg-white border border-sky-200 text-sky-700 flex items-center justify-center shrink-0">
                        <Wrench className="w-4 h-4" />
                      </span>
                      <div className="min-w-0 flex-1 basis-[150px]">
                        <p className="text-[13.5px] font-bold text-slate-900 leading-snug">{tech.name}</p>
                        <p className="text-[11.5px] text-slate-600 font-semibold leading-snug">{tech.role} · {tech.category}</p>
                        <p className="text-[10.5px] text-slate-400 font-mono">{tech.id}{!tech.active ? ' · inactive' : ''}</p>
                      </div>
                      {tech.phone && (
                        <a href={`tel:${tech.phone}`} className="shrink-0 min-h-[44px] px-2.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-[11.5px] font-bold font-mono flex items-center justify-center gap-1.5" aria-label={`Call ${tech.name}`}>
                          <Phone className="w-3.5 h-3.5 shrink-0" />{tech.phone}
                        </a>
                      )}
                    </div>
                    <div className="grid grid-cols-4 gap-1.5 text-center">
                      {[
                        { k: 'open', label: 'Assigned', cls: 'text-amber-800 bg-amber-50 border-amber-200' },
                        { k: 'awaitingClose', label: 'Resolved, to close', cls: 'text-emerald-800 bg-emerald-50 border-emerald-200' },
                        { k: 'closed', label: 'Closed', cls: 'text-slate-700 bg-white border-slate-200' },
                        { k: 'notFixed', label: 'Not fixed', cls: 'text-rose-700 bg-rose-50 border-rose-200' }
                      ].map(c => (
                        <div key={c.k} className={`rounded-lg border px-1 py-1.5 ${c.cls}`}>
                          <div className="text-lg font-extrabold font-mono leading-none">{s[c.k] || 0}</div>
                          <div className="text-[10px] font-bold leading-tight mt-1">{c.label}</div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-600 font-semibold leading-snug">
                      {(s.total || 0) === 0
                        ? 'No complaints assigned yet.'
                        : <>Assigned by: <b>Auto {s.byAuto || 0}</b>{wardens.length > 0 && <> · {wardens.map(([n, c]) => `${n} ${c}`).join(' · ')}</>}</>}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section id="wd-cleaning" className={`order-5 xl:col-span-12 xl:row-start-4 scroll-mt-[124px] min-w-0 bg-white border-2 border-cyan-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm ${tabCls('cleaning')}`}>
          <div className="border-b border-cyan-100 pb-3">
            <h2 className="text-[15px] font-bold text-slate-900 flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-cyan-100/70 text-cyan-700 border border-cyan-200 flex items-center justify-center shrink-0">
                <Sparkles className="w-4 h-4" />
              </span>
              <span>Room Cleaning</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Students answer &quot;Was your room cleaned today?&quot; from 1 PM to 9 PM on cleaning day. A dirty room becomes one complaint for the block&apos;s cleaners.
            </p>
          </div>
          <CleaningPanel role="WARDEN" onAlertCount={setCleaningAlerts} onAlerts={onCleaningAlerts} />
        </section>

        <section id="wd-register" className={`order-6 xl:col-span-12 xl:row-start-5 scroll-mt-[124px] min-w-0 bg-white border-2 border-slate-300 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm ${tabCls('register')}`}>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
            <div className="min-w-0">
              <h2 className="text-[15px] font-bold text-slate-900 flex items-center gap-2.5">
                <span className="w-9 h-9 rounded-xl bg-slate-100 text-slate-800 border border-slate-300 flex items-center justify-center shrink-0">
                  <ClipboardList className="w-4 h-4" />
                </span>
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
              const outNow = latestScanByPass(gateRows).filter(r => r.direction === 'EXIT').length;
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
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
              {preview('register', shownGateRows).map((row) => {
                const isExit = row.direction === 'EXIT';
                return (
                  <div key={row.id} className="bg-slate-50/60 border border-slate-200 rounded-xl px-3.5 py-3 flex flex-wrap sm:flex-nowrap xl:flex-wrap 2xl:flex-nowrap items-center gap-x-3 gap-y-1.5">
                    {/* Direction badge */}
                    <span className={`order-1 shrink-0 text-[10px] font-mono font-extrabold px-2.5 py-1 rounded-full w-fit ${
                      isExit
                        ? 'text-amber-800 bg-amber-100 border border-amber-200'
                        : 'text-emerald-800 bg-emerald-100 border border-emerald-200'
                    }`}>
                      {isExit ? '↑ OUT (EXIT)' : '↓ IN (RETURN)'}
                    </span>

                    <div className="min-w-0 flex-1 order-3 basis-full sm:order-2 sm:basis-auto xl:order-3 xl:basis-full 2xl:order-2 2xl:basis-auto">
                      <div className="text-xs font-bold text-slate-900">
                        {row.student_name || 'Student'}
                        <span className="text-[11px] font-normal text-slate-500 font-mono"> ({row.student_roll})</span>
                        <span className="ml-2 text-[10px] font-mono text-emerald-700 font-bold whitespace-nowrap">{row.pass_ref}</span>
                      </div>
                      <div className="text-[11px] text-slate-600 font-medium flex items-center gap-2 flex-wrap mt-0.5">
                        <span>{row.destination || '—'}</span>
                        <span>•</span>
                        <span>{row.category || 'Day Pass'}</span>
                        {row.late_return && (
                          <span className="text-[9px] font-mono font-extrabold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                            LATE RETURN
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="order-2 ml-auto sm:order-3 sm:ml-0 xl:order-2 xl:ml-auto 2xl:order-3 2xl:ml-0 shrink-0 flex items-center gap-2 text-[10px] font-mono text-slate-500 flex-wrap justify-end">
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
          {shownGateRows.length > PREVIEW.register && !wq && (
            <button type="button" onClick={() => toggleAll('register')} className={`${viewAllCls} border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-800`}>
              {showAll.register ? 'Show less' : `View all (${shownGateRows.length})`}
            </button>
          )}
        </section>

        <section id="wd-fees" className={`order-7 xl:col-span-12 xl:row-start-6 scroll-mt-[124px] min-w-0 bg-white border-2 border-emerald-200 rounded-2xl p-4 sm:p-5 space-y-4 shadow-sm ${tabCls('fees')}`}>
          <div className="border-b border-emerald-100 pb-3">
            <h2 className="text-[15px] font-bold text-slate-900 flex items-center gap-2.5">
              <span className="w-9 h-9 rounded-xl bg-emerald-100/70 text-emerald-700 border border-emerald-200 flex items-center justify-center shrink-0">
                <Receipt className="w-4 h-4" />
              </span>
              <span>Fee Payments</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Receipts from students&apos; Settle Dues taps (demo payments, no real money moves). Read-only.
            </p>
          </div>
          <FeePaymentsPanel />
        </section>
      </div>

      {/* NOTE: the Day-Scholar Leave Register deliberately does NOT live here.
          Day-scholar in/out history is a mentor-welfare concern — it shows in
          the Faculty Mentor Console (teacher dash), scoped server-side to each
          mentor's own mentees. The warden keeps the hosteller pass register. */}
      {rejectTarget && (
        <div className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" data-testid="reject-confirm" onClick={() => setRejectTarget(null)}>
          <div className="w-full max-w-sm bg-white rounded-2xl shadow-xl p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div>
              <h3 className="font-display font-extrabold text-base text-slate-900">Reject this pass?</h3>
              <p className="text-sm text-slate-600 mt-1">{rejectTarget.name ? `${rejectTarget.name}'s ` : 'This '}pass request will be rejected and the student will be told.</p>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setRejectTarget(null)} className="flex-1 min-h-[44px] rounded-xl border border-slate-200 bg-white text-slate-700 font-bold text-sm cursor-pointer">Keep it</button>
              <button type="button" data-testid="reject-confirm-yes" onClick={() => { const p = rejectTarget; setRejectTarget(null); doRejectPass(p); }} className="flex-1 min-h-[44px] rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-sm cursor-pointer">Yes, reject</button>
            </div>
          </div>
        </div>
      )}
      <WardenCreatePassModal
        isOpen={showCreatePassModal}
        onClose={() => setShowCreatePassModal(false)}
      />

    </div>
  );
}

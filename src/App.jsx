import React, { useState, useEffect, useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import StudentDashboard from './components/roles/StudentDashboard';
import WardenDashboard from './components/roles/WardenDashboard';
import GuardScanner from './components/roles/GuardScanner';
import AdminDashboard from './components/roles/AdminDashboard';
import RequestGatePassModal from './components/modals/RequestGatePassModal';
import ViewPassQRModal from './components/modals/ViewPassQRModal';
import ReportIssueModal from './components/modals/ReportIssueModal';
import MessFeedbackModal from './components/modals/MessFeedbackModal';
import TimetableModal from './components/modals/TimetableModal';
import DocRequestModal from './components/modals/DocRequestModal';
import FeeDuesModal from './components/modals/FeeDuesModal';
import NoticesModal from './components/modals/NoticesModal';
import ProfileModal from './components/modals/ProfileModal';
import SettingsModal from './components/modals/SettingsModal';
import MealRsvpModal from './components/modals/MealRsvpModal';
import LeaveQRModal from './components/modals/LeaveQRModal';
import TeacherDashboard from './components/roles/TeacherDashboard';
import LoginScreen from './components/auth/LoginScreen';
import { isPageHidden, onPageActive, POLL_ACTIVE_MS, POLL_IDLE_MS } from './utils/livePoll';
import {
  CheckCircle2,
  WifiOff,
  X
} from 'lucide-react';
import { initDB, getAllLocal, saveLocal, deleteLocal } from './utils/db';
import { flushOutbox, getPendingSyncCount, initSyncEngine } from './utils/syncEngine';
import { getStoredProfile, clearStoredSession, getAccessToken } from './utils/authClient';
import { startNotificationPolling, stopNotificationPolling, releasePushDeviceOnSignOut } from './utils/notify';
import { pickTodaysLeave, isLeaveLive, saveLeaveSnapshot, readLeaveSnapshot } from './utils/dayScholarLeave';
import { noteServerDate } from './utils/serverClock';

// Feed demographics start EMPTY — the feed only ever shows items the user
// actually created (persisted in IndexedDB / server). No pre-seeded demos.
const INITIAL_ACTIVITIES = [];

const now = Date.now();
void now;

const SESSION_KEY = 'campusdebug_session';
const VALID_ROLES = ['Student', 'Warden', 'Guard', 'Admin', 'Teacher'];

const roleToDashboard = (role) => {
  switch (String(role || '').toUpperCase()) {
    case 'WARDEN': return 'Warden';
    case 'GUARD': return 'Guard';
    case 'ADMIN':
    case 'DEAN': return 'Admin';
    case 'TEACHER': return 'Teacher';
    default: return 'Student';
  }
};

const profileToSession = (profile) => ({
  role: roleToDashboard(profile?.role),
  profileRole: profile?.role,
  identity: profile?.rollNumber,
  name: profile?.fullName,
  room: profile?.roomNumber,
  block: profile?.hostelBlock,
  residentType: profile?.resident_type || profile?.residentType || null,
  department: profile?.department,
  course: profile?.course || null,
  section: profile?.section || null,
  attendance: profile?.attendance,
  feeDue: profile?.feeDue,
  createdAt: new Date().toISOString()
});

// Session bootstrap: prefer the real auth session (utils/authClient);
// fall back to the legacy local session key only while migrating.
const readSession = () => {
  try {
    const profile = getStoredProfile();
    if (profile) return profileToSession(profile);
  } catch { /* fall through */ }
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY));
    return session && VALID_ROLES.includes(session.role) ? session : null;
  } catch {
    return null;
  }
};

export default function App() {
  const [session, setSession] = useState(readSession);
  const [currentRole, setCurrentRole] = useState(() => readSession()?.role || null); // 'Student' | 'Warden' | 'Guard' | 'Admin'
  const [activeModal, setActiveModal] = useState(null); // 'gate_pass' | 'complaint' | 'mess' | 'view_qr' | 'profile' | 'settings' | null
  const [selectedPassToView, setSelectedPassToView] = useState(null);
  const [recentActivities, setRecentActivities] = useState(INITIAL_ACTIVITIES);
  const [toastMessage, setToastMessage] = useState(null);
  const [activePass, setActivePass] = useState(INITIAL_ACTIVITIES.find(a => a.type === 'gate_pass'));
  const [masterClusters, setMasterClusters] = useState([]);

  // Mirror of activePass for polling callbacks (avoids stale-closure reads)
  const activePassRef = useRef(activePass);
  useEffect(() => { activePassRef.current = activePass; }, [activePass]);

  // DAY-SCHOLAR ACTIVE PASS: a day scholar's gate exit is a mentor-approved
  // LEAVE (leave_requests), not a warden gate pass (gate_passes). The
  // dashboard's Active Gate Pass card used to read gate_passes only, so for
  // a day scholar it never moved PENDING → APPROVED → OUT. Keep today's leave
  // in App state and refresh it the same way the hosteller pass is kept live:
  // every 3 s while it can still change on another device (mentor decides /
  // guard scans), every 30 s otherwise, and at once on any leave event.
  const isDayScholarStudent = currentRole === 'Student'
    && String(session?.residentType || '').trim().toLowerCase() === 'dayscholar';
  const [dayLeave, setDayLeave] = useState(null);
  const dayLeaveRef = useRef(null);
  useEffect(() => { dayLeaveRef.current = dayLeave; }, [dayLeave]);
  useEffect(() => {
    if (!isDayScholarStudent) { setDayLeave(null); return undefined; }
    let alive = true;
    let ticks = 0;
    // Offline (app opened at the gate with no network): show the last saved
    // leave so an approved leave's QR is still there.
    const fromSnapshot = () => {
      if (!alive || dayLeaveRef.current) return;
      const snap = readLeaveSnapshot(getStoredProfile()?.rollNumber);
      if (snap) setDayLeave(pickTodaysLeave(snap.leaves || []).activeLeave);
    };
    const pullLeave = async () => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) { fromSnapshot(); return; }
      try {
        const res = await fetch('/api/leave-requests/mine');
        noteServerDate(res); // server clock for the rotating leave QR
        if (!res.ok) return;
        const j = await res.json();
        if (!alive || !j?.success) return;
        saveLeaveSnapshot(getStoredProfile()?.rollNumber, j);
        setDayLeave(pickTodaysLeave(j.leaves || []).activeLeave);
        // Same snapshot to an open Leave modal, so both views agree.
        window.dispatchEvent(new CustomEvent('campus_leave_state', { detail: j }));
      } catch { fromSnapshot(); /* offline or server unreachable — keep the last state */ }
    };
    pullLeave();
    const iv = setInterval(() => {
      ticks += 1;
      if (isLeaveLive(dayLeaveRef.current) || ticks % 10 === 0) pullLeave();
    }, 3000);
    const onLeaveUpdated = () => pullLeave();
    const onVisible = () => { if (document.visibilityState === 'visible') pullLeave(); };
    window.addEventListener('campus_leave_updated', onLeaveUpdated);
    window.addEventListener('focus', onLeaveUpdated);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      clearInterval(iv);
      window.removeEventListener('campus_leave_updated', onLeaveUpdated);
      window.removeEventListener('focus', onLeaveUpdated);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isDayScholarStudent, session?.identity]);

  // Mirror of the signed-in roll — loadLocalData must never show another
  // identity's passes in "My Pass"/activity feed (role switching on the
  // same device shares one IndexedDB, so storage itself is NOT per-user).
  const sessionRollRef = useRef(session?.identity || '');
  useEffect(() => { sessionRollRef.current = session?.identity || ''; }, [session?.identity]);

  // Document Desk status mirror: the registrar's verdict (server) is polled
  // for the signed-in student and overlaid onto the local DOC-xxxx feed
  // items, so "Pending Admin Verification" becomes live truth in ≤15s.
  const [docStatusMap, setDocStatusMap] = useState({});
  const docStatusMapRef = useRef({}); // syncable mirror for non-effect closures
  useEffect(() => {
    if (currentRole !== 'Student' || !session) return;
    let alive = true;
    const pull = async () => {
      try {
        if (!getAccessToken()) return;
        const r = await fetch('/api/document-requests/mine');
        if (!r.ok) return;
        const d = await r.json();
        if (!alive || !d?.success) return;
        const myRoll = String((getStoredProfile() || {}).rollNumber || "");
        const rows = d.requests || [];
        const map = {};
        for (const row of rows) {
          // The server strips the [DOC-xxxx] prefix out of remarks and ships
          // the client ref as a dedicated field — use THAT first; the remarks
          // regex is only a fallback for hand-crafted rows. Keyed by the ref
          // (matches locally-submitted items) AND by the server row id.
          const ref = String(row.ref || "").toUpperCase()
            || ((/^\[(DOC-\d+)\]/i.exec(String(row.remarks || "")) || [])[1] || "").toUpperCase();
          if (ref) map[ref] = row.status;
          map[row.id] = row.status;
        }
        docStatusMapRef.current = map;
        setDocStatusMap(map);

        // Device convergence: a doc submitted on the PC lives only in the
        // PC's IndexedDB — this device would never see it in its feed.
        // Upsert every server row so the feed is complete on EVERY device
        // the student signs in from, stamped with the account that owns it.
        try {
          const localDocs = await getAllLocal("doc_requests");
          const byId = Object.fromEntries(localDocs.map(t => [String(t.id), t]));
          const DOC_TYPE_LABELS = {
            BONAFIDE: "Bonafide Certificate",
            NO_DUES: "Hostel No-Dues Clearance",
            CHARACTER: "Conduct Certificate",
            FEE_RECEIPT: "Official Fee Receipt",
            MIGRATION: "Migration / Transfer NOC",
            TRANSCRIPT: "Academic Transcript"
          };
          const DOC_STATUS_LABELS = {
            PENDING: "Pending Admin Verification",
            PROCESSING: "Processing at Registrar Office",
            READY_FOR_PICKUP: "Ready for Pickup",
            REJECTED: "Rejected by Office"
          };
          for (const row of rows) {
            const ref = String(row.ref || "").toUpperCase();
            let reason = String(row.remarks || "").replace(/^\[(DOC-\d+)\]\s*/i, "");
            const label = DOC_TYPE_LABELS[row.docType] || row.docType;
            // Older submissions stored their full title ("<Type>: <purpose>")
            // as the remark — avoid rendering "Official Fee Receipt: Official
            // Fee Receipt: For internship" in the converged feed item.
            if (reason.toLowerCase().startsWith(label.toLowerCase() + ":")) {
              reason = reason.slice(label.length + 1).trim();
            }
            // An earlier build keyed converged rows by the server UUID (the
            // remarks arrive already stripped, so the ref regex never hit).
            // When BOTH a ref-keyed item and that uuid copy exist, the uuid
            // copy is a redundant artifact — drop it, the ref item rules.
            if (ref && byId[ref] && byId[row.id]) {
              try { await deleteLocal("doc_requests", row.id); } catch { /* keep both */ }
              delete byId[row.id];
            }
            const localId = ref || row.id;
            const existing = byId[localId];
            // Upsert (not just insert): refresh the registrar's status so the
            // chip/progress stays live, and stamp ownership for scoping.
            await saveLocal("doc_requests", {
              ...(existing || {}),
              id: localId,
              owner: myRoll,
              type: "ticket",
              category: "Admin Document",
              title: `${label}: ${reason || "Registrar request"}`,
              description: reason || label,
              location: existing?.location || "Academic Registrar Office",
              status: row.status,
              statusLabel: DOC_STATUS_LABELS[row.status] || row.status,
              sla: existing?.sla || "Standard (24h SLA)",
              createdAt: existing?.createdAt || row.createdAt,
              time: existing?.time || "On file"
            });
          }
        } catch { /* convergence is best-effort; local-first flow unaffected */ }
      } catch { /* offline — keep the last known map */ }
    };
    pull();
    // Fix 2: skip while the tab is hidden; catch up as soon as it is visible.
    const iv = setInterval(() => { if (!isPageHidden()) pull(); }, 15000);
    const offActive = onPageActive(pull);
    return () => { alive = false; clearInterval(iv); offActive(); };
  }, [currentRole, session?.identity]);

  // Boot the sync engine once at app start so queued offline actions
  // (e.g. gate scans) auto-flush the moment connectivity returns —
  // regardless of which role dashboard is active.
  useEffect(() => {
    if (typeof window !== 'undefined' && !window.__campus_dbg_sync_init) {
      window.__campus_dbg_sync_init = true;
      initSyncEngine();
    }
  }, []);

  // Push-notification layer: poll the central notice bus while a user
  // is signed in (raises system notifications on new notices). Stops
  // cleanly at logout.
  useEffect(() => {
    if (session) {
      startNotificationPolling();
    } else {
      stopNotificationPolling();
    }
    return () => stopNotificationPolling();
  }, [session?.identity]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(() => typeof window !== 'undefined' ? window.innerWidth >= 1024 : true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeNav, setActiveNav] = useState('home');
  const [pendingSyncCount, setPendingSyncCount] = useState(0);

  // Load persisted items from IndexedDB
  const loadLocalData = async () => {
    try {
      await initDB();
      const localTickets = await getAllLocal('tickets');
      const localPasses = await getAllLocal('gate_passes');

      const combined = [...INITIAL_ACTIVITIES];

      let serverPasses = [];
      let serverTickets = [];
      let serverReachable = false;
      try {
        const res = await fetch('/api/dashboard-data');
        if (res.ok) {
          serverReachable = true;
          const serverData = await res.json();
          setMasterClusters(serverData.masterClusters || []);
          if (serverData.gatePasses && serverData.gatePasses.length > 0) {
            serverPasses = serverData.gatePasses;
          }
          if (serverData.tickets && serverData.tickets.length > 0) {
            serverTickets = serverData.tickets;
          }
        }
      } catch (err) {
        console.warn('Express server offline fallback active');
      }

      // Mirror live server ticket statuses (technician progress, escalations,
      // cluster resolution) into the student feed
      const myProfileId = String((getStoredProfile() || {}).id || '');
      serverTickets.forEach(ticket => {
        const existingIdx = combined.findIndex(i => i.id === ticket.id);
        const ticketObj = {
          ...ticket,
          type: 'ticket',
          title: ticket.title,
          description: ticket.description || ticket.raw_text,
          status: ticket.status,
          statusLabel: ticket.statusLabel,
          assignedTo: ticket.assignedTo,
          studentConfirmed: ticket.studentConfirmed === undefined ? (ticket.studentConfirmed || false) : ticket.studentConfirmed,
          masterJoined: !!ticket.master_incident_id || ticket.masterJoined,
          sla_hours: ticket.sla_hours,
          createdAt: ticket.createdAt || ticket.created_at || new Date().toISOString()
        };
        if (existingIdx >= 0) {
          combined[existingIdx] = { ...combined[existingIdx], ...ticketObj };
        } else if (myProfileId && String(ticket.student_id || '') === myProfileId) {
          // The student's OWN ticket history converges across devices: any
          // device now shows the same complaints (the old merge only updated
          // locally-known rows, so a desktop would show items a phone missed).
          combined.push({ ...ticketObj, time: 'Earlier' });
        }
        // Only refresh tickets this student already created (stored in IndexedDB
        // by id) — never pull OTHER students' complaints into a private feed.
      });

      // Merge local and server passes
      const allPassesMap = new Map();
      (localPasses || []).forEach(p => allPassesMap.set(p.id, p));
      serverPasses.forEach(p => {
        const existing = allPassesMap.get(p.id);
        allPassesMap.set(p.id, existing ? { ...existing, ...p } : p);
      });

      // Identity scoping: on a shared device, the local ledger may hold
      // passes created under a DIFFERENT login (role-switch test scenario).
      // The student feed must only ever surface passes whose roll matches
      // the signed-in identity (server rows are already user-scoped).
      const myRoll = String(sessionRollRef.current || '').toLowerCase();
      const mergedPasses = Array.from(allPassesMap.values()).filter(
        p => !myRoll || (p.rollNo && String(p.rollNo).toLowerCase() === myRoll)
      );

      // Add passes to activities
      if (mergedPasses.length > 0) {
        // Deterministic "current" pass selection — the SAME rule on every
        // device so both screens agree regardless of when/where the pass was
        // created. Priority: a usable APPROVED pass wins, then PENDING,
        // then REJECTED, then USED; recency only breaks ties.
        const statusRank = (p) => {
          const s = p.status || 'PENDING';
          if (s === 'APPROVED') return 0;
          if (s === 'PENDING') return 1;
          if (s === 'REJECTED') return 2;
          return 3; // USED and anything else
        };
        const passTime = (p) => {
          const ms = p.createdAtMs || (p.createdAt ? new Date(p.createdAt).getTime() : 0);
          return isNaN(ms) ? 0 : ms;
        };
        // Active card authority: when the server is reachable, choose ONLY
        // among passes the server knows (its ledger is canonical and
        // persisted now). Local-only historical passes must never make one
        // device disagree with another — they feed the activity list, not
        // the active card.
        const serverIds = new Set(serverPasses.map(p => String(p.id)));
        const serverAwareSource = (serverReachable && serverPasses.length > 0)
          ? mergedPasses.filter(p => serverIds.has(String(p.id)))
          : mergedPasses;
        const currentPass = (serverAwareSource.length > 0 ? serverAwareSource : mergedPasses).sort((a, b) =>
          statusRank(a) - statusRank(b) || passTime(b) - passTime(a)
        )[0];
        mergedPasses.forEach(pass => {
          const existingIdx = combined.findIndex(i => i.id === pass.id);
          const passActivity = {
            id: pass.id,
            type: 'gate_pass',
            title: `Gate Outing: ${pass.reason || 'Outing'} (${pass.destination || 'Campus Gate'})`,
            category: 'Gate Pass',
            destination: pass.destination,
            rollNo: pass.rollNo,
            name: pass.name,
            location: 'Main Exit Gate',
            status: pass.status || 'PENDING',
            statusLabel: pass.statusLabel 
              ? pass.statusLabel 
              : pass.status === 'USED'
                ? 'Scanned at Main Gate (Expired)'
                : pass.status === 'APPROVED'
                  ? 'Warden Approved (HMAC Signed)'
                  : pass.status === 'REJECTED'
                    ? 'Rejected by Warden'
                    : 'Pending Warden Approval',
            sla: pass.validUntil ? `Valid until ${new Date(pass.validUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Standard Outing',
            // Honest timestamps: a pass whose creation time was never recorded
            // shows "Earlier" — NEVER "Just now"/"Recently Updated" (the old
            // Date.now() fallback re-aged every old item on every render).
            time: (() => {
              const ms = pass.createdAtMs || (pass.createdAt ? new Date(pass.createdAt).getTime() : 0);
              if (!ms || isNaN(ms) || ms <= 0) return 'Earlier';
              if (Date.now() - ms < 60000) return 'Just now';
              if (Date.now() - ms < 3600000) return `${Math.floor((Date.now() - ms) / 60000)} mins ago`;
              return `${Math.floor((Date.now() - ms) / 3600000)}h ago`;
            })(),
            token: pass.token,
            signature: pass.signature,
            validUntil: pass.validUntil,
            createdAt: pass.createdAt ? pass.createdAt : undefined,
            createdAtMs: (() => {
              const ms = pass.createdAtMs || (pass.createdAt ? new Date(pass.createdAt).getTime() : 0);
              return ms && !isNaN(ms) && ms > 0 ? ms : 0;
            })()
          };

          if (existingIdx >= 0) {
            combined[existingIdx] = passActivity;
          } else {
            combined.unshift(passActivity);
          }
        });

        // Deterministic selection with the SAME status-priority rule above —
        // both devices must always agree on which pass is "active".
        setActivePass(currentPass);
      }

      // Add local tickets
      if (localTickets && localTickets.length > 0) {
        // One-time hygiene: certificate requests once leaked into the tickets
        // ledger — migrate each to its own store and remove from 'tickets' so
        // the WARDEN's shared-device queue is physically clean, not merely
        // filtered at load time. Idempotent: runs as a no-op once moved.
        for (const t of localTickets) {
          if (t?.category === 'Admin Document') {
            try {
              await saveLocal('doc_requests', t);
              await deleteLocal('tickets', t.id);
            } catch { /* non-fatal — the warden-side filter still guards */ }
          }
        }
        // Server-authoritative history: local tickets the server no longer
        // knows (deleted test rows, purged complaints) AND older than 48h
        // (offline queue flushes in seconds, so nothing legit is that old)
        // are pruned from this device so every device matches the DB.
        const serverTicketIds = new Set(serverTickets.map(t => String(t.id)));
        const staleCutoff = Date.now() - 48 * 3600e3;
        for (const t of localTickets) {
          const ms = t?.createdAt ? new Date(t.createdAt).getTime() : 0;
          if (!serverTicketIds.has(String(t.id)) && ms > 0 && ms < staleCutoff && t?.category !== 'Admin Document') {
            try { await deleteLocal('tickets', t.id); } catch { /* keep silently */ }
          }
        }
        // ACCOUNT-SCOPED: one device hosts several accounts, so the store
        // mixes tickets submitted under a previous login — exactly like the
        // doc store. Server-known ids are the logged-in student's own rows
        // (the dashboard fetch is already scoped by student_id); unknown
        // unstamped items get a short in-flight grace, then are pruned.
        const myTicketRoll = String(sessionRollRef.current || getStoredProfile()?.rollNumber || '');
        const inflightCutoff = Date.now() - 10 * 60e3;
        const ownedTickets = [];
        for (const t of localTickets) {
          if (t?.category === 'Admin Document') continue; // own store handles those
          const twRoll = String(t.owner || '');
          let owned;
          if (twRoll) owned = twRoll === myTicketRoll;
          else if (serverTicketIds.has(String(t.id))) {
            owned = true; // scoped server fetch proves ownership — re-stamp
            try { await saveLocal('tickets', { ...t, owner: myTicketRoll }); } catch { /* keep unstamped */ }
          } else {
            const ms = t?.createdAt ? new Date(t.createdAt).getTime() : 0;
            owned = !!ms && Date.now() - ms < 10 * 60e3; // in-flight offline submit
          }
          if (owned) ownedTickets.push(t);
          else if (!serverTicketIds.has(String(t.id))) {
            try { await deleteLocal('tickets', t.id); } catch { /* keep silently */ }
          }
        }
        const studentTickets = ownedTickets;
        studentTickets.forEach(ticket => {
          const existingIdx = combined.findIndex(i => i.id === ticket.id);
          const ticketObj = {
            ...ticket,
            createdAt: ticket.createdAt || new Date().toISOString()
          };
          if (existingIdx >= 0) {
            combined[existingIdx] = ticketObj;
          } else {
            combined.unshift(ticketObj);
          }
        });
      }

      // Add local document requests (their own persisted store since v4;
      // legacy DOC items already inside the tickets ledger still restore via
      // the merge above, but they never reach the warden — filtered there).
      // ACCOUNT-SCOPED: the store is device-wide, and one device can host
      // several accounts (student switching on a shared PC) — without this
      // filter, Vivaan's dashboard would render Shaurya's certificates and
      // vice-versa. Server-confirmed ids (the /mine map) can reclaim unstamped
      // legacy items; anything foreign gets pruned from the store entirely.
      try {
        const localDocs = await getAllLocal('doc_requests');
        const myRoll = String((getStoredProfile() || {}).rollNumber || '');
        const ownedNow = new Set(Object.keys(docStatusMapRef.current || {}));
        const keepers = [];
        for (const doc of (localDocs || [])) {
          if (!doc?.id || doc.category !== 'Admin Document') continue;
          const docOwner = String(doc.owner || '');
          let owned;
          if (docOwner) owned = docOwner === myRoll;
          else if (ownedNow.has(String(doc.id))) {
            owned = true; // the server confirms this account owns the row — re-stamp
            try { await saveLocal('doc_requests', { ...doc, owner: myRoll }); } catch { /* keep unstamped */ }
          } else {
            owned = false;
          }
          if (owned) keepers.push(doc);
          else {
            try { await deleteLocal('doc_requests', doc.id); } catch { /* keep silently */ }
          }
        }
        keepers.forEach(doc => {
          const existingIdx = combined.findIndex(i => i.id === doc.id);
          const docObj = { ...doc, createdAt: doc.createdAt || new Date().toISOString() };
          if (existingIdx >= 0) {
            combined[existingIdx] = docObj;
          } else {
            combined.unshift(docObj);
          }
        });
      } catch { /* store not migrated on this device yet */ }

      // Helper to safely extract numeric timestamp from any item
      const getTimeMs = (item) => {
        if (!item) return 0;
        if (item.createdAtMs) return item.createdAtMs;
        if (item.createdAt) {
          const parsed = new Date(item.createdAt).getTime();
          if (!isNaN(parsed) && parsed > 0) return parsed;
        }
        return 0;
      };

      // Enforce strict newest-first sorting across all feed items
      combined.sort((a, b) => getTimeMs(b) - getTimeMs(a));

      setRecentActivities(combined);
    } catch (err) {
      console.warn('Failed to load local DB data:', err);
    }
  };

  useEffect(() => {
    loadLocalData();

    const handleGatePassUpdate = (e) => {
      loadLocalData();
      if (e.detail?.pass) {
        setActivePass(e.detail.pass);
      }
    };

    const handleTicketsUpdated = (e) => {
      if (e.detail?.masterClusters) {
        setMasterClusters(e.detail.masterClusters);
      }
      loadLocalData();
    };

    // Approval happens on the WARDEN's device — the student's local ledger can
    // never hear about it by itself. While a pass is still locally PENDING,
    // poll the authoritative server status and reconcile the local copy
    // (status, HMAC token, validity). Only touches the network for pending
    // passes, so idle devices aren't chatty.
    const reconcileActivePass = async () => {
      const current = activePassRef.current;
      if (!current || current.status !== 'PENDING') return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      try {
        const res = await fetch(`/api/pass-status?id=${encodeURIComponent(current.id)}`);
        if (!res.ok) return;
        const data = await res.json();
        const serverPass = data?.pass;
        if (serverPass && serverPass.status && serverPass.status !== current.status) {
          const merged = { ...current, ...serverPass, status: serverPass.status };
          try {
            const { saveLocal } = await import('./utils/db');
            await saveLocal('gate_passes', merged);
          } catch (dbErr) {
            console.warn('[PassStatus] local ledger update failed:', dbErr);
          }
          setActivePass(merged);
          window.dispatchEvent(new CustomEvent('campus_gate_pass_updated', { detail: { pass: merged } }));
        }
      } catch (err) { /* offline or server unreachable — keep polling */ }
    };

    // Fix 2 (polling): this used to hit the server every 3 s, even in a
    // background tab. Now: every 15 s while the gate pass can still change on
    // another device (PENDING / APPROVED), every 30 s otherwise, nothing while
    // the tab is hidden, and at once when the user comes back to the tab or
    // after their own action (pass / ticket events, outbox flushes).
    let lastPollAt = Date.now();
    const pollNow = () => {
      lastPollAt = Date.now();
      loadLocalData();
      reconcileActivePass();
    };
    const pollEveryMs = () => {
      const s = String(activePassRef.current?.status || '').toUpperCase();
      return (s === 'PENDING' || s === 'APPROVED') ? POLL_ACTIVE_MS : POLL_IDLE_MS;
    };
    const pollInterval = setInterval(() => {
      if (isPageHidden()) return;
      if (Date.now() - lastPollAt >= pollEveryMs()) pollNow();
    }, 3000);
    const offPageActive = onPageActive(pollNow);
    // Own actions go through the outbox; refresh once its flush settles.
    let outboxTimer = null;
    const handleOutboxSettled = () => {
      clearTimeout(outboxTimer);
      outboxTimer = setTimeout(pollNow, 1200);
    };

    window.addEventListener('campus_gate_pass_updated', handleGatePassUpdate);
    window.addEventListener('campus_tickets_updated', handleTicketsUpdated);
    window.addEventListener('campus_outbox_updated', handleOutboxSettled);
    return () => {
      clearInterval(pollInterval);
      clearTimeout(outboxTimer);
      offPageActive();
      window.removeEventListener('campus_gate_pass_updated', handleGatePassUpdate);
      window.removeEventListener('campus_tickets_updated', handleTicketsUpdated);
      window.removeEventListener('campus_outbox_updated', handleOutboxSettled);
    };
  }, []);

  // Flush offline outbox on initial mount / page load and maintain pendingSyncCount
  useEffect(() => {
    let isMounted = true;

    const refreshPendingCount = async () => {
      try {
        const count = await getPendingSyncCount();
        if (isMounted) setPendingSyncCount(count);
      } catch (err) {
        console.warn('Failed to retrieve pending sync count:', err);
      }
    };

    const runInitialSync = async () => {
      // 1. Immediately read initial count from IndexedDB
      await refreshPendingCount();

      // 2. Immediately execute flushOutbox() if online
      if (typeof navigator === 'undefined' || navigator.onLine) {
        try {
          console.log('[App] Initial mount: Triggering immediate flushOutbox()...');
          await flushOutbox((msg, type) => {
            if (isMounted) showToast(msg, type);
          });
        } catch (syncErr) {
          console.warn('[App] Initial flushOutbox error:', syncErr);
        } finally {
          // 3. Update pendingSyncCount state immediately after flushOutbox resolves
          if (isMounted) {
            await refreshPendingCount();
          }
        }
      }
    };

    runInitialSync();

    const handleOutboxChange = (e) => {
      if (e.detail?.count !== undefined) {
        if (isMounted) setPendingSyncCount(e.detail.count);
      } else {
        refreshPendingCount();
      }
    };

    window.addEventListener('campus_outbox_updated', handleOutboxChange);
    return () => {
      isMounted = false;
      window.removeEventListener('campus_outbox_updated', handleOutboxChange);
    };
  }, []);

  const showToast = (msg, type = 'success') => {
    setToastMessage({ text: msg, type });
    setTimeout(() => setToastMessage(null), 4500);
  };

  // Callbacks for modal completions
  const handlePassCreated = (newPass) => {
    const activityItem = {
      id: newPass.id,
      type: 'gate_pass',
      title: `Gate Outing: ${newPass.reason} (${newPass.destination})`,
      category: 'Gate Pass',
      destination: newPass.destination,
      rollNo: newPass.rollNo,
      name: newPass.name,
      location: 'Main Exit Gate',
      status: 'PENDING',
      statusLabel: 'Pending Warden Approval',
      sla: `Valid until ${new Date(newPass.validUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      time: 'Just now',
      validUntil: newPass.validUntil,
      createdAt: newPass.createdAt || new Date().toISOString()
    };
    setActivePass(activityItem);
    setRecentActivities(prev => {
      const list = [activityItem, ...prev.filter(i => i.id !== activityItem.id)];
      return list.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
    });
    showToast(`Gate Pass #${newPass.id} submitted for Warden sign-off! (State: PENDING)`, 'offline');
  };

  const handleTicketCreated = (newTicket, isOnline) => {
    const ticketWithDate = {
      ...newTicket,
      createdAt: newTicket.createdAt || new Date().toISOString()
    };
    setRecentActivities(prev => [ticketWithDate, ...prev.filter(i => i.id !== ticketWithDate.id)].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    if (!isOnline) {
      showToast(`Network Offline: Ticket #${newTicket.id} saved to IndexedDB & queued for automatic sync.`, 'offline');
    } else {
      showToast(`Ticket #${newTicket.id} logged successfully and routed for clustering & SLA assignment.`, 'success');
    }
  };

  const handleFeedbackSubmitted = (newFeedback) => {
    const feedbackWithDate = {
      ...newFeedback,
      createdAt: newFeedback.createdAt || new Date().toISOString()
    };
    setRecentActivities(prev => [feedbackWithDate, ...prev.filter(i => i.id !== feedbackWithDate.id)].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    showToast(`Mess meal feedback logged & submitted to Caterer and Dean!`, 'success');
  };

  const handleDocRequested = (newDoc) => {
    const docWithDate = {
      ...newDoc,
      createdAt: newDoc.createdAt || new Date().toISOString()
    };
    setRecentActivities(prev => [docWithDate, ...prev.filter(i => i.id !== docWithDate.id)].sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()));
    showToast(`Certificate Request #${newDoc.id} submitted to Registrar! (SLA: 24h)`, 'success');
  };

  const handleOpenQRModal = (pass) => {
    setSelectedPassToView(pass || activePass);
    setActiveModal('view_qr');
  };

  const handleLogin = (newSession) => {
    localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
    setSession(newSession);
    setCurrentRole(newSession.role);
  };

  const handleRoleChange = (role) => {
    // Role comes exclusively from the verified login — no runtime switching.
    void role;
  };

  const handleSignOut = () => {
    // Stop this device getting the signed-out account's notifications
    // (background, never blocks logout; must run before the session is cleared).
    releasePushDeviceOnSignOut();
    localStorage.removeItem(SESSION_KEY);
    clearStoredSession();
    setSession(null);
    setCurrentRole(null);
    setActiveModal(null);
  };

  if (!session || !VALID_ROLES.includes(currentRole)) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return (
    <div className="h-screen w-full bg-[#F1F5F9] text-slate-900 flex overflow-hidden font-sans antialiased">
      
      {/* 1. Collapsible Sidebar (Fixed in fit-screen, does not scroll with page content) */}
      <Sidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        onSignOut={handleSignOut}
        onOpenProfile={() => setActiveModal('profile')}
        onOpenSettings={() => setActiveModal('settings')}
        activeNav={activeNav}
        setActiveNav={setActiveNav}
        currentRole={currentRole}
        session={session}
      />

      {/* 2. Main Page Container (Scrolls independently while sidebar stays pinned on the left) */}
      <div className="flex-1 w-full min-w-0 h-screen flex flex-col overflow-y-auto overflow-x-hidden transition-main">
        
        {/* Top Header */}
        <Header
          currentRole={currentRole}
          onRoleChange={handleRoleChange}
          onOpenNotices={() => setActiveModal('notices')}
          onSignOut={handleSignOut}
          onToggleSidebar={() => setIsSidebarOpen(prev => !prev)}
          isSidebarOpen={isSidebarOpen}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          pendingSyncCount={pendingSyncCount}
        />

        {/* Content Body */}
        <main className="flex-1 w-full max-w-7xl mx-auto px-3 sm:px-5 lg:px-6 py-4 sm:py-5 flex flex-col space-y-5">

          {/* Toast Notification */}
          {toastMessage && (
            <div className={`border px-4 py-3 rounded-2xl text-xs sm:text-sm font-semibold flex items-center justify-between shadow-lg animate-in fade-in duration-200 ${
              toastMessage.type === 'offline'
                ? 'bg-amber-50 border-amber-200 text-amber-900'
                : 'bg-emerald-50 border-emerald-200 text-emerald-900'
            }`}>
              <div className="flex items-center space-x-2.5">
                {toastMessage.type === 'offline' ? (
                  <WifiOff className="w-4 h-4 text-amber-600 shrink-0" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                )}
                <span>{toastMessage.text}</span>
              </div>
              <button 
                onClick={() => setToastMessage(null)} 
                className="text-slate-400 hover:text-slate-600 ml-2 cursor-pointer p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Dynamic Role Views */}
          {currentRole === 'Student' && (
            <StudentDashboard
              activities={recentActivities}
              activePass={activePass}
              dayLeave={dayLeave}
              onOpenModal={(modalType) => {
                // DAY-SCHOLAR GUARD: hostel repair tickets require a resident
                // on-site to confirm the fix when the technician arrives — an
                // off-campus student can never do that (they'd be stuck as an
                // un-confirmable ticket). The card stays visible but locked;
                // this guard also covers feed-fallback clicks. Hostellers,
                // staff and offline-session fallbacks (no residentType) pass.
                if (modalType === 'complaint'
                  && String(session?.residentType || '').trim().toLowerCase() === 'dayscholar') {
                  showToast('Hostel Issue reporting is for hostel residents only — day scholars commute from home, so there is no room for a technician to fix.', 'offline');
                  return;
                }
                setActiveModal(modalType);
              }}
              onViewPassQR={handleOpenQRModal}
              searchQuery={searchQuery}
              session={session}
              docStatusMap={docStatusMap}
            />
          )}

          {currentRole === 'Warden' && (
            <WardenDashboard
              onNotification={(msg) => showToast(msg, 'success')}
              masterClusters={masterClusters}
              searchQuery={searchQuery}
            />
          )} 

          {currentRole === 'Guard' && (
            <GuardScanner searchQuery={searchQuery} />
          )}

          {currentRole === 'Admin' && (
            <AdminDashboard
              onNotification={(msg) => showToast(msg, 'success')}
              searchQuery={searchQuery}
            />
          )}

          {currentRole === 'Teacher' && (
            <TeacherDashboard
              onNotification={(msg) => showToast(msg, 'success')}
              searchQuery={searchQuery}
              session={session}
            />
          )}

        </main>

        {/* Footer */}
        <footer className="border-t border-slate-200/50 py-3.5 px-4 text-center text-slate-400 text-[11px] font-medium bg-white/50 backdrop-blur-sm mt-auto">
          CampusDebug OS • Unified Campus Operations & Offline Action Feed
        </footer>

      </div>

      {/* --- Interactive Modals --- */}
      <RequestGatePassModal
        isOpen={activeModal === 'gate_pass'}
        onClose={() => setActiveModal(null)}
        onPassCreated={handlePassCreated}
        session={session}
      />

      <ViewPassQRModal
        isOpen={activeModal === 'view_qr'}
        onClose={() => setActiveModal(null)}
        pass={selectedPassToView}
      />

      {/* Day-scholar leave — mentor approval + one-way gate exit (CMS ID QR) */}
      <LeaveQRModal
        isOpen={activeModal === 'leave'}
        onClose={() => setActiveModal(null)}
        onToast={(msg, kind) => showToast(msg, kind || 'success')}
      />

      <ReportIssueModal
        isOpen={activeModal === 'complaint'}
        onClose={() => setActiveModal(null)}
        onTicketCreated={handleTicketCreated}
      />

      <MessFeedbackModal
        isOpen={activeModal === 'mess'}
        onClose={() => setActiveModal(null)}
        onFeedbackSubmitted={handleFeedbackSubmitted}
      />

      <TimetableModal
        isOpen={activeModal === 'timetable'}
        onClose={() => setActiveModal(null)}
        department={session?.department || ''}
        course={session?.course || ''}
        section={session?.section || ''}
      />

      <DocRequestModal
        isOpen={activeModal === 'doc_request'}
        onClose={() => setActiveModal(null)}
        onDocRequested={handleDocRequested}
      />

      <FeeDuesModal
        isOpen={activeModal === 'fee_dues'}
        onClose={() => setActiveModal(null)}
        onFeePaid={(msg) => showToast(msg, 'success')}
        session={session}
      />

      <NoticesModal
        isOpen={activeModal === 'notices'}
        onClose={() => setActiveModal(null)}
        onReadReceiptChanged={() => showToast('Notice acknowledgement saved to IndexedDB & sync queue.', 'success')}
      />

      <ProfileModal
        isOpen={activeModal === 'profile'}
        onClose={() => setActiveModal(null)}
        session={session}
        currentRole={currentRole}
      />

      <SettingsModal
        isOpen={activeModal === 'settings'}
        onClose={() => setActiveModal(null)}
      />

      <MealRsvpModal
        isOpen={activeModal === 'meal_rsvp'}
        onClose={() => setActiveModal(null)}
        session={session}
      />

    </div>
  );
}

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { 
  Database, 
  Send, 
  FileSpreadsheet, 
  Layers, 
  CheckCircle2, 
  AlertTriangle, 
  Users, 
  MapPin, 
  Filter, 
  UploadCloud, 
  FileText, 
  Sparkles, 
  Download, 
  TrendingUp, 
  Clock, 
  Check, 
  X,
  Radio,
  Search,
  ShieldCheck,
  Utensils,
  Calendar,
  RefreshCw,
  Building2,
  Receipt
} from 'lucide-react';
import FeePaymentsPanel from '../FeePaymentsPanel';
import { saveLocal, bulkSaveLocal, getAllLocal, queueOfflineAction, getOutboxCount } from '../../utils/db';
import { getAccessToken } from '../../utils/authClient';
import { getLiveUpdates } from '../../utils/liveUpdates';

// Notices are REAL records served by the central notice bus (server-persisted
// in data/notices.json). History loads from there — nothing is seeded.
const mapServerNotice = (n) => ({
  id: n.id,
  title: n.title,
  target: n.targetBlock ? `Hostel Block ${n.targetBlock}` : (n.target || 'All Students'),
  actionTag: n.actionTag || n.category || 'General',
  publishedAt: n.createdAt ? new Date(n.createdAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—',
  totalTargeted: n.recipients ? n.recipients.total : null,
  deliveredCount: (n.pushDelivered || 0) +
    (n.smsDispatchedTo ? n.smsDispatchedTo.filter(s => s.mode === 'gateway' || s.mode === 'simulated').length : 0),
  pushStudents: n.recipients ? n.recipients.pushStudents : (n.pushDelivered ?? null),
  smsCount: n.smsDispatchedTo ? n.smsDispatchedTo.length : 0,
  smsModes: n.smsDispatchedTo ? [...new Set(n.smsDispatchedTo.map(s => s.mode))] : [],
  noContact: n.recipients ? n.recipients.noContact : 0,
  dayscholars: n.recipients?.dayscholars || 0,
  priority: n.urgency || n.priority || 'Normal'
});

import { initSyncEngine, flushOfflineQueue } from '../../utils/syncEngine';
import AdminCoversCard from '../teacher/AdminCoversCard';
import AdminCoverAlerts from '../teacher/AdminCoverAlerts';

export default function AdminDashboard({ onNotification, searchQuery: externalSearchQuery = '' }) {
  const [activeTab, setActiveTab] = useState('dispatcher'); // 'dispatcher' | 'csv' | 'metrics'
  const [queueDepth, setQueueDepth] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // --- Timetable Engine state (Phase 2): read the solver's current output,
  //     regenerate on demand. Every regeneration is conflict-free by design.
  const [ttInfo, setTtInfo] = useState(null);        // GET /api/timetable payload
  const [ttBusy, setTtBusy] = useState(false);
  const [ttResult, setTtResult] = useState(null);    // last generate-timetable response
  const [ttSecBusy, setTtSecBusy] = useState(null);  // sectionKey being regenerated
  const [ttSecResult, setTtSecResult] = useState(null);
  const [ttSecPreview, setTtSecPreview] = useState(null); // draft grid awaiting Confirm — nothing is live until then

  // --- CSV timetable upload (Step 5): pick a section, upload a weekly CSV,
  //     validate against the whole campus, publish with zero errors only.
  const [csvCourse, setCsvCourse] = useState('');
  const [csvDept, setCsvDept] = useState('');
  const [csvSection, setCsvSection] = useState('');
  const [csvText, setCsvText] = useState('');
  const [csvBusy, setCsvBusy] = useState(false);      // validate/publish in flight
  const [csvReport, setCsvReport] = useState(null);   // { errors, autofills, report, ... }
  const [csvPublishState, setCsvPublishState] = useState('idle'); // 'idle' | 'validated' | 'published'
  const [csvStatement, setCsvStatement] = useState(null);

  // --- Attendance locks (hard-lock release valve): today's saved sessions;
  //     an admin can delete one so the teacher can mark that class again.
  const [attLocks, setAttLocks] = useState([]);
  const [attUnlockBusy, setAttUnlockBusy] = useState(null);

  const loadAttLocks = async () => {
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/attendance/sessions', tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
      const j = await r.json();
      if (j?.success) setAttLocks(j.sessions || []);
    } catch { /* offline — keep the last shown list */ }
  };

  const handleAttUnlock = async (lock) => {
    setAttUnlockBusy(lock.id);
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/admin/attendance-unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ sectionKey: lock.sectionKey, period: lock.period, date: lock.date })
      });
      const j = await r.json();
      if (j?.success) {
        if (onNotification) onNotification(j.statement || 'Attendance unlocked — the class can be marked again.', 'success');
        loadAttLocks();
      } else if (onNotification) {
        onNotification(j?.error || 'Unlock failed.', 'error');
      }
    } catch {
      if (onNotification) onNotification('Offline — unlocking needs connectivity.', 'error');
    }
    setAttUnlockBusy(null);
  };

  // CSV upload helpers — the section pickers derive from ttInfo.sections.
  const csvSectionKey = (csvCourse && csvDept && csvSection) ? `${csvCourse}|${csvDept}|${csvSection}` : null;
  const csvCourseList = [...new Set((ttInfo?.sections || []).map(s => s.course))];
  const csvDeptList = [...new Set((ttInfo?.sections || []).filter(s => !csvCourse || s.course === csvCourse).map(s => s.department))];
  const csvSectionList = (ttInfo?.sections || []).filter(s => (!csvCourse || s.course === csvCourse) && (!csvDept || s.department === csvDept)).map(s => s.section);

  const handleCsvRun = async (publish) => {
    if (!csvSectionKey) return;
    setCsvBusy(true);
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/admin/timetable-csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ sectionKey: csvSectionKey, csv: csvText, dryRun: !publish })
      });
      const j = await r.json();
      if (publish && j?.success && j.dryRun === false) {
        setCsvReport(null);
        setCsvPublishState('published');
        setCsvStatement(j);
        if (onNotification) onNotification(j.statement, 'success');
        loadTimetableInfo();
      } else if (j?.errors) {
        setCsvReport(j);
        setCsvPublishState(j.success ? 'validated' : 'idle');
        if (!j.success && onNotification) onNotification(j.report || 'Validation found problems — nothing published.', 'error');
      } else {
        if (onNotification) onNotification(j?.error || 'CSV processing failed.', 'error');
      }
    } catch {
      if (onNotification) onNotification('Offline — the CSV engine needs connectivity.', 'error');
    }
    setCsvBusy(false);
  };

  const handleCsvFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => { setCsvText(String(reader.result || '')); setCsvReport(null); setCsvPublishState('idle'); };
    reader.readAsText(f);
  };

  // --- CAMPUS SETUP (config as data): the admin edits branches, rooms,
  //     subjects + pools, hostel blocks and the weekly cap here. Saving
  //     never moves the live timetable — Regenerate applies it.
  const [cc, setCc] = useState(null);
  const [ccBusy, setCcBusy] = useState(false);
  const [ccMsg, setCcMsg] = useState(null);        // { ok, text, shadow }
  const [ccOpen, setCcOpen] = useState(null);      // expanded branch key
  const [ccPool, setCcPool] = useState(null);      // subject pool picker open: `${branchIdx}|${subjIdx}`
  const [ccSearch, setCcSearch] = useState('');
  const [ccDirectory, setCcDirectory] = useState({ sections: [], years: [] }); // live roster sections/years (dispatcher dropdowns)
  const [staff, setStaff] = useState({ teachers: [], wardens: [] });
  const [staffLoaded, setStaffLoaded] = useState(false); // KPI shows '—' until the real list arrives
  // --- ROOM ALLOCATION: dry-run plan preview, confirm-to-apply, plus the
  // per-student manual override (same rules, enforced live).
  const [roomPlan, setRoomPlan] = useState(null);   // dryRun response awaiting Confirm
  const [roomBusy, setRoomBusy] = useState(false);
  const [roomMsg, setRoomMsg] = useState(null);     // { ok, text }
  const [ovRoll, setOvRoll] = useState('');
  const [ovBlock, setOvBlock] = useState('');
  const [ovRoom, setOvRoom] = useState('');
  // --- STEP 6: AT-RISK roster (<50% live attendance) for the admin
  const [atRisk, setAtRisk] = useState(null);   // null = not loaded yet
  const atRiskThreshold = 50;

  const loadAtRisk = async () => {
    try {
      const tok = getAccessToken();
      const r = await fetch(`/api/admin/at-risk?threshold=${atRiskThreshold}`, tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
      const j = await r.json();
      setAtRisk(j?.success ? j : { success: false, atRisk: [], bySection: {}, totalStudents: 0, atRiskCount: 0, threshold: atRiskThreshold });
    } catch {
      setAtRisk({ success: false, atRisk: [], bySection: {}, totalStudents: 0, atRiskCount: 0, threshold: atRiskThreshold });
    }
  };

  const ccStale = !!(cc && ttInfo && cc.updatedAt && ttInfo.generatedAt && cc.updatedAt > ttInfo.generatedAt);

  const loadCampusConfig = async () => {
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/admin/campus-config', tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
      const j = await r.json();
      if (j?.success) {
        setCc(j.config);
        setCcDirectory(j.directory || { sections: [], years: [] });
      }
    } catch { /* offline: editor keeps whatever it had */ }
  };
  const loadStaffDirectory = async () => {
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/admin/staff-directory', tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
      const j = await r.json();
      if (j?.success) { setStaff({ teachers: j.teachers || [], wardens: j.wardens || [] }); setStaffLoaded(true); }
    } catch { /* offline */ }
  };

  // ROOM ALLOCATION — phase 1 solves the plan (nothing written), the admin
  // reviews it in a preview modal, and only Confirm writes block/room into
  // the profiles. Same two-phase trust pattern as section regenerate.
  const runRoomAlloc = async (apply) => {
    setRoomBusy(true);
    setRoomMsg(null);
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/admin/allocate-rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ dryRun: !apply })
      });
      const j = await r.json();
      if (!j?.success) {
        setRoomMsg({ ok: false, text: j?.error || 'Room allocation failed.' });
      } else if (j.dryRun) {
        setRoomPlan(j);
      } else {
        setRoomPlan(null);
        setRoomMsg({ ok: true, text: j.statement || 'Room allocation applied.' });
      }
    } catch {
      setRoomMsg({ ok: false, text: 'Offline — room allocation needs connectivity.' });
    }
    setRoomBusy(false);
  };

  const handleRoomOverride = async () => {
    if (!ovRoll.trim() || !ovBlock || !ovRoom.trim()) {
      setRoomMsg({ ok: false, text: 'Roll number, block aur room — teeno chahiye.' });
      return;
    }
    setRoomBusy(true);
    setRoomMsg(null);
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/admin/assign-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ roll: ovRoll.trim(), block: ovBlock, room: ovRoom.trim() })
      });
      const j = await r.json();
      if (j?.success) {
        setRoomMsg({ ok: true, text: j.statement });
        setOvRoll(''); setOvRoom('');
      } else {
        setRoomMsg({ ok: false, text: j?.error || 'Room override failed.' });
      }
    } catch {
      setRoomMsg({ ok: false, text: 'Offline — room override needs connectivity.' });
    }
    setRoomBusy(false);
  };

  const ccMutate = (fn) => {
    setCc(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      fn(copy);
      return copy;
    });
  };

  const ccRun = async (dryRun) => {
    setCcBusy(true);
    setCcMsg(null);
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/admin/campus-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ config: cc, dryRun })
      });
      const j = await r.json();
      const errs = (j?.errors || []).map(e => ({ message: e }));
      if (j?.success && j.dryRun === false) {
        setCcMsg({ ok: true, text: j.statement, shadow: j.shadow });
        if (onNotification) onNotification(j.statement, 'success');
        loadCampusConfig();
      } else if (j?.report) {
        setCcMsg({ ok: !!j.success, text: j.report, errors: errs });
        if (!j.success && onNotification) onNotification(j.report, 'error');
      } else {
        setCcMsg({ ok: false, text: j?.error || 'Config processing failed.', errors: errs });
      }
    } catch {
      setCcMsg({ ok: false, text: 'Offline — saving the campus profile needs connectivity.' });
    }
    setCcBusy(false);
  };

  const ccExport = () => {
    const blob = new Blob([JSON.stringify(cc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'campus_config.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const ccImportFile = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const doc = JSON.parse(String(reader.result));
        if (doc && Array.isArray(doc.branches)) { setCc(doc); setCcMsg({ ok: true, text: 'Imported — review and press Test or Save.' }); }
        else setCcMsg({ ok: false, text: 'That file is not a campus config document.' });
      } catch { setCcMsg({ ok: false, text: 'Import failed — invalid JSON.' }); }
    };
    reader.readAsText(f);
    e.target.value = '';
  };


  const loadTimetableInfo = async () => {
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/timetable', tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
      const j = await r.json();
      if (j?.success) setTtInfo(j);
    } catch { /* offline — the panel keeps the last shown copy */ }
  };

  const handleGenerateTimetable = async () => {
    setTtBusy(true);
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/admin/generate-timetable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) }
      });
      const j = await r.json();
      if (j?.success) {
        setTtResult(j);
        if (onNotification) onNotification(
          `New timetable generated: ${j.summary.sections} sections across ${j.summary.departments} branches, ${j.summary.lectureSessions} lectures + ${j.summary.labSessions} labs, ${j.summary.solverSteers} solver steers — clash-free.`,
          'success'
        );
        loadTimetableInfo();
      } else if (onNotification) {
        onNotification(j?.error || 'Generation failed.', 'error');
      }
    } catch {
      if (onNotification) onNotification('Offline — the solver needs connectivity.', 'error');
    }
    setTtBusy(false);
  };

  // Regenerate is a TWO-PHASE flow: phase 1 asks the server for a dry-run
  // draft (nothing is published), the admin reviews the preview grid, and
  // only Confirm posts the same seed back to publish it for real.
  const handleRegenerateSection = async (sectionKey) => {
    setTtSecBusy(sectionKey);
    setTtSecResult(null);
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/admin/generate-timetable-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ sectionKey, dryRun: true })
      });
      const j = await r.json();
      if (j?.success) {
        const label = (ttInfo?.sections || []).find(s => s.key === sectionKey)?.label || sectionKey.split('|').pop();
        setTtSecPreview({ ...j, key: sectionKey, label });
      } else if (onNotification) {
        onNotification(j?.error || 'Section preview failed.', 'error');
      }
    } catch {
      if (onNotification) onNotification('Offline — the solver needs connectivity.', 'error');
    }
    setTtSecBusy(null);
  };

  const handleConfirmSection = async () => {
    if (!ttSecPreview) return;
    const { key, seed, label } = ttSecPreview;
    setTtSecBusy(key);
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/admin/generate-timetable-section', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ sectionKey: key, seed })
      });
      const j = await r.json();
      if (j?.success) {
        setTtSecResult(j);
        setTtSecPreview(null);
        if (onNotification) onNotification(`Section ${label} published — ${j.placed} classes placed, ${j.steers} steers, still clash-free.`, 'success');
        loadTimetableInfo();
      } else if (onNotification) {
        onNotification(j?.error || 'Publishing the section failed.', 'error');
      }
    } catch {
      if (onNotification) onNotification('Offline — the solver needs connectivity.', 'error');
    }
    setTtSecBusy(null);
  };

  // Teachers KPI: read the staff list once on mount (Campus Setup still reloads it when opened).
  useEffect(() => {
    loadStaffDirectory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeTab === 'timetable') { loadTimetableInfo(); loadAttLocks(); loadCampusConfig(); loadAtRisk(); }
    if (activeTab === 'setup') { loadCampusConfig(); loadStaffDirectory(); }
    if (activeTab === 'dispatcher') { loadCampusConfig(); } // courses + live sections/years for the campus audience dropdowns
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    getOutboxCount().then((count) => {
      setQueueDepth(count || 0);
    }).catch(console.warn);
  }, []);

  const handleManualSync = async () => {
    setIsSyncing(true);
    try {
      const synced = await flushOfflineQueue(onNotification);
      const count = await getOutboxCount();
      setQueueDepth(count || 0);
      if (synced === 0 && onNotification) {
        onNotification('Offline queue is empty — everything is synced.', 'info');
      }
    } finally {
      setIsSyncing(false);
    }
  };
  
  // Notice Dispatcher Form State
  const [noticeForm, setNoticeForm] = useState({
    title: '',
    content: '',
    noticeKind: 'hostel',        // 'hostel' = block fan-out | 'campus' = academic/course audience
    hostelBlock: 'All Hostels',  // 'All Hostels' = campus-wide; a real block value = targeted fan-out
    campusMode: 'ALL',           // ALL | COURSE | COURSE_SECTION | COURSE_YEAR
    campusCourse: '',
    campusSection: '',
    campusYear: '',
    showOn: '',                  // YYYY-MM-DD — surfaces as the student dash "Today's Notice" card on that date
    actionTag: 'Require 1-Tap Acknowledge',
    urgency: 'High',
    smsPhones: '' // optional extra admin-typed numbers (SMS fallback)
  });

  const [dispatchedNotices, setDispatchedNotices] = useState([]);
  const [isDispatching, setIsDispatching] = useState(false);

  // CSV Importer State
  const [importedUsers, setImportedUsers] = useState([]);
  const [importStats, setImportStats] = useState(null);
  const [isImporting, setIsImporting] = useState(false);
  // Faculty CSV ingest (teacher roster + login pre-provisioning)
  const [teachImport, setTeachImport] = useState(null); // { running, rows, result, error }
  const [searchQuery, setSearchQuery] = useState('');

  // Load imported users on startup
  useEffect(() => {
    getAllLocal('users').then((users) => {
      if (users && users.length > 0) {
        setImportedUsers(users);
        setImportStats({
          count: users.length,
          timeMs: 24,
          type: 'Cached IndexedDB Users'
        });
      }
    }).catch(console.warn);
  }, []);

  // Real college-wide stats come from the server (directory size + computed
  // SLA rate). No hardcoded/fallback numbers are shown — if the data is
  // unavailable, the card simply shows "—" instead of inventing a figure.
  const [campusStats, setCampusStats] = useState({ studentCount: null, slaResolutionRate: null, blockCount: null, blocks: [] });
  useEffect(() => {
    fetch('/api/dashboard-data')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data?.success) {
          const recent = Array.isArray(data.tickets) ? data.tickets : [];
          setCampusStats({
            studentCount: data.studentCount ?? null,
            slaResolutionRate: data.slaResolutionRate ?? null,
            blockCount: data.blockCount ?? null,
            blocks: Array.isArray(data.blocks) ? data.blocks : [],
            clusterCount: Array.isArray(data.masterClusters) ? data.masterClusters.length : null,
            recentTickets: recent.length,
            recentResolved: recent.filter(t => ['RESOLVED', 'CLOSED'].includes(String(t.status || '').toUpperCase())).length
          });
        }
      })
      .catch(() => { /* offline — keep null */ });
  }, []);

  // System Health — a real round-trip to the API server and a real probe of
  // the local AI model (GET /api/health?ai=1), re-checked while the tab is open.
  const [health, setHealth] = useState(null); // null = checking
  useEffect(() => {
    if (activeTab !== 'metrics') return undefined;
    let alive = true;
    const check = async () => {
      const t0 = performance.now();
      try {
        const r = await fetch('/api/health?ai=1', { cache: 'no-store' });
        const d = r.ok ? await r.json() : null;
        if (alive) setHealth({ online: !!d?.online, rttMs: Math.round(performance.now() - t0), ai: d?.ai || null, at: new Date() });
      } catch {
        if (alive) setHealth({ online: false, rttMs: null, ai: null, at: new Date() });
      }
    };
    check();
    // Settings → Live updates OFF: no timed re-checks (opening the tab still checks).
    const id = setInterval(() => { if (getLiveUpdates()) check(); }, 30000);
    return () => { alive = false; clearInterval(id); };
  }, [activeTab]);

  // Notice history — pulled from the central notice bus (real, server-persisted).
  useEffect(() => {
    fetch('/api/notices')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.success && Array.isArray(d.notices)) {
          // Server returns newest-first already.
          setDispatchedNotices(d.notices.slice(0, 30).map(mapServerNotice));
        }
      })
      .catch(() => { /* offline — keep whatever we have */ });
  }, []);

  // Mess Kitchen Forecast — real RSVP aggregates + operator-SMS alert status.
  // 30s refresh so the count the admin sees is the count the operator gets.
  const [messForecast, setMessForecast] = useState(null);
  const [showOperatorHelp, setShowOperatorHelp] = useState(false);
  useEffect(() => {
    let alive = true;
    const load = () => {
      fetch('/api/mess-forecast')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive && d?.success) setMessForecast(d); })
        .catch(() => { /* offline — keep last */ });
    };
    load();
    const t = setInterval(() => { if (getLiveUpdates()) load(); }, 30000); // Settings → Live updates
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Document Desk — REAL registrar queue from the DB (certificate requests
  // students submit from their dashboard). Actions PATCH the DB row and the
  // student's own feed is overlaid from /mine within seconds.
  const [docRequests, setDocRequests] = useState(null);
  const [docBusyId, setDocBusyId] = useState(null);
  useEffect(() => {
    if (activeTab !== 'docs') return;
    let alive = true;
    const load = () => {
      fetch('/api/document-requests')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive && d?.success) setDocRequests(d.requests || []); })
        .catch(() => { /* offline — keep last */ });
    };
    load();
    const t = setInterval(() => { if (getLiveUpdates()) load(); }, 20000); // Settings → Live updates
    return () => { alive = false; clearInterval(t); };
  }, [activeTab]);

  const setDocStatus = async (id, status) => {
    setDocBusyId(id);
    try {
      const res = await fetch(`/api/document-requests/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status })
      });
      const d = await res.json();
      if (d?.success) {
        setDocRequests(prev => (prev || []).map(r => (r.id === id ? { ...r, status } : r)));
        onNotification(`Document ${d.request?.docType || ''} → ${String(status).replace(/_/g, ' ')} (student notified via their channel)`);
      } else {
        onNotification(d?.error || 'Document status update failed');
      }
    } catch {
      onNotification('Document desk offline — the update will need a retry');
    } finally {
      setDocBusyId(null);
    }
  };

  // Forgotten-password reset (Admin/Dean only — enforced server-side too)
  const [resetRoll, setResetRoll] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [resetResult, setResetResult] = useState(null);

  const handlePasswordReset = async () => {
    if (!resetRoll.trim()) return;
    setResetBusy(true);
    setResetResult(null);
    try {
      const res = await fetch('/api/admin/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rollNumber: resetRoll.trim() })
      });
      const data = await res.json();
      setResetResult({
        ok: !!data.success,
        text: data.success
          ? `✅ ${data.message}`
          : `❌ ${data.error || 'Reset failed — try again.'}`
      });
      if (data.success) {
        setResetRoll('');
        triggerToast(`Password reset for ${data.studentName || 'student'} — default restored.`);
      }
    } catch {
      setResetResult({ ok: false, text: '❌ Cannot reach the campus server right now.' });
    } finally {
      setResetBusy(false);
    }
  };

  const triggerToast = (msg) => {
    if (onNotification) onNotification(msg);
  };

  // Dispatch Targeted Notice
  const handleDispatchNotice = async (e) => {
    e.preventDefault();
    if (!noticeForm.title.trim() || !noticeForm.content.trim()) return;
    // Campus/academic narrow audiences must be fully picked — an incomplete
    // filter would silently broadcast to everyone.
    if (noticeForm.noticeKind === 'campus' && noticeForm.campusMode !== 'ALL') {
      const complete = noticeForm.campusMode === 'COURSE' ? !!noticeForm.campusCourse
        : noticeForm.campusMode === 'COURSE_SECTION' ? !!(noticeForm.campusCourse && noticeForm.campusSection)
        : !!(noticeForm.campusCourse && noticeForm.campusYear);
      if (!complete) {
        if (onNotification) onNotification('Pick the course (and section/year) for this audience first.', 'error');
        return;
      }
    }

    setIsDispatching(true);
    try {
      const isCampus = noticeForm.noticeKind === 'campus';
      const isBlockTargeted = !isCampus && noticeForm.hostelBlock !== 'All Hostels';
      const campusNarrow = isCampus && noticeForm.campusMode !== 'ALL';
      const campusLabel = {
        ALL: 'All Students — Campus Wide',
        COURSE: `Course ${noticeForm.campusCourse || '—'}`,
        COURSE_SECTION: `${noticeForm.campusCourse || '—'} · Section ${noticeForm.campusSection || '—'}`,
        COURSE_YEAR: `${noticeForm.campusCourse || '—'} · ${noticeForm.campusYear || '—'} Batch`
      }[noticeForm.campusMode] || 'All Students — Campus Wide';
      const targetLabel = isBlockTargeted
        ? `Hostel Block ${noticeForm.hostelBlock}`
        : isCampus ? campusLabel
        : 'All Students — Campus Wide';

      const newNotice = {
        id: `NOTIF-${Date.now().toString(36).toUpperCase()}`,
        title: noticeForm.title,
        content: noticeForm.content,
        target: targetLabel,
        actionTag: noticeForm.actionTag,
        urgency: noticeForm.urgency,
        publishedAt: 'Just now',
        totalTargeted: null,   // filled from the server's real recipient resolution
        deliveredCount: 0,     // delivery happens server-side in the background
        pushStudents: null,
        smsCount: 0,
        smsModes: [],
        noContact: 0,
        priority: noticeForm.urgency
      };

      // Local persistence must never abort the dispatch: IndexedDB can
      // transiently throw ("object stores not found" on first boot of a new
      // service-worker version). The central notice bus is now the source
      // of truth — local failures only degrade offline history.
      try {
        await saveLocal('notices', newNotice);
      } catch (dbErr) {
        console.warn('Local notice persistence failed (non-blocking):', dbErr.message);
      }

      // Push to the central notice bus (server) so every PWA device can
      // poll it and raise real system notifications. For a block target the
      // server resolves recipients from the live roster: activated students
      // get push, the rest get allowlist-gated SMS (SMS_MAX_PER_BROADCAST cap).
      // ONLY queue for the offline outbox when the server was unreachable —
      // queuing on success would replay the same notice twice when the
      // outbox flushes later.
      let serverAck = null;
      try {
        const res = await fetch('/api/notices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: newNotice.title,
            content: newNotice.content,
            target: targetLabel,
            category: isBlockTargeted ? 'Hostel' : (isCampus ? 'Academic' : 'General'),
            urgency: noticeForm.urgency,
            source: 'Admin Notice Desk',
            smsPhones: noticeForm.smsPhones || '',
            targetBlock: isBlockTargeted ? noticeForm.hostelBlock : null,
            audience: isCampus ? 'campus' : 'hostel',
            campusFilter: isCampus ? {
              mode: noticeForm.campusMode,
              course: noticeForm.campusCourse,
              section: noticeForm.campusSection,
              year: noticeForm.campusYear
            } : null,
            showOn: noticeForm.showOn || null
          })
        });
        if (res.ok) {
          serverAck = await res.json();
        } else {
          await queueOfflineAction('DISPATCH_NOTICE', newNotice);
        }
      } catch (netErr) {
        console.warn('Notice bus unreachable (queued for offline flush):', netErr.message);
        try {
          await queueOfflineAction('DISPATCH_NOTICE', newNotice);
        } catch (dbErr) {
          console.warn('Outbox queue write failed (non-blocking):', dbErr.message);
        }
      }

      // Real recipient split straight from the server's roster resolution.
      let dispatchSummary;
      if (serverAck?.success && serverAck?.notice) {
        const r = serverAck.notice.recipients;
        if (r) {
          newNotice.totalTargeted = r.total;
          newNotice.pushStudents = r.pushStudents;
          newNotice.smsCount = r.smsStudents;
          newNotice.deliveredCount = r.pushStudents + r.smsStudents; // in-flight; confirmed counts refresh on next history load
          newNotice.noContact = r.noContact;
        } else {
          newNotice.totalTargeted = null; // campus-wide broadcast — counts land on next history load
        }
        dispatchSummary = r
          ? `${r.total} residents reached → ${r.pushStudents} by app push, ${r.smsStudents} by SMS${r.noContact ? `, ${r.noContact} without any contact on file` : ''}`
          : 'campus-wide broadcast (push to every active device)';
      } else {
        dispatchSummary = 'queued offline — will dispatch when the connection returns';
      }

      setDispatchedNotices([newNotice, ...dispatchedNotices]);
      setNoticeForm({
        title: '',
        content: '',
        hostelBlock: 'All Hostels',
        actionTag: 'Require 1-Tap Acknowledge',
        urgency: 'High',
        smsPhones: ''
      });
      triggerToast(`Notice dispatched to ${targetLabel}: ${dispatchSummary}`);
    } catch (err) {
      console.error('Dispatch failed:', err);
    } finally {
      setIsDispatching(false);
    }
  };

  // CSV Client-Side Fast Parser
  const parseCSVText = (text) => {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    const records = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      if (values.length === headers.length) {
        const item = {};
        headers.forEach((h, idx) => {
          item[h] = values[idx];
        });
        records.push(item);
      }
    }
    return records;
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const startTime = performance.now();

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const csvContent = e.target.result;
        const parsedData = parseCSVText(csvContent);

        if (parsedData.length > 0) {
          // 1. Push to the real college database (Supabase `profiles`, ADMIN/DEAN
          //    gated) — an uploaded roster becomes real directory entries that
          //    all cards counts reflect. Upsert-safe by roll number.
          let cloudResult = null;
          try {
            const res = await fetch('/api/admin/bulk-ingest', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ students: parsedData })
            });
            cloudResult = await res.json();
          } catch (cloudErr) {
            console.warn('Cloud ingest unreachable — saved locally only:', cloudErr.message);
          }

          // 2. Local mirror for offline/roster browsing
          await bulkSaveLocal('users', parsedData);
          const endTime = performance.now();
          const duration = Math.round(endTime - startTime);

          // Refresh the live directory count from the server (e.g. 2000 → 2050)
          if (cloudResult?.success) {
            try {
              const dash = await fetch('/api/dashboard-data');
              if (dash.ok) {
                const dashData = await dash.json();
                if (dashData?.success && dashData.studentCount != null) {
                  setCampusStats((s) => ({ ...s, studentCount: dashData.studentCount }));
                }
              }
            } catch { /* keep old count */ }
          }

          setImportedUsers(parsedData);
          setImportStats({
            count: parsedData.length,
            timeMs: duration,
            type: file.name
          });

          if (cloudResult?.success) {
            triggerToast(`${cloudResult.totalUpserted}/${parsedData.length} records added to the college directory in ${duration}ms!`);
          } else if (cloudResult?.rejected) {
            triggerToast(`CSV REJECTED — ${cloudResult.errors?.length || '?'} row(s) missing compulsory fields. Nothing was imported. First issue: ${cloudResult.errors?.[0]?.error || ''}`, 'warning');
          } else if (cloudResult && !cloudResult.success) {
            triggerToast(`Cloud ingest issue: ${cloudResult.error || 'some batches failed'} — records kept locally.`, 'warning');
          } else {
            triggerToast(`Saved ${parsedData.length} records locally — college database unreachable (offline).`, 'info');
          }
        }
      } catch (err) {
        console.error('CSV ingest failed:', err);
        triggerToast('CSV ingest failed — invalid file?', 'warning');
      } finally {
        setIsImporting(false);
      }
    };
    reader.readAsText(file);
  };

  // Faculty CSV ingest — mirrors the student flow but posts the staff payload
  // to the teacher endpoint (profiles + pre-provisioned logins server-side).
  const handleTeacherFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setTeachImport({ running: true });
    try {
      const text = await file.text();
      const rows = parseCSVText(text).map(r => ({
        teacher_name: r.teacher_name || r.name,
        staff_id: r.staff_id || r.staffId,
        password: r.password,
        subject_specialization: r.subject_specialization || r.subjectSpecialization,
        department: r.department,
        phone_number: r.phone_number || r.phone
      })).filter(r => r.staff_id && r.teacher_name);
      if (rows.length === 0) {
        setTeachImport({ running: false, error: 'No usable rows — check the CSV headers (teacher_name, staff_id, password, …)' });
        return;
      }
      const res = await fetch('/api/admin/bulk-ingest-teachers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teachers: rows })
      });
      const j = await res.json();
      if (j?.success || j?.created != null) {
        setTeachImport({ running: false, rows: rows.length, result: j });
        triggerToast(j?.success
          ? `Faculty roster updated — ${j.created} new staff, ${j.refreshed || 0} refreshed · ${j.totalActiveTeachers} teachers total`
          : `Import finished with issues — ${j.errors?.length || 0} row(s) failed`, j?.success ? 'success' : 'warning');
      } else {
        setTeachImport({ running: false, error: j?.error || 'Import endpoint rejected the file' });
      }
    } catch (err) {
      setTeachImport({ running: false, error: 'Upload failed — ' + err.message });
    }
  };

  const effectiveQuery = (searchQuery || externalSearchQuery || '').toLowerCase();
  const filteredUsers = importedUsers.filter(u => 
    (u.name || '').toLowerCase().includes(effectiveQuery) ||
    (u.rollNo || '').toLowerCase().includes(effectiveQuery) ||
    (u.hostelBlock || '').toLowerCase().includes(effectiveQuery)
  );


  // ── Layout only: the same 8 admin tools (same ids, same labels, same
  // setActiveTab handler), grouped into sections, and the 4 KPI figures shown
  // compact instead of 4 big cards. No data or behaviour change.
  const adminTabs = {
    dispatcher: { label: 'Send Notice', Icon: Send, on: 'bg-emerald-600 text-white', off: 'bg-emerald-100 text-emerald-600', sel: 'bg-emerald-50 border-emerald-400 text-emerald-900', bar: 'bg-emerald-500' },
    docs: { label: 'Document Desk', Icon: FileText, on: 'bg-violet-600 text-white', off: 'bg-violet-100 text-violet-600', sel: 'bg-violet-50 border-violet-400 text-violet-900', bar: 'bg-violet-500' },
    timetable: { label: 'Timetable Engine', Icon: Calendar, on: 'bg-teal-600 text-white', off: 'bg-teal-100 text-teal-600', sel: 'bg-teal-50 border-teal-400 text-teal-900', bar: 'bg-teal-500' },
    setup: { label: 'Campus Setup', Icon: Building2, on: 'bg-indigo-600 text-white', off: 'bg-indigo-100 text-indigo-600', sel: 'bg-indigo-50 border-indigo-400 text-indigo-900', bar: 'bg-indigo-500' },
    mess: { label: 'Mess Kitchen Forecast', Icon: Utensils, on: 'bg-amber-600 text-white', off: 'bg-amber-100 text-amber-600', sel: 'bg-amber-50 border-amber-400 text-amber-900', bar: 'bg-amber-500' },
    csv: { label: `Import Students (CSV) (${importedUsers.length})`, Icon: FileSpreadsheet, on: 'bg-purple-600 text-white', off: 'bg-purple-100 text-purple-600', sel: 'bg-purple-50 border-purple-400 text-purple-900', bar: 'bg-purple-500' },
    metrics: { label: 'System Health & Sync Engine', Icon: Database, on: 'bg-sky-600 text-white', off: 'bg-sky-100 text-sky-600', sel: 'bg-sky-50 border-sky-400 text-sky-900', bar: 'bg-sky-500' },
    fees: { label: 'Fee Payments', Icon: Receipt, on: 'bg-emerald-600 text-white', off: 'bg-emerald-100 text-emerald-600', sel: 'bg-emerald-50 border-emerald-400 text-emerald-900', bar: 'bg-emerald-500' },
    security: { label: 'Password Reset Desk', Icon: ShieldCheck, on: 'bg-rose-600 text-white', off: 'bg-rose-100 text-rose-600', sel: 'bg-rose-50 border-rose-400 text-rose-900', bar: 'bg-rose-500' },
  };
  const adminGroups = [
    { title: 'Communication', ids: ['dispatcher'] },
    { title: 'Academics', ids: ['timetable'] },
    { title: 'Campus & Hostel', ids: ['setup', 'mess'] },
    { title: 'Support', ids: ['docs', 'fees', 'security'] },
    { title: 'Data & System', ids: ['csv', 'metrics'] },
  ];
  const activeGroup = adminGroups.find(g => g.ids.includes(activeTab)) || adminGroups[0];
  const adminKpis = [
    { label: 'Total Enrolled Students', value: campusStats.studentCount != null ? campusStats.studentCount.toLocaleString() : (importedUsers.length > 0 ? importedUsers.length : '—'), note: 'Active Rosters', dot: 'bg-purple-500', pill: 'bg-purple-100 text-purple-800' },
    { label: 'Hostel Blocks', value: campusStats.blockCount != null ? campusStats.blockCount.toLocaleString() : '—', note: 'On the live roster', dot: 'bg-blue-500', pill: 'bg-blue-100 text-blue-800' },
    { label: 'Resolution SLA Rate', value: campusStats.slaResolutionRate != null ? `${campusStats.slaResolutionRate}%` : '—', note: 'Target: >90%', dot: 'bg-emerald-500', pill: 'bg-emerald-100 text-emerald-800' },
    { label: 'Teachers', value: staffLoaded ? staff.teachers.length.toLocaleString() : '—', note: 'Faculty on roster', dot: 'bg-amber-500', pill: 'bg-amber-100 text-amber-800' },
  ];

  // Option A: mount point the app sidebar renders under "Home" for Admin.
  // If the sidebar is collapsed (slot clipped), the in-page nav takes over.
  const [toolNavSlot, setToolNavSlot] = useState(null);
  const [slotShown, setSlotShown] = useState(true);
  useEffect(() => {
    const el = document.getElementById('admin-tool-nav');
    setToolNavSlot(el);
    if (!el || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver(([e]) => setSlotShown(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div className="admin-dash space-y-5 animate-in fade-in duration-200">
      {/* Cover board escalation: an absent teacher's class nobody took */}
      <AdminCoverAlerts onNotification={onNotification} />
      
      {/* Laptop: the tools live as a grouped sub-menu under "Home" in the app sidebar */}
      {toolNavSlot && createPortal(
        <div className="mt-1 mb-2 ml-4 pl-2.5 border-l-2 border-slate-100 space-y-2">
          {adminGroups.map((g) => (
            <div key={g.title}>
              <p className="text-[9px] uppercase tracking-wider font-bold text-slate-400 px-2 pb-0.5">{g.title}</p>
              {g.ids.map((id) => {
                const t = adminTabs[id];
                const on = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    data-admin-tab={id}
                    onClick={() => setActiveTab(id)}
                    className={`w-full min-h-[44px] lg:min-h-[38px] flex items-center gap-2 rounded-lg border px-2 py-1 text-left transition-colors cursor-pointer ${on ? t.sel : 'border-transparent text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'}`}
                  >
                    <span className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 ${on ? t.on : t.off}`}>
                      <t.Icon className="w-3.5 h-3.5" />
                    </span>
                    <span className="text-[11px] font-bold leading-tight min-w-0">{t.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>,
        toolNavSlot
      )}


      {/* Slim KPI strip — the same 4 figures as the old big cards */}
      <section className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-3.5 lg:px-4 pt-2.5 lg:pt-3 pb-2 flex items-center justify-between gap-2">
          <h2 className="font-display font-extrabold text-base lg:text-lg text-slate-900 tracking-tight">Admin Console</h2>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Overview</span>
        </div>
        <div className="grid grid-cols-4 border-t border-slate-100 divide-x divide-slate-100">
          {adminKpis.map((k) => (
            <div key={k.label} className="px-2 lg:px-4 py-2 lg:py-2.5 min-w-0 flex flex-col-reverse lg:flex-col justify-end gap-0.5">
              <p className="text-[9px] lg:text-[11px] font-bold text-slate-500 flex items-start lg:items-center gap-1.5 min-w-0 leading-tight">
                <span className={`hidden lg:inline-block w-1.5 h-1.5 rounded-full shrink-0 ${k.dot}`}></span>
                <span className="lg:truncate">{k.label}<span className="lg:hidden block font-semibold text-slate-400">{k.note}</span></span>
              </p>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 min-w-0">
                <span className={`lg:hidden w-1.5 h-1.5 rounded-full shrink-0 self-center ${k.dot}`}></span>
                <span className={`font-mono font-extrabold text-slate-900 break-words min-w-0 ${k.small ? 'text-[10px] lg:text-sm' : 'text-base lg:text-xl'}`}>{k.value}</span>
                <span className={`hidden lg:inline text-[10px] font-bold px-1.5 py-0.5 rounded ${k.pill} whitespace-nowrap`}>{k.note}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Phone: the 5 groups as a bottom tab bar (portal to <body> so it stays fixed) */}
      {createPortal(
        <nav className={`${toolNavSlot && slotShown ? 'lg:hidden' : ''} fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-slate-200 shadow-[0_-4px_16px_rgba(15,23,42,0.06)] pb-[env(safe-area-inset-bottom)]`}>
          <div className="flex max-w-lg mx-auto">
            {adminGroups.map((g) => {
              const on = g.ids.includes(activeTab);
              const t = adminTabs[g.ids[0]];
              return (
                <button
                  key={g.title}
                  type="button"
                  data-admin-group={g.title}
                  onClick={() => setActiveTab(on ? activeTab : g.ids[0])}
                  className={`min-h-[60px] flex-[1_1_auto] flex flex-col items-center justify-center gap-1 px-0.5 cursor-pointer ${on ? 'text-slate-900' : 'text-slate-500'}`}
                >
                  <span className={`w-9 h-7 rounded-full flex items-center justify-center ${on ? t.on : 'text-slate-500'}`}>
                    <t.Icon className="w-4 h-4" />
                  </span>
                  <span className="text-[9.5px] font-bold leading-tight text-center">{g.title}</span>
                </button>
              );
            })}
          </div>
        </nav>,
        document.body
      )}

      {/* Phone: tools of the selected group as a segmented switch */}
      {activeGroup.ids.length > 1 && (
        <div className={`${toolNavSlot && slotShown ? 'lg:hidden' : ''} grid grid-cols-2 gap-1 bg-white border border-slate-200 rounded-2xl shadow-sm p-1`}>
          {activeGroup.ids.map((id, i) => {
            const t = adminTabs[id];
            const on = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                data-admin-tab={id}
                onClick={() => setActiveTab(id)}
                className={`${i === activeGroup.ids.length - 1 && activeGroup.ids.length % 2 === 1 ? 'col-span-2 ' : ''}min-h-[44px] flex items-center justify-center gap-1.5 rounded-xl border px-2 py-1 text-center transition-colors cursor-pointer ${on ? t.sel : 'border-transparent text-slate-600 hover:bg-slate-50'}`}
              >
                <t.Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="text-[11px] font-bold leading-tight">{t.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Selected tool — clear section header so the panel below is the focus */}
      <div className="flex items-center gap-2 px-1 min-w-0">
        <span className={`w-1 h-5 rounded-full shrink-0 ${(adminTabs[activeTab] || adminTabs.dispatcher).bar}`}></span>
        <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wider text-slate-400 shrink-0">{activeGroup.title}</span>
        <span className="text-slate-300 shrink-0">/</span>
        <h3 className="font-display font-extrabold text-sm sm:text-base text-slate-900 leading-tight break-words min-w-0">{(adminTabs[activeTab] || adminTabs.dispatcher).label}</h3>
      </div>

      {/* --- FEE PAYMENTS (read-only list of the students' demo Settle Dues receipts) --- */}
      {activeTab === 'fees' && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <Receipt className="w-5 h-5 text-emerald-600" />
              <span>Fee Payments</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Receipts from students&apos; Settle Dues taps (demo payments, no real money moves). Read-only.
            </p>
          </div>
          <FeePaymentsPanel />
        </section>
      )}

      {/* --- TAB 5: DOCUMENT DESK (Registrar queue) --- */}
      {activeTab === 'docs' && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <FileText className="w-5 h-5 text-violet-600" />
              <span>Document Desk — Registrar Queue</span>
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Real certificate requests from student dashboards. Your verdict updates their app feed within seconds (pushed via their channel).
            </p>
          </div>

          {!docRequests ? (
            <div className="py-10 text-center text-slate-500 text-xs">
              Reading the registrar queue from the campus database…
            </div>
          ) : docRequests.length === 0 ? (
            <div className="py-10 text-center text-slate-400 text-xs">
              No certificate requests yet — students submit these from their dashboard ("Request Official Document").
            </div>
          ) : (
            <div className="space-y-2.5">
              {docRequests.map((r) => {
                const student = r.student;
                const statusChip = {
                  PENDING: 'text-amber-800 bg-amber-50 border-amber-200',
                  PROCESSING: 'text-sky-800 bg-sky-50 border-sky-200',
                  READY_FOR_PICKUP: 'text-emerald-800 bg-emerald-50 border-emerald-200',
                  REJECTED: 'text-rose-800 bg-rose-50 border-rose-200'
                }[r.status] || 'text-slate-700 bg-slate-100 border-slate-300';
                return (
                  <div key={r.id} className="bg-slate-50/60 border border-slate-200 rounded-xl px-3.5 py-3 space-y-2">
                    {/* Row 1: ref + verdict pills, date/time stacked at the right */}
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 text-[10px] font-mono font-extrabold px-2.5 py-1 rounded-full bg-violet-100 border border-violet-200 text-violet-800">
                        {r.ref || String(r.id).slice(0, 8).toUpperCase()}
                      </span>
                      <span className={`shrink-0 text-[10px] font-mono font-extrabold px-2 py-1 rounded-full border ${statusChip}`}>
                        {String(r.status).replace(/_/g, ' ')}
                      </span>
                      <span className="ml-auto shrink-0 text-right font-mono text-[10px] text-slate-400 leading-tight">
                        <span className="block">{new Date(r.createdAt).toLocaleDateString([], { day: '2-digit', month: 'short' })}</span>
                        <span className="block">{new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </span>
                    </div>
                    {/* Row 2: name, with the roll number directly beneath */}
                    {student ? (
                      <div>
                        <p className="text-[12px] font-extrabold text-slate-900 leading-snug break-words">{student.name || '—'}</p>
                        {student.roll && (
                          <p className="text-[10px] font-mono text-slate-500">{student.roll}</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[12px] font-bold text-slate-400 italic">Student (unlinked row)</p>
                    )}
                    <p className="text-[11px] text-slate-600 leading-relaxed break-words">
                      <b className="text-slate-800">{r.docType.replace(/_/g, ' ')}</b>
                      {r.remarks ? ` — ${r.remarks}` : ' — no purpose stated'}
                    </p>
                    {r.status !== 'READY_FOR_PICKUP' && r.status !== 'REJECTED' && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        <button
                          onClick={() => setDocStatus(r.id, 'READY_FOR_PICKUP')}
                          disabled={docBusyId === r.id}
                          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-bold cursor-pointer transition-all"
                        >
                          {docBusyId === r.id ? 'Saving…' : '✓ Ready for Pickup'}
                        </button>
                        <button
                          onClick={() => setDocStatus(r.id, 'REJECTED')}
                          disabled={docBusyId === r.id}
                          className="px-3 py-1.5 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 disabled:opacity-50 text-rose-700 text-[10px] font-bold cursor-pointer transition-all"
                        >
                          ✕ Reject
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* --- TAB 6: TIMETABLE ENGINE (Phase 2 solver) --- */}
      {activeTab === 'timetable' && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Calendar className="w-5 h-5 text-teal-600" />
                <span>Academic Timetable Engine</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Generates one clash-free weekly schedule per SECTION (40 sections × 50 students) — specialist pools
                mean no teacher is ever double-booked anywhere on campus, labs land on consecutive-period pairs in the
                branch lab (one section at a time), and every section gets its own room pool.
              </p>
            </div>
            <button
              onClick={handleGenerateTimetable}
              disabled={ttBusy}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-xs font-bold cursor-pointer transition-all shrink-0 shadow-sm"
            >
              <RefreshCw className={`w-4 h-4 ${ttBusy ? 'animate-spin' : ''}`} />
              {ttBusy ? 'Solving…' : ttInfo ? 'Regenerate Timetable' : 'Generate Timetable'}
            </button>
          </div>

          {ccStale && (
            <div className="rounded-xl bg-amber-50 border border-amber-300 p-3 text-[11px] font-bold text-amber-900">
              ⚠ Campus config changed AFTER this timetable was generated — regenerate to apply the new rooms/subjects/pools.
            </div>
          )}

          {ttInfo ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { label: 'Sections', value: ttInfo.summary?.sections ?? '—' },
                  { label: 'Lecture sessions', value: ttInfo.summary?.lectureSessions ?? '—' },
                  { label: 'Lab blocks', value: ttInfo.summary?.labSessions ?? '—' },
                  { label: 'Solver steers', value: ttInfo.summary?.solverSteers ?? '—' }
                ].map(s => (
                  <div key={s.label} className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                    <p className="text-lg font-black text-slate-900">{s.value}</p>
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mt-0.5">{s.label}</p>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-slate-500 font-medium">
                Live version <code className="font-mono bg-slate-100 px-1 py-0.5 rounded">{ttInfo.version}</code>
                {ttInfo.generatedAt ? ` — generated ${new Date(ttInfo.generatedAt).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} by ${ttInfo.generatedBy || 'system'}` : ''}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(ttInfo.sections || []).map(sec => {
                  const isBusy = ttSecBusy === sec.key;
                  return (
                    <div key={sec.key} className="flex items-center justify-between gap-2 rounded-lg border border-slate-100 bg-slate-50/50 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-slate-800 truncate">{sec.label}</p>
                        <p className="text-[10px] text-slate-500 font-mono">{sec.sessions} scheduled sessions</p>
                      </div>
                      <button
                        onClick={() => handleRegenerateSection(sec.key)}
                        disabled={!!ttSecBusy}
                        className="shrink-0 text-[10px] font-black text-teal-700 bg-teal-50 border border-teal-200 hover:bg-teal-100 disabled:opacity-50 rounded-full px-2.5 py-1 transition-colors cursor-pointer"
                        title="Re-solve just this section against the other 39"
                      >
                        {isBusy ? 'solving…' : '↻ regenerate'}
                      </button>
                    </div>
                  );
                })}
              </div>
              {ttSecResult && (
                <div className="rounded-xl bg-teal-50 border border-teal-200 p-3 text-[11px] text-teal-900 font-semibold">
                  ✓ Section re-solved: {ttSecResult.placed} classes placed, {ttSecResult.library} library slots, {ttSecResult.steers} specialist steers — {ttSecResult.sectionKey}
                </div>
              )}

              {/* Section-regenerate PREVIEW — the solver ran as a dry-run;
                  this draft becomes the live timetable ONLY on Confirm. */}
              {ttSecPreview && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setTtSecPreview(null)}>
                  <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5 space-y-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">Preview — {ttSecPreview.label}</p>
                        <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Draft · live hone ke liye Confirm dabayein</p>
                      </div>
                      <button onClick={() => setTtSecPreview(null)} className="text-slate-400 hover:text-slate-700 text-lg leading-none cursor-pointer">✕</button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
                      <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-slate-700">{ttSecPreview.placed} classes</span>
                      <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-slate-700">{ttSecPreview.library} library slots</span>
                      <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-slate-700">{ttSecPreview.steers} steers</span>
                      <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-slate-400 font-mono">seed {ttSecPreview.seed}</span>
                    </div>
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-[9px] border-collapse">
                        <thead>
                          <tr className="bg-slate-50">
                            <th className="p-1.5 text-left text-slate-400 font-black uppercase"></th>
                            {[1, 2, 3, 4, 5, 6].map(p => <th key={p} className="p-1.5 text-slate-500 font-black uppercase">P{p}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {['MON', 'TUE', 'WED', 'THUR', 'FRI', 'SAT'].map(day => {
                            const row = [];
                            for (let p = 1; p <= 6; p++) {
                              const s = (ttSecPreview.slots || []).find(x => x.day === day && x.period === p && x.kind !== 'study');
                              if (s && s.kind === 'lab' && s.span === 2) {
                                row.push(
                                  <td key={p} colSpan={2} className="p-1.5 align-top bg-violet-50 border border-slate-100">
                                    <p className="font-black text-violet-900">🧪 {s.subjectCode}</p>
                                    <p className="text-slate-500 truncate">{s.room}</p>
                                    <p className="text-slate-400 truncate">{s.teacherName}</p>
                                  </td>
                                );
                                p++;
                              } else if (s) {
                                row.push(
                                  <td key={p} className="p-1.5 align-top bg-white border border-slate-100">
                                    <p className="font-black text-slate-800">{s.subjectCode}</p>
                                    <p className="text-slate-500 truncate">{s.room}</p>
                                    <p className="text-slate-400 truncate">{s.teacherName}</p>
                                  </td>
                                );
                              } else {
                                row.push(<td key={p} className="p-1.5 bg-slate-50/50 border border-slate-100 text-center text-slate-300">·</td>);
                              }
                            }
                            return (
                              <tr key={day}>
                                <th className="p-1.5 text-left text-slate-400 font-black uppercase bg-slate-50">{day}</th>
                                {row}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[10px] text-slate-500 font-medium">Solved against the other 39 sections — clash-free. Publishing replaces only this section.</p>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => setTtSecPreview(null)} className="text-[11px] font-black text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-full px-4 py-1.5 cursor-pointer">Cancel</button>
                        <button
                          onClick={handleConfirmSection}
                          disabled={!!ttSecBusy}
                          className="text-[11px] font-black text-white bg-teal-600 hover:bg-teal-700 disabled:opacity-50 rounded-full px-4 py-1.5 cursor-pointer"
                        >
                          {ttSecBusy ? 'publishing…' : '✓ Confirm & Publish'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Today's teacher absences & substitute covers (read-only) */}
              <AdminCoversCard />

              {/* Attendance locks — today's saved classes are FROZEN; only
                  this panel can release one for re-marking. */}
              <div className="rounded-xl border border-slate-200 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-black text-slate-700 uppercase tracking-wider">
                    🔒 Attendance locks today
                  </p>
                  <button
                    onClick={loadAttLocks}
                    className="text-[10px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
                  >
                    refresh
                  </button>
                </div>
                {attLocks.length === 0 ? (
                  <p className="text-[11px] text-slate-500 font-medium">
                    No classes marked yet today. Once a teacher saves attendance, it locks — it can only be released here.
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {attLocks.map(l => (
                      <div key={l.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-800 truncate">
                            {l.sectionLabel || l.department} · P{l.period} — {l.subjectCode}
                          </p>
                          <p className="text-[10px] text-slate-500 font-medium truncate">
                            {(l.present || []).length} present · by {l.takenByName || l.takenByLogin} at {l.takenAt ? new Date(l.takenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                          </p>
                        </div>
                        <button
                          onClick={() => handleAttUnlock(l)}
                          disabled={attUnlockBusy === l.id}
                          className="shrink-0 text-[10px] font-black text-rose-700 bg-rose-50 border border-rose-200 hover:bg-rose-100 disabled:opacity-50 rounded-full px-2.5 py-1 transition-colors cursor-pointer"
                          title="Delete this locked record so the teacher can mark the class again"
                        >
                          {attUnlockBusy === l.id ? 'unlocking…' : '🔓 Unlock'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {/* --- STEP 6: AT-RISK STUDENTS (<50% live attendance) --- */}
              <div className="rounded-xl border-2 border-dashed border-rose-200 bg-rose-50/40 p-4 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-black text-rose-800 uppercase tracking-wider">
                      ⚠ At-Risk Students — below {atRiskThreshold}% attendance
                    </p>
                    <p className="text-[11px] text-slate-600 font-medium mt-1">
                      Computed live from every recorded class: each mark and unlock recomputes each student's real
                      percentage. Day scholars need their <b>mentor</b>, hostellers their <b>warden</b>.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {atRisk?.success && (
                      <span className="text-[11px] font-black text-rose-900 bg-white border border-rose-200 rounded-full px-3 py-1">
                        {atRisk.atRiskCount} / {atRisk.totalStudents?.toLocaleString?.() ?? atRisk.totalStudents} students
                      </span>
                    )}
                    <button onClick={loadAtRisk} className="text-[10px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer">refresh</button>
                  </div>
                </div>
                {!atRisk ? (
                  <p className="text-[11px] text-slate-500 font-medium">Scanning rosters…</p>
                ) : !atRisk.success ? (
                  <p className="text-[11px] text-rose-700 font-bold">Could not load the at-risk roster — check connectivity.</p>
                ) : atRisk.atRiskCount === 0 ? (
                  <p className="text-[11px] text-emerald-700 font-bold">
                    ✓ No student is below {atRiskThreshold}% — the whole campus is above the line.
                  </p>
                ) : (
                  <>
                    {Object.keys(atRisk.bySection || {}).length > 1 && (
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(atRisk.bySection).sort((a, b) => b[1] - a[1]).map(([sec, n]) => (
                          <span key={sec} className="text-[10px] font-black text-rose-800 bg-white border border-rose-200 rounded-full px-2 py-0.5">
                            {sec}: {n}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="space-y-1 max-h-72 overflow-y-auto">
                      {atRisk.atRisk.map(s => (
                        <div key={s.roll} className="flex items-center justify-between gap-2 rounded-lg bg-white border border-rose-100 px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-800 truncate">
                              {s.roll} · {s.name}
                            </p>
                            <p className="text-[10px] text-slate-500 font-medium truncate">
                              {s.course}{s.section ? ` · Sec ${s.section}` : ''} · {s.residentType === 'hosteller' ? `hosteller (${s.block || 'no block'}) → warden` : 'day scholar → mentor'}
                            </p>
                          </div>
                          <span className={`shrink-0 text-[11px] font-black rounded-full px-2.5 py-1 border ${
                            s.pct < 30 ? 'bg-rose-100 text-rose-800 border-rose-300' : 'bg-amber-50 text-amber-800 border-amber-200'
                          }`}>
                            {s.pct != null ? `${s.pct}%` : '—'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
              {/* --- STEP 5: Upload Timetable CSV for ONE section --- */}
              <div className="rounded-xl border-2 border-dashed border-teal-200 bg-teal-50/40 p-4 space-y-3">
                <div>
                  <p className="text-[11px] font-black text-teal-800 uppercase tracking-wider">📄 Upload Timetable CSV — one section</p>
                  <p className="text-[11px] text-slate-600 font-medium mt-1">
                    Weekly grid as CSV: <code className="font-mono bg-white px-1 rounded border border-slate-200">day, period, subject_code, kind, teacher_id, room</code>{' '}
                    — e.g. <code className="font-mono bg-white px-1 rounded border border-slate-200">MON,1,MATHS,lecture,,</code>. Kind is lecture (default) or lab (labs take a P1-P2 or P4-P5 pair).
                    Blank teacher_id → a free specialist from that subject's pool is picked; blank room → a free branch hall. Titles come from the subject CODE, so no typo'd subjects.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <select value={csvCourse} onChange={e => { setCsvCourse(e.target.value); setCsvDept(''); setCsvSection(''); setCsvReport(null); setCsvPublishState('idle'); }}
                    className="text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-2 py-2 cursor-pointer">
                    <option value="">Course…</option>
                    {csvCourseList.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select value={csvDept} onChange={e => { setCsvDept(e.target.value); setCsvSection(''); setCsvReport(null); setCsvPublishState('idle'); }}
                    className="text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-2 py-2 cursor-pointer disabled:opacity-50" disabled={!csvCourse}>
                    <option value="">Branch / Department…</option>
                    {csvDeptList.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select value={csvSection} onChange={e => { setCsvSection(e.target.value); setCsvReport(null); setCsvPublishState('idle'); }}
                    className="text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-2 py-2 cursor-pointer disabled:opacity-50" disabled={!csvDept}>
                    <option value="">Section…</option>
                    {csvSectionList.map(s => <option key={s} value={s}>Section {s}</option>)}
                  </select>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <label className="relative flex-1 cursor-pointer">
                    <input type="file" accept=".csv,text/csv" onChange={handleCsvFile}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                    <div className="flex items-center justify-center gap-2 border border-teal-300 bg-white rounded-lg px-3 py-2 text-xs font-bold text-teal-700">
                      Choose CSV file {csvText ? '(loaded — paste over it below if needed)' : ''}
                    </div>
                  </label>
                  <button onClick={() => handleCsvRun(false)} disabled={!csvSectionKey || !csvText.trim() || csvBusy}
                    className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 disabled:opacity-40 text-white text-xs font-bold cursor-pointer transition-all">
                    {csvBusy ? 'Working…' : 'Validate'}
                  </button>
                  <button onClick={() => handleCsvRun(true)} disabled={csvPublishState !== 'validated' || csvBusy}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white text-xs font-bold cursor-pointer transition-all"
                    title="Publishing is only possible after a clean validation">
                    Publish
                  </button>
                </div>
                <textarea value={csvText} onChange={e => { setCsvText(e.target.value); setCsvReport(null); setCsvPublishState('idle'); }}
                  placeholder={`…or paste the CSV here:\nday,period,subject_code,kind,teacher_id,room\nMON,1,MATHS,lecture,,\nMON,4,OOP,lab,FAC004,`}
                  rows={4}
                  className="w-full text-[11px] font-mono text-slate-800 bg-white border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-teal-200" />
                {csvSectionKey && <p className="text-[10px] text-slate-500 font-mono">Target: {csvSectionKey}</p>}
                {csvReport && (
                  <div className={`rounded-lg border p-3 space-y-1 ${csvReport.success ? 'bg-emerald-50 border-emerald-200' : 'bg-rose-50 border-rose-200'}`}>
                    <p className={`text-[11px] font-black ${csvReport.success ? 'text-emerald-800' : 'text-rose-800'}`}>{csvReport.report}</p>
                    {csvReport.errors.map((e, i) => (
                      <p key={i} className="text-[11px] text-rose-700 font-semibold">✗ row {e.row}: {e.message}</p>
                    ))}
                    {csvReport.autofills.map((a, i) => (
                      <p key={i} className="text-[11px] text-teal-700 font-semibold">↳ row {a.row}: {a.message}</p>
                    ))}
                  </div>
                )}
                {csvStatement && (
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-[11px] text-emerald-900 font-semibold">
                    ✓ {csvStatement.statement} — version <code className="font-mono">{csvStatement.version}</code>
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500 font-medium">Press <b>Generate Timetable</b> to run the solver for all departments.</p>
          )}

          {ttResult && (
            <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 text-[11px] text-emerald-900 font-semibold">
              ✓ Fresh schedule published ({ttResult.summary?.lectureSessions} lectures, {ttResult.summary?.labSessions} labs,
              {` ${ttResult.summary?.solverSteers}`} solver steers recorded). Students' dashboards pick it up automatically.
            </div>
          )}
        </section>
      )}

      {/* --- TAB: CAMPUS SETUP (config as data) --- */}
      {activeTab === 'setup' && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Building2 className="w-5 h-5 text-indigo-600" />
                <span>Campus Setup — rooms, subjects, pools & hostel blocks</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                This is the campus profile the whole app runs on: the timetable solver, the section regenerator and the
                CSV-upload validator all read THIS. Saving never moves the live timetable — press <b>Regenerate</b> in the
                Timetable Engine tab to apply.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button onClick={ccExport} disabled={!cc}
                className="text-[10px] font-black text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg px-2.5 py-1.5 cursor-pointer disabled:opacity-40">
                ⬇ Export JSON
              </button>
              <label className="relative text-[10px] font-black text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg px-2.5 py-1.5 cursor-pointer">
                ⬆ Import JSON
                <input type="file" accept=".json,application/json" onChange={ccImportFile} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
              </label>
            </div>
          </div>

          {ccStale && (
            <div className="rounded-xl bg-amber-50 border border-amber-300 p-3 text-[11px] font-bold text-amber-900">
              ⚠ The published timetable predates this config ({new Date(cc.updatedAt).toLocaleString()} > {new Date(ttInfo.generatedAt).toLocaleString()}) — open the Timetable Engine tab and press <b>Regenerate Timetable</b> to apply it.
            </div>
          )}

          {!cc ? (
            <p className="text-sm text-slate-500 font-medium">Loading the campus profile…</p>
          ) : (
            <>
              {/* Weekly cap */}
              <div className="flex flex-wrap items-center gap-3">
                <label className="text-[11px] font-black text-slate-700 uppercase tracking-wider">
                  Weekly cap per teacher
                  <input type="number" min="1" max="40" value={cc.ttMaxWeekly}
                    onChange={e => ccMutate(d => { d.ttMaxWeekly = parseInt(e.target.value, 10) || 26; })}
                    className="ml-2 w-20 text-xs font-bold text-slate-900 bg-white border border-slate-200 rounded-lg px-2 py-1.5" />
                </label>
                <span className="text-[10px] text-slate-400 font-mono">last saved: {cc.updatedAt ? new Date(cc.updatedAt).toLocaleString() : '—'} · by {cc.updatedBy || '—'}</span>
              </div>

              {/* Branches */}
              <div className="space-y-2">
                {cc.branches.map((b, bi) => {
                  const open = ccOpen === b.key;
                  return (
                    <div key={b.key + bi} className="rounded-xl border border-slate-200 overflow-hidden">
                      <button type="button" onClick={() => setCcOpen(open ? null : b.key)}
                        className="w-full flex items-center justify-between gap-2 px-3 py-2.5 bg-slate-50 hover:bg-slate-100 transition-colors cursor-pointer text-left">
                        <span className="min-w-0">
                          <span className="text-xs font-black text-slate-900">{b.label || '(unnamed branch)'}</span>
                          <span className="text-[10px] text-slate-500 font-mono ml-2">
                            {b.lectureRooms?.length || 0} rooms · {b.subjects?.length || 0} subjects · {b.lab || 'no lab'}
                          </span>
                        </span>
                        <span className="text-[10px] font-black text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-2 py-0.5 shrink-0">
                          {open ? 'close' : 'edit'}
                        </span>
                      </button>

                      {open && (
                        <div className="p-3 space-y-3 bg-white">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <input value={b.course} onChange={e => ccMutate(d => { d.branches[bi].course = e.target.value; })}
                              placeholder="Course (BTech)" className="text-[11px] font-bold text-slate-900 bg-white border border-slate-200 rounded-lg px-2 py-1.5" />
                            <input value={b.department} onChange={e => ccMutate(d => { d.branches[bi].department = e.target.value; })}
                              placeholder="Department" className="text-[11px] font-bold text-slate-900 bg-white border border-slate-200 rounded-lg px-2 py-1.5" />
                            <input value={b.code} onChange={e => ccMutate(d => { d.branches[bi].code = e.target.value; })}
                              placeholder="Short code (CSE)" className="text-[11px] font-bold text-slate-900 bg-white border border-slate-200 rounded-lg px-2 py-1.5" />
                            <input value={b.label} onChange={e => ccMutate(d => { d.branches[bi].label = e.target.value; })}
                              placeholder="Display label" className="text-[11px] font-bold text-slate-900 bg-white border border-slate-200 rounded-lg px-2 py-1.5" />
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                              Lecture rooms (comma separated)
                              <input value={(b.lectureRooms || []).join(', ')}
                                onChange={e => ccMutate(d => { d.branches[bi].lectureRooms = e.target.value.split(',').map(x => x.trim()).filter(Boolean); })}
                                placeholder="A301, A302, A303" className="mt-1 w-full text-[11px] font-mono text-slate-900 bg-white border border-slate-200 rounded-lg px-2 py-1.5" />
                            </label>
                            <label className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                              Branch lab (used by lab subjects)
                              <input value={b.lab || ''} onChange={e => ccMutate(d => { d.branches[bi].lab = e.target.value; })}
                                placeholder="Workshop W101" className="mt-1 w-full text-[11px] font-mono text-slate-900 bg-white border border-slate-200 rounded-lg px-2 py-1.5" />
                            </label>
                          </div>

                          {/* Subjects */}
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Subjects</p>
                            {(b.subjects || []).map((s, si) => {
                              const poolKey = `${bi}|${si}`;
                              return (
                                <div key={si} className="rounded-lg border border-slate-100 bg-slate-50/60 p-2 space-y-1.5">
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <input value={s.code} onChange={e => ccMutate(d => { d.branches[bi].subjects[si].code = e.target.value.toUpperCase(); })}
                                      placeholder="CODE" className="w-20 text-[11px] font-mono font-black text-slate-900 bg-white border border-slate-200 rounded-lg px-2 py-1" />
                                    <input value={s.title} onChange={e => ccMutate(d => { d.branches[bi].subjects[si].title = e.target.value; })}
                                      placeholder="Subject title" className="flex-1 min-w-[140px] text-[11px] font-bold text-slate-900 bg-white border border-slate-200 rounded-lg px-2 py-1" />
                                    <label className="text-[10px] font-bold text-slate-600 flex items-center gap-1">
                                      lect/wk
                                      <input type="number" min="0" max="10" value={s.lectures}
                                        onChange={e => ccMutate(d => { d.branches[bi].subjects[si].lectures = parseInt(e.target.value, 10) || 0; })}
                                        className="w-14 text-[11px] font-bold text-slate-900 bg-white border border-slate-200 rounded-lg px-1.5 py-1" />
                                    </label>
                                    <label className="text-[10px] font-bold text-slate-600 flex items-center gap-1 cursor-pointer">
                                      <input type="checkbox" checked={!!s.lab}
                                        onChange={e => ccMutate(d => { d.branches[bi].subjects[si].lab = e.target.checked; })} />
                                      has lab
                                    </label>
                                    <button type="button" onClick={() => setCcPool(ccPool === poolKey ? null : poolKey)}
                                      className="text-[10px] font-black text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-2 py-1 cursor-pointer">
                                      pool: {(s.pool || []).length} ▾
                                    </button>
                                    <button type="button" onClick={() => ccMutate(d => { d.branches[bi].subjects.splice(si, 1); })}
                                      className="text-[10px] font-black text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1 cursor-pointer">✕</button>
                                  </div>
                                  {ccPool === poolKey && (
                                    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-2 space-y-1.5">
                                      <input value={ccSearch} onChange={e => setCcSearch(e.target.value)}
                                        placeholder="Search faculty…" className="w-full text-[11px] font-bold text-slate-900 bg-white border border-slate-200 rounded-lg px-2 py-1" />
                                      <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
                                        {staff.teachers
                                          .filter(t => !ccSearch || `${t.id} ${t.name}`.toLowerCase().includes(ccSearch.toLowerCase()))
                                          .map(t => {
                                            const inPool = (s.pool || []).includes(t.id);
                                            return (
                                              <button key={t.id} type="button"
                                                onClick={() => ccMutate(d => {
                                                  const pool = d.branches[bi].subjects[si].pool;
                                                  const at = pool.indexOf(t.id);
                                                  if (at >= 0) pool.splice(at, 1); else pool.push(t.id);
                                                })}
                                                className={`text-[10px] font-bold rounded-full px-2 py-0.5 border cursor-pointer transition-colors ${
                                                  inPool ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300'
                                                }`}>
                                                {t.id} · {t.name}
                                              </button>
                                            );
                                          })}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            <button type="button" onClick={() => ccMutate(d => { d.branches[bi].subjects.push({ code: '', title: '', lectures: 1, lab: false, pool: [] }); })}
                              className="text-[10px] font-black text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-2.5 py-1 cursor-pointer">
                              + add subject
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
                <button type="button" onClick={() => ccMutate(d => { d.branches.push({ course: '', department: '', code: '', label: '', lectureRooms: [], lab: '', subjects: [] }); setCcOpen('new'); })}
                  className="text-[11px] font-black text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-lg px-3 py-1.5 cursor-pointer">
                  + add branch
                </button>
              </div>

              {/* Hostel blocks */}
              <div className="space-y-1.5">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Hostel blocks (gender · capacity · seats/room · warden)</p>
                {(cc.hostelBlocks || []).map((hb, hi) => (
                  <div key={hi} className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-100 bg-slate-50/60 p-2">
                    <input value={hb.name} onChange={e => ccMutate(d => { d.hostelBlocks[hi].name = e.target.value; })}
                      placeholder="Block name" className="flex-1 min-w-[110px] text-[11px] font-bold text-slate-900 bg-white border border-slate-200 rounded-lg px-2 py-1" />
                    <select value={hb.gender || 'Boys'} onChange={e => ccMutate(d => { d.hostelBlocks[hi].gender = e.target.value; })}
                      className="text-[11px] font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-2 py-1 cursor-pointer" title="Boys/Girls hostel — never mixed">
                      <option value="Boys">Boys</option>
                      <option value="Girls">Girls</option>
                    </select>
                    <input type="number" min="1" max="8" value={hb.seatsPerRoom || 4} onChange={e => ccMutate(d => { d.hostelBlocks[hi].seatsPerRoom = parseInt(e.target.value, 10) || 1; })}
                      placeholder="Seats" className="w-20 text-[11px] font-bold text-slate-900 bg-white border border-slate-200 rounded-lg px-2 py-1" title="Students per room (1–8)" />
                    <input type="number" min="1" value={hb.capacity} onChange={e => ccMutate(d => { d.hostelBlocks[hi].capacity = parseInt(e.target.value, 10) || 0; })}
                      placeholder="Capacity" className="w-24 text-[11px] font-bold text-slate-900 bg-white border border-slate-200 rounded-lg px-2 py-1" />
                    <select value={hb.warden || ''} onChange={e => ccMutate(d => { d.hostelBlocks[hi].warden = e.target.value || null; })}
                      className="w-full sm:w-auto max-w-full min-w-0 text-[11px] font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-2 py-1 cursor-pointer">
                      <option value="">warden…</option>
                      {staff.wardens.map(w => <option key={w.id} value={w.id}>{w.id} · {w.name}</option>)}
                    </select>
                    <button type="button" onClick={() => ccMutate(d => { d.hostelBlocks.splice(hi, 1); })}
                      className="text-[10px] font-black text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-2 py-1 cursor-pointer">✕</button>
                  </div>
                ))}
                <button type="button" onClick={() => ccMutate(d => { d.hostelBlocks.push({ name: '', capacity: 100, warden: null, gender: 'Boys', seatsPerRoom: 4 }); })}
                  className="text-[10px] font-black text-teal-700 bg-teal-50 border border-teal-200 rounded-lg px-2.5 py-1 cursor-pointer">
                  + add block
                </button>
              </div>

              {/* Room allocation — the CSV never assigns rooms; this engine
                  groups hostellers by course+year and fills seats-per-room,
                  Boys/Girls blocks strictly separate. */}
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-black text-indigo-900 uppercase tracking-wider">🏠 Room allocation</p>
                    <p className="text-[10px] text-slate-600 font-medium">Hostellers get rooms automatically — grouped by course + admission year, {`(seats/room)`} respected, Boys/Girls hostels never mixed. Already-placed students keep their rooms. Nothing changes until you Confirm the preview.</p>
                  </div>
                  <button onClick={() => runRoomAlloc(false)} disabled={roomBusy}
                    className="shrink-0 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-[11px] font-black cursor-pointer">
                    {roomBusy ? 'Working…' : '🛏 Preview room allocation'}
                  </button>
                </div>
                {roomMsg && (
                  <div className={`rounded-lg border p-2 text-[11px] font-semibold ${roomMsg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'}`}>
                    {roomMsg.ok ? '✓ ' : '✕ '}{roomMsg.text}
                  </div>
                )}
                <div className="border-t border-indigo-100 pt-2">
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-wider">Manual override — move one student</p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-1">
                    <input value={ovRoll} onChange={e => setOvRoll(e.target.value)} placeholder="Roll number"
                      className="w-36 text-[11px] font-bold text-slate-900 bg-white border border-slate-200 rounded-lg px-2 py-1" />
                    <select value={ovBlock} onChange={e => setOvBlock(e.target.value)}
                      className="max-w-full min-w-0 text-[11px] font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-2 py-1 cursor-pointer">
                      <option value="">block…</option>
                      {(cc.hostelBlocks || []).map(hb => <option key={hb.name} value={hb.name}>{hb.name} ({hb.gender})</option>)}
                    </select>
                    <input value={ovRoom} onChange={e => setOvRoom(e.target.value)} placeholder="Room no."
                      className="w-24 text-[11px] font-bold text-slate-900 bg-white border border-slate-200 rounded-lg px-2 py-1" />
                    <button onClick={handleRoomOverride} disabled={roomBusy}
                      className="text-[11px] font-black text-indigo-700 bg-white border border-indigo-200 hover:bg-indigo-50 disabled:opacity-40 rounded-lg px-3 py-1 cursor-pointer">
                      Assign room
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 font-medium mt-1">Rules live-checked: block gender, seats/room, same course+year in the room, block capacity.</p>
                </div>
              </div>

              {/* Action bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 border-t border-slate-100 pt-3">
                <button onClick={() => ccRun(true)} disabled={ccBusy}
                  className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 disabled:opacity-40 text-white text-xs font-bold cursor-pointer transition-all">
                  {ccBusy ? 'Working…' : '🧪 Test this config (shadow solve)'}
                </button>
                <button onClick={() => ccRun(false)} disabled={ccBusy}
                  className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white text-xs font-bold cursor-pointer transition-all">
                  Save config
                </button>
              </div>
              {ccMsg && (
                <div className={`rounded-xl border p-3 text-[11px] font-semibold space-y-1 ${ccMsg.ok ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-rose-50 border-rose-200 text-rose-900'}`}>
                  <p className="font-black">{ccMsg.text}</p>
                  {(ccMsg.errors || []).map((e, i) => <p key={i} className="text-rose-700">✗ {e.message}</p>)}
                  {ccMsg.shadow && (
                    <p className="text-emerald-800 font-mono text-[10px]">
                      shadow solve → {ccMsg.shadow.sections} sections · {ccMsg.shadow.lectures} lectures · {ccMsg.shadow.labs} labs · heaviest teacher {ccMsg.shadow.maxLoad}/{cc?.ttMaxWeekly}/week
                    </p>
                  )}
                </div>
              )}

              {/* Room-allocation PREVIEW modal — the plan becomes real only
                  on Confirm; Cancel leaves every profile untouched. */}
              {roomPlan && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => setRoomPlan(null)}>
                  <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-5 space-y-3" onClick={e => e.stopPropagation()}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-slate-900">Room allocation — preview</p>
                        <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Draft · profiles change hone ke liye Confirm dabayein</p>
                      </div>
                      <button onClick={() => setRoomPlan(null)} className="text-slate-400 hover:text-slate-700 text-lg leading-none cursor-pointer">✕</button>
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[10px] font-bold">
                      <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-slate-700">{roomPlan.kept} already placed — keeping rooms</span>
                      <span className="rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-indigo-800">{roomPlan.toPlace} to place now</span>
                      <span className={`rounded-full border px-2 py-0.5 ${roomPlan.unplacedCount ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-100 border-slate-200 text-slate-700'}`}>{roomPlan.unplacedCount} unplaced</span>
                    </div>
                    <div className="rounded-xl border border-slate-200 overflow-x-auto">
                      <table className="w-full text-[10px]">
                        <thead><tr className="bg-slate-50 text-slate-500 font-black uppercase">
                          <th className="p-1.5 text-left">Block</th><th className="p-1.5">Gender</th><th className="p-1.5">Seats/room</th>
                          <th className="p-1.5">Rooms</th><th className="p-1.5">Residents → /cap</th>
                        </tr></thead>
                        <tbody>
                          {roomPlan.perBlock.map(b => (
                            <tr key={b.name} className="border-t border-slate-100 text-center">
                              <td className="p-1.5 text-left font-black text-slate-800">{b.name}</td>
                              <td className={`p-1.5 font-bold ${b.gender === 'Girls' ? 'text-pink-600' : 'text-sky-600'}`}>{b.gender}</td>
                              <td className="p-1.5 text-slate-600">{b.seatsPerRoom}</td>
                              <td className="p-1.5 text-slate-600">{b.roomsUsed}</td>
                              <td className="p-1.5 font-bold text-slate-800">{b.residents}/{b.capacity}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {roomPlan.assignments?.length > 0 && (
                      <div className="max-h-40 overflow-y-auto rounded-xl border border-slate-100">
                        <table className="w-full text-[10px]">
                          <tbody>
                            {roomPlan.assignments.map(a => (
                              <tr key={a.roll} className="border-b border-slate-50">
                                <td className="p-1.5 font-mono font-bold text-slate-700">{a.roll}</td>
                                <td className="p-1.5 text-slate-600">{a.name}</td>
                                <td className="p-1.5 font-bold text-indigo-700">{a.block} / {a.room}</td>
                                <td className="p-1.5 text-slate-400 font-mono">{a.group.split('|').join(' · ')}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {roomPlan.unplacedCount > 0 && (
                      <div className="rounded-xl bg-amber-50 border border-amber-200 p-2 max-h-32 overflow-y-auto">
                        <p className="text-[10px] font-black text-amber-800 uppercase">{roomPlan.unplacedCount} could not be placed</p>
                        {roomPlan.unplaced.map(u => (
                          <p key={u.roll} className="text-[10px] text-amber-900 font-medium">{u.roll} · {u.name} — {u.reason}</p>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[10px] text-slate-500 font-medium">Confirm writes block + room into each profile — warden/student dashboards reflect it on their next fetch.</p>
                      <div className="flex gap-2 shrink-0">
                        <button onClick={() => setRoomPlan(null)} className="text-[11px] font-black text-slate-600 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-full px-4 py-1.5 cursor-pointer">Cancel</button>
                        <button onClick={() => runRoomAlloc(true)} disabled={roomBusy}
                          className="text-[11px] font-black text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-full px-4 py-1.5 cursor-pointer">
                          {roomBusy ? 'applying…' : '✓ Confirm & Apply'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* --- TAB 4: MESS KITCHEN FORECAST --- */}
      {activeTab === 'mess' && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Utensils className="w-5 h-5 text-amber-600" />
                <span>Zero-Waste Mess Kitchen Forecast</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Live kitchen headcounts from real student RSVPs. At each meal's cutoff the final count is
                SMSed straight to the canteen operator's phone — he tells his workers exactly how much to cook.
              </p>
            </div>
            {messForecast && (
              <div className="shrink-0 flex flex-col items-start sm:items-end gap-1">
                <span className={`text-[11px] font-mono font-bold px-2.5 py-1 rounded-full border ${
                  messForecast.operatorConfigured
                    ? 'text-emerald-800 bg-emerald-50 border-emerald-200'
                    : 'text-amber-700 bg-amber-50 border-amber-200'
                }`}>
                  {messForecast.operatorConfigured
                    ? `Operator: ${messForecast.operatorPhone}`
                    : '⚠ Mess operator phone not set up'}
                </span>
                <button onClick={() => setShowOperatorHelp((v) => !v)} className="text-[10px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer">
                  {showOperatorHelp ? 'hide details' : 'how does this reach the operator?'}
                </button>
              </div>
            )}
          </div>

          {showOperatorHelp && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-[11px] text-slate-600 leading-relaxed space-y-1.5">
              <p><b className="text-slate-800">The flow:</b> students opt out of meals in their app → RSVP locks 3h before cooking → the server computes the final headcount from the real roster → ONE SMS goes to the mess operator's registered number.</p>
              <p>4 meals a day = 4 SMS total. Below, each meal shows whether its alert has been sent.</p>
            </div>
          )}

          {!messForecast ? (
            <div className="py-10 text-center text-slate-500 text-xs">
              Reading RSVP aggregates from the campus database…
            </div>
          ) : (
            <>
              {/* Today's payoff strip */}
              {(() => {
                const totalPlates = messForecast.meals.reduce((s, m) => s + (m.plates || 0), 0);
                const totalSaved = messForecast.meals.reduce((s, m) => s + (m.wasteKg || 0), 0);
                const totalOpted = messForecast.meals.reduce((s, m) => s + (m.optedOut || 0), 0);
                return (
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-center">
                      <span className="text-2xl sm:text-3xl font-extrabold font-mono text-slate-900 block">{totalPlates.toLocaleString()}</span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-slate-500 font-bold">Plates Today (4 meals)</span>
                    </div>
                    <div className="bg-amber-50/70 border border-amber-200 rounded-xl p-3.5 text-center">
                      <span className="text-2xl sm:text-3xl font-extrabold font-mono text-amber-900 block">{totalSaved.toFixed(1)}</span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-amber-700 font-bold">Kg Food Saved Today</span>
                    </div>
                    <div className="bg-emerald-50/70 border border-emerald-200 rounded-xl p-3.5 text-center">
                      <span className="text-2xl sm:text-3xl font-extrabold font-mono text-emerald-800 block">{totalOpted}</span>
                      <span className="text-[10px] font-mono uppercase tracking-wider text-emerald-700 font-bold">Opt-Outs Today</span>
                    </div>
                  </div>
                );
              })()}

              {/* Per-meal rows */}
              <div className="space-y-2.5">
                {messForecast.meals.map((m) => {
                  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
                  const alert = m.operatorAlert;
                  const alertChip = alert
                    ? (<span className={`text-[10px] font-mono font-extrabold px-2 py-1 rounded-full border ${alert.mode === 'gateway' ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : alert.mode === 'dry-run' ? 'text-slate-600 bg-slate-100 border-slate-300' : 'text-blue-700 bg-blue-50 border-blue-200'}`}>
                        {alert.mode === 'gateway' ? '📱 SMS SENT' : alert.mode === 'dry-run' ? '📵 TEST MODE (not sent)' : '🧪 SIMULATED'} {new Date(alert.sentAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>)
                    : m.cutoffPassed && m.windowOver
                      ? (<span className="text-[10px] font-mono font-extrabold px-2 py-1 rounded-full border text-slate-500 bg-slate-100 border-slate-300" title="Serving window ended before the operator SMS could fire — server skips stale alerts on purpose">⏭ Skipped — window over</span>)
                      : m.cutoffPassed
                      ? (<span className="text-[10px] font-mono font-extrabold px-2 py-1 rounded-full border text-amber-800 bg-amber-50 border-amber-200">⏳ Sending within 60s…</span>)
                      : (<span className="text-[10px] font-mono font-extrabold px-2 py-1 rounded-full border text-slate-600 bg-slate-50 border-slate-300">🔓 RSVPs open — locks {m.cutoffLabel}</span>);
                  return (
                    <div key={m.id} className="bg-slate-50/60 border border-slate-200 rounded-xl px-3.5 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                      <span className={`shrink-0 text-[10px] font-mono font-extrabold px-2.5 py-1 rounded-full border w-fit ${
                        m.cutoffPassed ? 'text-slate-600 bg-slate-100 border-slate-300' : 'text-amber-800 bg-amber-100 border-amber-200'
                      }`}>
                        {cap(m.id)} • {m.servingLabel}
                      </span>
                      <div className="min-w-0 flex-1 flex items-baseline gap-4 flex-wrap">
                        <span><b className="text-lg font-extrabold font-mono text-slate-900">{m.plates.toLocaleString()}</b> <span className="text-[10px] font-mono text-slate-500 uppercase font-bold">plates</span></span>
                        <span><b className="text-sm font-extrabold font-mono text-emerald-700">{m.optedOut}</b> <span className="text-[10px] font-mono text-slate-500 uppercase font-bold">opted out</span></span>
                        <span><b className="text-sm font-extrabold font-mono text-amber-700">{m.wasteKg} kg</b> <span className="text-[10px] font-mono text-slate-500 uppercase font-bold">saved</span></span>
                      </div>
                      {alertChip}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      )}

      {/* --- TAB 3: OPERATIONAL METRICS & SYSTEM HEALTH --- */}
      {activeTab === 'metrics' && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Database className="w-5 h-5 text-emerald-600" />
                <span>Operational Metrics & System Health</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Real-time latency, node status, and offline PWA synchronization queue depth.
              </p>
            </div>

            <button
              onClick={handleManualSync}
              disabled={isSyncing}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm shrink-0"
            >
              <TrendingUp className="w-4 h-4" />
              <span>{isSyncing ? 'Flushing Queue...' : 'Trigger Emergency Sync'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Metric 1 */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
              <span className="text-[11px] font-mono text-slate-500 block uppercase">1) Server Node Status</span>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-slate-900 font-mono">API server</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                  !health ? 'bg-slate-100 text-slate-600 border-slate-200'
                    : health.online ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                  {!health ? 'CHECKING…' : health.online ? '● ONLINE' : '● OFFLINE'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono">
                {!health ? 'Pinging /api/health…' : health.online ? `Responded in ${health.rttMs} ms` : 'No response from the server'}
              </p>
            </div>

            {/* Metric 2 */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
              <span className="text-[11px] font-mono text-slate-500 block uppercase">2) Ollama Model Latency</span>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-purple-700 font-mono">campusdebug-ai</span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border ${
                  !health ? 'bg-slate-100 text-slate-600 border-slate-200'
                    : health.ai?.reachable && health.ai?.modelLoaded ? 'bg-purple-50 text-purple-700 border-purple-200'
                    : 'bg-amber-50 text-amber-800 border-amber-200'}`}>
                  {!health ? 'CHECKING…'
                    : health.ai?.reachable ? `${health.ai.latencyMs}ms`
                    : 'NOT RUNNING'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono">
                {!health ? 'Probing the local AI server…'
                  : !health.ai?.reachable ? 'Complaints use the keyword fallback'
                  : health.ai.modelLoaded ? 'Model loaded on Ollama'
                  : 'Ollama is up, model not installed'}
              </p>
            </div>

            {/* Metric 3 */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
              <span className="text-[11px] font-mono text-slate-500 block uppercase">3) Offline Queue</span>
              <div className="flex items-center justify-between">
                <span className="text-xl font-bold text-emerald-600 font-mono">{queueDepth}</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-slate-200 text-slate-700">
                  Pending
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono">Actions saved offline, waiting to sync</p>
            </div>

            {/* Metric 4 */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
              <span className="text-[11px] font-mono text-slate-500 block uppercase">4) Clustered vs Resolved</span>
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-sky-700 font-mono">{campusStats.clusterCount ?? '—'} Clusters</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  {campusStats.recentTickets ? `${campusStats.recentResolved} Resolved` : '— Resolved'}
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-mono">
                {campusStats.recentTickets ? `Resolved = of the latest ${campusStats.recentTickets} tickets` : 'No tickets yet'}
              </p>
            </div>
          </div>
        </section>
      )}

      {/* --- TAB: PASSWORD RESET DESK (account recovery, ADMIN/DEAN only) --- */}
      {activeTab === 'security' && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 shadow-sm">
          <div className="border-b border-slate-100 pb-3">
            <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-rose-600" />
              <span>Password Reset Desk</span>
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Account recovery for students (hostellers + day scholars alike). Works exactly like first activation — nothing here exposes a password.
            </p>
          </div>
          <div className="border border-amber-200 rounded-xl bg-amber-50/60 p-4 space-y-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-amber-600" />
                <span>Forgotten Password Reset</span>
              </h3>
              <p className="text-[11px] text-slate-600 mt-0.5">
                Resets the student's password to the college default (firstname@last-4-of-mobile).
                The student signs in with the default and is forced to set a private password —
                identical to first activation. Passwords are never readable by anyone.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                value={resetRoll}
                onChange={(e) => { setResetRoll(e.target.value); setResetResult(null); }}
                placeholder="Student Registration No. e.g. 2201106190"
                className="min-w-0 flex-1 rounded-lg border border-amber-200 bg-white px-3 py-2 text-xs font-mono outline-none focus:border-amber-500"
              />
              <button
                type="button"
                onClick={handlePasswordReset}
                disabled={resetBusy || !resetRoll.trim()}
                className="shrink-0 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
              >
                {resetBusy ? 'Resetting…' : 'Reset Password'}
              </button>
            </div>
            {resetResult && (
              <p className={`text-[11px] font-semibold ${resetResult.ok ? 'text-emerald-700' : 'text-rose-600'}`}>
                {resetResult.text}
              </p>
            )}
          </div>
        </section>
      )}

      {/* --- TAB 1: TARGETED NOTICE DISPATCHER --- */}
      {activeTab === 'dispatcher' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          
          {/* Dispatcher Form */}
          <div className="md:col-span-2 bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 shadow-sm">
            <div className="border-b border-slate-100 pb-3">
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <Send className="w-5 h-5 text-emerald-600" />
                <span>Send a Notice</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Target notifications strictly to affected students without broadcasting irrelevant alerts campus-wide.
              </p>
            </div>

            <form onSubmit={handleDispatchNotice} className="space-y-3.5 text-xs">
              {/* Notice kind — hostel ops vs campus/academic: two separate
                  flows in one desk. Hostel = block fan-out; Campus = course/
                  section/year audience resolved from the live roster. */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setNoticeForm({ ...noticeForm, noticeKind: 'hostel' })}
                  className={`px-3 py-2 rounded-lg border font-bold text-xs transition-all cursor-pointer ${noticeForm.noticeKind === 'hostel' ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:border-emerald-300'}`}
                >
                  🏠 Hostel Notice
                  <span className="block text-[9px] font-medium opacity-80">block fan-out + SMS fallback</span>
                </button>
                <button
                  type="button"
                  onClick={() => setNoticeForm({ ...noticeForm, noticeKind: 'campus' })}
                  className={`px-3 py-2 rounded-lg border font-bold text-xs transition-all cursor-pointer ${noticeForm.noticeKind === 'campus' ? 'bg-sky-600 border-sky-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-600 hover:border-sky-300'}`}
                >
                  🎓 Campus / Academic
                  <span className="block text-[9px] font-medium opacity-80">course · section · year audience</span>
                </button>
              </div>

              {/* Segment Filter — real targeting resolved from the live roster */}
              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-2.5">
                <span className="text-[11px] font-mono text-emerald-700 font-bold uppercase tracking-wider flex items-center gap-1">
                  <Filter className="w-3.5 h-3.5" />
                  <span>Delivery Target (resolved from the live roster):</span>
                </span>

                {noticeForm.noticeKind === 'hostel' ? (
                <div className="grid grid-cols-1 gap-2">
                  <div>
                    <label className="block text-slate-600 mb-1 text-[11px]">Hostel Block</label>
                    <select
                      value={noticeForm.hostelBlock}
                      onChange={(e) => setNoticeForm({ ...noticeForm, hostelBlock: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-md px-2 py-1.5 text-slate-800 focus:outline-none focus:border-emerald-600"
                    >
                      <option value="All Hostels">All Hostels — Campus Wide Broadcast</option>
                      {(campusStats.blocks.length > 0
                        ? campusStats.blocks
                        : ['A', 'B', 'C', 'D', 'Girls Hostel 1'] // offline fallback only; live roster wins when online
                      ).map((b) => (
                        <option key={b} value={b}>Hostel Block {b}</option>
                      ))}
                    </select>
                    <p className="text-[10px] text-slate-500 mt-1.5 leading-relaxed">
                      {noticeForm.hostelBlock === 'All Hostels'
                        ? 'Campus wide: every active app device gets a push; keypad-phone students get an automatic SMS.'
                        : 'Targeted: hostellers of this block get the notice — activated ones by push, others by SMS. Day scholars in the directory are told in the notice title, not SMSed. Floor nuance: put it in the title.'}
                    </p>
                  </div>
                </div>
                ) : (
                <div className="space-y-2.5">
                  <div>
                    <label className="block text-slate-600 mb-1 text-[11px]">Audience</label>
                    <select
                      value={noticeForm.campusMode}
                      onChange={(e) => setNoticeForm({ ...noticeForm, campusMode: e.target.value })}
                      className="w-full bg-white border border-slate-200 rounded-md px-2 py-1.5 text-slate-800 focus:outline-none focus:border-sky-600"
                    >
                      <option value="ALL">Whole Campus — every student</option>
                      <option value="COURSE">Course-wise (e.g. all BTech students)</option>
                      <option value="COURSE_SECTION">Course + Section (e.g. BTech, Section A)</option>
                      <option value="COURSE_YEAR">Course + Year (e.g. BTech 2022 batch — semester exam)</option>
                    </select>
                  </div>

                  {noticeForm.campusMode !== 'ALL' && (
                    <div>
                      <label className="block text-slate-600 mb-1 text-[11px]">Course</label>
                      <select
                        value={noticeForm.campusCourse}
                        onChange={(e) => setNoticeForm({ ...noticeForm, campusCourse: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-md px-2 py-1.5 text-slate-800 focus:outline-none focus:border-sky-600"
                      >
                        <option value="">— pick a course —</option>
                        {[...new Set((cc?.branches || []).map(b => b.course).filter(Boolean))].map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {noticeForm.campusMode === 'COURSE_SECTION' && (
                    <div>
                      <label className="block text-slate-600 mb-1 text-[11px]">Section</label>
                      <select
                        value={noticeForm.campusSection}
                        onChange={(e) => setNoticeForm({ ...noticeForm, campusSection: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-md px-2 py-1.5 text-slate-800 focus:outline-none focus:border-sky-600"
                      >
                        <option value="">— pick a section —</option>
                        {ccDirectory.sections.map((s) => (
                          <option key={s} value={s}>Section {s}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {noticeForm.campusMode === 'COURSE_YEAR' && (
                    <div>
                      <label className="block text-slate-600 mb-1 text-[11px]">Admission Year (from roll number)</label>
                      <select
                        value={noticeForm.campusYear}
                        onChange={(e) => setNoticeForm({ ...noticeForm, campusYear: e.target.value })}
                        className="w-full bg-white border border-slate-200 rounded-md px-2 py-1.5 text-slate-800 focus:outline-none focus:border-sky-600"
                      >
                        <option value="">— pick a year —</option>
                        {ccDirectory.years.map((y) => (
                          <option key={y} value={y}>{y} batch</option>
                        ))}
                      </select>
                    </div>
                  )}

                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    {noticeForm.campusMode === 'ALL'
                      ? 'Campus wide: every active app device gets a push; keypad-phone students get an automatic SMS.'
                      : 'Targeted academic audience: matching students get the notice — activated ones by push, others by SMS. Resolved live from the roster, so transfer/section changes are always reflected.'}
                  </p>
                </div>
                )}
              </div>

              {/* Today's Notice — optional date pin. The notice still goes out
                  on the bus (push/SMS) right now, but the student dashboard
                  surfaces it as a dated hero card ONLY on this date — the
                  antidote to notices drowning in chat history. */}
              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  📌 Show as &quot;Today&apos;s Notice&quot; on
                  <span className="ml-2 text-[10px] font-mono text-slate-400">(optional — dated hero card on the student dashboard, that day only)</span>
                </label>
                <input
                  type="date"
                  value={noticeForm.showOn}
                  onChange={(e) => setNoticeForm({ ...noticeForm, showOn: e.target.value })}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-600"
                />
              </div>

              {/* Title & Content */}
              <div>
                <label className="block text-slate-700 font-medium mb-1">Notice Headline</label>
                <input
                  type="text"
                  required
                  value={noticeForm.title}
                  onChange={(e) => setNoticeForm({ ...noticeForm, title: e.target.value })}
                  placeholder="e.g., Water Pump Motor Overhaul — Block B 3rd Floor"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-600"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Notice Body / Instructions</label>
                <textarea
                  required
                  rows={3}
                  value={noticeForm.content}
                  onChange={(e) => setNoticeForm({ ...noticeForm, content: e.target.value })}
                  placeholder="Please store drinking water by 2 PM. Main supply will resume by 5:30 PM..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-600"
                ></textarea>
              </div>

              {/* Action Tag & Urgency */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Interactive Action Tag</label>
                  <select
                    value={noticeForm.actionTag}
                    onChange={(e) => setNoticeForm({ ...noticeForm, actionTag: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-600 cursor-pointer"
                  >
                    <option value="Require 1-Tap Acknowledge">Require 1-Tap Read Receipt</option>
                    <option value="Vote / Preference Poll">Attach 1-Tap Vote</option>
                    <option value="Emergency Warning">Emergency Evacuation Tag</option>
                    <option value="Informational">General Informational</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">Priority Level</label>
                  <select
                    value={noticeForm.urgency}
                    onChange={(e) => setNoticeForm({ ...noticeForm, urgency: e.target.value })}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-600 cursor-pointer"
                  >
                    <option value="High">High Priority (Pinned)</option>
                    <option value="Normal">Normal Priority</option>
                    <option value="Emergency">Emergency Alert</option>
                  </select>
                </div>
              </div>

              {/* SMS Fallback for keypad-phone students (no PWA device) */}
              <div>
                <label className="block text-slate-700 font-medium mb-1">
                  SMS Fallback Targets
                  <span className="ml-2 text-[10px] font-mono text-slate-400">(optional — students on keypad phones get it by SMS)</span>
                </label>
                <input
                  type="text"
                  value={noticeForm.smsPhones}
                  onChange={(e) => setNoticeForm({ ...noticeForm, smsPhones: e.target.value })}
                  placeholder="10-digit mobile numbers, comma-separated — leave blank for notification-only"
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-800 focus:outline-none focus:border-emerald-600"
                />
              </div>

              {/* Dispatch Action */}
              <div className="flex items-center justify-end pt-2 border-t border-slate-100">
                <button
                  type="submit"
                  disabled={isDispatching}
                  className="px-5 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs flex items-center space-x-1.5 transition-all cursor-pointer shadow-sm"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isDispatching ? 'Dispatching...' : 'Dispatch Targeted Notice'}</span>
                </button>
              </div>
            </form>
          </div>

          {/* Live Delivery Report — real counts from the notice bus */}
          <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4 shadow-sm">
            <h3 className="text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold border-b border-slate-100 pb-2">
              Live Delivery Report (real recipients)
            </h3>

            <div className="space-y-3.5">
              {dispatchedNotices.length === 0 && (
                <p className="text-[11px] text-slate-500 py-4 text-center">
                  No notices sent yet.
                </p>
              )}
              {dispatchedNotices.map((n) => {
                const reachedKnown = n.totalTargeted != null && n.totalTargeted > 0;
                const deliveryPct = reachedKnown ? Math.min(100, Math.round((n.deliveredCount / n.totalTargeted) * 100)) : 0;

                return (
                  <div key={n.id} className="bg-slate-50/50 border border-slate-200 rounded-lg p-3 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-emerald-700 font-bold">{n.id}</span>
                      <span className="text-[10px] font-mono text-slate-500">{n.publishedAt}</span>
                    </div>

                    <h4 className="font-bold text-slate-900 leading-tight">{n.title}</h4>
                    <p className="text-[11px] text-slate-500 truncate">{n.target}</p>

                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {n.pushStudents != null && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 border border-sky-200">
                          🔔 {n.pushStudents} app push
                        </span>
                      )}
                      {n.smsCount > 0 && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 border border-violet-200">
                          💬 {n.smsCount} SMS{n.smsModes.length ? ` (${n.smsModes.join(', ')})` : ''}
                        </span>
                      )}
                      {n.noContact > 0 && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          ⚠ {n.noContact} no contact on file
                        </span>
                      )}
                      {n.dayscholars > 0 && (
                        <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-lime-50 text-lime-800 border border-lime-200">
                          🚶 {n.dayscholars} day scholar{(n.dayscholars > 1) ? 's' : ''} excluded
                        </span>
                      )}
                      {!reachedKnown && n.pushStudents == null && (
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">
                          campus-wide broadcast
                        </span>
                      )}
                    </div>

                    {reachedKnown && (
                      <div className="space-y-1 pt-1">
                        <div className="flex justify-between text-[10px] font-mono text-slate-600">
                          <span>Reached (push + SMS in flight):</span>
                          <span className="text-sky-700 font-bold">{n.deliveredCount}/{n.totalTargeted}</span>
                        </div>
                        <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                          <div className="bg-sky-600 h-full rounded-full" style={{ width: `${deliveryPct}%` }}></div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* --- TAB 2: ZERO-DISRUPTION LEGACY CSV IMPORTER OVERLAY --- */}
      {activeTab === 'csv' && (
        <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-5 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                <FileSpreadsheet className="w-5 h-5 text-purple-600" />
                <span>Import Students from CSV</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Upload the existing student allotment list (CSV) to add students to the college directory.
              </p>
            </div>

            {/* Only real CSV upload remains — the fake "sample roster" generator
                was removed: the college directory lives in Supabase now and
                demo/fake data is no longer part of this system. */}
          </div>

          {/* Drag & Drop File Upload Box */}
          <div className="border-2 border-dashed border-slate-200 hover:border-emerald-300 bg-slate-50/50 rounded-xl p-6 text-center transition-colors relative">
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileUpload}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            <div className="flex flex-col items-center justify-center space-y-2 pointer-events-none">
              <div className="w-10 h-10 rounded-lg bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                <UploadCloud className="w-5 h-5" />
              </div>
              <p className="text-xs font-semibold text-slate-800">
                Click to browse or drop any legacy <span className="text-emerald-700 font-mono">.CSV</span> roster file here
              </p>
              <p className="text-[11px] text-slate-500 font-mono">
                Auto-maps: RollNo, Name, Branch, Batch, HostelBlock, RoomNumber
              </p>
              <p className="text-[10px] text-slate-400 font-mono">
                Required every row: RollNo · Name · Phone · Gender (Male/Female/Other) · ResidentType · Course · Section — any miss rejects the WHOLE CSV · Hostel block &amp; room are NOT CSV fields — they&apos;re auto-allocated (Setup tab → Room allocation) or moved by the admin override · Optional: MentorRoll (blank auto-assigns round-robin)
              </p>
            </div>
          </div>

          {/* Import Stats Banner */}
          {importStats && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-lg flex items-center justify-between text-xs font-mono text-emerald-800">
              <div className="flex items-center space-x-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>
                  <strong>{importStats.count} records imported</strong> in <strong>{importStats.timeMs}ms</strong>
                </span>
              </div>
              <span className="text-slate-500 text-[11px] hidden sm:inline">{importStats.type}</span>
            </div>
          )}

          {/* TEACHER ROSTER INGEST — same admin CSV flow, staff columns.
              Existing staff ids are only refreshed in the specialist column;
              new ids get a profile AND a pre-provisioned login using the CSV
              password (teachers must use the college-issued password on day
              one, unlike students who get lazily-provisioned defaults). */}
          <div className="border border-teal-200 bg-teal-50/40 rounded-xl p-4 sm:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-teal-100 border border-teal-300 text-teal-700 flex items-center justify-center">
                <Users className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Faculty Staff Ingest (Teachers)</h3>
                <p className="text-[11px] text-slate-500">
                  CSV columns: <span className="font-mono text-teal-800">teacher_name, staff_id, password, subject_specialization, department, phone_number</span> <span className="text-slate-400">(phone optional — must not match any student's number)</span>
                </p>
              </div>
            </div>
            <div className="relative">
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleTeacherFileUpload}
                disabled={!!teachImport?.running}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
              />
              <div className="border-2 border-dashed border-teal-200 hover:border-teal-400 bg-white/70 rounded-lg px-4 py-3 text-center transition-colors pointer-events-none">
                <p className="text-xs font-semibold text-slate-700">
                  {teachImport?.running ? 'Importing faculty…' : 'Click to upload the teacher roster CSV'}
                </p>
                <p className="text-[10px] text-slate-500 font-mono mt-0.5">Re imports are idempotent — existing staff ids are never renamed or re-passworded</p>
              </div>
            </div>
            {teachImport?.result && (
              <div className={`rounded-lg border px-3 py-2 text-xs font-mono ${teachImport.result.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-300 text-amber-900'}`}>
                <strong>{teachImport.result.created ? `${teachImport.result.created} created` : 'no new rows'}</strong>
                {teachImport.result.refreshed ? ` · ${teachImport.result.refreshed} specialization(s) refreshed` : ''}
                {' '}· faculty on roster now: <strong>{teachImport.result.totalActiveTeachers}</strong>
                {teachImport.result.errors?.length ? ` — ${teachImport.result.errors.length} failed: ${teachImport.result.errors[0].message}` : ''}
              </div>
            )}
            {teachImport?.error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-mono text-rose-800">{teachImport.error}</div>
            )}
          </div>

          {/* Ingested Records Table Preview */}
          {importedUsers.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold">
                  Ingested Student Directory ({filteredUsers.length} shown)
                </h3>
                <div className="relative w-48 sm:w-64">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by roll, name, room..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-2.5 py-1 text-xs text-slate-800 focus:outline-none focus:border-emerald-600"
                  />
                </div>
              </div>

              <div className="overflow-x-auto border border-slate-200 rounded-xl max-h-72 overflow-y-auto shadow-sm">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-100 text-slate-700 border-b border-slate-200 sticky top-0">
                    <tr>
                      <th className="p-2.5">Roll No</th>
                      <th className="p-2.5">Student Name</th>
                      <th className="p-2.5">Branch</th>
                      <th className="p-2.5">Hostel & Room</th>
                      <th className="p-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {filteredUsers.slice(0, 50).map((u, i) => (
                      <tr key={i} className="hover:bg-slate-50 transition-colors">
                        <td className="p-2.5 text-emerald-700 font-bold">{u.rollNo}</td>
                        <td className="p-2.5 text-slate-900 font-sans font-medium">{u.name}</td>
                        <td className="p-2.5 text-slate-600">{u.branch}</td>
                        <td className="p-2.5 text-slate-600">{u.hostelBlock} — Rm {u.roomNumber}</td>
                        <td className="p-2.5">
                          <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 font-semibold">
                            {u.status || 'Active'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      <div className={`${toolNavSlot && slotShown ? 'lg:hidden' : ''} h-16`} aria-hidden="true"></div>
    </div>
  );
}

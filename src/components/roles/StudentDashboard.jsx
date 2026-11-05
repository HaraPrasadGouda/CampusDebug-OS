import React, { useState, useMemo, useEffect } from 'react';
import { 
  Bell, 
  QrCode, 
  Wrench, 
  Utensils, 
  TrendingUp, 
  ArrowUpRight, 
  X, 
  Clock, 
  MapPin,
  CheckCircle2,
  UserCheck,
  AlertCircle,
  Eye,
  ShieldCheck,
  XCircle,
  Calendar,
  FileCheck,
  CreditCard,
  ChevronRight,
  Megaphone,
  Zap,
  Droplets,
  AlertTriangle,
  Info,
  Leaf,
  Compass,
  FileText,
  MessageSquare,
  ChevronDown,
  ChevronUp,
  Lock
} from 'lucide-react';
import AiCategoryChip from '../AiCategoryChip';
import CleaningCheckCard from '../CleaningCheckCard';
import { StudentTicketActions, StageTicks, hasLifecycle, ticketCode } from '../TicketLifecycle';
import { getTodayMenuKey, getTodayMenu, getTomorrowMenu, isFeastDay, getTodayDayLabel, getMealStatus, fmtDuration, MEAL_ORDER } from '../../data/messMenu';
import { isLeaveWindowOpen } from '../../utils/leaveWindow';
import { leaveNumber } from '../../utils/passNumber';
import { canAutoRefresh } from '../../utils/liveUpdates';

export default function StudentDashboard({
  activities = [],
  activePass,
  dayLeave = null,
  onOpenModal,
  onViewPassQR,
  searchQuery = '',
  session,
  docStatusMap = {}
}) {
  const [activeFeedTab, setActiveFeedTab] = useState('all'); // 'all' | 'issues' | 'passes' | 'mess'
  const [ticketDetail, setTicketDetail] = useState(null); // read-only complaint detail card

  // Complaint lifecycle actions (Resolved / Not fixed) on the student's own
  // complaints. The server answers with the updated ticket; it is shown at
  // once and the feed reloads from the server right after.
  const [ticketPatch, setTicketPatch] = useState({});   // { id: updated ticket }
  const [ticketBusy, setTicketBusy] = useState(null);   // id being saved
  const [ticketMsg, setTicketMsg] = useState({});       // { id: { ok, text } }
  useEffect(() => { setTicketPatch({}); }, [activities]);
  const withPatch = (act) => (ticketPatch[act.id] ? { ...act, ...ticketPatch[act.id] } : act);
  const ticketAction = async (act, kind) => {
    setTicketBusy(act.id);
    setTicketMsg((m) => ({ ...m, [act.id]: null }));
    try {
      const res = await fetch(`/api/tickets/${act.id}/${kind === 'resolve' ? 'resolve' : 'not-fixed'}`, { method: 'POST' });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d?.success) {
        const patch = d.ticket || (kind === 'resolve'
          ? { lifecycleStage: 'RESOLVED', status: 'RESOLVED', studentResolvedAt: d.studentResolvedAt || new Date().toISOString() }
          : { lifecycleStage: 'REPORTED', status: d.status || 'ASSIGNED', studentResolvedAt: null, notFixedCount: d.notFixedCount });
        setTicketPatch((p) => ({ ...p, [act.id]: patch }));
        setTicketDetail((td) => (td && td.id === act.id ? { ...td, ...patch } : td));
        setTicketMsg((m) => ({ ...m, [act.id]: { ok: true, text: kind === 'resolve' ? 'Marked resolved — the warden can close it now.' : 'Sent back to the technician.' } }));
        window.dispatchEvent(new CustomEvent('campus_tickets_updated', { detail: {} }));
      } else {
        setTicketMsg((m) => ({ ...m, [act.id]: { ok: false, text: d?.error || 'Could not save — try again.' } }));
      }
    } catch {
      setTicketMsg((m) => ({ ...m, [act.id]: { ok: false, text: 'No connection — try again when you are online.' } }));
    } finally {
      setTicketBusy(null);
    }
  };
  const renderTicketLifecycle = (t, compact = false) => (
    <>
      <StudentTicketActions
        ticket={t}
        busy={ticketBusy === t.id}
        compact={compact}
        onResolve={(x) => ticketAction(x, 'resolve')}
        onNotFixed={(x) => ticketAction(x, 'not-fixed')}
      />
      {ticketMsg[t.id] && (
        <p className={`mt-2 text-[11px] font-bold ${ticketMsg[t.id].ok ? 'text-emerald-700' : 'text-rose-700'}`}>{ticketMsg[t.id].text}</p>
      )}
    </>
  );

  // --- TODAY'S NOTICE: a dated notice (showOn) pinned by the admin surfaces
  // as a hero card ONLY on its target date — the antidote to notices
  // drowning up-thread in WhatsApp. Audience-filtered: a student only ever
  // sees a notice that was dispatched to them.
  const [todaysNotice, setTodaysNotice] = useState(null);
  useEffect(() => {
    let alive = true;
    const loadNotice = async () => {
      try {
        const r = await fetch('/api/notices');
        const j = await r.json();
        if (!alive || !j?.success || !Array.isArray(j.notices)) return;
        const todayStr = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
        const roll = String(session?.identity || '');
        const yy = /^(\d{2})/.exec(roll);
        const myYear = yy ? 2000 + parseInt(yy[1], 10) : null;
        const match = j.notices.find((n) => {
          if (!n.showOn || String(n.showOn).slice(0, 10) !== todayStr) return false;
          if (n.targetBlock) {
            // Hostel notice — same fuzzy block matching the dispatcher uses.
            const t = String(n.targetBlock).toLowerCase().replace(/^block/, '').trim();
            const b = String(session?.block || '').toLowerCase().replace(/^block/, '').trim();
            return !!b && (b === t || b.includes(t) || t.includes(b));
          }
          if (n.audience === 'campus' && n.campusFilter && n.campusFilter.mode !== 'ALL') {
            if (n.campusFilter.course && String(session?.course || '') !== n.campusFilter.course) return false;
            if (n.campusFilter.mode === 'COURSE_SECTION' && String(session?.section || '').toUpperCase() !== n.campusFilter.section) return false;
            if (n.campusFilter.mode === 'COURSE_YEAR' && myYear !== n.campusFilter.year) return false;
          }
          return true; // campus-wide broadcast → everyone sees it
        });
        setTodaysNotice(match || null);
      } catch { /* offline: the card simply doesn't render */ }
    };
    loadNotice();
    const iv = setInterval(() => { if (canAutoRefresh()) loadNotice(); }, 120000); // Settings → Live updates
    return () => { alive = false; clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // REAL per-student stats (attendance %, fee due) — fetched from the server
  // with the login token; falls back to the values captured at sign-in.
  // Hardcoded demo numbers were removed: if the server is unreachable the
  // cards show "—" instead of pretending.
  const [myStats, setMyStats] = useState({
    attendance: Number(session?.attendance) || null,
    feeDue: Number(session?.feeDue) || null
  });
  // MY MENTOR — resolved server-side from profiles.mentor_roll (the teacher
  // this student's leaves route to). Hidden entirely when unset / offline.
  const [myMentor, setMyMentor] = useState(null);
  useEffect(() => {
    let alive = true;
    fetch('/api/dashboard-data')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data?.success) return;
        const p = data.profile || {};
        setMyStats({
          attendance: p.attendance_percentage != null ? Number(p.attendance_percentage) : null,
          feeDue: p.fee_due_balance != null ? Number(p.fee_due_balance) : null
        });
        setMyMentor(data.mentor || null);
      })
      .catch(() => { /* offline — keep session values */ });
    return () => { alive = false; };
  }, []);
  // Settle Dues was tapped in the fee modal: the Fees & Dues card behind it shows the new balance at once
  useEffect(() => {
    const onFees = (e) => { const v = e?.detail?.feeDue; if (v != null) setMyStats((s) => ({ ...s, feeDue: Number(v) })); };
    window.addEventListener('campus_fees_updated', onFees);
    return () => window.removeEventListener('campus_fees_updated', onFees);
  }, []);
  const attendancePct = myStats.attendance != null ? myStats.attendance : null;
  const ringCircumference = 188.5;
  const ringOffset = attendancePct != null ? ringCircumference * (1 - attendancePct / 100) : ringCircumference;

  // Live relative-time label — computed at render so old items never stay
  // frozen as "Just now" (the old static `time` string was saved at submit
  // moment and never refreshed).
  const activityTimeMs = (item) => {
    if (!item) return 0;
    if (item.createdAtMs) return item.createdAtMs;
    if (item.createdAt) {
      const p = new Date(item.createdAt).getTime();
      if (!isNaN(p) && p > 0) return p;
    }
    return 0;
  };
  const relativeTime = (item) => {
    const ms = activityTimeMs(item);
    if (!ms) return (item && item.time) || 'Recently updated';
    const diff = Date.now() - ms;
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} min ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return `${Math.floor(diff / 86400000)}d ago`;
  };

  // Filter activities based on tab and search query
  const filteredActivities = useMemo(() => activities.filter(item => {
    // Tab filter
    if (activeFeedTab === 'issues' && item.type !== 'ticket') return false;
    if (activeFeedTab === 'passes' && item.type !== 'gate_pass') return false;
    if (activeFeedTab === 'mess' && item.type !== 'mess' && item.category !== 'Admin Document') return false;

    // Search query filter
    if (searchQuery && typeof searchQuery === 'string' && searchQuery.trim() !== '') {
      const q = (searchQuery || '').toLowerCase();
      const matchTitle = (item.title || '').toLowerCase().includes(q);
      const matchCat = (item.category || '').toLowerCase().includes(q);
      const matchId = (item.id || '').toLowerCase().includes(q);
      const matchLoc = (item.location || '').toLowerCase().includes(q);
      return matchTitle || matchCat || matchId || matchLoc;
    }
    return true;
  }), [activities, activeFeedTab, searchQuery]);

  // Guarantee newest-first ordering in the feed regardless of merge order
  const sortedActivities = [...filteredActivities].sort((a, b) => activityTimeMs(b) - activityTimeMs(a));

  // Day scholars never use the hosteller gate-pass round trip (exit + return):
  // their card follows the mentor leave below (one exit scan, final), so a
  // stray warden gate pass is not shown on their Active Gate Pass card.
  const isDayScholarCard = String(session?.residentType || '').toLowerCase() === 'dayscholar';
  const cardPass = isDayScholarCard ? null : activePass;
  const isPassApproved = cardPass && cardPass.status === 'APPROVED';
  const isPassPending = cardPass && cardPass.status === 'PENDING';
  const isPassRejected = cardPass && cardPass.status === 'REJECTED';
  const isPassUsed = cardPass && cardPass.status === 'USED';
  const isPassReturned = cardPass && cardPass.status === 'RETURNED';

  // Today's mess menu (picked by actual weekday)
  const todayMenuKey = getTodayMenuKey();
  const todayMenu = getTodayMenu();
  const todayDayLabel = getTodayDayLabel();
  // Day scholars are on campus only at lunch hour — their whole meal
  // section collapses to just the lunch slot (menu, live status, RSVP).
  const isDayScholar = String(session?.residentType || '').toLowerCase() === 'dayscholar';
  const dayScholarMealOrder = ['lunch'];

  // Day scholars: the Active Gate Pass card follows TODAY's mentor leave
  // (leave_requests — PENDING → APPROVED → OUT), kept live by App.jsx.
  // No leave today → the card behaves exactly as before.
  const fmtHM = (iso) => (iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
  const leaveCard = (isDayScholar && dayLeave) ? (() => {
    // Same tag styles as the hosteller card at the matching step:
    // PENDING (amber, pulsing) → APPROVED (green) → scanned OUT (grey, like
    // USED). Leave is one-way, so OUT is final — there is no RETURNED step.
    const st = String(dayLeave.status || '').toUpperCase();
    if (st === 'APPROVED') return {
      badge: 'APPROVED', badgeCls: 'bg-emerald-100 text-emerald-800 border-emerald-300', icon: 'dot', dotCls: 'bg-emerald-600',
      footer: 'Mentor Approved — Show QR at Gate', footerDot: 'bg-amber-500', action: 'View QR →'
    };
    if (st === 'OUT') return {
      badge: 'Out of Campus (Leave)', badgeCls: 'bg-slate-200 text-slate-700 border-slate-400', icon: 'x',
      footer: `Exited${dayLeave.scanned_at ? ` at ${fmtHM(dayLeave.scanned_at)}` : ''} — Back Next Working Day`, footerDot: 'bg-slate-400', action: 'View →'
    };
    if (st === 'REJECTED' || st === 'EXPIRED') return {
      badge: st, badgeCls: 'bg-amber-100 text-amber-800 border-amber-300', icon: 'dot', dotCls: 'bg-amber-600',
      footer: st === 'REJECTED' ? 'Rejected — tap to request again' : 'Expired — tap to request again',
      footerDot: 'bg-amber-500', action: 'Request →'
    };
    return {
      badge: 'PENDING', badgeCls: 'bg-amber-100 text-amber-800 border-amber-300', icon: 'dot', dotCls: 'bg-amber-600 animate-pulse',
      footer: 'Awaiting Mentor Sign-off', footerDot: 'bg-amber-500', action: 'View QR →'
    };
  })() : null;
  // Leave number (LV-xxxxxx) = the card title, like the hosteller's GP number.
  const leaveNo = leaveCard ? leaveNumber(dayLeave.id) : '';
  const mealOrder = isDayScholar ? dayScholarMealOrder : MEAL_ORDER;
  // Live meal-slot engine: what's being served right now / what's next
  const mealStatus = getMealStatus(new Date(), mealOrder);
  // "View Full Menu" expands the complete day list on demand
  const [showFullMenu, setShowFullMenu] = useState(false);

  const MEAL_TIMES = {
    breakfast: 'Breakfast (07:30 - 09:30 AM)',
    lunch: 'Lunch (12:30 - 02:30 PM)',
    snacks: 'Snacks (05:00 - 06:30 PM)',
    dinner: 'Dinner (08:00 - 10:00 PM)'
  };
  const visibleMealTimes = isDayScholar
    ? { lunch: MEAL_TIMES.lunch }
    : MEAL_TIMES;

  // Get greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  // Quick Action tile classes — presentation only (phone: round icon +
  // label in a swipe row; desktop: compact tile with icon left).
  const QA_TILE = 'group relative flex-none snap-start min-w-[74px] px-1 flex flex-col items-center text-center cursor-pointer transition-all duration-200 lg:min-w-0 lg:flex-row lg:items-center lg:text-left lg:gap-2.5 lg:px-2.5 lg:py-2.5 lg:rounded-xl lg:border lg:border-slate-200 lg:bg-white lg:hover:shadow-md lg:hover:-translate-y-0.5';
  const QA_ICON = 'w-[58px] h-[58px] rounded-full lg:w-[30px] lg:h-[30px] lg:rounded-[9px] flex items-center justify-center shrink-0 border border-slate-900/5 lg:border-0 shadow-[0_2px_6px_rgba(15,23,42,0.06)] lg:shadow-none group-hover:scale-105 transition-transform';
  const QA_TEXT = 'min-w-0 lg:flex-1';
  const QA_TITLE = 'text-xs lg:text-[13.5px] font-bold text-slate-900 mt-1.5 lg:mt-0 leading-tight whitespace-nowrap lg:whitespace-normal';
  const QA_SUB = 'text-[10.5px] lg:text-xs text-slate-500 font-medium mt-0.5 leading-tight whitespace-nowrap lg:whitespace-normal';

  return (
    <div className="animate-in fade-in duration-300">

      {/* ONE grid, re-ordered per breakpoint (layout only — every handler,
          text and condition below is the same as before).
          Phone (< lg, design D3): Greeting → Attendance | Fees → Gate Pass strip
            → Quick Actions swipe row → My Mentor → Mess Menu → Feed
          Desktop (lg+, Option C): Greeting → Quick Actions row
            → Attendance | Fees | Gate Pass | My Mentor (2x2 under xl) → Mess Menu (wide) → Feed */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 lg:gap-4 items-stretch">

      {/* 1. Greeting Banner with Campus Backdrop */}
      <div className="order-1 col-span-full relative overflow-hidden rounded-2xl bg-white border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] px-4 py-4 sm:px-6 min-h-[86px] lg:min-h-0 lg:h-[96px] flex flex-col justify-center">
        {/* Left greeting text */}
        <div className="relative z-10 min-w-0">
          <h1 className="text-[21px] lg:text-[28px] font-extrabold tracking-tight leading-tight text-slate-900 flex items-center gap-2">
            <span>{getGreeting()}, {(session?.name || 'Student').split(' ')[0]}!</span>
            <span className="text-xl lg:text-[26px] animate-bounce">👋</span>
          </h1>
          <p className="text-[12.5px] lg:text-sm text-slate-500 mt-1 font-medium leading-relaxed max-w-[72%] lg:max-w-none">
            Welcome back to your unified campus portal.
          </p>
        </div>

        {/* Right campus photography smoothly faded */}
        <div className="absolute right-0 top-0 bottom-0 w-[52%] lg:w-[48%] overflow-hidden pointer-events-none [-webkit-mask-image:linear-gradient(90deg,transparent_0,rgba(0,0,0,.55)_55%,#000)] [mask-image:linear-gradient(90deg,transparent_0,rgba(0,0,0,.55)_55%,#000)] lg:[-webkit-mask-image:linear-gradient(90deg,transparent_0,#000_38%)] lg:[mask-image:linear-gradient(90deg,transparent_0,#000_38%)]">
          <img 
            src="/campus_banner.jpg" 
            alt="Campus" 
            className="w-full h-full object-cover object-right opacity-80"
          />
        </div>
      </div>

      {/* 1b. TODAY'S NOTICE — dated hero card, rendered ONLY on the notice's
          target date and only for the audience it was dispatched to */}
      {todaysNotice && (
        <div className="order-2 col-span-full relative overflow-hidden rounded-2xl p-4 sm:p-5 bg-gradient-to-br from-[#fff7ed] to-[#fef3c7] border-2 border-[#fde68a] shadow-[0_6px_20px_rgba(245,158,11,0.12)]">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center border border-amber-200 shrink-0 text-lg">📌</div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[10px] font-black tracking-wider uppercase text-amber-700">Today&apos;s Notice</span>
                <span className="text-[9px] font-mono text-slate-500">
                  {new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </span>
                {todaysNotice.urgency === 'Emergency' && (
                  <span className="text-[9px] font-black text-rose-700 bg-rose-100 border border-rose-200 px-1.5 py-0.5 rounded-full">EMERGENCY</span>
                )}
              </div>
              <h3 className="text-sm sm:text-base font-extrabold text-slate-900 mt-1">{todaysNotice.title}</h3>
              <p className="text-xs text-slate-700 font-medium leading-relaxed mt-1 whitespace-pre-line">{todaysNotice.content}</p>
              <p className="text-[10px] text-slate-500 mt-2 font-medium">— {todaysNotice.source || 'Admin Desk'}</p>
            </div>
          </div>
        </div>
      )}

      {/* 1c. Room cleaning check — shows itself only on cleaning day 1-9 PM for hostellers */}
      <div className="order-2 col-span-full empty:hidden"><CleaningCheckCard /></div>

      {/* 2. Quick Actions — phone: swipe row of round icons (after the Gate
          Pass strip); desktop: one row of 6 tiles right under the greeting */}
      <div className="order-6 lg:order-3 col-span-full min-w-0 lg:bg-white lg:rounded-2xl lg:border lg:border-slate-200 lg:shadow-[0_1px_2px_rgba(15,23,42,0.04)] lg:p-3.5 min-[1440px]:flex min-[1440px]:items-center min-[1440px]:gap-3.5">
        <div className="flex items-center gap-2.5 px-0.5 lg:px-0 min-[1440px]:w-[150px] min-[1440px]:flex-none">
          <div className="w-[30px] h-[30px] rounded-[9px] bg-blue-100 flex items-center justify-center text-blue-600 shrink-0">
            <Zap className="w-4 h-4" />
          </div>
          <h2 className="text-[15px] font-bold text-slate-900 tracking-tight">
            Quick Actions
          </h2>
        </div>

        {/* 6 actions: horizontal swipe on phones, 3 / 6 columns on desktop */}
        <div className="mt-3 min-[1440px]:mt-0 min-[1440px]:flex-1 min-w-0 flex gap-1.5 overflow-x-auto snap-x scroll-px-3 sm:scroll-px-5 scrollbar-none -mx-3 px-3 sm:-mx-5 sm:px-5 pt-1.5 pb-1 lg:mx-0 lg:px-0 lg:pt-0 lg:pb-0 lg:grid lg:grid-cols-3 xl:grid-cols-6 lg:gap-2.5 lg:overflow-visible">

          {/* 1. Gate Pass (hostellers) / Day-Scholar Leave: the leave needs
              a MENTOR'S approval (never automatic) and is a ONE-WAY exit —
              the same signed campus-ID QR opens the gate only while an
              approved leave exists. */}
          <button
            type="button"
            onClick={() => onOpenModal(isDayScholar ? 'leave' : 'gate_pass')}
            className={QA_TILE}
          >
            <div className={`${QA_ICON} bg-blue-100 text-blue-600`}>
              <Calendar className="w-6 h-6 lg:w-4 lg:h-4" />
            </div>
            <div className={QA_TEXT}>
              <p className={QA_TITLE}>{isDayScholar ? 'Leave Request' : 'Gate Pass'}</p>
              <p className={QA_SUB}>{isDayScholar ? 'Ask your mentor' : 'Request exit'}</p>
            </div>
          </button>

          {/* 2. Hostel Issue — LOCKED for day scholars: a repair ticket
              needs a resident on-site to confirm the fix with the
              technician; an off-campus student can never do that, so
              the workflow is hostellers-only. Card stays visible with
              a lock badge; clicking it shows an explanatory toast. */}
          <button
            type="button"
            onClick={() => onOpenModal('complaint')}
            className={`${QA_TILE} ${isDayScholar ? 'opacity-80 lg:bg-slate-50' : ''}`}
          >
            <div className={`${QA_ICON} ${isDayScholar ? 'bg-slate-100 text-slate-400' : 'bg-rose-100 text-rose-600'}`}>
              {isDayScholar ? <Lock className="w-6 h-6 lg:w-4 lg:h-4" /> : <Wrench className="w-6 h-6 lg:w-4 lg:h-4" />}
            </div>
            <div className={QA_TEXT}>
              <p className={`${QA_TITLE} ${isDayScholar ? '!text-slate-500' : ''}`}>Hostel Issue</p>
              <p className={`${QA_SUB} ${isDayScholar ? '!text-slate-400' : ''}`}>
                {isDayScholar ? 'Hostellers only' : 'Report repairs'}
              </p>
            </div>
            {isDayScholar && (
              <span className="absolute -top-1 right-0 lg:-top-2 lg:right-2 text-[9px] lg:text-[10px] font-extrabold uppercase tracking-wide text-slate-500 bg-slate-100 border border-slate-200 rounded-full px-1.5 py-0.5">
                Locked
              </span>
            )}
          </button>

          {/* 3. Certificates */}
          <button
            type="button"
            onClick={() => onOpenModal('doc_request')}
            className={QA_TILE}
          >
            <div className={`${QA_ICON} bg-purple-100 text-purple-600`}>
              <FileText className="w-6 h-6 lg:w-4 lg:h-4" />
            </div>
            <div className={QA_TEXT}>
              <p className={QA_TITLE}>Certificates</p>
              <p className={QA_SUB}>Request doc</p>
            </div>
          </button>

          {/* 4. Mess Review */}
          <button
            type="button"
            onClick={() => onOpenModal('mess')}
            className={QA_TILE}
          >
            <div className={`${QA_ICON} bg-emerald-100 text-emerald-600`}>
              <Utensils className="w-6 h-6 lg:w-4 lg:h-4" />
            </div>
            <div className={QA_TEXT}>
              <p className={QA_TITLE}>Mess Review</p>
              <p className={QA_SUB}>Rate meals</p>
            </div>
          </button>

          {/* 5. Campus Notices */}
          <button
            type="button"
            onClick={() => onOpenModal('notices')}
            className={QA_TILE}
          >
            <div className={`${QA_ICON} bg-amber-100 text-amber-600`}>
              <Megaphone className="w-6 h-6 lg:w-4 lg:h-4" />
            </div>
            <div className={QA_TEXT}>
              <p className={QA_TITLE}>Notices</p>
              <p className={QA_SUB}>Campus alerts</p>
            </div>
          </button>

          {/* 6. Time Table */}
          <button
            type="button"
            onClick={() => onOpenModal('timetable')}
            className={QA_TILE}
          >
            <div className={`${QA_ICON} bg-sky-100 text-sky-600`}>
              <Calendar className="w-6 h-6 lg:w-4 lg:h-4" />
            </div>
            <div className={QA_TEXT}>
              <p className={QA_TITLE}>Time Table</p>
              <p className={QA_SUB}>Class routine</p>
            </div>
          </button>

        </div>
      </div>

      {/* 3. Status cards — phone: Attendance | Fees tiles, Gate Pass strip;
          desktop: Attendance | Fees & Dues | Active Gate Pass | My Mentor, equal height */}

      {/* Card 1: Attendance */}
      <div className="order-4 col-span-1 relative min-w-0 rounded-2xl border border-[#bbf7d0] bg-gradient-to-b from-[#f0fdf4] to-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-3.5 lg:p-4 flex flex-col lg:hover:shadow-lg lg:hover:-translate-y-0.5 transition-all duration-300">
        {/* Phone: the whole tile opens the student's attendance (classes
            marked present/absent). Desktop keeps its "View Today's Timetable" link. */}
        <button
          type="button"
          aria-label="Attendance"
          onClick={() => onOpenModal('attendance')}
          className="lg:hidden absolute inset-0 z-[1] rounded-2xl cursor-pointer active:bg-emerald-900/[0.03]"
        />
        <div className="flex items-center gap-2.5">
          <div className="w-[30px] h-[30px] lg:w-[34px] lg:h-[34px] rounded-[9px] lg:rounded-[10px] bg-[#dcfce7] text-[#16a34a] flex items-center justify-center shrink-0">
            <Calendar className="w-4 h-4" />
          </div>
          <span className="text-[13.5px] lg:text-[15px] font-bold text-slate-900 tracking-tight">Attendance</span>
        </div>

        {/* Attendance Value and Progress Circle */}
        <div className="flex-1 flex items-center justify-between gap-2 mt-3 lg:mt-3.5">
          <div className="min-w-0">
            <div className="text-[30px] min-[380px]:text-[34px] lg:text-[40px] leading-none font-extrabold text-slate-900 tracking-tight">{attendancePct != null ? `${attendancePct}%` : '—'}</div>
            <p className="text-xs lg:text-[12.5px] text-slate-600 font-medium mt-1.5">Overall Attendance</p>
          </div>

          {/* Circular Progress Ring */}
          <div className="relative w-10 h-10 lg:w-20 lg:h-20 shrink-0 flex items-center justify-center">
            <svg viewBox="0 0 80 80" className="w-full h-full transform -rotate-90">
              <circle 
                cx="40" 
                cy="40" 
                r="30" 
                stroke="#bbf7d0" 
                strokeWidth="7" 
                fill="transparent" 
              />
              <circle 
                cx="40" 
                cy="40" 
                r="30" 
                stroke="#059669" 
                strokeWidth="7" 
                fill="transparent" 
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringOffset}
                strokeLinecap="round"
              />
            </svg>
          </div>
        </div>

        <div className="hidden lg:block mt-3 pt-3 border-t border-slate-900/[0.08]">
          <button
            onClick={() => onOpenModal('timetable')}
            className="text-xs font-semibold text-[#15803d] hover:text-emerald-900 flex items-start gap-1.5 text-left leading-snug transition-colors cursor-pointer group"
          >
            <span>View Today's Timetable ({session?.department || 'CSE'})</span>
            <span className="group-hover:translate-x-1 transition-transform">→</span>
          </button>
        </div>
      </div>

      {/* Card 2: Fees & Dues */}
      <div className="order-4 col-span-1 relative min-w-0 rounded-2xl border border-[#fecdd3] bg-gradient-to-b from-[#fff1f2] to-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-3.5 lg:p-4 flex flex-col lg:hover:shadow-lg lg:hover:-translate-y-0.5 transition-all duration-300">
        {/* Phone: the whole tile opens the fee statement (same modal as
            Pay Now / View Statement on desktop) */}
        <button
          type="button"
          aria-label="Fees & Dues"
          onClick={() => onOpenModal('fee_dues')}
          className="lg:hidden absolute inset-0 z-[1] rounded-2xl cursor-pointer active:bg-rose-900/[0.03]"
        />
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-[30px] h-[30px] lg:w-[34px] lg:h-[34px] rounded-[9px] lg:rounded-[10px] bg-[#ffe4e6] text-[#e11d48] flex items-center justify-center font-bold text-sm shrink-0">
              ₹
            </div>
            <span className="text-[13.5px] lg:text-[15px] font-bold text-slate-900 tracking-tight whitespace-nowrap">Fees & Dues</span>
          </div>
          {myStats.feeDue != null && myStats.feeDue > 0 ? (
            <span className="hidden lg:flex text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 items-center gap-1 border border-rose-200 whitespace-nowrap">
              <AlertTriangle className="w-3 h-3 text-rose-600" />
              <span>Dues Pending</span>
            </span>
          ) : (
            (myStats.feeDue != null || Number(session?.feeDue) >= 0) && (
              <span className="hidden lg:inline text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 whitespace-nowrap">
                No Dues
              </span>
            )
          )}
        </div>

        <div className="flex-1 flex flex-col justify-center mt-3 lg:mt-3.5">
          <div className="flex items-center gap-x-2 gap-y-1.5 flex-wrap">
            <div className="text-[30px] min-[380px]:text-[34px] lg:text-[40px] leading-none font-extrabold text-slate-900 tracking-tight">
              {myStats.feeDue != null ? `\u20B9${myStats.feeDue.toLocaleString('en-IN')}` : '—'}
            </div>
            {myStats.feeDue != null && myStats.feeDue > 0 ? (
              <span className="lg:hidden inline-flex items-center h-6 px-3 rounded-full bg-rose-600 text-white text-xs font-bold whitespace-nowrap shadow-sm">
                Pay Now
              </span>
            ) : (
              (myStats.feeDue != null || Number(session?.feeDue) >= 0) && (
                <span className="lg:hidden text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200 whitespace-nowrap">No Dues</span>
              )
            )}
          </div>
          <p className="text-xs lg:text-[12.5px] text-slate-600 font-medium mt-1.5">Total Outstanding</p>
          {myStats.feeDue != null && myStats.feeDue > 0 && (
            <span className="lg:hidden text-[11px] font-bold text-rose-700 flex items-center gap-1 mt-1">
              <AlertTriangle className="w-3 h-3 shrink-0" /> Dues Pending
            </span>
          )}
        </div>

        {/* Phone footer: small text link (the tile itself is the tap target) */}
        <span className="lg:hidden mt-auto pt-3 inline-flex items-center gap-0.5 text-xs font-semibold text-rose-700 whitespace-nowrap">
          View Statement <ChevronRight className="w-3.5 h-3.5" />
        </span>

        <div className="hidden lg:flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-900/[0.08]">
          <button
            onClick={() => onOpenModal('fee_dues')}
            className="flex-1 h-9 px-3 rounded-[10px] bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-sm transition-all cursor-pointer whitespace-nowrap"
          >
            Pay Now
          </button>
          <button
            onClick={() => onOpenModal('fee_dues')}
            className="flex-1 h-9 px-3 rounded-[10px] bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap"
          >
            View Statement
          </button>
        </div>
      </div>

      {/* Card 3: Active Gate Pass — phone: one horizontal strip; desktop: card.
          Same element and click handler on both; only the grid areas move. */}
      <div 
        onClick={() => isDayScholar
          ? onOpenModal('leave')
          : cardPass ? onViewPassQR(cardPass) : onOpenModal('gate_pass')}
        className={`order-5 ${myMentor ? 'col-span-2 lg:col-span-1' : 'col-span-2'} min-w-0 rounded-2xl border border-[#fde68a] bg-gradient-to-r lg:bg-gradient-to-b from-[#fefce8] to-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] px-3.5 py-3 lg:p-4 cursor-pointer group active:scale-[.985] lg:active:scale-100 lg:hover:shadow-lg lg:hover:-translate-y-0.5 transition-all duration-300 grid gap-x-3 lg:gap-x-0 grid-cols-[30px_minmax(0,1fr)_auto] lg:grid-cols-[34px_minmax(0,1fr)_auto] lg:grid-rows-[auto_auto_1fr_auto] [grid-template-areas:'hicon_htitle_htitle'_'hicon_badge_badge'_'hicon_main_act'_'foot_foot_foot'] lg:[grid-template-areas:'hicon_htitle_htitle'_'badge_badge_badge'_'main_main_main'_'foot_foot_act']`}
      >
        <div className="[grid-area:hicon] self-start lg:self-auto w-[30px] h-[30px] lg:w-[34px] lg:h-[34px] rounded-[9px] lg:rounded-[10px] bg-[#fef3c7] text-[#d97706] flex items-center justify-center">
          <QrCode className="w-4 h-4" />
        </div>
        <span className="[grid-area:htitle] self-end lg:self-center lg:ml-2.5 text-[11.5px] lg:text-[15px] font-semibold lg:font-bold text-slate-500 lg:text-slate-900 tracking-tight whitespace-nowrap">Active Gate Pass</span>
        <div className="[grid-area:badge] justify-self-start self-start mt-1.5 lg:mt-2.5 flex items-center gap-1.5 min-w-0 max-w-full">
          {leaveCard ? (
          <span data-testid="pass-card-badge" className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 border leading-tight ${leaveCard.badgeCls}`}>
            {leaveCard.icon === 'x' ? <XCircle className="w-3 h-3 shrink-0" />
              : <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${leaveCard.dotCls}`}></span>}
            <span>{leaveCard.badge}</span>
          </span>
          ) : (
          <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 border leading-tight ${
            isPassApproved
              ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
              : isPassReturned
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : isPassUsed
                  ? 'bg-slate-200 text-slate-700 border-slate-400'
                  : 'bg-amber-100 text-amber-800 border-amber-300'
          }`}>
            {!cardPass ? (
              <>
                <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0"></span>
                <span>No Pass</span>
              </>
            ) : isPassReturned ? (
              <>
                <CheckCircle2 className="w-3 h-3 shrink-0" />
                <span>Returned — Pass Closed</span>
              </>
            ) : isPassUsed ? (
              <>
                <XCircle className="w-3 h-3 shrink-0" />
                <span>Out of Campus (Return Pending)</span>
              </>
            ) : (
              <>
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isPassApproved ? 'bg-emerald-600' : 'bg-amber-600 animate-pulse'}`}></span>
                <span>{cardPass.status || 'Pending'}</span>
              </>
            )}
          </span>
          )}
        </div>

        <div className="[grid-area:main] min-w-0 mt-1.5 lg:mt-3 lg:flex lg:flex-col lg:justify-center">
          <div className={`${leaveCard && !leaveNo ? 'text-[15px] lg:text-xl 2xl:text-2xl' : 'text-[15px] lg:text-[26px]'} leading-tight font-bold lg:font-extrabold text-slate-900 font-mono tracking-tight break-words group-hover:text-amber-900 transition-colors`}>
            {leaveCard ? (leaveNo || 'Day-Scholar Leave') : cardPass ? cardPass.id : 'No Active Pass'}
          </div>
          <p className="text-[11px] lg:text-[12.5px] text-slate-600 font-medium mt-0.5 lg:mt-1 max-lg:line-clamp-2 max-lg:break-words lg:truncate">
            {leaveCard
              ? `${dayLeave.reason || 'Leave'} • One-way exit`
              : cardPass ? `${cardPass.destination || 'Campus'} • ${cardPass.passType || 'Day Pass'}` : 'No pass is currently active for your account'}
          </p>
        </div>

        <div className="[grid-area:foot] mt-2.5 pt-2.5 lg:mt-3 lg:pt-3 border-t border-dashed lg:border-solid border-amber-200/80 flex items-center gap-1.5 text-xs text-amber-950 font-semibold min-w-0">
          <span className={`w-2 h-2 rounded-full shrink-0 ${leaveCard ? leaveCard.footerDot : !cardPass ? 'bg-slate-300' : isPassUsed ? 'bg-slate-400' : isPassReturned ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
          <span data-testid="pass-card-footer" className="leading-snug">
            {leaveCard
              ? leaveCard.footer
              : !cardPass
              ? (isDayScholar ? (isLeaveWindowOpen() ? 'Tap to request leave from your mentor' : 'Leave requests: 9:00 AM – 4:30 PM') : 'Tap to request a new gate pass')
              : isPassReturned
                ? (isDayScholar ? 'Visit Complete — Pass Closed' : 'Round Trip Complete — Pass Closed')
                : isPassUsed
                  ? 'Exited — Show QR Again to Return'
                  : isPassApproved
                    ? 'Warden Approved'
                    : isPassRejected
                      ? 'Rejected — tap to request again'
                      : 'Awaiting Sign-off'}
          </span>
        </div>
        <span className="[grid-area:act] justify-self-end self-end lg:self-stretch flex items-center mt-1 lg:mt-3 lg:pt-3 lg:pl-2 lg:border-t border-amber-200/80 text-xs font-bold text-amber-800 group-hover:translate-x-1 transition-transform whitespace-nowrap">
          {leaveCard ? leaveCard.action : cardPass ? 'View QR →' : 'Request →'}
        </span>
      </div>

      {/* Card 4: MY MENTOR — the faculty mentor assigned to this student
          (profiles.mentor_roll). Day-scholar leave requests route to
          this teacher for approval. Hidden when not assigned. */}
      {myMentor && (
        <div className="order-7 col-span-2 lg:col-span-1 min-w-0 rounded-2xl border border-[#c7d2fe] lg:border-[#ddd6fe] bg-gradient-to-br lg:bg-gradient-to-b from-[#eef2ff] lg:from-[#f5f3ff] to-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-3.5 lg:p-4 flex flex-col lg:hover:shadow-lg lg:hover:-translate-y-0.5 transition-all duration-300">
          <div className="flex items-center gap-2.5">
            <div className="w-[30px] h-[30px] lg:w-[34px] lg:h-[34px] rounded-[9px] lg:rounded-[10px] bg-[#e0e7ff] text-[#4f46e5] flex items-center justify-center shrink-0">
              <UserCheck className="w-4 h-4" />
            </div>
            <h2 className="text-[13.5px] lg:text-[15px] font-bold text-slate-900 tracking-tight whitespace-nowrap">
              My Mentor
            </h2>
            <span className="ml-auto text-[9px] lg:text-[10px] font-extrabold uppercase tracking-wide text-indigo-700 bg-indigo-100 border border-indigo-200 rounded-full px-2 py-0.5">
              Assigned
            </span>
          </div>

          <div className="flex-1 flex flex-col justify-center mt-3">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 lg:w-[42px] lg:h-[42px] rounded-xl bg-gradient-to-br from-cyan-600 to-blue-700 text-white flex items-center justify-center font-extrabold shadow-sm shrink-0">
                {(myMentor.name || 'M').charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm lg:text-[15px] font-extrabold text-slate-900 leading-snug break-words">{myMentor.name || 'Faculty Mentor'}</p>
                <p className="text-[11.5px] lg:text-[12px] text-slate-600 font-medium leading-snug break-words">
                  {myMentor.department || 'Faculty'} {myMentor.department ? '• ' : ''}Mentor
                </p>
              </div>
              {/* Phone: call button sits on the mentor row */}
              {myMentor.phone ? (
                <a
                  href={`tel:${myMentor.phone}`}
                  className="lg:hidden flex-none h-[44px] px-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                >
                  <UserCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>Call Mentor</span>
                </a>
              ) : (
                <span className="lg:hidden flex-none h-[44px] px-3 rounded-xl bg-indigo-50 text-indigo-700 text-xs font-bold flex items-center justify-center gap-1.5 border border-indigo-200">
                  <UserCheck className="w-3.5 h-3.5 shrink-0" />
                  <span>Faculty Mentor</span>
                </span>
              )}
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {myMentor.roll && (
                <span className="text-[10px] font-mono font-bold text-slate-700 bg-white border border-slate-200 rounded-md px-2 py-0.5">
                  {myMentor.roll}
                </span>
              )}
              <span className="text-[10px] font-bold text-indigo-800 bg-indigo-50 border border-indigo-200 rounded-md px-2 py-0.5">
                {isDayScholar ? 'Leave approvals' : 'Guidance & support'}
              </span>
            </div>

            <p className="text-[12px] lg:text-[12.5px] text-slate-600 font-medium leading-relaxed mt-2">
              {isDayScholar
                ? `Your day-scholar leave requests go to ${myMentor.name || 'your mentor'} for sign-off.`
                : `Your mentor is your first point of contact for academic help and campus life.`}
            </p>
          </div>

          {/* Desktop: full-width call button pinned to the bottom */}
          <div className="hidden lg:flex mt-3 pt-3 border-t border-slate-900/[0.08] items-center gap-2">
            {myMentor.phone ? (
              <a
                href={`tel:${myMentor.phone}`}
                className="flex-1 h-9 px-3 rounded-[10px] bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs"
              >
                <UserCheck className="w-3.5 h-3.5 shrink-0" />
                <span>Call Mentor</span>
              </a>
            ) : (
              <span className="flex-1 h-9 px-3 rounded-[10px] bg-indigo-50 text-indigo-700 text-xs font-bold flex items-center justify-center gap-1.5 border border-indigo-200">
                <UserCheck className="w-3.5 h-3.5 shrink-0" />
                <span>Faculty Mentor</span>
              </span>
            )}
          </div>
        </div>
      )}

      {/* 4. Today's Mess Menu — phone: stacked (amber band, next meal, buttons);
          desktop: one wide card in 3 zones (status strip | next meal | actions) */}
      <div className="order-8 col-span-full min-w-0 rounded-2xl border border-[#fde68a] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden lg:grid lg:grid-cols-[264px_minmax(0,1fr)] xl:grid-cols-[292px_minmax(0,1fr)_204px] 2xl:grid-cols-[304px_minmax(0,1fr)_228px]">

        {/* Zone 1: title, tags, live status / countdown */}
        <div className="bg-[linear-gradient(135deg,#fffbeb,#fef3c7)] lg:bg-[linear-gradient(150deg,#fffbeb_0%,#fef3c7_60%,#fde68a_100%)] px-4 py-3.5 lg:py-[18px] lg:pl-5 lg:pr-[30px] border-b border-[#fde68a] lg:border-b-0 lg:[clip-path:polygon(0_0,calc(100%_-_18px)_0,100%_50%,calc(100%_-_18px)_100%,0_100%)] flex flex-col justify-between gap-3 min-w-0">
          <div>
            <div className="flex items-center gap-2.5">
              <div className="w-[30px] h-[30px] rounded-[9px] bg-white text-amber-600 flex items-center justify-center shrink-0">
                <Utensils className="w-4 h-4" />
              </div>
              <h3 className="text-[15px] font-bold text-[#78350f] whitespace-nowrap">Today's Mess Menu</h3>
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-2.5">
              {isFeastDay(todayMenu) ? (
                <span className="inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-white text-amber-700 border border-[#fde68a]">
                  Special Feast! ✨
                </span>
              ) : (
                <span className="inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-white text-amber-700 border border-[#fde68a]">
                  {todayDayLabel}'s Menu
                </span>
              )}
              <span className="inline-flex items-center gap-1 text-[11px] lg:text-xs font-semibold text-[#78350f] bg-white/60 lg:bg-transparent border border-[#fde68a] lg:border-0 rounded-full px-2.5 lg:px-0 py-0.5">
                <MapPin className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                <span>Campus Mess</span>
              </span>
            </div>
          </div>

          {/* Live Menu — ONLY the meal being served right now (or the next upcoming meal) */}
          <div className={`rounded-xl border px-3 py-2.5 ${
            mealStatus.current
              ? 'bg-emerald-50/90 border-emerald-300'
              : 'bg-white/70 border-[#fde68a]'
          }`}>
            {mealStatus.current ? (
              <>
                <p className="text-[13px] font-extrabold text-slate-900 flex items-center gap-1.5 flex-wrap">
                  {MEAL_TIMES[mealStatus.current]}
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-600 text-white flex items-center gap-1 self-start">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                    LIVE NOW
                  </span>
                </p>
                <ul className="text-[12.5px] text-slate-700 font-bold pt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                  {todayMenu[mealStatus.current].split(',').map((item, idx) => (
                    <li key={idx} className="flex items-center gap-2">• {item.trim()}</li>
                  ))}
                </ul>
              </>
            ) : (
              <>
                <p className="text-[12px] font-semibold text-[#92400e] flex items-center gap-1.5 flex-wrap">
                  <Clock className="w-3.5 h-3.5 text-amber-600" />
                  Kitchen break between meals
                </p>
                <p className="text-[12.5px] text-[#78350f] font-medium pt-1 flex items-baseline gap-x-1 flex-wrap">
                  <span>Next serving in</span>
                  <b className="text-[18px] lg:text-[22px] leading-none font-bold text-[#92400e]">{fmtDuration(mealStatus.minsToNext)}</b>
                  <span className="lg:hidden">— see below ↓</span>
                </p>
              </>
            )}
          </div>
        </div>

        {/* Zone 2: next meal (keeps RSVP usable — cut-off is 3h BEFORE each meal) */}
        <div className="px-4 pt-3.5 lg:py-[18px] lg:pl-[26px] lg:pr-[22px] flex gap-3 lg:gap-4 items-start lg:items-center min-w-0">
          <div className="w-[58px] h-[58px] lg:w-[72px] lg:h-[72px] 2xl:w-[84px] 2xl:h-[84px] rounded-[14px] lg:rounded-[18px] overflow-hidden shrink-0 shadow-[0_4px_10px_-6px_rgba(146,64,14,0.35)] border-2 border-white">
            <img 
              src="/mess_food.jpg" 
              alt="Today's Meal" 
              className="w-full h-full object-cover"
            />
          </div>
          {mealStatus.next && (
            <div className="min-w-0 flex-1">
              <p className="font-bold text-slate-800 flex items-center gap-2 flex-wrap">
                <span className="text-[15px] lg:text-[18px]">Next: {mealStatus.next.charAt(0).toUpperCase() + mealStatus.next.slice(1)}</span>
                {mealStatus.isTomorrow && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-700 border border-slate-300">TOMORROW</span>
                )}
                <span className="text-[11px] font-mono text-amber-900 bg-amber-100 px-2 py-0.5 rounded-md border border-amber-200 whitespace-nowrap">
                  starts {mealStatus.nextStartLabel}
                </span>
              </p>
              <p className="text-[13px] lg:text-sm text-slate-600 pt-1 leading-relaxed">{(mealStatus.isTomorrow ? getTomorrowMenu() : todayMenu)[mealStatus.next]}</p>
              <p className={`mt-2.5 inline-flex items-start gap-1.5 text-[11.5px] font-medium rounded-[10px] lg:rounded-full border px-2.5 py-1 ${mealStatus.rsvpClosed ? 'text-slate-500 bg-slate-50 border-slate-200' : 'text-[#9a3412] bg-[#fff7ed] border-[#fed7aa]'}`}>
                <Leaf className="w-3 h-3 shrink-0 mt-0.5" />
                {mealStatus.rsvpClosed
                  ? 'RSVP closed for this meal (locks 3 hrs before cooking)'
                  : `RSVP before it locks at ${mealStatus.rsvpCutoffLabel} (3 hrs before cooking)`}
              </p>
            </div>
          )}
        </div>

        {/* Zone 3: View Full Menu + Meal RSVP / Review Food */}
        <div className="px-4 pt-3.5 pb-1 lg:pb-0 grid grid-cols-2 gap-2.5 lg:col-span-2 xl:col-span-1 lg:flex lg:flex-row lg:items-center lg:justify-end lg:gap-2.5 lg:px-5 lg:py-3 lg:border-t lg:border-amber-100 xl:flex-col xl:items-stretch xl:justify-center xl:border-t-0 xl:border-l xl:border-slate-100 xl:py-4">
          {/* View Full Menu toggle — complete day list on demand */}
          <button
            type="button"
            onClick={() => setShowFullMenu(v => !v)}
            className="col-span-2 order-last lg:order-first lg:mr-auto xl:mr-0 h-[44px] lg:h-9 xl:h-[22px] border-t border-amber-100 lg:border-0 flex items-center justify-center gap-1 text-xs font-extrabold text-amber-800 hover:text-amber-900 transition-colors cursor-pointer"
          >
            {showFullMenu ? 'Hide Full Menu' : 'View Full Menu'}
            {showFullMenu ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
          <button
            type="button"
            onClick={() => onOpenModal('meal_rsvp')}
            className="h-[44px] lg:h-[38px] lg:px-5 xl:px-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs active:scale-95 whitespace-nowrap"
          >
            <Leaf className="w-3.5 h-3.5 shrink-0" />
            <span>Meal RSVP</span>
          </button>
          <button
            type="button"
            onClick={() => onOpenModal('mess')}
            className="h-[44px] lg:h-[38px] lg:px-5 xl:px-3.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs active:scale-95 whitespace-nowrap"
          >
            <span>Review Food</span>
            <span>→</span>
          </button>
        </div>

        {showFullMenu && (
          <div className="lg:col-span-full px-4 pb-4 pt-2 lg:px-5 lg:pt-4 lg:pb-5 border-t border-amber-100 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-x-5 gap-y-2.5 text-xs sm:text-sm">
            {Object.entries(visibleMealTimes).map(([mealKey, mealLabel]) => (
              <div key={mealKey} className="pt-2 lg:pt-0 min-w-0">
                <p className="font-extrabold text-slate-900 flex items-center gap-1.5 flex-wrap">
                  {mealLabel}
                  {mealKey === mealStatus.current && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-600 text-white flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                      LIVE NOW
                    </span>
                  )}
                  {mealKey === mealStatus.next && !mealStatus.current && (
                    <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">UP NEXT</span>
                  )}
                </p>
                <ul className="text-slate-700 space-y-1 font-bold pt-1">
                  {todayMenu[mealKey].split(',').map((item, idx) => (
                    <li key={idx} className="flex items-center gap-2">• {item.trim()}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {/* bottom breathing room on phones (zone 3 is the last row there) */}
        <div className="h-3 lg:hidden" />
      </div>

      {/* 5. Live Action & Status Feed — full width, last */}
      <div className="order-9 col-span-full min-w-0 bg-white rounded-2xl border border-slate-200 shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-3.5 lg:p-[18px]">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5 lg:gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-[30px] h-[30px] rounded-[9px] bg-blue-100 text-blue-600 flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4" />
            </div>
            <h2 className="text-[15px] font-bold text-slate-900 tracking-tight">
              Live Action & Status Feed
            </h2>
          </div>

          {/* Feed Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none -mx-3.5 px-3.5 py-1.5 lg:py-0 lg:mx-0 lg:px-0">
            {[
              { id: 'all', label: 'All Feed' },
              { id: 'issues', label: 'Hostel Issues' },
              { id: 'passes', label: 'Gate Passes' },
              { id: 'mess', label: 'Requests & Mess' }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveFeedTab(tab.id)}
                className={`relative shrink-0 h-[36px] px-3.5 rounded-full text-[12.5px] font-semibold border transition-all whitespace-nowrap cursor-pointer after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-[''] lg:after:hidden ${
                  activeFeedTab === tab.id
                    ? 'bg-slate-900 border-slate-900 text-white shadow-xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Faculty Finder now lives in the header — an inline dropdown
            right under the search bar (FacultyFinderDropdown). */}

        {/* Activities List */}
        <div className="space-y-2 pt-2.5">
          {filteredActivities.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">
              Nothing here yet — gate passes, complaints and feedback you submit will appear in this feed.
            </div>
          ) : (
            sortedActivities.map((rawAct) => {
              const act = withPatch(rawAct);
              const showLifecycle = act.type === 'ticket' && hasLifecycle(act);
              const isPass = act.type === 'gate_pass';
              const isElectrical = act.category === 'Electrical';
              const isPlumbing = act.category === 'Plumbing';
              const isNotice = act.type === 'notice';
              const isMess = act.type === 'mess';
              const isDoc = act.category === 'Admin Document' || /^DOC-\d+$/i.test(String(act.id || ''));
              // Live registrar verdict (polled) overrides the local guess
              const docStatus = docStatusMap?.[act.id] || (String(act.status || '').startsWith('PENDING_OFFICE') ? 'PENDING' : act.status);

              return (
                <div
                  key={act.id}
                  onClick={() => {
                    if (isPass) {
                      onViewPassQR(act);
                    } else if (isMess) {
                      onOpenModal('mess');
                    } else if (isNotice) {
                      onOpenModal('notices');
                    } else if (act.type === 'ticket') {
                      // A submitted complaint opens its READ-ONLY detail card —
                      // never the (fresh) report form.
                      setTicketDetail(act);
                    } else {
                      onOpenModal('complaint');
                    }
                  }}
                  className={`p-[11px] lg:px-3 rounded-xl bg-white border border-[#edf1f5] hover:border-slate-200 hover:shadow-md transition-all duration-200 cursor-pointer flex items-start lg:items-center justify-between gap-2.5 lg:gap-3 group ${showLifecycle ? 'flex-wrap' : ''}`}
                >
                  <div className={`flex items-start lg:items-center gap-2.5 lg:gap-3 min-w-0 ${showLifecycle ? 'flex-1 basis-0' : ''}`}>
                    {/* Icon Badge */}
                    <div className={`w-[30px] h-[30px] lg:w-[34px] lg:h-[34px] rounded-[9px] lg:rounded-[10px] flex items-center justify-center shrink-0 ${
                      isPass 
                        ? 'bg-emerald-50 text-emerald-600' 
                        : isElectrical
                          ? 'bg-purple-50 text-purple-600'
                          : isPlumbing
                            ? 'bg-blue-50 text-blue-600'
                            : isNotice
                              ? 'bg-rose-50 text-rose-600'
                              : 'bg-amber-50 text-amber-600'
                    }`}>
                      {isPass && <Calendar className="w-4 h-4" />}
                      {isElectrical && <Zap className="w-4 h-4" />}
                      {isPlumbing && <Droplets className="w-4 h-4" />}
                      {isNotice && <Info className="w-4 h-4" />}
                      {isMess && <Utensils className="w-4 h-4" />}
                      {!isPass && !isElectrical && !isPlumbing && !isNotice && !isMess && <FileText className="w-4 h-4" />}
                    </div>

                    {/* Title & Info */}
                    <div className="min-w-0">
                      <p className="text-[13px] lg:text-[13.5px] font-semibold text-slate-800 leading-snug lg:truncate group-hover:text-blue-600 transition-colors">
                        <span className="font-mono text-slate-900 font-bold mr-1.5 inline-block max-w-[118px] lg:max-w-none truncate align-bottom">{showLifecycle ? ticketCode(act) : act.id}</span>
                        <span>• {act.title}</span>
                      </p>

                      {/* Pipeline Status / Status Label */}
                      <div className="flex items-center flex-wrap gap-x-2 gap-y-1.5 mt-1.5 lg:mt-1">
                        {isPass ? (
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md ${
                            act.status === 'USED' 
                              ? 'bg-blue-50 text-blue-700' 
                              : act.status === 'APPROVED'
                                ? 'bg-emerald-50 text-emerald-700'
                                : 'bg-amber-50 text-amber-700'
                          }`}>
                            {act.status === 'USED' ? 'Verified by Main Gate' : act.statusLabel || act.status}
                          </span>
                            ) : (
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-md font-semibold ${
                                  isDoc
                                    ? docStatus === 'READY_FOR_PICKUP'
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : docStatus === 'REJECTED'
                                        ? 'bg-rose-50 text-rose-700'
                                        : docStatus === 'PROCESSING'
                                          ? 'bg-sky-50 text-sky-700'
                                          : 'bg-amber-50 text-amber-700'
                                    : ['RESOLVED', 'CLOSED'].includes(String(act.status).toUpperCase())
                                      ? 'bg-emerald-50 text-emerald-700'
                                      : String(act.status).toUpperCase() === 'ESCALATED_TO_DEAN'
                                        ? 'bg-rose-50 text-rose-700'
                                        : ['ASSIGNED', 'IN_PROGRESS'].includes(String(act.status).toUpperCase())
                                          ? 'bg-sky-50 text-sky-700'
                                          : 'bg-amber-50 text-amber-700'
                                }`}>
                                  {isDoc
                                    ? (docStatus === 'READY_FOR_PICKUP'
                                        ? 'Ready for Pickup'
                                        : docStatus === 'REJECTED'
                                          ? 'Rejected by Office'
                                          : docStatus === 'PROCESSING'
                                            ? 'Processing at Registrar Office'
                                            : 'Pending Admin Verification')
                                    : ((act.statusLabel || act.status || 'Reported').replace(/_/g, ' '))}
                                </span>
                                {act.assignedTo && !showLifecycle && ['ASSIGNED', 'IN_PROGRESS'].includes(String(act.status).toUpperCase()) && (
                                  <span className="text-[10px] text-sky-700 flex items-center gap-0.5">
                                    <Wrench className="w-3 h-3" /> {act.assignedTo}
                                  </span>
                                )}
                                {!isDoc && <AiCategoryChip ticket={act} />}
                                {act.aiFallback && (
                                  <span className="text-[10px] text-slate-500 italic">AI offline — deterministic classification</span>
                                )}
                              </div>
                            )}

                            <span className="text-[10.5px] text-slate-400 font-mono">
                              {relativeTime(act)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right Chevron */}
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all shrink-0 self-center" />

                      {/* Document request: same tick-style progress as complaints */}
                      {isDoc && (
                        <div className="basis-full w-full border-t border-slate-100 pt-2.5 mt-0.5 cursor-default" onClick={(e) => e.stopPropagation()}>
                          <StageTicks
                            labels={['Requested', 'Ready for Pickup']}
                            stage={String(docStatus).toUpperCase() === 'READY_FOR_PICKUP' ? 2 : 1}
                            rejected={String(docStatus).toUpperCase() === 'REJECTED'}
                          />
                        </div>
                      )}

                      {/* Complaint lifecycle: progress + Resolved / Not fixed (own complaint) */}
                      {showLifecycle && (
                        <div className="basis-full w-full border-t border-slate-100 pt-2.5 mt-0.5 cursor-default" onClick={(e) => e.stopPropagation()}>
                          {renderTicketLifecycle(act, true)}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
        </div>

      </div>

      {/* Read-only ticket detail card (opened from the feed) */}
      {ticketDetail && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm"
          onClick={() => setTicketDetail(null)}
        >
          <div
            className="bg-white rounded-2xl w-full max-w-md shadow-2xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between p-5 border-b border-slate-100">
              <div className="min-w-0 pr-3">
                <h3 className="text-lg font-extrabold text-slate-900 truncate">{ticketDetail.title}</h3>
                <p className="text-[10px] font-mono text-slate-400 truncate">{hasLifecycle(ticketDetail) ? `${ticketCode(ticketDetail)} · ${ticketDetail.id}` : ticketDetail.id}</p>
              </div>
              <button
                type="button"
                onClick={() => setTicketDetail(null)}
                className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center text-slate-500 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-5 space-y-3 text-sm">
              {(() => {
                const isDocDetail = ticketDetail.category === 'Admin Document' || /^DOC-\d+$/i.test(String(ticketDetail.id || ''));
                const rawDetailStatus = isDocDetail
                  ? (docStatusMap?.[ticketDetail.id]
                      || (String(ticketDetail.status || '').startsWith('PENDING_OFFICE') ? 'PENDING' : ticketDetail.status))
                  : ticketDetail.status;
                const detailStatus = String(rawDetailStatus || 'PENDING').toUpperCase();
                const detailStudentConfirmed = ticketDetail.studentConfirmed === true || detailStatus === 'CLOSED';
                const docLabels = {
                  PENDING: 'Pending Admin Verification',
                  PROCESSING: 'Processing at Registrar Office',
                  READY_FOR_PICKUP: 'Ready for Pickup',
                  REJECTED: 'Rejected by Office'
                };
                const docRejected = isDocDetail && detailStatus === 'REJECTED';
                // Lifecycle progress: docs = Requested→Ready for Pickup
                // (2 stages — Processing is an office-internal detail);
                // tickets = Reported→In Progress→Student confirmed→Closed.
                const stageCount = isDocDetail ? 2 : 4;
                let stage = isDocDetail
                  ? (docRejected ? 1 : (detailStatus === 'READY_FOR_PICKUP' ? 2 : 1))
                  : (detailStatus === 'CLOSED' ? 4
                      : (detailStudentConfirmed || detailStatus === 'RESOLVED') ? 3
                        : ['ASSIGNED', 'IN_PROGRESS', 'ESCALATED_TO_DEAN'].includes(detailStatus) ? 2 : 1);
                const stageLabels = isDocDetail
                  ? ['Requested', 'Ready for Pickup']
                  : ['Reported', 'In Progress', 'Student confirmed', 'Closed'];
                const liveStatusLabel = isDocDetail
                  ? docLabels[detailStatus] || detailStatus
                  : (ticketDetail.statusLabel || ticketDetail.status || 'REPORTED').replace(/_/g, ' ');
                const confirmTicket = async () => {
                  try {
                    const res = await fetch(`/api/tickets/${ticketDetail.id}/student-confirm`, { method: 'POST' });
                    const d = await res.json().catch(() => ({}));
                    if (d?.success) {
                      setTicketDetail({ ...ticketDetail, status: 'RESOLVED', studentConfirmed: true, statusLabel: 'Resolved — confirmed by you' });
                    }
                  } catch { /* offline — retry later */ }
                };
                return (
                  <>
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                  {ticketDetail.category || 'Issue'}
                </span>
                {!isDocDetail && <AiCategoryChip ticket={ticketDetail} className="py-1 rounded-lg font-bold" />}
                <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                  Urgency: {ticketDetail.urgency || 'MEDIUM'}
                </span>
                <span className={`px-2 py-1 rounded-lg text-[10px] font-bold border ${
                  docRejected ? 'bg-rose-50 text-rose-700 border-rose-200'
                    : detailStatus === 'READY_FOR_PICKUP' || detailStatus === 'RESOLVED' || detailStatus === 'CLOSED'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-sky-50 text-sky-700 border-sky-200'
                }`}>
                  {liveStatusLabel}
                </span>
              </div>

              {/* Lifecycle progress bar — exactly where this request sits.
                  Server complaints use the Reported → Resolved → Closed bar
                  (with Resolved / Not fixed) further down. */}
              {!(!isDocDetail && hasLifecycle(ticketDetail)) && (
              <div className="pt-1">
                <StageTicks labels={stageLabels} stage={stage} rejected={docRejected} />
              </div>
              )}

              <div className="flex items-center gap-2 text-slate-700 font-bold">
                <MapPin className="w-4 h-4 text-amber-600 shrink-0" /> {ticketDetail.location || 'Hostel'}
              </div>
              {ticketDetail.assignedTo && !hasLifecycle(ticketDetail) && (
                <div className="flex items-center gap-2 text-slate-700 font-bold">
                  <Wrench className="w-4 h-4 text-sky-600 shrink-0" /> {ticketDetail.assignedTo}
                </div>
              )}
              {(ticketDetail.sla || ticketDetail.sla_hours) && (
                <div className="flex items-center gap-2 text-slate-700 font-bold">
                  <Clock className="w-4 h-4 text-blue-600 shrink-0" />
                  {ticketDetail.sla || `SLA: ${ticketDetail.sla_hours}h Target`}
                  {ticketDetail.sla_hours ? ` • ${ticketDetail.sla_hours}h target` : ''}
                </div>
              )}
              <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
                <p className="text-[10px] uppercase tracking-wide font-extrabold text-slate-400 mb-1">
                  {isDocDetail ? 'Your purpose / reason' : 'Your complaint'}
                </p>
                <p className="text-slate-700 font-medium">
                  "{ticketDetail.description || ticketDetail.raw_text || '—'}"
                </p>
              </div>
              {isDocDetail && ticketDetail.remarks && (
                <p className="text-[11px] text-slate-500 px-1">
                  <b className="text-slate-700">Office remarks:</b> {ticketDetail.remarks}
                </p>
              )}

              {/* Accountability loop: the student confirms the technician's job
                  is done; the warden can only AFTER that verify-close it. */}
              {!isDocDetail && hasLifecycle(ticketDetail) && (
                <div className="rounded-xl border border-slate-200 p-3">
                  {renderTicketLifecycle(ticketDetail)}
                </div>
              )}
              {!isDocDetail && !hasLifecycle(ticketDetail) && detailStatus !== 'CLOSED' && !detailStudentConfirmed && (
                <button
                  type="button"
                  onClick={confirmTicket}
                  className="w-full px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm active:scale-[0.98]"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Technician finished — Confirm Job Done</span>
                </button>
              )}
              {!isDocDetail && !hasLifecycle(ticketDetail) && detailStudentConfirmed && detailStatus === 'CLOSED' && (
                <p className="text-[11px] text-emerald-700 font-bold px-1">
                  ✔ Verified & closed by warden — complaint fully resolved.
                </p>
              )}
              {!isDocDetail && !hasLifecycle(ticketDetail) && detailStudentConfirmed && detailStatus !== 'CLOSED' && (
                <p className="text-[11px] text-slate-500 px-1">
                  You confirmed the fix on {relativeTime(ticketDetail)} — the warden verifies and closes it from here.
                </p>
              )}
              <p className="text-[11px] text-slate-400">
                Submitted {relativeTime(ticketDetail)} • Live status updates appear in the feed above.
              </p>
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
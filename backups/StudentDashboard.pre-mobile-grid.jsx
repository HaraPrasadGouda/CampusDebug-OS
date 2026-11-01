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
  Layers,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { getTodayMenuKey, getTodayMenu, isFeastDay, getTodayDayLabel, getMealStatus, fmtDuration } from '../../data/messMenu';

export default function StudentDashboard({
  activities = [],
  activePass,
  onOpenModal,
  onViewPassQR,
  searchQuery = '',
  session
}) {
  const [activeFeedTab, setActiveFeedTab] = useState('all'); // 'all' | 'issues' | 'passes' | 'mess'
  const [ticketDetail, setTicketDetail] = useState(null); // read-only complaint detail card

  // REAL per-student stats (attendance %, fee due) — fetched from the server
  // with the login token; falls back to the values captured at sign-in.
  // Hardcoded demo numbers were removed: if the server is unreachable the
  // cards show "—" instead of pretending.
  const [myStats, setMyStats] = useState({
    attendance: Number(session?.attendance) || null,
    feeDue: Number(session?.feeDue) || null
  });
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
      })
      .catch(() => { /* offline — keep session values */ });
    return () => { alive = false; };
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

  const isPassApproved = activePass && activePass.status === 'APPROVED';
  const isPassPending = activePass && activePass.status === 'PENDING';
  const isPassRejected = activePass && activePass.status === 'REJECTED';
  const isPassUsed = activePass && activePass.status === 'USED';

  // Today's mess menu (picked by actual weekday)
  const todayMenuKey = getTodayMenuKey();
  const todayMenu = getTodayMenu();
  const todayDayLabel = getTodayDayLabel();
  // Live meal-slot engine: what's being served right now / what's next
  const mealStatus = getMealStatus();
  // "View Full Menu" expands the complete day list on demand
  const [showFullMenu, setShowFullMenu] = useState(false);

  const MEAL_TIMES = {
    breakfast: 'Breakfast (07:30 - 09:30 AM)',
    lunch: 'Lunch (12:30 - 02:30 PM)',
    snacks: 'Snacks (05:00 - 06:30 PM)',
    dinner: 'Dinner (08:00 - 10:00 PM)'
  };

  // Get greeting based on time of day
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  };

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      
      {/* 1. Greeting Banner with Campus Backdrop — plain text on mobile, carded on desktop */}
      <div className="relative md:overflow-hidden rounded-none sm:rounded-2xl md:rounded-3xl bg-transparent sm:bg-white/90 sm:backdrop-blur-sm border-0 sm:border sm:border-slate-200/50 shadow-none sm:shadow-sm p-0 sm:p-5 md:p-8 flex flex-col md:flex-row md:items-center justify-between md:min-h-[140px] pb-1 sm:pb-0">
        {/* Left greeting text */}
        <div className="relative z-10 max-w-lg">
          <h1 className="text-2xl sm:text-2xl md:text-3xl font-extrabold tracking-tight text-slate-900 flex items-center gap-2">
            <span>{getGreeting()}, {(session?.name || 'Student').split(' ')[0]}!</span>
            <span className="text-xl sm:text-3xl animate-bounce">👋</span>
          </h1>
          <p className="text-[11px] sm:text-sm text-slate-500 mt-1.5 font-medium leading-relaxed">
            Welcome back to your unified campus portal.
          </p>
        </div>

        {/* Right campus photography smoothly faded */}
        <div className="hidden md:block absolute right-0 top-0 bottom-0 w-1/2 overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-r from-white via-white/50 to-transparent z-10"></div>
          <img 
            src="/campus_banner.jpg" 
            alt="Campus" 
            className="w-full h-full object-cover object-right opacity-80"
          />
        </div>
      </div>

      {/* 2. Top Metric / Status Cards Grid (3 Columns) */}
      {/* 2. Top Metric / Status Cards Grid (3 Columns) - Distinct 3D colorful cards with bolder borders & larger text */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 sm:gap-5">
        
        {/* Card 1: Attendance */}
        <div className="rounded-2xl sm:rounded-3xl p-5 bg-gradient-to-br from-[#edf9f5] to-[#e0f5ed] border-2 border-[#bbf7d0] shadow-[0_6px_20px_rgba(16,185,129,0.08)] flex flex-col justify-between hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
          <div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold shadow-xs border border-emerald-200">
                <Calendar className="w-4 h-4 text-emerald-700" />
              </div>
              <span className="text-sm font-bold text-slate-800 tracking-tight">Attendance</span>
            </div>

            {/* Attendance Value and Big Centered Progress Circle (Fully Visible with generous viewBox) */}
            <div className="mt-3 flex items-center justify-between">
              <div>
                <div className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">{attendancePct != null ? `${attendancePct}%` : '—'}</div>
                <p className="text-xs text-slate-600 font-medium mt-0.5">Overall Attendance</p>
              </div>

              {/* High-Visibility Circular Progress Ring with no edge cut-off */}
              <div className="relative w-16 h-16 sm:w-18 sm:h-18 flex items-center justify-center p-0.5">
                <svg viewBox="0 0 80 80" className="w-full h-full transform -rotate-90 drop-shadow-xs">
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
          </div>

          <div className="mt-4 pt-3 border-t border-emerald-200/80">
            <button
              onClick={() => onOpenModal('timetable')}
              className="text-xs font-bold text-emerald-800 hover:text-emerald-950 flex items-center gap-1.5 transition-colors cursor-pointer group"
            >
              <span>View Today's Timetable (CSE)</span>
              <span className="group-hover:translate-x-1 transition-transform">→</span>
            </button>
          </div>
        </div>

        {/* Card 2: Fees & Dues */}
        <div className="rounded-2xl sm:rounded-3xl p-5 bg-gradient-to-br from-[#fff1f2] to-[#ffe8ea] border-2 border-[#fecdd3] shadow-[0_6px_20px_rgba(244,63,94,0.08)] flex flex-col justify-between hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-rose-100 text-rose-700 flex items-center justify-center font-bold text-sm shadow-xs border border-rose-200">
                  ₹
                </div>
                <span className="text-sm font-bold text-slate-800 tracking-tight">Fees & Dues</span>
              </div>
              {myStats.feeDue != null && myStats.feeDue > 0 ? (
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-rose-200/70 text-rose-800 flex items-center gap-1 border border-rose-300">
                  <AlertTriangle className="w-3 h-3 text-rose-600" />
                  <span>Due in 5 days</span>
                </span>
              ) : (
                (myStats.feeDue != null || Number(session?.feeDue) >= 0) && (
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-emerald-200/70 text-emerald-800 border border-emerald-300">
                    No Dues
                  </span>
                )
              )}
            </div>

            <div className="mt-3">
              <div className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">
                {myStats.feeDue != null ? `\u20B9${myStats.feeDue.toLocaleString('en-IN')}` : '—'}
              </div>
              <p className="text-xs text-slate-600 font-medium mt-0.5">Mess Owe Balance</p>
            </div>
          </div>

          <div className="mt-4 pt-3 flex items-center gap-2 border-t border-rose-200/80">
            <button
              onClick={() => onOpenModal('fee_dues')}
              className="px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-500/20 transition-all cursor-pointer"
            >
              Pay Now
            </button>
            <button
              onClick={() => onOpenModal('fee_dues')}
              className="px-3 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-800 border border-slate-300 text-xs font-semibold transition-colors cursor-pointer"
            >
              View Statement
            </button>
          </div>
        </div>

        {/* Card 3: Active Gate Pass */}
        <div 
          onClick={() => activePass ? onViewPassQR(activePass) : onOpenModal('gate_pass')}
          className="rounded-2xl sm:rounded-3xl p-5 bg-gradient-to-br from-[#fffbeb] to-[#fef6d8] border-2 border-[#fde68a] shadow-[0_6px_20px_rgba(245,158,11,0.08)] flex flex-col justify-between hover:shadow-xl hover:-translate-y-1 transition-all duration-300 cursor-pointer group"
        >
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold shadow-xs border border-amber-200">
                  <QrCode className="w-4 h-4" />
                </div>
                <span className="text-sm font-bold text-slate-800 tracking-tight">Active Gate Pass</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full flex items-center gap-1.5 border ${
                  isPassApproved
                    ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                    : isPassUsed
                      ? 'bg-slate-200 text-slate-700 border-slate-400'
                      : 'bg-amber-100 text-amber-800 border-amber-300'
                }`}>
                  {!activePass ? (
                    <>
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400"></span>
                      <span>No Pass</span>
                    </>
                  ) : isPassUsed ? (
                    <>
                      <XCircle className="w-3 h-3 shrink-0" />
                      <span>EXPIRED (Used at Gate)</span>
                    </>
                  ) : (
                    <>
                      <span className={`w-1.5 h-1.5 rounded-full ${isPassApproved ? 'bg-emerald-600' : 'bg-amber-600 animate-pulse'}`}></span>
                      <span>{activePass.status || 'Pending'}</span>
                    </>
                  )}
                </span>
              </div>
            </div>

            <div className="mt-3">
              <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-mono tracking-tight group-hover:text-amber-900 transition-colors">
                {activePass ? activePass.id : 'No Active Pass'}
              </div>
              <p className="text-xs text-slate-600 font-medium mt-0.5 truncate">
                {activePass ? `${activePass.destination || 'Campus'} • ${activePass.passType || 'Day Pass'}` : 'No pass is currently active for your account'}
              </p>
            </div>
          </div>

          <div className="mt-4 pt-3 flex items-center justify-between border-t border-amber-200/80">
            <div className="flex items-center gap-1.5 text-xs text-amber-950 font-semibold">
              <span className={`w-2 h-2 rounded-full ${!activePass ? 'bg-slate-300' : isPassUsed ? 'bg-slate-400' : 'bg-amber-500'}`}></span>
              <span>{!activePass ? 'Tap to request a new gate pass' : isPassUsed ? 'Pass Expired — Verified & Used at Main Gate' : isPassApproved ? 'Warden Approved' : 'Awaiting Sign-off'}</span>
            </div>
            <span className="text-xs font-bold text-amber-800 group-hover:translate-x-1 transition-transform">
              {activePass ? 'View QR →' : 'Request →'}
            </span>
          </div>
        </div>

      </div>

      {/* 3. Main Bottom Section: In Mobile View, Quick Actions + Mess Menu appears FIRST (order-1 lg:order-2), Feed appears below (order-2 lg:order-1) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 sm:gap-6">
        
        {/* Left Column: Live Action & Status Feed (order-2 in mobile, order-1 in desktop) */}
        <div className="order-2 lg:order-1 lg:col-span-8 space-y-4">
          
          {/* Feed Header & Filters */}
          <div className="bg-white/90 backdrop-blur-sm rounded-2xl sm:rounded-3xl p-4 sm:p-5 border border-slate-200/50 shadow-sm space-y-4">
            
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Zap className="w-4.5 h-4.5 text-blue-600 shrink-0" />
                <h2 className="text-base font-extrabold text-slate-900 tracking-tight">
                  Live Action & Status Feed
                </h2>
              </div>

              {/* Feed Filter Pills */}
              <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
                {[
                  { id: 'all', label: 'All Feed' },
                  { id: 'issues', label: 'Hostel Issues' },
                  { id: 'passes', label: 'Gate Passes' },
                  { id: 'mess', label: 'Requests & Mess' }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveFeedTab(tab.id)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap cursor-pointer ${
                      activeFeedTab === tab.id
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200/80 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Activities List */}
            <div className="space-y-3 pt-1">
              {filteredActivities.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-sm">
                  Nothing here yet — gate passes, complaints and feedback you submit will appear in this feed.
                </div>
              ) : (
                sortedActivities.map((act) => {
                  const isPass = act.type === 'gate_pass';
                  const isElectrical = act.category === 'Electrical';
                  const isPlumbing = act.category === 'Plumbing';
                  const isNotice = act.type === 'notice';
                  const isMess = act.type === 'mess';

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
                      className="p-3 sm:p-4 rounded-xl sm:rounded-2xl bg-white border border-slate-100/80 hover:border-slate-200 hover:shadow-md transition-all duration-200 cursor-pointer flex items-center justify-between gap-3 group"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        {/* Icon Badge */}
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
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
                          {isPass && <Calendar className="w-5 h-5" />}
                          {isElectrical && <Zap className="w-5 h-5" />}
                          {isPlumbing && <Droplets className="w-5 h-5" />}
                          {isNotice && <Info className="w-5 h-5" />}
                          {isMess && <Utensils className="w-5 h-5" />}
                          {!isPass && !isElectrical && !isPlumbing && !isNotice && !isMess && <FileText className="w-5 h-5" />}
                        </div>

                        {/* Title & Info */}
                        <div className="min-w-0">
                          <p className="text-xs sm:text-sm font-semibold text-slate-800 truncate group-hover:text-blue-600 transition-colors">
                            <span className="font-mono text-slate-900 font-bold mr-1.5">{act.id}</span>
                            <span>• {act.title}</span>
                          </p>

                          {/* Pipeline Status / Status Label */}
                          <div className="flex items-center gap-2 mt-1">
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
                                  ['RESOLVED', 'CLOSED'].includes(String(act.status).toUpperCase())
                                    ? 'bg-emerald-50 text-emerald-700'
                                    : String(act.status).toUpperCase() === 'ESCALATED_TO_DEAN'
                                      ? 'bg-rose-50 text-rose-700'
                                      : ['ASSIGNED', 'IN_PROGRESS'].includes(String(act.status).toUpperCase())
                                        ? 'bg-sky-50 text-sky-700'
                                        : 'bg-amber-50 text-amber-700'
                                }`}>
                                  {(act.statusLabel || act.status || 'Reported').replace(/_/g, ' ')}
                                </span>
                                {act.assignedTo && ['ASSIGNED', 'IN_PROGRESS'].includes(String(act.status).toUpperCase()) && (
                                  <span className="text-[10px] text-sky-700 flex items-center gap-0.5">
                                    <Wrench className="w-3 h-3" /> {act.assignedTo}
                                  </span>
                                )}
                                {act.masterJoined && (
                                  <span className="text-[10px] text-purple-700 flex items-center gap-0.5">
                                    <Layers className="w-3 h-3" /> Clustered — one fix serves all matches
                                  </span>
                                )}
                                {act.aiFallback && (
                                  <span className="text-[10px] text-slate-500 italic">AI offline — deterministic classification</span>
                                )}
                              </div>
                            )}

                            <span className="text-[10px] text-slate-400 font-mono ml-auto sm:ml-2">
                              {relativeTime(act)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right Chevron */}
                      <ChevronRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all shrink-0" />
                    </div>
                  );
                })
              )}
            </div>

          </div>

        </div>

        {/* Right Column: Quick Actions + Today's Mess Menu (In mobile: order-1 so it displays on top!) */}
        <div className="order-1 lg:order-2 lg:col-span-4 space-y-5 sm:space-y-6">
          
          {/* Quick Actions Card - Distinct border-2 and enhanced text size */}
          <div className="bg-white rounded-2xl sm:rounded-3xl p-5 border-2 border-slate-200 shadow-md space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
                <Zap className="w-4.5 h-4.5" />
              </div>
              <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
                Quick Actions
              </h2>
            </div>

            {/* 2-Column Grid of 6 Colorful Action Cards */}
            <div className="grid grid-cols-2 gap-3">
              
              {/* 1. Gate Pass */}
              <button
                type="button"
                onClick={() => onOpenModal('gate_pass')}
                className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-[#eff6ff] to-[#dbeafe] hover:from-[#dbeafe] hover:to-[#bfdbfe] border-2 border-[#bfdbfe] text-left transition-all duration-200 cursor-pointer group shadow-sm hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="w-9 h-9 rounded-xl bg-white text-blue-700 flex items-center justify-center mb-2 shadow-xs border border-blue-100 group-hover:scale-105 transition-transform">
                  <Calendar className="w-5 h-5 text-blue-600" />
                </div>
                <p className="text-sm font-extrabold text-slate-900">Gate Pass</p>
                <p className="text-xs text-blue-700 font-bold mt-0.5">Request exit</p>
              </button>

              {/* 2. Hostel Issue */}
              <button
                type="button"
                onClick={() => onOpenModal('complaint')}
                className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-[#fff1f2] to-[#ffe4e6] hover:from-[#ffe4e6] hover:to-[#fecdd3] border-2 border-[#fecdd3] text-left transition-all duration-200 cursor-pointer group shadow-sm hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="w-9 h-9 rounded-xl bg-white text-rose-700 flex items-center justify-center mb-2 shadow-xs border border-rose-100 group-hover:scale-105 transition-transform">
                  <Wrench className="w-5 h-5 text-rose-600" />
                </div>
                <p className="text-sm font-extrabold text-slate-900">Hostel Issue</p>
                <p className="text-xs text-rose-700 font-bold mt-0.5">Report repairs</p>
              </button>

              {/* 3. Certificates */}
              <button
                type="button"
                onClick={() => onOpenModal('doc_request')}
                className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-[#faf5ff] to-[#f3e8ff] hover:from-[#f3e8ff] hover:to-[#e9d5ff] border-2 border-[#e9d5ff] text-left transition-all duration-200 cursor-pointer group shadow-sm hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="w-9 h-9 rounded-xl bg-white text-purple-700 flex items-center justify-center mb-2 shadow-xs border border-purple-100 group-hover:scale-105 transition-transform">
                  <FileText className="w-5 h-5 text-purple-600" />
                </div>
                <p className="text-sm font-extrabold text-slate-900">Certificates</p>
                <p className="text-xs text-purple-700 font-bold mt-0.5">Request doc</p>
              </button>

              {/* 4. Mess Review */}
              <button
                type="button"
                onClick={() => onOpenModal('mess')}
                className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-[#ecfdf5] to-[#d1fae5] hover:from-[#d1fae5] hover:to-[#a7f3d0] border-2 border-[#a7f3d0] text-left transition-all duration-200 cursor-pointer group shadow-sm hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="w-9 h-9 rounded-xl bg-white text-emerald-700 flex items-center justify-center mb-2 shadow-xs border border-emerald-100 group-hover:scale-105 transition-transform">
                  <Utensils className="w-5 h-5 text-emerald-600" />
                </div>
                <p className="text-sm font-extrabold text-slate-900">Mess Review</p>
                <p className="text-xs text-emerald-700 font-bold mt-0.5">Rate meals</p>
              </button>

              {/* 5. Campus Notices */}
              <button
                type="button"
                onClick={() => onOpenModal('notices')}
                className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-[#fffbeb] to-[#fef3c7] hover:from-[#fef3c7] hover:to-[#fde68a] border-2 border-[#fde68a] text-left transition-all duration-200 cursor-pointer group shadow-sm hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="w-9 h-9 rounded-xl bg-white text-amber-700 flex items-center justify-center mb-2 shadow-xs border border-amber-100 group-hover:scale-105 transition-transform">
                  <Megaphone className="w-5 h-5 text-amber-600" />
                </div>
                <p className="text-sm font-extrabold text-slate-900">Notices</p>
                <p className="text-xs text-amber-700 font-bold mt-0.5">Campus alerts</p>
              </button>

              {/* 6. Time Table */}
              <button
                type="button"
                onClick={() => onOpenModal('timetable')}
                className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-br from-[#f0f9ff] to-[#e0f2fe] hover:from-[#e0f2fe] hover:to-[#bae6fd] border-2 border-[#bae6fd] text-left transition-all duration-200 cursor-pointer group shadow-sm hover:shadow-md hover:-translate-y-0.5"
              >
                <div className="w-9 h-9 rounded-xl bg-white text-sky-700 flex items-center justify-center mb-2 shadow-xs border border-sky-100 group-hover:scale-105 transition-transform">
                  <Calendar className="w-5 h-5 text-sky-600" />
                </div>
                <p className="text-sm font-extrabold text-slate-900">Time Table</p>
                <p className="text-xs text-sky-700 font-bold mt-0.5">Class routine</p>
              </button>

            </div>
          </div>

          {/* Today's Mess Menu Card matching image with border-2 & bigger text */}
          <div className="bg-gradient-to-br from-[#fffdf7] via-white to-[#fefaee] rounded-2xl sm:rounded-3xl p-5 border-2 border-amber-300 shadow-md space-y-4">
            
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center font-bold">
                    <Utensils className="w-4 h-4" />
                  </div>
                  <h3 className="text-base font-extrabold text-slate-900">Today's Mess Menu</h3>
                </div>
                {isFeastDay(todayMenu) ? (
                  <span className="inline-block mt-1.5 text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                    Special Feast! ✨
                  </span>
                ) : (
                  <span className="inline-block mt-1.5 text-xs font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300">
                    {todayDayLabel}'s Menu
                  </span>
                )}
              </div>

              {/* Food Thumbnail Image */}
              <div className="w-16 h-16 rounded-2xl overflow-hidden shadow-xs border-2 border-amber-200 shrink-0">
                <img 
                  src="/mess_food.jpg" 
                  alt="Today's Meal" 
                  className="w-full h-full object-cover"
                />
              </div>
            </div>

            {/* Live Menu — ONLY the meal being served right now (or the next upcoming meal) */}
            {(() => {
              const menuItems = (key) => todayMenu[key].split(',').map((item, idx) => (
                <li key={idx} className="flex items-center gap-2">• {item.trim()}</li>
              ));
              return (
                <>
                  {/* Big live block */}
                  <div className={`rounded-xl border p-3 ${
                    mealStatus.current
                      ? 'bg-emerald-50/80 border-emerald-300'
                      : 'bg-slate-50 border-slate-200'
                  }`}>
                    {mealStatus.current ? (
                      <>
                        <p className="font-extrabold text-slate-900 flex items-center gap-1.5 flex-wrap">
                          {MEAL_TIMES[mealStatus.current]}
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-600 text-white flex items-center gap-1 self-start">
                            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                            LIVE NOW
                          </span>
                        </p>
                        <ul className="text-slate-700 space-y-1 font-bold pt-1.5">
                          {menuItems(mealStatus.current)}
                        </ul>
                      </>
                    ) : (
                      <>
                        <p className="font-extrabold text-slate-900 flex items-center gap-1.5 flex-wrap">
                          <Clock className="w-3.5 h-3.5 text-slate-500" />
                          Kitchen break between meals
                        </p>
                        <p className="text-slate-600 font-bold pt-1">
                          Next serving in {fmtDuration(mealStatus.minsToNext)} — see below ↓
                        </p>
                      </>
                    )}
                  </div>

                  {/* Slim "Next meal" strip — keeps RSVP usable (cut-off is 3h BEFORE each meal) */}
                  {mealStatus.next && (
                    <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
                      <p className="font-extrabold text-slate-900 flex items-center gap-1.5 flex-wrap">
                        <span>Next: {mealStatus.next.charAt(0).toUpperCase() + mealStatus.next.slice(1)}</span>
                        {mealStatus.isTomorrow && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-700 border border-slate-300">TOMORROW</span>
                        )}
                        <span className="text-[10px] font-mono text-amber-900 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-300">
                          starts {mealStatus.nextStartLabel}
                        </span>
                      </p>
                      <p className="text-slate-700 font-bold pt-1 leading-snug">{todayMenu[mealStatus.next]}</p>
                      <p className={`text-[10px] font-bold pt-1.5 flex items-center gap-1 ${mealStatus.rsvpClosed ? 'text-slate-500' : 'text-amber-900'}`}>
                        <Leaf className="w-3 h-3 shrink-0" />
                        {mealStatus.rsvpClosed
                          ? 'RSVP closed for this meal (locks 3 hrs before cooking)'
                          : `RSVP before it locks at ${mealStatus.rsvpCutoffLabel} (3 hrs before cooking)`}
                      </p>
                    </div>
                  )}
                </>
              );
            })()}

            {/* View Full Menu toggle — complete day list on demand */}
            <button
              type="button"
              onClick={() => setShowFullMenu(v => !v)}
              className="flex items-center gap-1 text-xs font-extrabold text-amber-800 hover:text-amber-900 transition-colors cursor-pointer self-start"
            >
              {showFullMenu ? 'Hide Full Menu' : 'View Full Menu'}
              {showFullMenu ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showFullMenu && (
              <div className="space-y-2.5 text-xs sm:text-sm pt-1">
                {Object.entries(MEAL_TIMES).map(([mealKey, mealLabel]) => (
                  <div key={mealKey} className="pb-1.5 border-b border-amber-100 last:border-b-0 last:pb-0">
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

            {/* Footer with Location & Review / RSVP Button */}
            <div className="pt-3 flex flex-col sm:flex-row sm:items-center justify-between border-t-2 border-amber-100 gap-2.5">
              <span className="text-xs sm:text-sm text-slate-700 flex items-center gap-1.5 font-bold">
                <MapPin className="w-4 h-4 text-amber-600 shrink-0" />
                <span>Mess Hall B</span>
              </span>
              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => onOpenModal('meal_rsvp')}
                  className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs active:scale-95"
                >
                  <Leaf className="w-3.5 h-3.5 shrink-0" />
                  <span>Meal RSVP</span>
                </button>
                <button
                  type="button"
                  onClick={() => onOpenModal('mess')}
                  className="flex-1 sm:flex-none px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-xs active:scale-95"
                >
                  <span>Review Food</span>
                  <span>→</span>
                </button>
              </div>
            </div>

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
                <p className="text-[10px] font-mono text-slate-400 truncate">{ticketDetail.id}</p>
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
              <div className="flex flex-wrap gap-2">
                <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200">
                  {ticketDetail.category || 'Issue'}
                </span>
                <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                  Urgency: {ticketDetail.urgency || 'MEDIUM'}
                </span>
                <span className="px-2 py-1 rounded-lg text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                  {(ticketDetail.statusLabel || ticketDetail.status || 'REPORTED').replace(/_/g, ' ')}
                </span>
              </div>
              <div className="flex items-center gap-2 text-slate-700 font-bold">
                <MapPin className="w-4 h-4 text-amber-600 shrink-0" /> {ticketDetail.location || 'Hostel'}
              </div>
              {ticketDetail.assignedTo && (
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
                <p className="text-[10px] uppercase tracking-wide font-extrabold text-slate-400 mb-1">Your complaint</p>
                <p className="text-slate-700 font-medium">
                  "{ticketDetail.description || ticketDetail.raw_text || '—'}"
                </p>
              </div>
              {ticketDetail.masterJoined && (
                <p className="text-[11px] text-purple-700 flex items-start gap-1.5 font-bold">
                  <Layers className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  Clustered into a Master Incident — one technician fix resolves all matching complaints on this floor.
                </p>
              )}
              <p className="text-[11px] text-slate-400">
                Submitted {relativeTime(ticketDetail)} • Live status updates appear in the feed above.
              </p>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
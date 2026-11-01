import React, { useState, useEffect, useRef } from 'react';
import {
  Search,
  Bell,
  Menu,
  ChevronDown,
  User,
  Shield,
  UserCheck,
  Lock,
  Wifi,
  WifiOff,
  RefreshCw,
  Sparkles,
  Download,
  Database,
  CheckCircle2,
  AlertTriangle,
  X
} from 'lucide-react';
import { getOutboxCount } from '../utils/db';
import { getPendingSyncCount } from '../utils/syncEngine';
import FacultyFinderDropdown from './FacultyFinderDropdown';
import { isPageHidden, onPageActive } from '../utils/livePoll';

const ROLES = [
  { id: 'Student', label: 'Student', title: 'Student Portal', icon: User, color: 'text-blue-600 bg-blue-50' },
  { id: 'Warden', label: 'Warden', title: 'Hostel Warden', icon: Shield, color: 'text-amber-600 bg-amber-50' },
  { id: 'Guard', label: 'Guard', title: 'Security Gate', icon: UserCheck, color: 'text-indigo-600 bg-indigo-50' },
  { id: 'Admin', label: 'Admin', title: 'Admin / Estate', icon: Lock, color: 'text-slate-800 bg-slate-100' }
];

export default function Header({
  currentRole,
  onRoleChange,
  onOpenNotices,
  onSignOut,
  onToggleSidebar,
  isSidebarOpen,
  searchQuery,
  onSearchChange,
  pendingSyncCount
}) {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [queueCount, setQueueCount] = useState(pendingSyncCount || 0);

  useEffect(() => {
    if (pendingSyncCount !== undefined) {
      setQueueCount(pendingSyncCount);
    }
  }, [pendingSyncCount]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isRoleMenuOpen, setIsRoleMenuOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  
  const roleDropdownRef = useRef(null);
  const notifDropdownRef = useRef(null);

  // Real bell preview data comes from the central notice bus — the panel
  // must show the same items the Notices modal shows (publishedAt proven
  // server-side), never fabricated placeholders.
  const [notifItems, setNotifItems] = useState([]);
  const [bellReadAt, setBellReadAt] = useState(Date.now());

  useEffect(() => {
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallPWA = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setDeferredPrompt(null);
    }
  };

  // Live bell feed from the central notice bus (same source the phone
  // notification layer polls). Refreshed every 20s + on panel open.
  const timeAgo = (ts) => {
    const m = Math.max(0, Math.floor((Date.now() - ts) / 60000));
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  const fetchBellNotices = async () => {
    try {
      const res = await fetch('/api/notices', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      const serverNotices = (Array.isArray(data?.notices) ? data.notices : [])
        .slice(0, 6)
        .map(n => ({
          id: n.id,
          title: n.title,
          desc: n.content,
          createdAt: n.createdAt,
          time: timeAgo(n.createdAt)
        }));
      setNotifItems(serverNotices);
    } catch {
      // Offline → keep the last known list quietly
    }
  };

  useEffect(() => {
    fetchBellNotices();
    // Fix 2: no bell refresh while the tab is hidden; refresh on return.
    const bellInterval = setInterval(() => { if (!isPageHidden()) fetchBellNotices(); }, 20000);
    const offBellActive = onPageActive(fetchBellNotices);
    return () => { clearInterval(bellInterval); offBellActive(); };
  }, []);

  // Bell "new" count = real fetchese items newer than the last time
  // the panel was opened (no fake counters).
  const unreadCount = notifItems.filter(n => n.createdAt > bellReadAt).length;

  const refreshQueueCount = async () => {
    try {
      const syncCount = await getPendingSyncCount();
      setQueueCount(syncCount);
    } catch (err) {
      console.warn('Failed to query outbox queue count:', err);
    }
  };

  useEffect(() => {
    refreshQueueCount();

    // Active ping check to catch physical Wi-Fi drops or unreachable backend
    const checkConnectivity = async () => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      try {
        // Lightweight public heartbeat. (HEAD /api/dashboard-data was
        // unreliable: Chromium fetch flags HEAD responses as failed even
        // with HTTP 200, and dashboard-data is too heavy for 3s polling.)
        const res = await fetch('/api/health', {
          method: 'GET',
          cache: 'no-store',
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        const data = await res.json().catch(() => null);
        setIsOnline(res.ok && data?.online === true);
      } catch (err) {
        clearTimeout(timeoutId);
        setIsOnline(false);
      }
    };

    checkConnectivity();

    const handleOnline = () => {
      setIsOnline(true);
      setIsSyncing(true);
      refreshQueueCount();
      checkConnectivity();
      setTimeout(() => {
        setIsSyncing(false);
        refreshQueueCount();
      }, 1500);
    };

    const handleOffline = () => {
      setIsOnline(false);
      setIsSyncing(false);
      refreshQueueCount();
    };

    const updateQueueCount = async (e) => {
      if (e?.detail?.count !== undefined) {
        setQueueCount(e.detail.count);
      } else {
        try {
          const syncCount = await getPendingSyncCount();
          setQueueCount(syncCount);
        } catch (err) {
          console.warn('Failed to query outbox queue count:', err);
        }
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('campus_outbox_updated', updateQueueCount);

    // Periodically poll getPendingSyncCount (local, no network) every 3 seconds.
    // Fix 2: the server heartbeat now runs every 15 s instead of every 3 s,
    // never while the tab is hidden, and at once when the tab comes back.
    // (The browser's own online/offline events above still flip the badge
    // instantly.)
    let lastPingAt = Date.now();
    const intervalId = setInterval(() => {
      refreshQueueCount();
      if (!isPageHidden() && Date.now() - lastPingAt >= 15000) {
        lastPingAt = Date.now();
        checkConnectivity();
      }
    }, 3000);
    const offPingActive = onPageActive(() => { lastPingAt = Date.now(); checkConnectivity(); });

    return () => {
      clearInterval(intervalId);
      offPingActive();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('campus_outbox_updated', updateQueueCount);
    };
  }, []);

  // Close menus on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (roleDropdownRef.current && !roleDropdownRef.current.contains(e.target)) {
        setIsRoleMenuOpen(false);
      }
      if (notifDropdownRef.current && !notifDropdownRef.current.contains(e.target)) {
        setIsNotifOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const currentRoleObj = ROLES.find(r => r.id === currentRole) || ROLES[0];
  const CurrentRoleIcon = currentRoleObj.icon;

  return (
    <header className="sticky top-0 z-30 w-full bg-white/80 backdrop-blur-xl border-b border-slate-200/60 px-3 sm:px-5 py-2 transition-all shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
      <div className="w-full flex items-center justify-between gap-2 sm:gap-3">
        
        {/* Left: Hamburger Button & Search Bar */}
        <div className="flex items-center gap-2 sm:gap-3 flex-1 max-w-xl">
          {/* Hamburger Collapse Toggle Button */}
          <button
            type="button"
            onClick={onToggleSidebar}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100/80 transition-all duration-200 cursor-pointer shrink-0 active:scale-95"
            title={isSidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
            aria-label="Toggle Navigation Sidebar"
          >
            <Menu className="w-5 h-5" />
          </button>

          {/* Brand lockup lives in the Sidebar; header stays clean to avoid
              repeating the brand name twice on the same screen. */}

          {/* Search Bar */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery || ''}
              onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
              placeholder={currentRole === 'Student'
                ? 'Search feed… or find a teacher (try "priya")'
                : currentRole === 'Warden'
                  ? 'Search tickets, passes, clusters, register…'
                  : 'Search, actions, or ask AI...'}
              className="w-full pl-10 pr-4 py-2 bg-slate-100/60 hover:bg-slate-100 focus:bg-white text-xs sm:text-sm text-slate-800 placeholder-slate-400 rounded-full border border-transparent focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500/10 transition-all duration-200"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange && onSearchChange('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
            {/* Faculty Finder — inline dropdown under the search bar (students
                only): type a teacher's name and see where they are right now */}
            {currentRole === 'Student' && (
              <FacultyFinderDropdown
                searchQuery={searchQuery}
                onNavigate={() => onSearchChange && onSearchChange('')}
              />
            )}
          </div>
        </div>

        {/* Right: Sync Status + Notifications + Role Switcher Pill */}
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          
          {/* Network Sync Indicator Pill */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-50 text-[11px] font-mono text-slate-500 border border-slate-200/50">
            {isOnline ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-soft-pulse"></span>
                <span className="text-emerald-700 font-semibold">Online</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3.5 h-3.5 text-rose-500" />
                <span className="text-rose-600 font-semibold">Offline</span>
              </>
            )}
            {queueCount > 0 ? (
              <span className="ml-1 px-1.5 py-0.2 rounded-full bg-amber-500 text-white font-bold text-[10px]">
                {queueCount} queued
              </span>
            ) : null}
          </div>

          {/* Notification Bell */}
          <div className="relative" ref={notifDropdownRef}>
            <button
              type="button"
              onClick={() => {
                const opening = !isNotifOpen;
                setIsNotifOpen(!isNotifOpen);
                if (opening) {
                  setBellReadAt(Date.now());
                  fetchBellNotices();
                }
              }}
              className="relative p-2 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-100/80 transition-all duration-200 cursor-pointer active:scale-95"
              title="Notifications"
            >
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-rose-500 ring-2 ring-white"></span>
              )}
            </button>

            {/* Notification Dropdown — on phones it appears as a centered
                card under the header (anchoring to the bell jammed it into
                the corner); tablet+ keeps the classic anchored dropdown. */}
            {isNotifOpen && (
              <div className="fixed top-[3.75rem] left-1/2 -translate-x-1/2 w-[min(24rem,calc(100vw-1.5rem))] max-h-[70vh] overflow-y-auto bg-white/95 backdrop-blur-xl rounded-2xl shadow-xl border border-slate-200/60 p-3 z-50 animate-in fade-in duration-150 sm:absolute sm:top-auto sm:left-auto sm:right-0 sm:translate-x-0 sm:mt-2 sm:w-96">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-800">Campus Alerts</span>
                    <span className="text-[10px] bg-blue-50 text-blue-600 font-semibold px-2 py-0.5 rounded-full">
                      {unreadCount} new
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setBellReadAt(Date.now());
                      onOpenNotices && onOpenNotices();
                      setIsNotifOpen(false);
                    }}
                    className="text-[11px] text-blue-600 hover:text-blue-700 font-medium cursor-pointer"
                  >
                    View All
                  </button>
                </div>

                <div className="space-y-1.5 max-h-72 overflow-y-auto">
                  {notifItems.length === 0 ? (
                    <p className="text-xs text-slate-400 text-center py-6">
                      No campus alerts yet — dispatches appear here in real time.
                    </p>
                  ) : notifItems.map((n) => (
                    <div 
                      key={n.id} 
                      onClick={() => {
                        onOpenNotices && onOpenNotices();
                        setIsNotifOpen(false);
                      }}
                      className="p-2.5 rounded-xl hover:bg-slate-50 transition-colors cursor-pointer border border-transparent hover:border-slate-100"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900">{n.title}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{n.time}</span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">{n.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Role Indicator — the role is defined exclusively by the verified
              login. There is NO runtime role switching: Log out → sign in as
              someone else is the only way to change identity. */}
          <div className="flex items-center gap-1.5 pl-1.5 pr-2.5 py-1.5 rounded-full bg-slate-50 text-slate-800 text-xs sm:text-sm font-semibold border border-slate-200/50">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-600 to-indigo-500 text-white flex items-center justify-center shrink-0 shadow-sm">
              <CurrentRoleIcon className="w-3.5 h-3.5" />
            </div>
            <span className="hidden sm:inline">{currentRole}</span>
          </div>

        </div>

      </div>
    </header>
  );
}

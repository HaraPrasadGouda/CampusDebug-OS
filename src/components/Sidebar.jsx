import React from 'react';
import { 
  Home, 
  User, 
  Settings, 
  LogOut, 
  X, 
  Shield, 
  UserCheck, 
  Lock, 
  GraduationCap,
  BookOpenCheck,
  UserRound,
  Sparkles,
  ExternalLink,
  MapPin
} from 'lucide-react';
import { useTeacherNav, TEACHER_TABS, goTeacherTab } from '../utils/teacherNav';

const TEACHER_ICONS = { today: Home, students: GraduationCap, classes: BookOpenCheck, me: UserRound };

export default function Sidebar({ 
  isOpen, 
  onClose, 
  onSignOut, 
  onOpenProfile, 
  onOpenSettings,
  activeNav = 'home',
  setActiveNav,
  currentRole = 'Student',
  session
}) {
  const isTeacherRole = currentRole === 'Teacher';
  const teacherNav = useTeacherNav();
  const navItems = [
    { id: 'home', label: 'Home', icon: Home, onClick: isTeacherRole ? () => goTeacherTab('today') : undefined },
    { id: 'profile', label: 'Profile', icon: User, onClick: onOpenProfile },
    { id: 'settings', label: 'Settings', icon: Settings, onClick: onOpenSettings },
    { id: 'logout', label: 'Logout', icon: LogOut, onClick: onSignOut, isDanger: true }
  ];

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isOpen && (
        <div 
          onClick={onClose}
          className="fixed inset-0 bg-slate-900/30 backdrop-blur-[2px] z-40 lg:hidden transition-opacity duration-300"
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside 
        className={`
          fixed lg:sticky top-0 inset-y-0 left-0 z-50
          flex flex-col justify-between shrink-0
          bg-white/95 backdrop-blur-xl
          border-r border-slate-200/80
          shadow-[4px_0_24px_-4px_rgba(0,0,0,0.08)]
          transition-all duration-300 ease-in-out
          h-screen overflow-hidden
          ${isOpen 
            ? 'w-64 min-w-[16rem] translate-x-0 opacity-100 visible' 
            : 'w-0 min-w-0 -translate-x-full lg:translate-x-0 lg:w-0 lg:min-w-0 lg:opacity-0 lg:invisible lg:border-none lg:shadow-none'
          }
        `}
      >
        <div className="p-4 sm:p-5 flex flex-col h-full w-64 overflow-y-auto overflow-x-hidden">
          
          {/* Logo & Brand Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div className="flex items-center gap-2.5">
              {/* App icon (full-bleed artwork, no nested frame) */}
              <img
                src="/brand_icon_128.png"
                alt="CampusDebug"
                className="w-10 h-10 object-contain shrink-0"
              />
              {/* Divider between icon and wordmark */}
              <span className="w-px h-6 bg-emerald-800/60 shrink-0"></span>
              {/* Wordmark (logo-then-text lockup) */}
              <div className="flex flex-col min-w-0">
                <img
                  src="/brand_wordmark.png"
                  alt="CampusDebug OS"
                  className="h-6 w-auto object-contain object-left"
                />
              </div>
            </div>

            {/* Close Button on Mobile */}
            <button 
              type="button"
              onClick={onClose}
              className="lg:hidden p-1.5 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
              title="Close Sidebar"
              aria-label="Close Sidebar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* User Profile Section (Dynamic to current dashboard role) */}
          <div className="my-3.5">
            {(() => {
              const isStudent = currentRole === 'Student';
              const isWarden = currentRole === 'Warden';
              const isGuard = currentRole === 'Guard';
              const isAdmin = currentRole === 'Admin';
              const isTeacher = currentRole === 'Teacher';

              const displayName = isTeacher
                ? (session?.name || 'Teacher')
                : isStudent
                  ? (session?.name || 'Student')
                  : isWarden
                    ? (session?.name || 'Warden')
                    : isGuard
                      ? (String(session?.name || '').trim() || 'Guard')
                      : (session?.name || 'Administrator');

              // Sub-line is REAL: roll number + role/department from the
              // verified login session — no hardcoded demo identities.
              const displaySub = isTeacher
                ? `${session?.identity || '—'} • Faculty Mentor`
                : isStudent
                  ? `${session?.identity || '—'} • ${session?.department || 'Student'}`
                  : isWarden
                    ? `${session?.identity || '—'} • Warden`
                    : isGuard
                      ? `${session?.identity || '—'} • Security`
                      : `${session?.identity || '—'} • Administration`;

              const initial = isTeacher ? 'T' : isStudent ? (displayName.charAt(0) || 'D') : isWarden ? 'W' : isGuard ? 'G' : 'A';

              const gradientClass = isTeacher
                ? 'from-cyan-600 to-blue-700'
                : isStudent
                  ? 'from-blue-600 to-indigo-600'
                  : isWarden
                    ? 'from-amber-600 to-orange-600'
                    : isGuard
                      ? 'from-emerald-600 to-teal-700'
                      : 'from-purple-700 to-slate-900';

              return (
                <div 
                  onClick={() => {
                    if (onOpenProfile) onOpenProfile();
                    if (window.innerWidth < 1024) onClose();
                  }}
                  className="group bg-gradient-to-br from-blue-50/80 via-slate-50 to-indigo-50/40 border border-blue-200/60 hover:border-blue-300 rounded-2xl p-3 flex items-center gap-3 shadow-xs hover:shadow-md transition-all duration-200 cursor-pointer"
                  title="Click to view full profile"
                >
                  <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradientClass} text-white flex items-center justify-center font-extrabold text-sm shadow-sm shrink-0 group-hover:scale-105 transition-transform`}>
                    {initial}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-slate-900 truncate group-hover:text-blue-600 transition-colors">
                        {displayName}
                      </p>
                    </div>
                    <div className="flex items-start gap-1.5 mt-0.5">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-emerald-100 animate-pulse shrink-0 mt-0.5"></span>
                      {/* Roll + branch/stream wrap onto extra lines instead of
                          being cut — the full branch name stays readable on phones. */}
                      <span className="text-[10px] text-slate-600 font-mono font-semibold break-words min-w-0 leading-snug">
                        {displaySub}
                      </span>
                    </div>
                    {/* Student residency chips — straight from the real directory
                        (profiles.hostel_block + profiles.resident_type). Hidden
                        when the directory doesn't carry them yet. Day scholars
                        commute — no block chip is shown for them. */}
                    {isStudent && (session?.block || session?.residentType) && (
                      <div className="flex flex-wrap items-center gap-1 mt-1.5">
                        {session?.block && session?.residentType !== 'dayscholar' && (
                          <span className="inline-flex items-center gap-1 max-w-full text-[9px] font-extrabold px-1.5 py-0.5 rounded-md bg-sky-100 text-sky-800 border border-sky-200">
                            <MapPin className="w-2.5 h-2.5 shrink-0" />
                            {/* "Block B · Room 101" — each half stays whole; on a very
                                narrow drawer the room drops under the block. */}
                            <span className="min-w-0 flex flex-wrap gap-x-1">
                              <span className="whitespace-nowrap">{session.block}{session?.room ? ' ·' : ''}</span>
                              {session?.room && <span className="whitespace-nowrap">Room {session.room}</span>}
                            </span>
                          </span>
                        )}
                        <span className={`text-[9px] font-extrabold px-1.5 py-0.5 rounded-md border whitespace-nowrap ${
                          session?.residentType === 'dayscholar'
                            ? 'bg-amber-100 text-amber-800 border-amber-200'
                            : 'bg-emerald-100 text-emerald-800 border-emerald-200'
                        }`}>
                          {session?.residentType === 'dayscholar' ? 'Day Scholar' : 'Hosteller'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1.5 flex-1">
            {/* TEACHER (laptop only): SECTIONS = the four tab pages. On a phone the drawer stays the old menu
                (Home, Profile, Settings, Logout) and the same four sections live in the bottom bar. */}
            {isTeacherRole && (
              <div className="hidden lg:block space-y-1.5 pb-2" data-testid="sidebar-sections">
                <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 px-3 py-1">Sections</p>
                {TEACHER_TABS.map((t) => {
                  const TIcon = TEACHER_ICONS[t.id];
                  const on = teacherNav.tab === t.id;
                  const n = t.id === 'today' ? teacherNav.counts.today : t.id === 'students' ? teacherNav.counts.students : 0;
                  return (
                    <button key={t.id} type="button" data-section={t.id} aria-current={on ? 'page' : undefined} onClick={() => goTeacherTab(t.id)}
                      className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer ${on ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'}`}>
                      <TIcon className={`w-4 h-4 shrink-0 ${on ? 'text-white' : 'text-slate-500'}`} />
                      <span className="flex-1 text-left">{t.label}</span>
                      {n > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-rose-500 text-white text-[10px] font-extrabold flex items-center justify-center">{n}</span>}
                    </button>
                  );
                })}
              </div>
            )}
            <p className="text-[10px] uppercase tracking-wider font-bold text-slate-400 px-3 py-1">
              {isTeacherRole ? (<><span className="lg:hidden">Menu</span><span className="hidden lg:inline">Account</span></>) : 'Menu'}
            </p>
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = isTeacherRole ? false : activeNav === item.id;

              return (
                <React.Fragment key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (item.onClick) {
                      item.onClick();
                    } else if (setActiveNav) {
                      setActiveNav(item.id);
                    }
                    if (window.innerWidth < 1024) onClose();
                  }}
                  className={`
                    w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 cursor-pointer
                    ${isActive 
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-500/20' 
                      : item.isDanger
                        ? 'text-slate-600 hover:text-rose-600 hover:bg-rose-50/80'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80'
                    }
                  `}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : item.isDanger ? 'text-rose-500' : 'text-slate-500'}`} />
                  <span>{item.label}</span>
                </button>
                {/* Admin tool sub-menu mounts here (layout only) */}
                {item.id === 'home' && currentRole === 'Admin' && <div id="admin-tool-nav" />}
                </React.Fragment>
              );
            })}
          </nav>

          {/* Sidebar bottom anchor */}
          <div></div>

        </div>
      </aside>
    </>
  );
}

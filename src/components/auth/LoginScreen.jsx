import React, { useState, useRef } from 'react';
import { CheckCircle2, LockKeyhole, ArrowRight, ShieldCheck, XCircle, Loader, HelpCircle, IdCard, Lock, Check } from 'lucide-react';
import { storeSession, roleToDashboard } from '../../utils/authClient';
import PasswordInput from './PasswordInput';
import NeedHelpModal from './NeedHelpModal';
import ReportProblemModal from './ReportProblemModal';

// REAL authentication — identity is verified against the college directory
// (Supabase `profiles`), passwords are managed by Supabase Auth as salted
// hashes. First-time users are auto-provisioned with the college default
// password (firstname@last-4-of-registered-mobile) and MUST set their own
// password before entering the portal.

// Campus line-art for the green brand panel — drawn from scratch to the
// layout of HARA's mockup: classical hall (pediment, oculus, colonnade),
// clock tower with a spire, a block building with a window grid, round
// trees and small sparkles, all in thin mint strokes on one ground line.
// Coordinates are in a 704-wide box (the mockup's panel width at 1280px).
const CampusLineArt = ({ className = '' }) => {
  const cols = [84, 114, 144, 174, 204, 235];
  const winX = [452, 480, 508, 537, 565, 594];
  const winY = [168, 198, 228];
  const Tree = ({ x, cy, r, base = 269 }) => (
    <g>
      <circle cx={x} cy={cy} r={r} />
      <path d={`M${x} ${cy + r}V${base}`} />
      <path d={`M${x} ${cy + r}V${cy - r * 0.15}M${x} ${cy + r * 0.45}l${-r * 0.4} ${-r * 0.4}M${x} ${cy + r * 0.3}l${r * 0.4} ${-r * 0.4}`} strokeOpacity="0.65" strokeWidth="1.6" />
    </g>
  );
  const Sparkle = ({ x, y, s = 6, o = 0.75 }) => (
    <path d={`M${x} ${y - s}V${y + s}M${x - s} ${y}H${x + s}`} strokeOpacity={o} />
  );
  return (
    <svg viewBox="0 0 704 300" fill="none" className={className} aria-hidden="true" preserveAspectRatio="xMidYMax meet">
      <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* classical hall */}
        <path d="M52 181L164 135L276 181Z" />
        <circle cx="164" cy="163" r="6" strokeOpacity="0.8" />
        <path d="M61 191H267" />
        <path d="M62 181V269M266 181V269" />
        {cols.map((x) => <path key={x} d={`M${x} 191V262`} strokeOpacity="0.85" />)}
        <path d="M58 262H270" />
        {/* clock tower */}
        <path d="M310 109V269M393 109V269" />
        <path d="M301 109H402" />
        <path d="M304 109L351.5 42L399 109" />
        <path d="M351.5 42V16" strokeOpacity="0.85" />
        <circle cx="351.5" cy="151.5" r="24" />
        <path d="M351.5 151.5V137M351.5 151.5l9 5" strokeOpacity="0.85" />
        <path d="M326 228v-16a4 4 0 018 0v16M369 228v-16a4 4 0 018 0v16" strokeOpacity="0.75" />
        <path d="M341 269v-18a10.5 10.5 0 0121 0v18" strokeOpacity="0.8" />
        {/* block building */}
        <path d="M435 269V153H622V269" />
        <path d="M461 153V127H596V153" />
        {winY.map((y) => winX.map((x) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="13" height="17" rx="1.5" strokeWidth="1.8" strokeOpacity="0.8" />
        )))}
        {/* trees */}
        <Tree x={27} cy={224} r={16} />
        <Tree x={293} cy={233} r={12} />
        <Tree x={418} cy={232} r={13} />
        <Tree x={657} cy={217} r={19} />
        {/* sparkles */}
        <Sparkle x={418} y={20} s={5} />
        <Sparkle x={230} y={30} s={4} o={0.6} />
        <Sparkle x={612} y={66} s={4} o={0.55} />
        <Sparkle x={96} y={96} s={3.5} o={0.5} />
        {/* ground */}
        <path d="M-40 269.5H744" strokeOpacity="0.95" />
      </g>
    </svg>
  );
};

// Decorative dot grid from the mockups (rows/cols of soft white dots).
const DotGrid = ({ className = '', cols = 6, rows = 7, gap = 12.5, r = 1.6 }) => {
  const width = (cols - 1) * gap + r * 2;
  const height = (rows - 1) * gap + r * 2;
  const dots = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) dots.push(<circle key={`${x}-${y}`} cx={r + x * gap} cy={r + y * gap} r={r} />);
  }
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className={className} aria-hidden="true" fill="currentColor">
      {dots}
    </svg>
  );
};

// Thin concentric arcs centred on a panel corner, sweeping inward (per mockup).
const Rings = ({ className = '', corner = 'bl', radii = [110, 165, 220, 275, 330, 385] }) => {
  const size = 800;
  const c = { tr: [size, 0], bl: [0, size], tl: [0, 0], br: [size, size] }[corner];
  return (
    <svg viewBox={`0 0 ${size} ${size}`} fill="none" className={className} aria-hidden="true">
      <g stroke="currentColor" strokeWidth="1.2">
        {radii.map((r) => <circle key={r} cx={c[0]} cy={c[1]} r={r} />)}
      </g>
    </svg>
  );
};

// Small inline fallback mark shown inside the white squircle if the PNG
// brand icon is missing (keeps the lockup intact offline).
const BrandIcon = ({ size = 'w-9 h-9' }) => (
  <img
    src="/brand_icon.png"
    alt="CampusDebug OS"
    className={`${size} object-contain`}
    onError={(e) => {
      const box = e.currentTarget.parentElement;
      if (box && !box.dataset.iconFailed) {
        box.dataset.iconFailed = '1';
        e.currentTarget.outerHTML = (
          '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="7" y1="21" x2="17" y2="21"></line><line x1="12" y1="3" x2="12" y2="21"></line></svg>'
        );
      }
    }}
  />
);

export default function LoginScreen({ onLogin }) {
  const [identity, setIdentity] = useState('');
  const [password, setPassword] = useState('');
  const [verifyState, setVerifyState] = useState(null); // {fullName, role, department, hostelBlock, activated} | 'notfound' | null
  const [verifying, setVerifying] = useState(false);
  const verifiedIdRef = useRef(null); // the ID whose verify already succeeded
  const [authBusy, setAuthBusy] = useState(false);
  const [error, setError] = useState('');

  // Forced first-login password change (no account is reusable with the
  // default password — the portal demands a private one before entry).
  const [pendingSession, setPendingSession] = useState(null); // {session, profile}
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changeBusy, setChangeBusy] = useState(false);

  // Support surfaces (per design mockups): FAQ/help + real report-a-problem ticket.
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpFocus, setHelpFocus] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);

  const verifyCollegeRecord = async () => {
    const id = identity.trim();
    if (!id) { setError('Enter your registration / staff number first.'); return false; }
    setVerifying(true);
    setError('');
    setVerifyState(null);
    try {
      const res = await fetch('/api/auth/verify-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rollNumber: id })
      });
      const data = await res.json();
      if (!data.verified) {
        setVerifyState('notfound');
        setError(data.error || 'This registration number is not in the college records.');
        return false;
      }
      setVerifyState(data);
      verifiedIdRef.current = id;
      return true;
    } catch (e) {
      setVerifyState('notfound');
      setError('Cannot reach the campus server right now — check your connection.');
      return false;
    } finally {
      setVerifying(false);
    }
  };

  // Auto-verify the moment the user leaves the ID field (per the flow:
  // "moving from roll to password should verify automatically").
  const handleIdentityBlur = () => {
    const id = identity.trim();
    if (id && id !== verifiedIdRef.current && !verifying) verifyCollegeRecord();
  };

  const finishLogin = (data) => {
    storeTmp(data);
  };

  const storeTmp = (data) => {
    // Hand the verified profile + tokens up to App via onLogin; App decides
    // the dashboard route. Nickname fields come from the REAL directory row.
    onLogin({
      role: roleToDashboard(data.profile.role),
      profileRole: data.profile.role,
      identity: data.profile.rollNumber,
      name: data.profile.fullName,
      room: data.profile.roomNumber,
      block: data.profile.hostelBlock,
      residentType: data.profile.residentType || null,
      department: data.profile.department,
      course: data.profile.course || null,
      section: data.profile.section || null,
      attendance: data.profile.attendance,
      feeDue: data.profile.feeDue,
      sessionData: data
    });
  };

  const handleSignIn = async (event) => {
    event.preventDefault();
    const id = identity.trim();
    if (!id || !password.trim()) {
      setError('Enter your registration number and password.');
      return;
    }
    setAuthBusy(true);
    setError('');
    // Gate order per the flow: an unverified ID is verified FIRST, and only
    // a record that exists in the college directory proceeds to sign-in.
    if (id !== verifiedIdRef.current) {
      const ok = await verifyCollegeRecord();
      if (!ok) { setAuthBusy(false); return; }
    }
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rollNumber: id, password: password.trim() })
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Sign-in failed.');
        return;
      }
      if (data.firstLogin) {
        // Force a private password before the portal opens
        const pending = { ...data, session: { ...data.session, defaultUsed: password.trim() } };
        setPendingSession(pending);
        setPassword('');
        return;
      }
      storeSessionAndEnter(data);
    } catch (e) {
      setError('Cannot reach the campus server right now — check your connection.');
    } finally {
      setAuthBusy(false);
    }
  };

  const storeSessionAndEnter = (data) => {
    storeSession(data);
    finishLogin(data);
  };

  const handleForcedChange = async (event) => {
    event.preventDefault();
    if (newPassword.length < 6) { setError('New password must be at least 6 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    if (newPassword === (pendingSession?.hint || '')) { setError('New password must be different from the default one.'); return; }
    setChangeBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${pendingSession.session.access_token}`
        },
        body: JSON.stringify({ newPassword, oldPassword: pendingSession.session.defaultUsed || 'default' })
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Password change failed — try again.');
        return;
      }
      // The admin-side password update revokes the session that made the
      // change, so re-sign in with the brand-new password and store THAT
      // session — otherwise every portal API call would 401 until the user
      // manually logs out and back in.
      const re = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rollNumber: pendingSession.profile.rollNumber, password: newPassword })
      });
      const reData = await re.json();
      const freshSession = reData?.success ? reData : pendingSession;
      sessionStorage.removeItem('campus_pending_session');
      storeSessionAndEnter(freshSession);
    } catch {
      setError('Cannot reach the campus server right now — check your connection.');
    } finally {
      setChangeBusy(false);
    }
  };

  // ---------- FORCED FIRST-LOGIN PASSWORD CHANGE ----------
  if (pendingSession) {
    return (
      <main className="min-h-screen bg-[#F4F7FB] text-slate-900 flex items-center justify-center p-4 sm:p-6 selection:bg-emerald-600 selection:text-white">
        <div className="w-full max-w-md overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-xl">
          <section className="p-8 sm:p-10">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 flex items-center justify-center mb-5">
              <LockKeyhole className="w-6 h-6 text-amber-600" />
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">Set your private password</h1>
            <p className="mt-2 text-xs sm:text-sm text-slate-500 leading-relaxed">
              Welcome, <b className="text-slate-700">{pendingSession.profile.fullName}</b>. This is your first
              sign-in with the college default password — for account safety you must replace it before
              continuing. All future sign-ins will use this new password.
            </p>
            <form onSubmit={handleForcedChange} className="space-y-4 mt-6">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">New Password</label>
                <PasswordInput
                  value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1.5">Confirm New Password</label>
                <PasswordInput
                  value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat the same password"
                  autoComplete="new-password"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50/70 focus:bg-white px-3.5 py-2.5 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
                />
              </div>
              {error && <p className="text-xs text-rose-600 font-semibold">{error}</p>}
              <button
                type="submit" disabled={changeBusy}
                className="w-full rounded-xl bg-slate-900 py-3 text-sm font-bold text-white transition hover:bg-slate-800 shadow-xs cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
              >
                {changeBusy ? <Loader className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                <span>{changeBusy ? 'Securing your account…' : 'Save Password & Enter Portal'}</span>
              </button>
            </form>
          </section>
        </div>
      </main>
    );
  }

  // ---------- NORMAL SIGN-IN (green brand design, per mockups) ----------
  const openHelp = (focusItem) => {
    setHelpFocus(focusItem);
    setHelpOpen(true);
  };

  return (
    // Mobile (<1024px): green header + white bottom sheet. Desktop (≥1024px):
    // full-bleed split — 55% green brand panel, 45% form panel (per mockups).
    <main className="login-screen min-h-screen w-full bg-white overflow-x-hidden flex flex-col lg:grid lg:grid-cols-[55fr_45fr] selection:bg-emerald-600 selection:text-white">

      {/* ================= GREEN BRAND PANEL ================= */}
      <section className="login-brand relative overflow-hidden text-white pb-[76px] lg:pb-0 lg:h-screen lg:min-h-[640px] lg:flex lg:flex-col">
        {/* --- decorations: mobile --- */}
        <div className="lg:hidden pointer-events-none absolute inset-0 z-0" aria-hidden="true">
          <div className="absolute -top-[150px] -right-[120px] w-[300px] h-[300px] rounded-full border border-white/[0.10]" />
          <div className="absolute -top-[215px] -right-[185px] w-[430px] h-[430px] rounded-full border border-white/[0.07]" />
          <div className="absolute -bottom-[150px] -left-[110px] w-[260px] h-[260px] rounded-full border border-white/[0.07]" />
          <DotGrid className="absolute top-[60px] right-6 text-white/[0.22]" cols={8} rows={5} gap={11} r={1.5} />
          <DotGrid className="absolute bottom-14 right-8 text-white/[0.16]" cols={8} rows={4} gap={11} r={1.5} />
        </div>

        {/* --- decorations: desktop --- */}
        <div className="hidden lg:block pointer-events-none absolute inset-0 z-0" aria-hidden="true">
          <div className="absolute -left-[270px] -top-[210px] w-[500px] h-[500px] rounded-full border-[1.5px] border-white/[0.08]" />
          <div className="absolute -right-[271px] -top-[265px] w-[510px] h-[510px] rounded-full border-[1.5px] border-white/[0.08]" />
          <div className="absolute -right-[366px] -top-[360px] w-[700px] h-[700px] rounded-full border border-white/[0.05]" />
          <div className="absolute left-1/2 top-[300px] -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] rounded-full border border-white/[0.04]" />
          <DotGrid className="absolute left-[67px] top-[76px] text-white/[0.20]" cols={9} rows={6} />
          <DotGrid className="absolute right-[60px] top-[270px] text-white/[0.16]" cols={7} rows={9} />
        </div>

        {/* Need help? — mobile sits on the green header (top-right) */}
        <div className="lg:hidden absolute top-2 right-3 z-20">
          <button
            type="button"
            onClick={() => openHelp(null)}
            className="min-h-[44px] inline-flex items-center px-1 cursor-pointer"
          >
            <span className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full bg-white/[0.12] border border-white/[0.18] text-[12.5px] font-semibold text-white/95 backdrop-blur-sm">
              <HelpCircle className="w-4 h-4" />
              Need help?
            </span>
          </button>
        </div>

        {/* Mobile: left-aligned lockup */}
        <div className="relative z-10 px-7 pt-[68px] sm:px-0 sm:w-full sm:max-w-[440px] sm:mx-auto lg:hidden">
          <div className="w-[84px] h-[84px] rounded-[22px] bg-[#f6fbf7] flex items-center justify-center overflow-hidden shadow-[0_12px_26px_-10px_rgba(2,40,28,0.45)]">
            <BrandIcon size="w-[56px] h-[56px]" />
          </div>
          <h1 className="font-display mt-[26px] text-[31px] min-[380px]:text-[34px] font-extrabold text-white tracking-[-0.01em] leading-[1.1] whitespace-nowrap">
            CampusDebug <span className="text-[#a7f3d0]">OS</span>
          </h1>
          <p className="mt-2 text-[16px] min-[380px]:text-[17px] font-medium text-white/90">Your campus, in one app.</p>
        </div>

        {/* Desktop: centred composition */}
        <div className="relative z-10 hidden lg:flex flex-col items-center text-center pt-[82px] xl:pt-[min(82px,10vh)]">
          <div className="w-[92px] h-[92px] rounded-[24px] bg-[#f6fbf7] flex items-center justify-center overflow-hidden shadow-[0_18px_40px_-10px_rgba(2,40,28,0.55)] ring-[10px] ring-white/[0.12]">
            <BrandIcon size="w-[64px] h-[64px]" />
          </div>
          <p className="font-display mt-[30px] text-[26px] font-extrabold text-white tracking-[-0.01em] leading-none">
            CampusDebug <span className="text-[#a7f3d0]">OS</span>
          </p>
          <h2 className="font-display mt-[20px] text-[48.5px] font-extrabold text-white leading-[1.06] tracking-[-0.015em]">
            Your campus,<br /><span className="text-[#a7f3d0]">signed in.</span>
          </h2>
          <p className="mt-[18px] text-[16px] font-medium text-white/85">One account for your whole college life.</p>
        </div>

        {/* Campus line-art, standing on a full-width ground line */}
        <div className="hidden lg:block flex-1 min-h-[24px]" />
        <div className="hidden lg:block relative z-0 w-full pb-[80px]">
          <CampusLineArt className="block w-full max-w-[860px] mx-auto h-auto text-[#a7f3d0] opacity-[0.56]" />
        </div>
      </section>

      {/* ================= FORM PANEL (sheet on mobile) ================= */}
      <section
        className="login-form relative z-10 -mt-7 rounded-t-[28px] bg-white
          flex-1 px-[26px] pt-[40px] pb-8
          lg:m-0 lg:rounded-none lg:h-screen lg:min-h-[640px] lg:overflow-y-auto lg:bg-[#fbfdfc]
          lg:px-10 lg:pt-0 lg:pb-0 lg:flex lg:flex-col lg:items-center"
      >
        {/* Sheet grab-handle (mobile) */}
        <div className="lg:hidden absolute top-3 left-1/2 -translate-x-1/2 w-11 h-[5px] rounded-full bg-[#e0e7e4]" />

        {/* Faint concentric rings (desktop) */}
        <Rings corner="bl" className="hidden lg:block absolute bottom-0 left-0 w-[800px] h-[800px] text-[#0f6b4f]/[0.07] pointer-events-none z-0" />
        <Rings corner="tr" radii={[120, 190, 260, 330]} className="hidden lg:block absolute top-0 right-0 w-[800px] h-[800px] text-[#0f6b4f]/[0.05] pointer-events-none z-0" />

        {/* Need help? — desktop top-right */}
        <div className="hidden lg:flex absolute top-[12px] right-[30px] z-20">
          <button
            type="button"
            onClick={() => openHelp(null)}
            className="min-h-[44px] inline-flex items-center gap-1.5 px-2 text-[12.5px] font-semibold text-[#5a5f5d] hover:text-emerald-700 transition-colors cursor-pointer"
          >
            <HelpCircle className="w-[15px] h-[15px]" />
            Need help?
          </button>
        </div>

        <div className="relative z-10 w-full sm:max-w-[440px] sm:mx-auto lg:mx-0 lg:max-w-[356px] lg:flex-1 lg:flex lg:flex-col lg:justify-center lg:py-16">
          <div>
            <h2 className="text-[25px] lg:text-[28px] font-extrabold text-[#0b1712] tracking-[-0.025em] leading-tight">Welcome back</h2>
            <p className="mt-[7px] lg:mt-[6px] text-[14.5px] lg:text-[13.25px] font-medium text-[#5d6461]">Sign in with your college ID to continue</p>
          </div>

          <form onSubmit={handleSignIn} className="mt-[22px] lg:mt-[26px]">
              {/* Roll No / ID — Verify chip on the label row */}
              <div>
                <div className="flex items-center justify-between mb-[8px] lg:mb-[7px]">
                  <label className="text-[14px] lg:text-[13.5px] font-bold text-[#13201b]">Roll No / ID</label>
                  <button
                    type="button"
                    onClick={verifyCollegeRecord}
                    disabled={verifying || !identity.trim()}
                    className="group -my-2.5 min-h-[44px] inline-flex items-center pl-2 cursor-pointer disabled:cursor-default"
                  >
                    <span className="inline-flex items-center gap-1 h-[26px] lg:h-[25px] rounded-full border border-[#c9eadb] bg-[#e9fbf2] px-3 text-[12px] font-bold text-[#0b5e45] whitespace-nowrap transition-colors group-hover:bg-[#d8f6e7] group-disabled:opacity-60">
                      {verifying ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" strokeWidth={2.6} />}
                      {verifying ? 'Checking…' : 'Verify Record'}
                    </span>
                  </button>
                </div>
                <div className="group relative">
                  <IdCard className="absolute left-[15px] top-1/2 -translate-y-1/2 w-[19px] h-[19px] text-[#7c8481] group-focus-within:text-[#10a574] pointer-events-none transition-colors" />
                  <input
                    value={identity}
                    onChange={(e) => { setIdentity(e.target.value); verifiedIdRef.current = null; setVerifyState(null); setError(''); }}
                    onBlur={handleIdentityBlur}
                    autoComplete="username"
                    placeholder="e.g. 2201106001 or WDN-001"
                    className={`login-input min-w-0 w-full h-[52px] lg:h-[47px] rounded-[12px] border-[1.5px] pl-[46px] pr-4 text-[15px] lg:text-[14.5px] font-medium text-[#0b1712] outline-none transition placeholder:text-[#9aa29f] placeholder:font-normal ${
                      verifyState && verifyState !== 'notfound'
                        ? 'border-[#2f9e78] bg-white ring-[3px] ring-[#2f9e78]/[0.14]'
                        : verifyState === 'notfound'
                          ? 'border-rose-400 bg-white ring-[3px] ring-rose-400/[0.12]'
                          : 'border-[#e3e8e6] bg-[#f5f7f6] focus:bg-white focus:border-[#2f9e78] focus:ring-[3px] focus:ring-[#2f9e78]/[0.14]'
                    }`}
                  />
                </div>
              </div>

              {/* Live verification against the real college directory */}
              {verifyState === 'notfound' && (
                <div className="mt-3 rounded-[12px] border border-rose-200 bg-rose-50/80 p-3.5 text-xs text-rose-900">
                  <p className="flex items-center gap-2 font-bold text-rose-700">
                    <XCircle className="w-4 h-4 shrink-0" />
                    No matching college record
                  </p>
                  <p className="mt-1 text-rose-700/90">
                    Double-check the number — still stuck?{' '}
                    <button type="button" onClick={() => openHelp(0)} className="font-extrabold underline underline-offset-2 cursor-pointer">
                      Get help
                    </button>
                  </p>
                </div>
              )}

              {verifyState && verifyState !== 'notfound' && (
                <div className="mt-3 rounded-[12px] border border-[#c9eadb] bg-[#effbf5] p-3.5 text-xs text-emerald-900">
                  <p className="flex items-center gap-2 font-bold text-[#0b5e45]">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-[#10a574]" />
                    Official College Record Verified!
                  </p>
                  <p className="mt-1.5 text-[#0f6b4f] leading-relaxed font-medium">
                    {verifyState.fullName} • {verifyState.role === 'STUDENT' ? (verifyState.department || 'Student') : verifyState.role}
                    {verifyState.hostelBlock ? ` • ${verifyState.hostelBlock}` : ''}
                  </p>
                  {!verifyState.activated && (
                    <p className="mt-1.5 text-[11px] text-emerald-800/90 leading-relaxed">
                      <b>First time here?</b> Use your default password —{' '}
                      <span className="font-mono font-bold">firstname@last-4-of-your-registered-mobile</span> — and you will
                      set your own password right after this sign-in.
                    </p>
                  )}
                </div>
              )}

              {/* Password — forgot link under the field */}
              <div className="mt-[16px] lg:mt-[14px]">
                <label className="block text-[14px] lg:text-[13.5px] font-bold text-[#13201b] mb-[8px] lg:mb-[7px]">Password</label>
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Your password"
                  leadingIcon={Lock}
                  iconClassName="!left-[15px] !w-[18px] !h-[18px] !text-[#6b716f]"
                  toggleClassName="absolute right-1 top-1/2 -translate-y-1/2 w-[44px] h-[44px] flex items-center justify-center text-[#5b625f] hover:text-[#0b1712] transition-colors cursor-pointer"
                  toggleIconClassName="w-[19px] h-[19px]"
                  className="login-input w-full h-[52px] lg:h-[47px] rounded-[12px] border-[1.5px] border-[#e3e8e6] bg-[#f5f7f6] focus:bg-white !pl-[46px] !pr-12 text-[15px] lg:text-[14.5px] font-medium text-[#0b1712] outline-none transition placeholder:text-[#9aa29f] placeholder:font-normal focus:border-[#2f9e78] focus:ring-[3px] focus:ring-[#2f9e78]/[0.14]"
                />
                <div className="flex justify-end -mt-[2px] lg:-mt-[4px]">
                  <button
                    type="button"
                    onClick={() => openHelp(3)}
                    className="min-h-[44px] inline-flex items-center pl-2 text-[13.5px] lg:text-[13px] font-bold text-[#0a6b4a] hover:text-[#065a3d] transition-colors cursor-pointer"
                  >
                    Forgot password?
                  </button>
                </div>
              </div>

              {error && <p className="-mt-1 mb-2 text-xs text-rose-600 font-semibold">{error}</p>}

              <button
                type="submit" disabled={authBusy}
                className="mt-[10px] lg:mt-[9px] w-full h-[56px] lg:h-[50px] rounded-[14px] lg:rounded-[12px] bg-gradient-to-r from-[#06996b] to-[#047a58] text-[16px] lg:text-[15.5px] font-bold text-white transition hover:brightness-[1.06] shadow-[0_12px_24px_-8px_rgba(4,122,88,0.55)] cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <span>{authBusy ? 'Verifying…' : 'Sign In'}</span>
                {authBusy ? <Loader className="w-[18px] h-[18px] animate-spin" /> : <ArrowRight className="w-[18px] h-[18px]" strokeWidth={2.4} />}
              </button>

              {/* Secured footer (mobile only — desktop has the © bar below) */}
              <p className="lg:hidden flex items-center justify-center gap-1.5 text-[12.5px] text-[#6a6e6d] font-medium pt-[26px]">
                <ShieldCheck className="w-4 h-4 text-[#23aa7f]" />
                Secured with your college account
              </p>
            </form>
          </div>

          {/* Desktop © bar */}
          <div className="hidden lg:flex absolute left-[50px] right-[44px] bottom-[14px] items-center justify-between z-10">
            <div className="text-[12px] font-medium text-[#a0a6a3]">
              © 2026 CampusDebug OS
            </div>
            <div className="flex items-center text-[12px] font-medium text-[#a0a6a3]">
              <button type="button" onClick={() => openHelp(null)} className="min-h-[44px] min-w-[44px] pl-2 hover:text-emerald-700 transition-colors cursor-pointer">Help</button>
            </div>
          </div>
        </section>

      {/* Support surfaces */}
      <NeedHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} initialItem={helpFocus} onReportProblem={() => setReportOpen(true)} />
      <ReportProblemModal open={reportOpen} onClose={() => setReportOpen(false)} initialRoll={identity} />
    </main>
  );
}

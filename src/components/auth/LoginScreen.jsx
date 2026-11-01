import React, { useState, useRef } from 'react';
import { CheckCircle2, LockKeyhole, ArrowRight, ShieldCheck, XCircle, Loader, HelpCircle, Contact, Lock, Check } from 'lucide-react';
import { storeSession, roleToDashboard } from '../../utils/authClient';
import PasswordInput from './PasswordInput';
import NeedHelpModal from './NeedHelpModal';
import ReportProblemModal from './ReportProblemModal';

// REAL authentication — identity is verified against the college directory
// (Supabase `profiles`), passwords are managed by Supabase Auth as salted
// hashes. First-time users are auto-provisioned with the college default
// password (firstname@last-4-of-registered-mobile) and MUST set their own
// password before entering the portal.

// Line-art campus skyline recreated from the design mockup: mint outline
// strokes on the green brand panel — gabled teaching wing with an oculus,
// columns; steep-roofed clock tower with a round face; slender buildings
// with real window grids; domed hall; round-canopy trees. Pure vector.
const CampusSkyline = ({ className = '' }) => (
  <svg viewBox="0 0 480 150" fill="none" preserveAspectRatio="none" className={className} aria-hidden="true">
    <g stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {/* far-left low wing with window dashes */}
      <path d="M8 138V92h40v46" />
      <path d="M18 104h7M18 116h7M31 104h7M31 116h7" strokeOpacity="0.55" />
      {/* gabled hall — pediment + oculus + colonnade */}
      <path d="M56 138V96l32-20 32 20v42" />
      <path d="M88 76l-2.5 1.5M90.5 76a3 3 0 105 0" strokeOpacity="0.6" />
      <circle cx="88" cy="86" r="4" strokeOpacity="0.65" />
      <path d="M64 138v-30M72 138v-30M80 138v-30M96 138v-30M104 138v-30M112 138v-30" strokeOpacity="0.55" />
      {/* clock tower — steep roof + finial + pedestal face + arch door */}
      <path d="M132 138V64h30v74" />
      <path d="M127 64l20-24 20 24" />
      <path d="M147 40v-6" strokeOpacity="0.7" />
      <circle cx="147" cy="86" r="9" strokeOpacity="0.7" />
      <path d="M147 86v-5M147.9 86.6l3.2 1.8" strokeOpacity="0.7" strokeWidth="1.4" />
      <path d="M142 138v-9a5 5 0 0110 0v9" strokeOpacity="0.55" />
      {/* tall rectangle tower — 3x4 square window grid */}
      <path d="M174 138V74h34v64" />
      <path d="M180 82h7M180 92h7M180 102h7M180 112h7M190 82h7M190 92h7M190 102h7M190 112h7M191 122h6" strokeOpacity="0.45" />
      {/* domed arc hall */}
      <path d="M216 138v-25a16 16 0 0132 0v25" />
      <path d="M232 113v25" strokeOpacity="0.6" />
      {/* main academic block — wide, square window grid */}
      <path d="M256 138V58h52v80" />
      <path d="M263 66h9v8h-9zM276 66h9v8h-9zM289 66h9v8h-9zM263 80h9v8h-9zM276 80h9v8h-9zM289 80h9v8h-9zM263 94h9v8h-9zM276 94h9v8h-9zM289 94h9v8h-9zM263 108h9v8h-9zM276 108h9v8h-9zM289 108h9v8h-9z" strokeOpacity="0.4" />
      <path d="M278 138v-10h9v10" strokeOpacity="0.6" />
      {/* slim hostel towers */}
      <path d="M316 138V84h20v54M344 138V98h18v40" />
      <path d="M321 92h10M321 102h10M321 112h10M349 106h8M349 116h8" strokeOpacity="0.5" />
      {/* small gate booth */}
      <path d="M370 138v-18h12v18M369 120h14" strokeOpacity="0.7" />
      {/* trees — round canopies on trunks */}
      <circle cx="404" cy="112" r="10" strokeOpacity="0.75" />
      <path d="M404 122v16" strokeOpacity="0.75" />
      <circle cx="430" cy="106" r="14" strokeOpacity="0.75" />
      <path d="M430 120v18" strokeOpacity="0.75" />
      {/* ground line */}
      <path d="M0 140h480" strokeOpacity="0.8" />
      {/* birds */}
      <path d="M370 36c3-3 6-3 9 0M384 27c3-3 6-3 9 0M396 40c2.5-2.5 5-2.5 7.5 0" strokeOpacity="0.5" strokeWidth="1.5" />
    </g>
  </svg>
);

// Decorative dot grid from the mockups (rows/cols of soft white dots).
const DotGrid = ({ className = '', cols = 6, rows = 7, gap = 14, r = 2.6 }) => {
  const width = (cols - 1) * gap + r * 2;
  const height = (rows - 1) * gap + r * 2;
  const dots = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) dots.push(<circle key={`${x}-${y}`} cx={r + x * gap} cy={r + y * gap} r={r} />);
  }
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true" fill="currentColor">
      {dots}
    </svg>
  );
};

// Soft concentric arcs anchored at the white panel's corners (per mockup).
// Circles are centered at the SVG's own corner so the visible part sweeps
// INWARD through the panel — arcs reach the middle, not clipped floated
// full circles like before.
const Rings = ({ className = '', corner = 'tr' }) => {
  const c = corner === 'tr' ? { cx: 800, cy: 0 } : { cx: 0, cy: 800 };
  return (
    <svg viewBox="0 0 800 800" fill="none" className={className} aria-hidden="true">
      <g stroke="currentColor" strokeLinecap="round">
        {[170, 265, 360, 455, 550, 645, 740, 800].map((r, i) => (
          <circle key={r} cx={c.cx} cy={c.cy} r={r} strokeWidth={i % 3 === 0 ? 1.8 : 1.2} strokeOpacity={0.7 - i * 0.06} />
        ))}
      </g>
    </svg>
  );
};

// Small inline fallback mark shown inside the white squircle if the PNG
// brand icon is missing (keeps the lockup intact offline).
const BrandIcon = ({ size = 'w-9 h-9' }) => (
  <img
    src="/brand_icon_128.png"
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
    // FULL-BLEED per the mockup: on desktop the green panel + white form each
    // cover half of the actual viewport — no floating card, no margins.
    <main className="min-h-screen w-full bg-white lg:grid lg:grid-cols-2 lg:min-h-0 selection:bg-emerald-600 selection:text-white">

      {/* ================= LEFT: GREEN BRAND PANEL (full height) ================= */}
      <section
        className="relative overflow-hidden text-emerald-100 lg:h-screen lg:flex lg:flex-col
          bg-gradient-to-b from-[#0A7A57] to-[#12946A]
          pt-8 pb-16
          lg:bg-gradient-to-br lg:from-[#086B4E] lg:via-[#0C855D] lg:to-[#17A673]
          lg:py-0"
      >
        {/* Soft decorations from the mockups */}
        <DotGrid className="absolute top-9 right-5 w-11 text-white/25 z-0" />
        <DotGrid className="absolute bottom-24 left-4 w-8 text-white/20 z-0 lg:hidden" cols={4} rows={5} />

        {/* Mobile: LEFT-aligned lockup (per the mobile mockup) */}
        <div className="relative z-10 px-6 pt-10 lg:hidden">
          <div className="w-16 h-16 rounded-[1.4rem] bg-white shadow-xl flex items-center justify-center overflow-hidden">
            <BrandIcon size="w-11 h-11" />
          </div>
          <h1 className="mt-5 text-[1.85rem] font-extrabold text-white tracking-tight leading-none">
            CampusDebug <span className="text-emerald-200">OS</span>
          </h1>
          <p className="mt-2 text-[15px] font-medium text-emerald-50/90">Your campus, in one app.</p>
        </div>

        {/* Desktop: CENTERED composition (per the web mockup) */}
        <div className="relative z-10 hidden lg:flex flex-col items-center text-center pt-12 pb-2">
          <div className="w-24 h-24 rounded-[1.7rem] bg-white shadow-2xl ring-1 ring-white/40 flex items-center justify-center overflow-hidden">
            <BrandIcon size="w-16 h-16" />
          </div>
          <p className="mt-6 text-[1.7rem] font-extrabold text-white tracking-tight leading-none">
            CampusDebug <span className="text-emerald-200">OS</span>
          </p>
          <h2 className="mt-10 text-[3.1rem] xl:text-[3.5rem] font-extrabold text-white leading-[1.08] tracking-tight">
            Your campus,<br /><span className="text-emerald-300">signed in.</span>
          </h2>
          <p className="mt-4 text-[15px] text-emerald-50/90">One account for your whole college life.</p>
        </div>

        {/* Scatter: dot grids + thin sparkle "+" marks (desktop) */}
        <DotGrid className="hidden lg:block absolute top-14 left-14 w-14 text-white/25 z-0" />
        <DotGrid className="hidden lg:block absolute top-[36%] right-12 w-10 text-white/20 z-0" cols={5} rows={5} />
        <DotGrid className="hidden lg:block absolute bottom-[36%] left-24 w-9 text-white/15 z-0" cols={4} rows={4} />
        <span className="hidden lg:block absolute top-[30%] left-[16%] text-white/40 text-xl font-light select-none z-0">+</span>
        <span className="hidden lg:block absolute top-[24%] right-[24%] text-white/35 text-lg font-light select-none z-0">+</span>
        <span className="hidden lg:block absolute top-[52%] right-[10%] text-white/30 text-xl font-light select-none z-0">+</span>

        {/* Skyline composition (desktop) — FULL-BLEED: the wrapper keeps the
            SVG's exact 480:150 ratio, so the drawing always spans the whole
            panel width and its ground line runs edge to edge */}
        <div className="hidden lg:block flex-[1.15]" />
        <div className="hidden lg:block relative z-0 w-full aspect-[16/5]">
          <CampusSkyline className="w-full h-full text-emerald-200" />
        </div>
        {/* Tall ground band under the skyline — the skyline floats above it */}
        <div className="hidden lg:block flex-1" />
        <div className="hidden lg:block relative z-0 h-12 bg-[#0A5C43]/50" />
      </section>

      {/* ================= RIGHT: WHITE FORM PANEL (full height) ================= */}
      <section
        className="relative z-10 -mt-9 rounded-t-[2rem] bg-white
          px-6 pt-5 pb-8 min-h-screen
          lg:m-0 lg:rounded-none lg:min-h-0 lg:h-screen lg:overflow-y-auto
          lg:px-16 xl:px-24 lg:py-8
          lg:flex lg:flex-col"
      >
        {/* Sheet grab-handle (mobile, per the mockup) */}
        <div className="lg:hidden absolute top-2 left-1/2 -translate-x-1/2 w-12 h-[5px] rounded-full bg-slate-200" />

        {/* Soft concentric arcs — anchored exactly at the panel corners so they
            sweep toward the middle (per mockup: up-right and down-left) */}
        <Rings corner="tr" className="hidden lg:block absolute top-0 right-0 w-[560px] h-[560px] text-emerald-950/[0.12] pointer-events-none z-0" />
        <Rings corner="bl" className="hidden lg:block absolute bottom-0 left-0 w-[560px] h-[560px] text-emerald-950/[0.10] pointer-events-none z-0" />

        {/* Need help? — top-right */}
        <div className="relative flex justify-end shrink-0">
          <button
            type="button"
            onClick={() => openHelp(null)}
            className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-emerald-700 transition-colors cursor-pointer"
          >
            <HelpCircle className="w-4 h-4" />
            Need help?
          </button>
        </div>

        <div className="relative lg:flex-1 lg:flex lg:flex-col lg:justify-center lg:max-w-xl w-full">
          <div className="mt-4 lg:mt-0">
            <h2 className="text-[1.65rem] sm:text-[1.9rem] font-extrabold text-slate-900 tracking-tight">Welcome back</h2>
            <p className="mt-1 text-[15px] text-slate-500">Sign in with your college ID to continue</p>
          </div>

          <form onSubmit={handleSignIn} className="space-y-4 mt-6">
              {/* Roll No / ID — Verify chip lives on the label row, per the mockup */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-bold text-slate-800">Roll No / ID</label>
                  <button
                    type="button"
                    onClick={verifyCollegeRecord}
                    disabled={verifying || !identity.trim()}
                    className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/70 bg-emerald-50 px-3.5 py-1.5 text-xs font-extrabold text-emerald-700 hover:bg-emerald-100 transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                  >
                    {verifying ? <Loader className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    {verifying ? 'Checking…' : 'Verify Record'}
                  </button>
                </div>
                <div className="relative">
                  <Contact className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-slate-400 pointer-events-none" />
                  <input
                    value={identity}
                    onChange={(e) => { setIdentity(e.target.value); verifiedIdRef.current = null; setVerifyState(null); setError(''); }}
                    onBlur={handleIdentityBlur}
                    autoComplete="username"
                    placeholder="e.g. 2201106001 or WDN-001"
                    className={`min-w-0 w-full rounded-[0.9rem] border bg-slate-50/80 px-3.5 py-3.5 pl-10 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 ${
                      verifyState && verifyState !== 'notfound'
                        ? 'border-emerald-500 ring-[3px] ring-emerald-500/10 bg-white'
                        : verifyState === 'notfound'
                          ? 'border-rose-400 ring-[3px] ring-rose-400/10 bg-white'
                          : 'focus:bg-white focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10'
                    }`}
                  />
                </div>
              </div>

              {/* Live verification against the real college directory */}
              {verifyState === 'notfound' && (
                <div className="rounded-2xl border border-rose-200 bg-rose-50/80 p-3.5 text-xs text-rose-900">
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
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-3.5 text-xs text-emerald-900">
                  <p className="flex items-center gap-2 font-bold text-emerald-800">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                    Official College Record Verified!
                  </p>
                  <p className="mt-1.5 text-emerald-700 leading-relaxed font-medium">
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

              {/* Password — forgot link sits UNDER the field, per the mockup */}
              <div>
                <label className="block text-sm font-bold text-slate-800 mb-2">Password</label>
                <PasswordInput
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  placeholder="Your password"
                  leadingIcon={Lock}
                  className="w-full rounded-[0.9rem] border border-slate-200 bg-slate-50/80 focus:bg-white px-3.5 py-3.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/10"
                />
                <div className="flex justify-end mt-2">
                  <button
                    type="button"
                    onClick={() => openHelp(3)}
                    className="text-[13px] font-bold text-slate-600 hover:text-emerald-700 transition-colors cursor-pointer"
                  >
                    Forgot password?
                  </button>
                </div>
              </div>

              {error && <p className="text-xs text-rose-600 font-semibold">{error}</p>}

              <button
                type="submit" disabled={authBusy}
                className="w-full rounded-2xl bg-emerald-600 py-3.5 text-[15px] font-extrabold text-white transition hover:bg-emerald-700 shadow-[0_12px_28px_rgba(5,150,105,0.35)] cursor-pointer flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <span>{authBusy ? 'Verifying…' : 'Sign In'}</span>
                {authBusy ? <Loader className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
              </button>

              {/* Secured footer (mobile only — desktop has the © bar below) */}
              <p className="lg:hidden flex items-center justify-center gap-1.5 text-[11px] text-slate-400 font-semibold pt-1">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Secured with your college account
              </p>
            </form>
          </div>

          {/* Desktop © bar (per the mockup) */}
          <div className="hidden lg:flex items-center justify-between pt-6 border-t border-slate-100 shrink-0 relative">
            <div className="text-[11px] font-semibold text-slate-400">
              © 2026 CampusDebug OS
            </div>
            <div className="flex items-center gap-4 text-[11px] font-bold text-slate-400">
              <button type="button" onClick={() => openHelp(null)} className="hover:text-emerald-700 transition-colors cursor-pointer">Privacy</button>
              <span className="text-slate-200">•</span>
              <button type="button" onClick={() => openHelp(null)} className="hover:text-emerald-700 transition-colors cursor-pointer">Terms</button>
              <span className="text-slate-200">•</span>
              <button type="button" onClick={() => openHelp(null)} className="hover:text-emerald-700 transition-colors cursor-pointer">Help</button>
            </div>
          </div>
        </section>

      {/* Support surfaces */}
      <NeedHelpModal open={helpOpen} onClose={() => setHelpOpen(false)} initialItem={helpFocus} onReportProblem={() => setReportOpen(true)} />
      <ReportProblemModal open={reportOpen} onClose={() => setReportOpen(false)} initialRoll={identity} />
    </main>
  );
}

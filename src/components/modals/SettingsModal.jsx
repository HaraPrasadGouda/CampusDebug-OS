import React, { useState, useEffect } from 'react';
import { X, Bell, Wifi, Moon, RefreshCw, Database, Shield, Check } from 'lucide-react';
import PasswordInput from '../auth/PasswordInput';
import { useLiveUpdates } from '../../utils/liveUpdates';

export default function SettingsModal({ isOpen, onClose }) {
  const [offlineSync, setOfflineSync] = useState(true);
  // Live updates: saved on this device, applies to every open screen at once.
  const [autoRefresh, setAutoRefresh] = useLiveUpdates();
  const [pushStatus, setPushStatus] = useState({ ok: null, text: '' });
  const [pushOn, setPushOn] = useState(null); // null = still checking this device
  const [pushBusy, setPushBusy] = useState(false);

  // Detect this device's real push state every time Settings opens, so the
  // toggle always reflects the truth (permission granted + live subscription).
  useEffect(() => {
    let cancelled = false;
    if (!isOpen) return undefined;
    import('../../utils/notify')
      .then(({ checkBackgroundAlertsEnabled }) => checkBackgroundAlertsEnabled())
      .then(({ enabled }) => { if (!cancelled) setPushOn(enabled); })
      .catch(() => { if (!cancelled) setPushOn(false); });
    return () => { cancelled = true; };
  }, [isOpen]);

  const toggleBackgroundAlerts = async () => {
    if (pushBusy || pushOn === null) return;
    setPushBusy(true);
    try {
      const notifyMod = await import('../../utils/notify');
      const result = pushOn
        ? await notifyMod.disableBackgroundAlerts()
        : await notifyMod.enableBackgroundAlerts();
      if (result.ok) {
        setPushOn(!pushOn);
        setPushStatus({ ok: null, text: '' }); // the toggle itself is the indicator
      } else {
        setPushStatus({ ok: false, text: result.message });
      }
    } catch (err) {
      setPushStatus({ ok: false, text: `Toggle failed: ${err.message}` });
    } finally {
      setPushBusy(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-3xl max-w-md w-full border border-slate-200/80 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold">
              ⚙️
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">App Preferences</h2>
              <p className="text-xs text-slate-600">Sync & display settings</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Settings List */}
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-3">
              <Wifi className="w-5 h-5 text-blue-600" />
              <div>
                <p className="text-xs font-semibold text-slate-800">Background Sync</p>
                <p className="text-[11px] text-slate-600">Auto-sync actions when online</p>
              </div>
            </div>
            <button 
              onClick={() => setOfflineSync(!offlineSync)}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${offlineSync ? 'bg-blue-600' : 'bg-slate-300'}`}
            >
              <div className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${offlineSync ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          {/* Push registration — once ON, it stays ON. Unsubscribing would
              silently drop the device out of the push group (falling back to
              the SMS channel), so the UI shows a permanent Active badge
              instead of a toggle the student can flip on and off. */}
          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-3">
              <Bell className="w-5 h-5 text-emerald-600" />
              <div>
                <p className="text-xs font-semibold text-slate-800">Background Alerts</p>
                <p className="text-[11px] text-slate-600">
                  {pushOn === null
                    ? 'Checking this device…'
                    : pushOn
                      ? 'Device registered — notices reach you even when the app is closed'
                      : 'Not enabled on this device yet'}
                </p>
              </div>
            </div>
            {pushOn ? (
              <span className="shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Active
              </span>
            ) : (
              <button
                onClick={toggleBackgroundAlerts}
                disabled={pushOn === null || pushBusy}
                aria-label="Enable background alerts"
                className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-slate-300 text-[10px] font-bold transition-colors ${pushOn === null || pushBusy ? 'opacity-60 cursor-wait text-slate-400' : 'text-slate-600 hover:bg-emerald-50 hover:border-emerald-300 hover:text-emerald-700 cursor-pointer'}`}
              >
                {pushOn === null ? (
                  '…'
                ) : pushBusy ? (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                    Registering…
                  </>
                ) : (
                  <>
                    <span className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                    Tap to Enable
                  </>
                )}
              </button>
            )}
          </div>
          {pushStatus.text && (
            <p className={`-mt-2 px-3.5 text-[11px] font-medium px-2.5 py-1.5 rounded-lg ${pushStatus.ok === false ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
              {pushStatus.text}
            </p>
          )}

          <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
            <div className="flex items-center gap-3">
              <RefreshCw className="w-5 h-5 text-purple-600" />
              <div>
                <p className="text-xs font-semibold text-slate-800">Live updates</p>
                <p className="text-[11px] text-slate-600">
                  {autoRefresh
                    ? 'On: pass & leave status refresh every 15 s'
                    : 'Off: status refreshes when you open the app'}
                </p>
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={autoRefresh}
              aria-label="Live updates"
              data-testid="live-updates-toggle"
              onClick={() => setAutoRefresh(!autoRefresh)}
              className="shrink-0 min-w-[44px] min-h-[44px] flex items-center justify-center cursor-pointer"
            >
              <span className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors ${autoRefresh ? 'bg-purple-600' : 'bg-slate-300'}`}>
                <span className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${autoRefresh ? 'translate-x-5' : 'translate-x-0'}`} />
              </span>
            </button>
          </div>

          {/* Change Password — updates the Supabase Auth record via the server */}
          <ChangePasswordSection />

          <div className="pt-2">
            <button
              onClick={onClose}
              className="w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm transition-colors cursor-pointer"
            >
              Save & Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChangePasswordSection() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleChange = async () => {
    if (newPassword.length < 6) { setError('New password must be at least 6 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newPassword })
      });
      const data = await res.json();
      if (data.success) {
        // The server-side password update revokes the session token that
        // authorized the change — silently re-sign in with the new password
        // so the user stays logged in instead of being booted on the next
        // API call.
        try {
          const { getStoredProfile, storeSession } = await import('../../utils/authClient');
          const prof = getStoredProfile();
          const re = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rollNumber: prof?.rollNumber || prof?.identity, password: newPassword })
          });
          const reData = await re.json();
          if (reData?.success) storeSession(reData);
        } catch { /* worst case the online session kick handles it */ }
        setDone(true);
        setNewPassword('');
        setConfirmPassword('');
        setTimeout(() => setDone(false), 3500);
      } else {
        setError(data.error || 'Password change failed — try again.');
      }
    } catch {
      setError('Cannot reach the campus server right now.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-100">
      <div className="flex items-center gap-3 mb-2.5">
        <Shield className="w-5 h-5 text-amber-600" />
        <div>
          <p className="text-xs font-semibold text-slate-800">Change Password</p>
          <p className="text-[11px] text-slate-600">Updates your login password in the college database</p>
        </div>
      </div>
      <div className="space-y-2">
        <PasswordInput
          value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
          placeholder="New password (min 6 characters)" autoComplete="new-password"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-amber-400"
        />
        <PasswordInput
          value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
          placeholder="Confirm new password" autoComplete="new-password"
          className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs outline-none focus:border-amber-400"
        />
        {error && <p className="text-[11px] text-rose-600 font-semibold">{error}</p>}
        {done && <p className="text-[11px] text-emerald-700 font-bold">Password updated — use it on your next sign-in!</p>}
        <button
          type="button" onClick={handleChange} disabled={busy}
          className="w-full py-2 rounded-xl border border-amber-200 bg-amber-50 hover:bg-amber-100 text-amber-800 text-xs font-bold transition-colors cursor-pointer disabled:opacity-60"
        >
          {busy ? 'Updating…' : 'Update Password'}
        </button>
      </div>
    </div>
  );
}

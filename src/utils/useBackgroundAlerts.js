// This device's background-alert (push) state for the teacher Today banner and the Me tab.
// Reuses the exact helpers Settings uses (checkBackgroundAlertsEnabled / enable / disable) - no new network calls.
import { useState, useEffect, useCallback } from 'react';

export default function useBackgroundAlerts(active = true) {
  const [on, setOn] = useState(null);      // null = still checking this device
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    try {
      const { checkBackgroundAlertsEnabled } = await import('./notify');
      const r = await checkBackgroundAlertsEnabled();
      setOn(!!r.enabled);
      return !!r.enabled;
    } catch { setOn(false); return false; }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    refresh();
    const again = () => { if (document.visibilityState !== 'hidden') refresh(); };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => { window.removeEventListener('focus', again); document.removeEventListener('visibilitychange', again); };
  }, [active, refresh]);

  const toggle = useCallback(async () => {
    if (busy || on === null) return;
    setBusy(true); setMsg('');
    try {
      const mod = await import('./notify');
      const res = on ? await mod.disableBackgroundAlerts() : await mod.enableBackgroundAlerts();
      if (res.ok) setOn(!on); else setMsg(res.message || 'Could not change alerts on this device.');
    } catch (e) {
      setMsg(`Could not change alerts: ${e.message}`);
    } finally { setBusy(false); }
  }, [busy, on]);

  return { on, busy, msg, toggle, refresh };
}

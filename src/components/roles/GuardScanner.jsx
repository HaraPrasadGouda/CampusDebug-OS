import React, { useState, useEffect, useRef } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Camera, 
  CameraOff, 
  CheckCircle2, 
  XCircle, 
  Clock, 
  MapPin, 
  User, 
  Lock, 
  ArrowRight, 
  RefreshCw, 
  QrCode,
  FileCheck,
  LogOut,
  LogIn,
  Users
} from 'lucide-react';
import { verifySignedPassToken, leaveQrFreshness, refreshPassPublicKey } from '../../utils/crypto';
import { noteServerDate, serverNow } from '../../utils/serverClock';
import { getAllLocal, saveLocal, queueOfflineAction } from '../../utils/db';
import { getAccessToken } from '../../utils/authClient';
import { queueAction } from '../../utils/syncEngine';
import { refreshApprovedLeaves, checkLeaveOffline, markLeaveUsedLocally, getUsedLeaves } from '../../utils/leaveGateCache';

export default function GuardScanner({ searchQuery = '' }) {
  const [isScanning, setIsScanning] = useState(false);
  const [scanResult, setScanResult] = useState(null); // { valid, isExpired, payload, message }
  const [leaveRows, setLeaveRows] = useState([]);  // day-scholar leave log (category=LEAVE)
  const [leaveStats, setLeaveStats] = useState({ outsToday: 0 });
  // Leave exits this phone let out OFFLINE (sync pending / synced / conflict).
  const [localLeaveUsed, setLocalLeaveUsed] = useState(() => getUsedLeaves());
  const [gateLogs, setGateLogs] = useState([
    // Starts EMPTY — the log only shows gates the guard actually verified
    // in this browser's ledger (IndexedDB). No fabricated history.
  ]);
  const [cameraError, setCameraError] = useState(null);
  const [manualInput, setManualInput] = useState('');
  const [manualBusy, setManualBusy] = useState(false);
  const html5QrCodeRef = useRef(null);
  const scanLockRef = useRef(false);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // OFFLINE LEAVE LIST: download today's approved day-scholar leaves whenever
  // online (now, every minute, and the moment the network comes back), so a
  // leave QR can still be checked at the gate with no network.
  useEffect(() => {
    // Fix 5: the server's PUBLIC gate key is downloaded with the list, so
    // QRs can be checked offline (the phone holds no signing secret).
    const refreshGateData = () => { refreshApprovedLeaves(); refreshPassPublicKey(); };
    refreshGateData();
    const iv = setInterval(refreshGateData, 60000);
    const onOnline = () => refreshGateData();
    // Outbox answer for an offline leave exit: synced, or refused (double use / invalid).
    const onLeaveSynced = (e) => {
      const d = e?.detail || {};
      if (!d.leaveId) return;
      const prev = getUsedLeaves()[String(d.leaveId)] || {};
      markLeaveUsedLocally(d.leaveId, d.ok
        ? { state: 'SYNCED', syncedAt: new Date().toISOString() }
        : { state: d.conflict ? 'CONFLICT' : 'REFUSED', reason: d.reason || d.error || 'Refused by server at sync', firstOutAt: d.firstOutAt || null });
      setLocalLeaveUsed(getUsedLeaves());
      setScanResult(cur => (cur && cur.mode === 'leave' && cur.leave?.pendingSync && cur.payload?.leaveId === String(d.leaveId))
        ? (d.ok
            ? { ...cur, leave: { ...cur.leave, pendingSync: false, synced: true, parentSms: d.parentSms || cur.leave.parentSms } }
            : { valid: false, reasonKind: 'state', message: d.reason || 'Offline exit refused by the server at sync.', payload: cur.payload })
        : cur);
      if (d.ok) window.dispatchEvent(new CustomEvent('campus_leave_updated', { detail: { rollNo: prev.rollNo, outAt: prev.scannedAt } }));
    };
    window.addEventListener('online', onOnline);
    window.addEventListener('campus_leave_scan_synced', onLeaveSynced);
    return () => {
      clearInterval(iv);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('campus_leave_scan_synced', onLeaveSynced);
    };
  }, []);

  const startCamera = async () => {
    setCameraError(null);
    scanLockRef.current = false;
    try {
      const html5QrCode = new Html5Qrcode('guard-reader');
      html5QrCodeRef.current = html5QrCode;

      await html5QrCode.start(
        { facingMode: 'environment' },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 }
        },
        async (decodedText) => {
          // One scan per student: the camera keeps reading ~10 frames/s, so
          // without this lock the same QR was processed several times (first
          // = exit OK, next = "already LEFT" overwriting it).
          if (scanLockRef.current) return;
          scanLockRef.current = true;
          try { html5QrCode.pause(true); } catch (e) { /* ignore */ }
          await processToken(decodedText);
          stopCamera();
        },
        (errorMessage) => {
          // ignore scan frame errors
        }
      );
      setIsScanning(true);
    } catch (err) {
      console.warn('Camera start error:', err);
      setCameraError('Camera access unavailable or blocked. Type the pass number in the manual pass entry below.');
      setIsScanning(false);
    }
  };

  const stopCamera = async () => {
    if (html5QrCodeRef.current && html5QrCodeRef.current.isScanning) {
      try {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current.clear();
      } catch (e) {
        console.warn('Error stopping camera:', e);
      }
    }
    setIsScanning(false);
  };

  // Web Audio API Chimes (Zero external audio files required)
  const playAudioFeedback = (isSuccess) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (isSuccess) {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, ctx.currentTime); // A5 High Pitch
        osc.frequency.exponentialRampToValueAtTime(1320, ctx.currentTime + 0.15); // E6
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.3);
      } else {
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, ctx.currentTime); // A3 Low Warning
        osc.frequency.exponentialRampToValueAtTime(110, ctx.currentTime + 0.25);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.35);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.35);
      }
    } catch (e) {
      // Silent catch if audio context blocked
    }
  };

  useEffect(() => {
    let alive = true;
    // "Today's Gate Movement Log" reads the SERVER's append-only pass_scans
    // register: one row per physical scan, REAL scanned_at timestamps, no
    // mock rows. The device-local pass store is a last-resort offline
    // fallback, strictly scoped to TODAY with its own honest timestamps —
    // old test passes without a scan time must never fake "Recently".
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const buildFromServer = (scans) => scans
      .filter(s => s.scanned_at && new Date(s.scanned_at) >= startOfDay)
      .slice(0, 10)
      .map(s => ({
        id: `SRV-${s.id || s.scanned_at}`,
        passId: s.pass_ref || '',
        student: `${s.student_name || 'Student'} (${s.student_roll || '—'})`,
        destination: s.destination || '',
        type: String(s.direction || '').toUpperCase() === 'RETURN'
          ? (s.late_return ? 'LATE_RETURN_GATE' : 'RETURN_GATE')
          : 'EXIT_GATE',
        time: new Date(s.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        ts: new Date(s.scanned_at).getTime(),
        status: String(s.direction || '').toUpperCase() === 'RETURN' ? 'RETURNED' : 'VERIFIED',
        serverRow: true
      }));

    const mergeLogs = (serverRows) => {
      setGateLogs(prev => {
        // Optimistic entries added seconds ago by this very scan tap stay
        // until the register row with the same pass+direction+minute
        // arrives; that server copy then REPLACES the optimistic one (it
        // carries the authoritative late_return flag).
        const manual = prev.filter(l => !l.serverRow);
        for (const s of serverRows) {
          const matchIdx = manual.findIndex(l =>
            l.passId === s.passId &&
            l.type === s.type &&
            Math.abs((l.ts || new Date(l.verifiedAt || 0).getTime()) - s.ts) < 120e3);
          if (matchIdx >= 0) manual.splice(matchIdx, 1);
          manual.push(s);
        }
        return manual
          .sort((a, b) => (b.ts || b.ms || 0) - (a.ts || a.ms || 0))
          .slice(0, 10);
      });
    };

    const loadLeaveList = async () => {
      // Day-scholar leave log: same append-only table, category=LEAVE —
      // one-way OUT records (mentor-approved gate exits).
      try {
        const tok = getAccessToken();
        const r = await fetch('/api/pass-scans?category=LEAVE&limit=120',
          tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
        const j = await r.json();
        if (alive && j?.success && Array.isArray(j.scans)) {
          setLeaveRows(j.scans);
          const start = new Date(); start.setHours(0, 0, 0, 0);
          const todays = j.scans.filter(x => x.scanned_at && new Date(x.scanned_at) >= start);
          setLeaveStats({ outsToday: todays.length });
        }
      } catch { /* offline — card keeps last snapshot */ }
    };

    const loadRegister = async () => {
      try {
        const tok = getAccessToken();
        const r = await fetch('/api/pass-scans?limit=60', tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
        noteServerDate(r);
        const j = await r.json();
        if (alive && j?.success && Array.isArray(j.scans)) {
          mergeLogs(buildFromServer(j.scans));
        }
      } catch { /* offline — fall back below */ }
      loadLeaveList();
      if (!alive) return;
      try {
        const lod = await getAllLocal('gate_passes');
        const fallback = (lod || [])
          .filter(p => p.verifiedAt && new Date(p.verifiedAt) >= startOfDay)
          .slice(-10).reverse()
          .map((p, idx) => ({
            id: `LOC-${idx}`,
            passId: p.id || '',
            student: `${p.name || 'Student'} (${p.rollNo || '—'})`,
            destination: p.destination || '',
            type: p.gateCheckInStatus === 'CHECKED_IN'
              ? (new Date(p.verifiedAt) > new Date(p.validUntil || 0) ? 'LATE_RETURN_GATE' : 'RETURN_GATE')
              : 'EXIT_GATE',
            // Honest timestamps or NOTHING — the old `|| 'Recently'` painted
            // undated mock rows with a fake fresh time.
            time: new Date(p.verifiedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            ts: new Date(p.verifiedAt).getTime(),
            status: p.gateCheckInStatus === 'CHECKED_IN' ? 'RETURNED' : 'VERIFIED'
          }));
        setGateLogs(prev => (Array.isArray(prev) && prev.some(l => l.serverRow)) ? prev : fallback);
      } catch { /* store not ready */ }
    };

    loadRegister();
    const iv = setInterval(loadRegister, 15000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const processToken = async (rawToken) => {
    if (!rawToken || !rawToken.trim()) return;

    const verification = await verifySignedPassToken(rawToken.trim());
    setScanResult(verification);
    playAudioFeedback(verification.valid);

    if (verification.valid && verification.payload) {
      const passId = verification.payload.passId || '';

      // Old permanent campus-ID QR (no time, no leave id): a screenshot of it
      // could be re-used, so it no longer opens the gate for a leave.
      if (verification.payload.kind === 'COMMUTE') {
        setScanResult({
          valid: false,
          reasonKind: 'state',
          message: 'Old campus-ID QR — not valid for leave exit any more. Ask the student to open the app and show the live leave QR (it changes every few seconds).',
          payload: verification.payload
        });
        playAudioFeedback(false);
        return;
      }

      // Fix 5: the hosteller gate pass QR rotates too — refuse one older
      // than ~60 s (screenshots / forwarded photos), exit AND return.
      if (verification.payload.kind !== 'LEAVE') {
        const { fresh } = leaveQrFreshness(verification.payload, serverNow());
        if (!fresh) {
          setScanResult({
            valid: false,
            isExpired: true,
            message: 'QR expired — ask the student to show the live QR in the app (screenshots or old photos are not accepted). Nothing recorded.',
            payload: verification.payload
          });
          playAudioFeedback(false);
          return;
        }
      }

      // DAY-SCHOLAR LEAVE branch: a rotating per-leave token never touches
      // the pass state machine — the SERVER checks the leave id is this
      // student's mentor-APPROVED, not-yet-scanned leave and that the QR is
      // fresh, then records the ONE-WAY OUT (parent SMS + student
      // notification fire here at the gate, never before).
      if (verification.payload.kind === 'LEAVE') {
        const { fresh } = leaveQrFreshness(verification.payload, serverNow());
        if (!fresh) {
          setScanResult({
            valid: false,
            isExpired: true,
            message: 'QR expired — ask the student to show the live QR in the app (screenshots or old photos are not accepted). Nothing recorded.',
            payload: verification.payload
          });
          playAudioFeedback(false);
          return;
        }
        // NO NETWORK: check against this phone's downloaded approved list,
        // let the student out once, queue the exit (real scan time) in the
        // outbox — the server re-checks it when the phone is back online.
        const exitOffline = async () => {
          const p = verification.payload;
          const chk = checkLeaveOffline(p, serverNow());
          if (!chk.ok) {
            setScanResult({ valid: false, reasonKind: chk.reasonKind, message: chk.reason, payload: p });
            playAudioFeedback(false);
            return;
          }
          const scannedAt = new Date(serverNow()).toISOString();
          markLeaveUsedLocally(p.leaveId, { state: 'PENDING', scannedAt, rollNo: p.rollNo, name: p.name });
          setLocalLeaveUsed(getUsedLeaves());
          try {
            await queueAction('LEAVE_SCAN', '/api/leave-scan', {
              rollNo: p.rollNo,
              name: p.name,
              leaveId: p.leaveId,
              issuedAt: p.issuedAt,
              qrToken: rawToken.trim(),
              scannedAt,
              offline: true,
              method: 'QR',
              scannedBy: 'Main Gate Guard'
            });
          } catch (qErr) { console.warn('Leave exit could not be queued:', qErr); }
          setGateLogs(prev => [{
            id: `LV-${Date.now()}`,
            passId: `LEAVE-${p.rollNo}`,
            student: `${p.name} (${p.rollNo})`,
            destination: 'Day-scholar leave',
            type: 'LEAVE_OUT',
            time: new Date(scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            ts: new Date(scannedAt).getTime(),
            status: 'OUT (sync pending)',
            verifiedAt: scannedAt
          }, ...prev].slice(0, 10));
          setScanResult({
            valid: true,
            mode: 'leave',
            leave: { outAt: scannedAt, pendingSync: true, parentSms: 'sent when this phone is back online' },
            student: {
              name: p.name,
              rollNo: p.rollNo,
              department: p.department || '',
              course: p.course || '',
              section: p.section || ''
            },
            payload: p
          });
          playAudioFeedback(true);
        };
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          await exitOffline();
          return;
        }
        try {
          const tok = getAccessToken();
          const r = await fetch('/api/leave-scan', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
            body: JSON.stringify({
              rollNo: verification.payload.rollNo,
              name: verification.payload.name,
              leaveId: verification.payload.leaveId,
              issuedAt: verification.payload.issuedAt,
              qrToken: rawToken.trim(),
              method: 'QR',
              scannedBy: 'Main Gate Guard'
            })
          });
          noteServerDate(r);
          const j = await r.json();
          if (j?.success) {
            markLeaveUsedLocally(verification.payload.leaveId, { state: 'SYNCED', scannedAt: j.outAt, rollNo: j.rollNo, name: j.name, online: true });
            setGateLogs(prev => [{
              id: `LV-${Date.now()}`,
              passId: `LEAVE-${j.rollNo}`,
              student: `${j.name} (${j.rollNo})`,
              destination: 'Day-scholar leave',
              type: 'LEAVE_OUT',
              time: new Date(j.outAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              ts: new Date(j.outAt).getTime(),
              status: 'OUT (LEAVE)',
              verifiedAt: j.outAt
            }, ...prev].slice(0, 10));
            setScanResult({
              valid: true,
              mode: 'leave',
              leave: { outAt: j.outAt, reason: j.leaveReason, parentSms: j.parentSms },
              // Identity for the guard to read out — the server's directory
              // row wins over what the student's phone put in the QR.
              student: {
                name: j.name || verification.payload.name,
                rollNo: j.rollNo || verification.payload.rollNo,
                department: j.department || verification.payload.department || '',
                course: j.course || verification.payload.course || '',
                section: j.section || verification.payload.section || ''
              },
              payload: verification.payload
            });
            playAudioFeedback(true);
            window.dispatchEvent(new CustomEvent('campus_leave_updated', { detail: { rollNo: j.rollNo, outAt: j.outAt } }));
          } else {
            setScanResult({
              valid: false,
              reasonKind: j?.expired ? undefined : 'state',
              isExpired: j?.expired || undefined,
              message: j?.reason || j?.error || 'Gate leave-scan rejected',
              payload: verification.payload
            });
            playAudioFeedback(false);
          }
        } catch {
          // Network dropped (request never answered) — same offline check.
          await exitOffline();
        }
        return;
      }

      // Ask the AUTHORITATIVE server for this pass's live state. The state
      // machine (APPROVED -> exit, USED -> return) is decided by the server,
      // not by the guard's possibly-stale local cache.
      let serverState = null;
      try {
        const tok = getAccessToken();
        const lr = await fetch(`/api/pass-lookup?id=${encodeURIComponent(passId)}`,
          tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
        if (lr.ok) {
          const lj = await lr.json();
          if (lj?.success) serverState = lj.pass;
        }
      } catch { /* offline — fall back to the local ledger below */ }

      // Local cache used when the gate device is offline
      let priorScan = null;
      let priorReturn = null;
      try {
        const localPasses = await getAllLocal('gate_passes');
        priorScan = (localPasses || []).find(p => p.id === passId && p.status === 'USED') || null;
        // A completed trip (return already recorded) exists in the local
        // ledger too — a re-scan of such a pass must be a harmless no-op.
        priorReturn = (localPasses || []).find(p => p.id === passId && (p.status === 'RETURNED' || p.gateCheckInStatus === 'CHECKED_IN')) || null;
      } catch (dbErr) {
        console.warn('Local replay check skipped:', dbErr);
      }

      const shouldReturn = serverState ? serverState.returnAllowed : !!priorScan;
      const canExit = serverState ? serverState.exitAllowed : true; // offline + no local USED => exit as before

      // Trip already completed: the return was recorded earlier, so this pass
      // can neither exit NOR return again. Camera scanners frequently fire the
      // same QR a second time within a moment — a duplicate scan must show the
      // same successful readout, not a scary tamper rejection.
      const alreadyReturned = (serverState && String(serverState.status || '').toUpperCase() === 'RETURNED') || !!priorReturn;
      if (alreadyReturned && !shouldReturn) {
        setScanResult({
          valid: true,
          mode: 'return',
          alreadyReturned: true,
          isExpired: verification.isExpired || undefined,
          lateMs: 0,
          payload: verification.payload
        });
        playAudioFeedback(true);
        return;
      }

      if (shouldReturn) {
        // RETURN: the student is coming back into campus with a USED pass.
        // An expired pass MUST still be returnable (the student is outside
        // and cannot be locked out of campus) — the lateness is computed
        // here for the guard's readout and flagged server-side as well.
        const returnedPayload = {
          id: passId,
          ...verification.payload,
          direction: 'RETURN',
          scannedBy: 'Main Gate Guard',
          qrToken: rawToken.trim(),
          qrCheckedAt: new Date(serverNow()).toISOString()
        };
        // Minutes/hours past the pass's expected return window, shown to
        // the guard and echoed in the pass-status update event.
        const lateMs = verification.isExpired && verification.payload?.validUntil
          ? Math.max(0, Date.now() - new Date(verification.payload.validUntil).getTime())
          : 0;
        let registered = false;
        try {
          const tok = getAccessToken();
          const r = await fetch('/api/scan-pass', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
            body: JSON.stringify({ passData: returnedPayload })
          });
          const j = await r.json();
          if (j.success) registered = true;
          else {
            setScanResult({ valid: false, message: j.reason || 'Return rejected by server', payload: verification.payload });
            playAudioFeedback(false);
            return;
          }
        } catch (netErr) {
          // Offline: record locally and queue for auto-sync
          try {
            await saveLocal('gate_passes', { ...returnedPayload, status: 'RETURNED', statusLabel: 'Returned to Campus', gateCheckInStatus: 'CHECKED_IN', returnedAt: new Date().toISOString(), verifiedAt: new Date().toISOString() });
            await queueOfflineAction('SCAN_PASS', { ...returnedPayload, offlineScan: true });
            registered = true; // optimistic offline registration
          } catch (qErr) {
            console.warn('Offline return queue failed:', qErr);
          }
        }
        if (registered) {
          const newLog = {
            id: `LOG-${Math.floor(100 + Math.random() * 900)}`,
            passId,
            student: `${verification.payload.name} (${verification.payload.rollNo})`,
            destination: verification.payload.destination,
            type: lateMs > 0 ? 'LATE_RETURN_GATE' : 'RETURN_GATE',
            time: 'Just now',
            status: 'RETURNED',
            verifiedAt: new Date().toISOString(),
            lateMs
          };
          setGateLogs(prev => [newLog, ...prev].slice(0, 10));
          setScanResult({
            valid: true,
            mode: 'return',
            isExpired: verification.isExpired || undefined,
            lateMs,
            payload: verification.payload
          });
          playAudioFeedback(true);
          window.dispatchEvent(new CustomEvent('campus_gate_pass_updated', { detail: { pass: { id: passId, status: 'RETURNED', lateMs } } }));
        }
        return;
      }

      if (serverState && !canExit) {
        // PENDING/REJECTED/etc — the pass is genuine but simply not
        // exit-eligible right now. This is a STATE rejection, never tamper.
        setScanResult({
          valid: false,
          reasonKind: 'state',
          message: serverState.status === 'PENDING'
            ? 'Warden approval still pending — pass is not valid at the gate yet.'
            : 'This pass cannot be used for exit in its current state.',
          payload: verification.payload
        });
        playAudioFeedback(false);
        return;
      }

      // EXIT leg only: an expired pass must never take a student OUT of
      // campus (returns stay always-allowed — see the RETURN branch above).
      if (verification.isExpired) {
        setScanResult({
          valid: false,
          isExpired: true,
          payload: verification.payload,
          message: `Pass expired at ${new Date(verification.payload.validUntil).toLocaleTimeString()}`
        });
        playAudioFeedback(false);
        return;
      }

      // EXIT flow (existing behavior): mark USED, log locally + server
      const newLog = {
        id: `LOG-${Math.floor(100 + Math.random() * 900)}`,
        passId: verification.payload.passId,
        student: `${verification.payload.name} (${verification.payload.rollNo})`,
        destination: verification.payload.destination,
        type: 'EXIT_GATE',
        time: 'Just now',
        status: 'VERIFIED',
        verifiedAt: new Date().toISOString()
      };
      setGateLogs(prev => [newLog, ...prev].slice(0, 10));
      
      try {
        const updatedPassData = {
          id: verification.payload.passId || newLog.id,
          ...verification.payload,
          gateCheckInStatus: 'CHECKED_OUT',
          verifiedAt: newLog.verifiedAt,
          status: 'USED',
          statusLabel: 'Scanned at Main Gate (Expired)',
          scannedBy: 'Main Gate Guard',
          qrToken: rawToken.trim(),
          qrCheckedAt: new Date(serverNow()).toISOString()
        };

        await saveLocal('gate_passes', updatedPassData);

        // Sync scan status to backend server so other devices (e.g. laptop) update in real-time
        try {
          const tok = getAccessToken();
          const er = await fetch('/api/scan-pass', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
            body: JSON.stringify({ passData: updatedPassData })
          });
          // Fix 5: the server re-checks the QR signature; show its refusal.
          if (er.status === 403) {
            const ej = await er.json().catch(() => null);
            if (ej?.qrRejected) {
              setGateLogs(prev => prev.filter(l => l !== newLog));
              setScanResult({ valid: false, isExpired: ej.expired || undefined, message: ej.reason || 'QR refused by the server', payload: verification.payload });
              playAudioFeedback(false);
              return;
            }
          }
        } catch (netErr) {
          console.warn('Offline: scan saved locally & queued for auto-sync:', netErr);
          // Queue the scan so it reaches the server the moment connectivity returns
          try {
            await queueOfflineAction('SCAN_PASS', { ...updatedPassData, offlineScan: true });
          } catch (qErr) {
            console.warn('Outbox queue failed:', qErr);
          }
        }

        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('campus_gate_pass_updated', {
            detail: { pass: updatedPassData }
          }));
        }
      } catch (err) {
        console.warn('Failed to save gate log to IndexedDB:', err);
      }
    }
  };

  // Keypad-phone path: the student speaks their GP number, the guard looks it
  // up and gets the AUTHORITATIVE server state, then registers Exit / Return.
  const handleManualLookup = async () => {
    if (!manualInput.trim() || manualBusy) return;
    setManualBusy(true);
    try {
      const tok = getAccessToken();
      const r = await fetch('/api/pass-lookup?id=' + encodeURIComponent(manualInput.trim()),
        tok ? { headers: { Authorization: `Bearer ${tok}` } } : undefined);
      const j = await r.json();
      if (r.ok && j?.success && j.pass) {
        const p = j.pass;
        setScanResult({
          valid: p.exitAllowed || p.returnAllowed,
          pendingAction: p.exitAllowed || p.returnAllowed,
          exitAllowed: p.exitAllowed,
          returnAllowed: p.returnAllowed,
          statusLabel: p.statusLabel,
          payload: {
            passId: p.id,
            name: p.name,
            rollNo: p.rollNo,
            destination: p.destination,
            passType: p.passType,
            reason: p.reason || '',
            validUntil: p.validUntil || new Date().toISOString()
          },
          message: !(p.exitAllowed || p.returnAllowed)
            ? (p.status === 'PENDING'
              ? 'Warden approval still pending — this pass is not valid at the gate yet.'
              : 'Round trip already completed — this pass is closed.')
            : null
        });
        playAudioFeedback(p.exitAllowed || p.returnAllowed);
        setManualInput('');
      } else {
        setScanResult({ valid: false, message: j?.error || 'No pass found with that number', payload: null });
        playAudioFeedback(false);
      }
    } catch (err) {
      setScanResult({ valid: false, message: 'Server unreachable — manual lookup needs connectivity.', payload: null });
      playAudioFeedback(false);
    } finally {
      setManualBusy(false);
    }
  };

  // Register the chosen direction (EXIT or RETURN) for manual-entry passes.
  const executeGateAction = async (direction, pass) => {
    if (manualBusy) return;
    // Gate policy parity with QR scans: an expired pass must never take a
    // student OUT of campus (a RETURN is always allowed and gets flagged
    // LATE instead).
    if (direction === 'EXIT' && pass?.validUntil && Date.now() > new Date(pass.validUntil).getTime()) {
      setScanResult({
        valid: false,
        isExpired: true,
        payload: pass,
        message: `Pass expired at ${new Date(pass.validUntil).toLocaleTimeString()} — cannot permit exit.`
      });
      playAudioFeedback(false);
      return;
    }
    setManualBusy(true);
    try {
      const tok = getAccessToken();
      const passData = {
        id: pass.passId,
        name: pass.name,
        rollNo: pass.rollNo,
        destination: pass.destination,
        passType: pass.passType,
        reason: pass.reason,
        validUntil: pass.validUntil,
        direction,
        scannedBy: 'Main Gate Guard'
      };
      const r = await fetch('/api/scan-pass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
        body: JSON.stringify({ passData })
      });
      const j = await r.json();
      if (j?.success) {
        // Late-return readout for keypad entries too: if the return happened
        // after the pass window, compute the gap for the guard's card.
        const lateMs = direction === 'RETURN' && pass.validUntil
          ? Math.max(0, Date.now() - new Date(pass.validUntil).getTime())
          : 0;
        setGateLogs(prev => [{
          id: `LOG-${Math.floor(100 + Math.random() * 900)}`,
          passId: pass.passId,
          student: `${pass.name} (${pass.rollNo})`,
          destination: pass.destination,
          type: direction === 'RETURN' ? (lateMs > 0 ? 'LATE_RETURN_GATE' : 'RETURN_GATE') : 'EXIT_GATE',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: direction === 'RETURN' ? 'RETURNED' : 'VERIFIED',
          verifiedAt: j.verifiedAt,
          lateMs
        }, ...prev].slice(0, 10));
        try {
          await saveLocal('gate_passes', { ...passData, status: j.status, statusLabel: direction === 'RETURN' ? 'Returned to Campus' : 'Scanned at Main Gate (Expired)', verifiedAt: j.verifiedAt, gateCheckInStatus: direction === 'RETURN' ? 'CHECKED_IN' : 'CHECKED_OUT' });
        } catch (dbErr) { console.warn('local save failed:', dbErr); }
        window.dispatchEvent(new CustomEvent('campus_gate_pass_updated', { detail: { pass: { id: pass.passId, status: j.status, lateMs } } }));
        setScanResult({ valid: true, mode: direction === 'RETURN' ? 'return' : 'exit', lateMs, isExpired: lateMs > 0 || undefined, payload: pass });
        playAudioFeedback(true);
      } else {
        setScanResult({ valid: false, message: j?.reason || j?.error || 'Gate action rejected', payload: pass });
        playAudioFeedback(false);
      }
    } catch (netErr) {
      // Offline fallback: register locally and queue for sync
      try {
        await saveLocal('gate_passes', { ...passDataFixes(pass, direction), status: direction === 'RETURN' ? 'RETURNED' : 'USED', statusLabel: direction === 'RETURN' ? 'Returned to Campus' : 'Scanned at Main Gate (Expired)', verifiedAt: new Date().toISOString(), gateCheckInStatus: direction === 'RETURN' ? 'CHECKED_IN' : 'CHECKED_OUT' });
        await queueOfflineAction('SCAN_PASS', passDataFixes(pass, direction));
        setScanResult({ valid: true, mode: direction === 'RETURN' ? 'return' : 'exit', offline: true, payload: pass });
        playAudioFeedback(true);
      } catch (qErr) {
        setScanResult({ valid: false, message: 'Failed to register gate action (offline).', payload: pass });
        playAudioFeedback(false);
      }
    } finally {
      setManualBusy(false);
    }
  };

  const passDataFixes = (pass, direction) => ({
    id: pass.passId,
    name: pass.name,
    rollNo: pass.rollNo,
    destination: pass.destination,
    passType: pass.passType,
    reason: pass.reason,
    validUntil: pass.validUntil,
    direction,
    scannedBy: 'Main Gate Guard'
  });

  const filteredGateLogs = gateLogs.filter(log => {
    if (!searchQuery || typeof searchQuery !== 'string') return true;
    const q = (searchQuery || '').toLowerCase();
    return (
      ((log?.student || '').toLowerCase().includes(q)) ||
      ((log?.destination || '').toLowerCase().includes(q)) ||
      ((log?.passId || '').toLowerCase().includes(q))
    );
  });

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      
      {/* Guard Security Header Overview - 3D Colorful Card */}
      <section className="bg-gradient-to-br from-[#edf9f5] via-white to-[#e0f5ed] border-2 border-[#86efac] rounded-2xl sm:rounded-3xl p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-[0_8px_24px_rgba(16,185,129,0.12)]">
        <div className="flex items-center space-x-3.5">
          <div className="w-12 h-12 rounded-2xl bg-emerald-100 border-2 border-emerald-400 text-emerald-800 flex items-center justify-center shrink-0 shadow-sm">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-base sm:text-lg font-extrabold text-slate-900 tracking-tight">
                Main Gate Offline QR Verifier
              </h2>
              <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-emerald-200 text-emerald-900 font-bold border border-emerald-400">
                100% OFFLINE
              </span>
            </div>
            <p className="text-xs text-slate-600 mt-0.5 font-medium">
              Signed QR (Ed25519) • Secure offline gate verification
            </p>
          </div>
        </div>

      </section>

      {/* Main Scanner & Verification Output Grid Container with Equal Heights */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-stretch">
        
        {/* Left Column: Scanner View / Manual Tester */}
        <div className="bg-white border-2 border-slate-300 rounded-2xl p-4 sm:p-5 flex flex-col justify-between space-y-4 h-full shadow-[0_6px_20px_rgba(0,0,0,0.06)]">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b-2 border-slate-100 pb-2">
              <h3 className="text-xs sm:text-sm font-mono uppercase tracking-wider text-slate-700 font-extrabold flex items-center space-x-2">
                <QrCode className="w-4 h-4 text-emerald-600" />
                <span>Camera Stream & Pass Number</span>
              </h3>
              {isScanning && (
                <span className="flex items-center space-x-1.5 text-xs font-mono text-emerald-600 font-bold">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
                  <span>LIVE</span>
                </span>
              )}
            </div>

            {/* Camera Viewport & Centered Standby Box */}
            <div className="relative bg-slate-50 border-2 border-slate-200 rounded-xl overflow-hidden min-h-[240px] flex flex-col items-center justify-center text-center p-4">
              <div id="guard-reader" className="w-full max-w-[280px]"></div>

              {isScanning && (
                <button
                  type="button"
                  onClick={stopCamera}
                  className="mt-3 min-h-[44px] px-4 py-2.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer shadow-sm"
                >
                  <CameraOff className="w-3.5 h-3.5" />
                  <span>Stop Scanner</span>
                </button>
              )}

              {!isScanning && (
                <div className="flex flex-col items-center justify-center text-center p-4 sm:p-6 space-y-3 w-full max-w-sm">
                  <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-emerald-600 shadow-sm">
                    <Camera className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-900">
                      Guard Camera Scanner
                    </h4>
                    <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                      Point camera at student QR code for automatic offline verification.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={startCamera}
                    className="mt-1 min-h-[44px] px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs flex items-center justify-center space-x-1.5 transition-all cursor-pointer shadow-sm"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Activate Guard Camera</span>
                  </button>

                  {cameraError && (
                    <p className="text-[11px] text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200 w-full mt-2">
                      {cameraError}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Keypad-phone manual pass entry — student speaks their GP number */}
          <div className="pt-3 border-t border-slate-100 space-y-2">
            <label className="block text-[11px] text-slate-500 font-mono uppercase tracking-wider font-semibold">
              Keypad-Phone Pass Entry
            </label>
            <p className="text-[10px] text-slate-500 leading-relaxed">
              Student reads out the pass number from their approval SMS. The server state decides whether this is an Exit or a Return.
            </p>
            <div className="flex space-x-2">
              <input
                type="text"
                value={manualInput}
                onChange={(e) => setManualInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleManualLookup(); } }}
                placeholder="e.g. GP-984163"
                className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono font-bold tracking-wide text-slate-800 uppercase focus:outline-none focus:border-emerald-600"
              />
              <button
                type="button"
                onClick={handleManualLookup}
                disabled={manualBusy || !manualInput.trim()}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold transition-colors cursor-pointer shrink-0 shadow-sm disabled:opacity-50"
              >
                {manualBusy ? '…' : 'Fetch Pass'}
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Verification Result Card */}
        <div className="bg-white border-2 border-slate-300 rounded-2xl p-4 sm:p-5 flex flex-col justify-between space-y-4 h-full shadow-[0_6px_20px_rgba(0,0,0,0.06)]">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b-2 border-slate-100 pb-2">
              <h3 className="text-xs sm:text-sm font-mono uppercase tracking-wider text-slate-700 font-extrabold flex items-center space-x-2">
                <FileCheck className="w-4 h-4 text-emerald-600" />
                <span>Cryptographic Verification Output</span>
              </h3>
              {scanResult && (
                <span className={`text-xs font-mono px-2.5 py-1 rounded font-extrabold border-2 ${
                  scanResult.valid 
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-300' 
                    : 'bg-rose-50 text-rose-800 border-rose-300'
                }`}>
                  {scanResult.valid ? 'PASSED' : 'REJECTED'}
                </span>
              )}
            </div>

            {!scanResult ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center flex flex-col items-center justify-center space-y-3 min-h-[240px]">
                <div className="w-12 h-12 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-400 shadow-sm">
                  <ShieldCheck className="w-6 h-6 text-slate-500" />
                </div>
                <div className="max-w-xs">
                  <h4 className="text-sm font-bold text-slate-800">
                    Awaiting Gate Pass Scan
                  </h4>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Scan a student's QR code or enter the pass number.
                  </p>
                </div>
              </div>
            ) : scanResult.valid ? (
              /* --- GREEN BANNER: VALID PASS --- */
              <div className="bg-emerald-50/50 border-2 border-emerald-500 rounded-xl p-4 sm:p-5 space-y-3.5 shadow-sm relative overflow-hidden animate-in zoom-in-95 duration-150">
                {/* Valid Ribbon */}
                <div className="flex items-center space-x-2 bg-emerald-600 text-white px-3 py-1.5 rounded-lg font-mono text-xs font-bold tracking-wider">
                  <CheckCircle2 className="w-4 h-4" />
                  <span>
                    {scanResult.pendingAction
                      ? 'PASS FOUND — CONFIRM GATE ACTION'
                      : scanResult.mode === 'return'
                        ? (scanResult.alreadyReturned
                            ? 'TRIP COMPLETED — RETURN ALREADY RECORDED ✓'
                            : (scanResult.lateMs > 0 ? 'LATE RETURN REGISTERED — ENTRY ALLOWED ⏰' : 'RETURN TO CAMPUS REGISTERED ✓'))
                        : scanResult.mode === 'exit'
                          ? 'CAMPUS EXIT REGISTERED ✓'
                          : scanResult.mode === 'leave'
                            ? (scanResult.leave?.pendingSync
                                ? 'OFFLINE — EXITED (SYNC PENDING) ✓'
                                : 'LEAVE EXIT REGISTERED — STUDENT IS OUT ✓')
                            : 'CRYPTOGRAPHICALLY VALID PASS'}
                  </span>
                </div>

                {/* Duplicate scan of a completed trip: nothing was registered
                    again — tell the guard plainly instead of alarming them. */}
                {scanResult.mode === 'return' && scanResult.alreadyReturned && (
                  <div className="p-3 bg-sky-50 border border-sky-300 rounded-lg text-xs text-sky-800 leading-relaxed">
                    <strong className="font-extrabold">✓ Trip already completed.</strong> This QR was scanned again after the return was recorded — no new gate record was created, and the pass signature is intact (no tampering).
                  </div>
                )}

                {/* Day-scholar leave readout: one-way OUT — no return leg. */}
                {scanResult.mode === 'leave' && scanResult.leave && (
                  <div className="p-3 border rounded-lg text-xs leading-relaxed bg-amber-50 border-amber-300 text-amber-800">
                    <strong className="font-extrabold font-mono text-[11px] block tracking-wider">⬆ ONE-WAY LEAVE — OUT OF CAMPUS</strong>
                    Exit scanned at {new Date(scanResult.leave.outAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                    {scanResult.leave.pendingSync && (
                      <span data-testid="leave-sync-pending" className="block font-bold">Exited (sync pending) — checked offline on this phone; it is sent to the server as soon as the network is back.</span>
                    )}
                    {scanResult.leave.synced && (
                      <span data-testid="leave-synced" className="block font-bold">Synced ✓ — the server recorded this exit.</span>
                    )}
                    No return scan today — the student is expected back on the <strong>next working day</strong>. Parent SMS: {scanResult.leave.parentSms}.
                  </div>
                )}

                {/* Late-return notice: the student came home after the pass
                    window — entry is ALWAYS allowed, the lateness is what
                    gets flagged to the warden/admin register. */}
                {scanResult.mode === 'return' && scanResult.lateMs > 0 && (
                  <div className="p-3 bg-amber-50 border border-amber-300 rounded-lg text-xs text-amber-800 leading-relaxed">
                    <strong className="font-extrabold">⏰ Late by {(() => {
                      const mins = Math.floor(scanResult.lateMs / 60000);
                      return mins >= 60
                        ? `${Math.floor(mins / 60)}h ${mins % 60}m`
                        : `${mins}m`;
                    })()}</strong> — returned after the pass window closed
                    {' '}({new Date(scanResult.payload.validUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}).
                    Entry permitted; this return is flagged LATE in the gate register for the warden.
                  </div>
                )}

                {/* Student Photo & Details */}
                <div className="flex items-center space-x-3.5 pt-1">
                  <div className="w-12 h-12 rounded-xl bg-emerald-600 flex items-center justify-center text-white font-bold text-lg font-mono shadow-sm">
                    {scanResult.payload.name ? scanResult.payload.name.charAt(0) : 'S'}
                  </div>
                  <div className="min-w-0">
                    <h4 className={`${scanResult.mode === 'leave' ? 'text-lg sm:text-xl break-words' : 'text-base'} font-bold text-slate-900 leading-tight`}>
                      {(scanResult.mode === 'leave' && scanResult.student?.name) || scanResult.payload.name}
                    </h4>
                    <span className={`${scanResult.mode === 'leave' ? 'text-sm' : 'text-xs'} font-mono text-emerald-700 font-semibold`}>
                      Roll No: {(scanResult.mode === 'leave' && scanResult.student?.rollNo) || scanResult.payload.rollNo}
                    </span>
                    <span className="text-[11px] text-slate-500 block font-mono">
                      Pass ID: {scanResult.payload.passId}
                    </span>
                  </div>
                </div>

                {/* Day-scholar leave: branch / department / course for the
                    guard to match the student (no photo by design). */}
                {scanResult.mode === 'leave' && scanResult.student && (
                  <div data-testid="leave-student-details" className="grid grid-cols-2 gap-2 pt-2 border-t border-emerald-200">
                    <div className="col-span-2 bg-white p-2.5 rounded-lg border border-emerald-100 min-w-0">
                      <span className="text-[10px] font-mono text-slate-500 block">Branch / Department</span>
                      <span className="text-base font-extrabold text-slate-900 block leading-snug break-words">
                        {scanResult.student.department || '—'}
                      </span>
                    </div>
                    <div className="bg-white p-2.5 rounded-lg border border-emerald-100 min-w-0">
                      <span className="text-[10px] font-mono text-slate-500 block">Course</span>
                      <span className="text-sm font-bold text-slate-900 block break-words">{scanResult.student.course || '—'}</span>
                    </div>
                    <div className="bg-white p-2.5 rounded-lg border border-emerald-100 min-w-0">
                      <span className="text-[10px] font-mono text-slate-500 block">Section</span>
                      <span className="text-sm font-bold text-slate-900 block break-words">{scanResult.student.section || '—'}</span>
                    </div>
                  </div>
                )}

                {/* Destination & Expiry Grid — pass-only fields; leave IDs carry neither */}
                {scanResult.mode !== 'leave' && (
                <>
                  <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-2 border-t border-emerald-200">
                    <div className="bg-white p-2.5 rounded-lg border border-emerald-100">
                      <span className="text-[10px] text-slate-500 block">Destination</span>
                      <span className="font-bold text-slate-800 block truncate">
                        {scanResult.payload.destination}
                      </span>
                    </div>

                    <div className="bg-white p-2.5 rounded-lg border border-emerald-100">
                      <span className="text-[10px] text-slate-500 block">Return Deadline</span>
                      <span className="font-bold text-amber-700 block">
                        {new Date(scanResult.payload.validUntil).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>

                  {/* Reason */}
                  <div className="text-xs text-slate-700 italic bg-white p-2 rounded-lg border border-emerald-100">
                    "{scanResult.payload.reason}"
                  </div>
                </>
                )}

                {/* Security Gate In/Out Log Action */}
                <div className="flex items-center space-x-2 pt-1">
                  {scanResult.pendingAction ? (
                    <>
                      {scanResult.exitAllowed && (
                        <button
                          onClick={() => executeGateAction('EXIT', scanResult.payload)}
                          disabled={manualBusy}
                          className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs transition-all cursor-pointer flex items-center justify-center space-x-1.5 shadow-sm disabled:opacity-50"
                        >
                          <LogOut className="w-3.5 h-3.5" />
                          <span>Register Campus Exit</span>
                        </button>
                      )}
                      {scanResult.returnAllowed && (
                        <button
                          onClick={() => executeGateAction('RETURN', scanResult.payload)}
                          disabled={manualBusy}
                          className="flex-1 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs transition-all cursor-pointer flex items-center justify-center space-x-1.5 shadow-sm disabled:opacity-50"
                        >
                          <LogIn className="w-3.5 h-3.5" />
                          <span>Register Return to Campus</span>
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      onClick={() => setScanResult(null)}
                      className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs transition-all cursor-pointer flex items-center justify-center space-x-1.5 shadow-sm"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>{scanResult.mode === 'return' ? 'Next Student' : 'Authorize Student Exit'}</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              /* --- RED BANNER: INVALID / TAMPERED PASS --- */
              <div className="bg-rose-50 border-2 border-rose-500 rounded-xl p-4 sm:p-5 space-y-3.5 shadow-sm animate-in zoom-in-95 duration-150">
                <div className="flex items-center space-x-2 bg-rose-600 text-white px-3 py-1.5 rounded-lg font-mono text-xs font-bold tracking-wider">
                  <ShieldAlert className="w-4 h-4" />
                  <span>ACCESS DENIED — {scanResult.isExpired ? 'PASS EXPIRED' : scanResult.reasonKind === 'state' ? 'PASS NOT USABLE FOR EXIT' : 'SECURITY TAMPER DETECTED'}</span>
                </div>

                <div className="p-3 bg-white border border-rose-200 rounded-lg text-xs text-rose-800 leading-relaxed font-mono">
                  🚨 {scanResult.message}
                </div>

                <p className="text-xs text-slate-600 leading-relaxed">
                  {scanResult.reasonKind === 'state'
                    ? 'The QR signature is authentic, but this pass is not authorised for exit right now (approval pending, rejected, or the trip is already completed). Do not permit student exit.'
                    : 'The digital signature does not match the campus cryptographic seed or the allowed time window has elapsed. Do not permit student exit.'}
                </p>

                <button
                  onClick={() => setScanResult(null)}
                  className="w-full py-2.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white font-medium text-xs transition-colors cursor-pointer shadow-sm"
                >
                  Clear & Scan Next Student
                </button>
              </div>
            )}
          </div>

          {/* Quick Clear */}
          {scanResult && (
            <div className="pt-2 text-right">
              <button
                onClick={() => setScanResult(null)}
                className="text-xs text-slate-500 hover:text-slate-800 underline cursor-pointer"
              >
                Reset Verification Card
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Offline Gate Logs Table */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-600" />
            <span>Today's Offline Gate Movement Log</span>
          </h3>
          <span className="text-xs font-mono text-slate-500">
            {gateLogs.length} Verified Records
          </span>
        </div>

        <div className="space-y-2">
          {filteredGateLogs.map((log) => (
            <div
              key={log.id}
              className="bg-slate-50/70 border border-slate-200/80 rounded-2xl p-3.5 flex items-center justify-between gap-3 text-xs font-mono hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center space-x-3">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  log.type === 'EXIT_GATE' || log.type === 'LEAVE_OUT' ? 'bg-sky-50 text-sky-700 border border-sky-200' : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                }`}>
                  {log.type === 'LEAVE_OUT' ? 'LEAVE' : log.type === 'EXIT_GATE' ? 'OUT' : 'IN'}
                </span>
                <div>
                  <span className="font-bold text-slate-900">{log.student}</span>
                  <span className="text-slate-500 block text-[11px] font-sans">
                    Destination: {log.destination} • {log.passId}
                  </span>
                </div>
              </div>

              <div className="text-right">
                <span className="text-emerald-700 font-semibold block text-[11px]">
                  ✓ {log.status}
                </span>
                <span className="text-slate-500 text-[10px]">
                  {log.time}
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* DAY-SCHOLAR LEAVE LOG — mentor-approved one-way gate exits */}
      <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-600" />
            <span>Day-Scholar Leave Log</span>
          </h3>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-mono font-bold text-amber-800 bg-amber-100 border border-amber-200 px-2.5 py-1 rounded-full">
              {leaveStats.outsToday} Left Today (Leave)
            </span>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          A day scholar leaves ONLY on a mentor-APPROVED leave: scan their Campus-QR once — the exit is recorded as a
          one-way OUT, the parent is SMSed, and no return scan happens today. No approved leave → the red NOT APPROVED
          card, nothing recorded.
        </p>

        {(() => {
          const start = new Date(); start.setHours(0, 0, 0, 0);
          const todays = (leaveRows || [])
            .filter(x => x.scanned_at && new Date(x.scanned_at) >= start);
          // Exits this phone let out OFFLINE that the server list doesn't show yet.
          const serverRolls = new Set(todays.map(x => String(x.student_roll || '').toLowerCase()));
          const offlineRows = Object.entries(localLeaveUsed || {})
            .map(([leaveId, v]) => ({ leaveId, ...v }))
            .filter(v => !v.online && v.scannedAt && new Date(v.scannedAt) >= start)
            .filter(v => !(v.state === 'SYNCED' && serverRolls.has(String(v.rollNo || '').toLowerCase())))
            .sort((a, b) => Date.parse(b.scannedAt) - Date.parse(a.scannedAt));
          if (todays.length === 0 && offlineRows.length === 0) {
            return (
              <div className="py-6 text-center text-xs text-slate-500 space-y-1">
                <Users className="w-7 h-7 text-slate-300 mx-auto" />
                <p className="font-semibold text-slate-600">No leave exits today yet</p>
                <p className="text-[11px]">Entries appear when a day scholar shows their Campus-QR on an approved leave.</p>
              </div>
            );
          }
          return (
            <div className="space-y-2">
              {offlineRows.map(row => (
                <div key={`off-${row.leaveId}`} data-testid="offline-leave-row" className={`border rounded-2xl p-3 flex items-center justify-between gap-3 text-xs font-mono ${row.state === 'CONFLICT' || row.state === 'REFUSED' ? 'bg-red-50/70 border-red-200' : 'bg-amber-50/70 border-amber-200'}`}>
                  <div className="flex items-center space-x-3 min-w-0">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold border shrink-0 ${row.state === 'CONFLICT' || row.state === 'REFUSED' ? 'bg-red-100 text-red-700 border-red-200' : row.state === 'SYNCED' ? 'bg-sky-50 text-sky-700 border-sky-200' : 'bg-amber-100 text-amber-800 border-amber-200'}`}>
                      {row.state === 'CONFLICT' ? 'DOUBLE USE' : row.state === 'REFUSED' ? 'REFUSED AT SYNC' : row.state === 'SYNCED' ? 'OUT (SYNCED)' : 'OUT (SYNC PENDING)'}
                    </span>
                    <div className="min-w-0">
                      <span className="font-bold text-slate-900">{row.name || 'Student'}</span>
                      <span className="text-slate-500 block text-[11px] font-sans break-words">
                        {row.rollNo || '—'} • {row.state === 'CONFLICT'
                          ? `Already exited at another gate${row.firstOutAt ? ` at ${new Date(row.firstOutAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''} — flagged for warden`
                          : row.state === 'REFUSED' ? (row.reason || 'Refused by server') : 'Offline leave exit'}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-slate-500 text-[10px] block">this phone</span>
                    <span className="text-slate-700 font-bold text-[11px]">
                      {new Date(row.scannedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
              {todays.map(row => (
                <div key={row.id} className="bg-slate-50/70 border border-slate-200/80 rounded-2xl p-3 flex items-center justify-between gap-3 text-xs font-mono">
                  <div className="flex items-center space-x-3">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-50 text-sky-700 border border-sky-200">
                      OUT (LEAVE)
                    </span>
                    <div>
                      <span className="font-bold text-slate-900">{row.student_name}</span>
                      <span className="text-slate-500 block text-[11px] font-sans">
                        {row.student_roll || '—'} • City leave exit
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-slate-500 text-[10px] block">by {row.scanned_by || 'Guard'}</span>
                    <span className="text-slate-700 font-bold text-[11px]">
                      {new Date(row.scanned_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}
      </section>

    </div>
  );
}

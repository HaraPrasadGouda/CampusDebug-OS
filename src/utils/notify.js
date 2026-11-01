// CampusDebug OS — Notification Layer (push-to-phone for PWA users)
// ---------------------------------------------------------------------
// For students/staff who signed in (i.e. have a device running this PWA),
// /api/notices is polled and NEW notices raise real system notifications
// via the ServiceWorker (visible over the HTTPS devtunnel even when the
// app is in the background).
//
// Unactivated students (never logged in — e.g. keypad-phone owners) never
// run this file — the SERVER routes their copy of every critical event
// through the SMS gateway instead (see dispatchSms in server.js). That
// split is the delivery matrix:
//   activated + PWA open        → system notification (here)
//   activated + app in background → system notification via SW polling
//   unactivated                 → real SMS from the gateway SIM (server)
// ---------------------------------------------------------------------
import { getStoredProfile } from './authClient';

const SEEN_KEY = 'campusdebug_last_seen_notices';
const POLL_INTERVAL = 20000; // 20s — cheap, honest, catches notice dispatch fast

let pollingTimer = null;
let visibilityHandler = null;
let inFlight = false;

function readSeenMap() {
    try {
        return JSON.parse(localStorage.getItem(SEEN_KEY)) || {};
    } catch {
        return {};
    }
}

function writeSeenMap(map) {
    try {
        localStorage.setItem(SEEN_KEY, JSON.stringify(map));
    } catch { /* storage full — non-fatal */ }
}

// ---- Web Push (VAPID) subscription ---------------------------------
// Polling alone is throttled/suspended when the tab is not foregrounded
// on mobile. A real push subscription lets the SERVER wake the service
// worker even when the app is closed. Falls back gracefully: if the
// subscription fails (older browser, iOS quirks), in-page polling keeps
// the experience functional while the PWA is open.
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
    return output;
}

async function ensureWebPushSubscription(profile) {
    try {
        // User turned the toggle OFF in Settings — never silently re-subscribe
        // from polling/visibility events (that would make the toggle lie).
        if (isPushOptedOut()) {
            return { ok: false, message: 'Background alerts are turned OFF in Settings' };
        }
        if (!('serviceWorker' in navigator)) {
            return { ok: false, message: 'Service Worker unsupported in this browser' };
        }
        if (!('PushManager' in window)) {
            return { ok: false, message: 'Web Push unsupported in this browser' };
        }

        // Permission gate (prompt happens here on first/fresh install)
        let perm = Notification.permission;
        if (perm === 'default') perm = await Notification.requestPermission();
        if (perm !== 'granted') {
            return { ok: false, message: `Notifications permission is ${perm} — allow them in browser/site settings` };
        }

        const keyRes = await fetch('/api/push/public-key', { cache: 'no-store' });
        if (!keyRes.ok) return { ok: false, message: `Server key unreachable (HTTP ${keyRes.status})` };
        const { publicKey } = await keyRes.json();
        if (!publicKey) return { ok: false, message: 'Server has no VAPID public key configured' };

        const registration = await navigator.serviceWorker.ready;
        if (!registration.pushManager) {
            return { ok: false, message: 'Push manager not exposed by this service worker version' };
        }

        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(publicKey)
            });
        }

        const roll = profile?.rollNumber || profile?.identity;
        const res = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rollNumber: roll, subscription: subscription.toJSON() })
        });
        if (res.ok) {
            console.log('[notify] background Web Push subscription active' + (roll ? ` (roll ${roll})` : ''));
            // Re-enabling from Settings clears any prior opt-out so polling
            // and visibility events keep the subscription healthy again.
            setPushOptedOut(false);
            return { ok: true, message: roll ? `Background alerts ON — roll ${roll}` : 'Background alerts ON' };
        }
        return { ok: false, message: `Subscription rejected by server (HTTP ${res.status})` };
    } catch (err) {
        // LOUD on purpose: a silent failure here is why "no notification on
        // the phone" is hard to diagnose — visibility into this path matters.
        console.warn('[notify] Background push subscription FAILED (polling fallback active):', err);
        return { ok: false, message: `Subscription failed: ${err && err.name ? err.name : 'Error'}${err && err.message ? ' — ' + err.message : ''}` };
    }
}

// Re-exposed for Settings — runs the same flow on demand and reports keys to the UI.
export async function enableBackgroundAlerts() {
    try {
        const { getStoredProfile } = await import('./authClient');
        return await ensureWebPushSubscription(getStoredProfile());
    } catch (err) {
        return { ok: false, message: `Unexpected failure: ${err.message}` };
    }
}

// ---- Settings toggle helpers ------------------------------------------
// Device-local detection: the toggle must reflect THIS device's true state
// (permission + an actual push subscription) without touching the server.
const PUSH_OPTOUT_KEY = 'campusdebug_push_optout';

function isPushOptedOut() {
    try { return localStorage.getItem(PUSH_OPTOUT_KEY) === '1'; } catch { return false; }
}

function setPushOptedOut(val) {
    try {
        if (val) localStorage.setItem(PUSH_OPTOUT_KEY, '1');
        else localStorage.removeItem(PUSH_OPTOUT_KEY);
    } catch { /* storage unavailable — session-only behavior */ }
}

export async function checkBackgroundAlertsEnabled() {
    try {
        if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
            return { enabled: false, permission: 'unsupported' };
        }
        const permission = ('Notification' in window) ? Notification.permission : 'unsupported';
        if (permission !== 'granted') return { enabled: false, permission };
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg?.pushManager ? await reg.pushManager.getSubscription() : null;
        // An opt-out flag without an active subscription still counts as OFF —
        // visibility auto-resubscribe is suppressed, so it stays off.
        return { enabled: !!sub && !isPushOptedOut(), permission };
    } catch {
        return { enabled: false, permission: 'unknown' };
    }
}

export async function disableBackgroundAlerts() {
    try {
        if (!('serviceWorker' in navigator)) {
            return { ok: false, message: 'Service Worker unsupported in this browser' };
        }
        // Opt-out first so visibility/polling events can't re-subscribe behind
        // the user's back, then drop the browser-side subscription.
        setPushOptedOut(true);
        const reg = await navigator.serviceWorker.getRegistration();
        const sub = reg?.pushManager ? await reg.pushManager.getSubscription() : null;
        if (!sub) return { ok: true, message: 'Background alerts turned OFF' };
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        try {
            await fetch('/api/push/unsubscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ endpoint })
            });
        } catch { /* offline — device is unsubscribed locally anyway; the
                     server prunes dead endpoints on the next dispatch (410) */ }
        return { ok: true, message: 'Background alerts turned OFF — no pushes on this device' };
    } catch (err) {
        return { ok: false, message: `Could not turn off: ${err.message}` };
    }
}

export async function requestNotificationPermission() {
    try {
        if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
        if (window.Notification && Notification.permission === 'default') {
            return await Notification.requestPermission();
        }
        return Notification.permission;
    } catch {
        return 'denied';
    }
}

async function showSystemNotification(title, body) {
    try {
        const reg = await navigator.serviceWorker?.getRegistration?.();
        if (reg && typeof reg.showNotification === 'function') {
            await reg.showNotification(title, {
                body,
                icon: '/brand_icon_128.png',
                badge: '/brand_icon_sm.png',
                tag: 'campusdebug-notice'
            });
            return true;
        }
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification(title, { body, icon: '/brand_icon_128.png' });
            return true;
        }
    } catch (err) {
        console.debug('[notify] system notification failed (app stays usable):', err.message);
    }
    return false;
}

async function checkForNewNotices() {
    if (inFlight) return;
    const profile = getStoredProfile();
    if (!profile) return; // not signed in → nothing to route
    inFlight = true;
    try {
        const res = await fetch('/api/notices', { cache: 'no-store' });
        if (!res.ok) return;
        const data = await res.json();
        const notices = Array.isArray(data?.notices) ? data.notices : [];
        if (!notices.length) return;

        const key = profile?.rollNumber || profile?.identity || 'global';
        const seen = readSeenMap();
        let threshold = seen[key] || 0;

        // First poll after a fresh login: only remember the newest, so the
        // student isn't spammed with historical notices on re-login.
        if (!seen[key] && notices.length) {
            seen[key] = notices[0].createdAt;
            threshold = notices[0].createdAt;
            writeSeenMap(seen);
            return;
        }

        const fresh = notices.filter(n => n.createdAt > threshold);
        if (!fresh.length) return;

        // Raise up to 3 notifications per poll (poll is only 20s, notices
        // are capped 100, remainder is visible inside the Notices modal).
        fresh.slice(0, 3).forEach(n => {
            showSystemNotification(`CampusDebug OS — ${n.title}`, n.content);
        });
        console.log(`[notify] ${fresh.length} new notice(s); ${fresh.length > 3 ? 'rest in the Notices modal' : 'delivered'}`);

        seen[key] = Math.max(...fresh.map(n => n.createdAt));
        writeSeenMap(seen);
    } catch {
        // Offline / server down → silent, retried on the next tick
    } finally {
        inFlight = false;
    }
}

export function startNotificationPolling() {
    if (typeof window === 'undefined') return;
    if (pollingTimer) return; // already running

    // Best-effort permission ask exactly once per login (browsers block
    // re-prompts; the in-app Notices modal still works without it — the
    // notification layer degrades, nothing breaks).
    requestNotificationPermission().then((perm) => {
        if (perm === 'granted') {
            // Real background delivery: the SERVER can wake the service
            // worker when the app is closed/suspended.
            const profile = getStoredProfile();
            ensureWebPushSubscription(profile);
        }
    });

    checkForNewNotices();
    pollingTimer = setInterval(checkForNewNotices, POLL_INTERVAL);

    visibilityHandler = () => {
        // Coming back to the app? Check instantly, and (re)try the push
        // subscription in case it failed at login (e.g. stale SW then).
        if (document.visibilityState === 'visible') {
            checkForNewNotices();
            ensureWebPushSubscription(getStoredProfile());
        }
    };
    document.addEventListener('visibilitychange', visibilityHandler);
    console.log('[notify] push notification polling started (every ' + POLL_INTERVAL / 1000 + 's)');
}

export function stopNotificationPolling() {
    if (typeof window === 'undefined') return;
    if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
    }
    if (visibilityHandler) {
        document.removeEventListener('visibilitychange', visibilityHandler);
        visibilityHandler = null;
    }
}

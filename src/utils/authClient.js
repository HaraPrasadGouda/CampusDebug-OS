// Authentication session client — CampusDebug OS
// Real login via Supabase Auth (identity = Registration Number + password).
// Session is cached in localStorage so PWA reloads and offline use keep
// working; every API call gets the Bearer token attached automatically.

const SESSION_KEY = 'campus_auth_session';
const AUTH_EMAIL_DOMAIN = '@campusdebug.os';

export function getStoredSession() {
    try {
        const raw = localStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed?.session?.access_token) return null;
        // Expired access token is fine — the fetch interceptor refreshes it.
        return parsed;
    } catch {
        return null;
    }
}

export function getStoredProfile() {
    const s = getStoredSession();
    return s ? s.profile : null;
}

export function getAccessToken() {
    const s = getStoredSession();
    return s?.session?.access_token || null;
}

export function storeSession(result) {
    if (!result?.session) return;
    const record = {
        session: {
            access_token: result.session.access_token,
            refresh_token: result.session.refresh_token,
            expires_in: result.session.expires_in || 3600
        },
        profile: result.profile || null,
        storedAt: Date.now()
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(record));
}

export function applyRefreshedSession(session) {
    const s = getStoredSession();
    if (!s) return;
    s.session = {
        access_token: session.access_token,
        refresh_token: session.refresh_token || s.session.refresh_token,
        expires_in: session.expires_in || 3600
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearStoredSession() {
    localStorage.removeItem(SESSION_KEY);
}

export const authEmailFor = (id) => `${String(id).trim().toLowerCase()}${AUTH_EMAIL_DOMAIN}`;

let refreshing = null;

async function tryRefreshSession() {
    const s = getStoredSession();
    if (!s?.session?.refresh_token) return false;
    if (!refreshing) {
        refreshing = (async () => {
            try {
                let res;
                try {
                    res = await fetch('/api/auth/refresh', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ refreshToken: s.session.refresh_token })
                    });
                } catch {
                    // Network hiccup — NOT a credential problem. Retry on a later call.
                    return false;
                }
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    // Supabase revokes the whole refresh-token family once a rotated
                    // token is reused — only then is a real re-login unavoidable.
                    if (/invalid|already used|revoked|expired/i.test(`${err.error || ''} ${err.description || ''}`)) {
                        return 'revoked';
                    }
                    return false;
                }
                const data = await res.json();
                if (!data?.session?.access_token) return false;
                applyRefreshedSession(data.session);
                return true;
            } finally {
                refreshing = null;
            }
        })();
    }
    return refreshing;
}

/**
 * Patches window.fetch ONCE so every existing API call in the app
 * (dashboards, modals, offline sync engine) carries the login token.
 * On 401 it silently refreshes the session and retries the request once.
 */
export function installAuthFetch() {
    if (typeof window === 'undefined' || window.__campus_auth_fetch_installed) return;
    window.__campus_auth_fetch_installed = true;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init = {}) => {
        let url = '';
        try {
            url = typeof input === 'string' ? input : (input && input.url) || '';
        } catch { url = ''; }
        const isApi = url.includes('/api/');
        const isAuthEndpoint = /\/api\/auth\/(login|refresh|verify-login)/.test(url);
        const token = isApi && !isAuthEndpoint ? getAccessToken() : null;

        if (!token) return originalFetch(input, init);

        const headers = new Headers(init.headers || (input && input.headers) || {});
        if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
        const nextInit = { ...init, headers };

        const first = await originalFetch(input, nextInit);
        if (first.status !== 401) return first;

        // Session probably expired → refresh and retry once
        const refreshed = await tryRefreshSession();
        if (refreshed === 'revoked') {
            // Refresh-token family revoked — user must sign in again.
            clearStoredSession();
            if (typeof window !== 'undefined' && !/\/api\//.test(window.location.hash)) {
                window.location.hash = '#login';
            }
            return first;
        }
        if (!refreshed) {
            // Transient failure — keep credentials and let the caller see the 401;
            // the app stays usable and a later call will refresh successfully.
            return first;
        }
        const retryHeaders = new Headers(init.headers || (input && input.headers) || {});
        retryHeaders.set('Authorization', `Bearer ${getAccessToken()}`);
        return originalFetch(input, { ...init, headers: retryHeaders });
    };
}

const ROLE_MAP = {
    STUDENT: 'Student',
    TEACHER: 'Teacher',
    WARDEN: 'Warden',
    GUARD: 'Guard',
    ADMIN: 'Admin',
    DEAN: 'Admin'
};
export const roleToDashboard = (role) => ROLE_MAP[String(role || '').toUpperCase()] || 'Student';

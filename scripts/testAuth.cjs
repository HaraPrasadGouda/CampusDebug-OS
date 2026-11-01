// End-to-end auth test — Phase 1+2 verification (run against a test port).
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const BASE = process.env.TEST_BASE || 'http://localhost:5050';
const sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY
);

const post = async (path, body, token) => {
    const res = await fetch(BASE + path, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body)
    });
    let json = null;
    try { json = await res.json(); } catch { }
    return { status: res.status, json };
};

(async () => {
    const results = [];
    const check = (name, cond, detail = '') => {
        results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? '  → ' + detail : ''}`);
    };

    // Expected default password, computed independently from the DB
    const { data: prof } = await sb.from('profiles').select('*').ilike('roll_number', '2201106190').maybeSingle();
    const digits = String(prof?.phone_number || '').replace(/\D/g, '');
    const expectedDefault = `${String(prof.full_name).trim().split(/\s+/)[0].toLowerCase()}@${digits.slice(-4)}`;
    console.log(`(profile: ${prof.full_name}, phone ${prof.phone_number} → expected default: ${expectedDefault})`);

    // 1. Verify record
    let r = await post('/api/auth/verify-login', { rollNumber: '2201106190' });
    check('verify-login returns real name', r.json?.fullName === prof.full_name, `${r.json?.fullName} activated=${r.json?.activated}`);

    // 2. Login with default pattern → firstLogin true (assume fresh account)
    r = await post('/api/auth/login', { rollNumber: '2201106190', password: expectedDefault });
    const firstLogin = r.json?.firstLogin;
    check('login with default password', r.json?.success === true, `firstLogin=${firstLogin}`);
    const token1 = r.json?.session?.access_token;
    const refreshToken = r.json?.session?.refresh_token;

    // 3. Change password (forced)
    const NEW_PW = 'Test@shaurya2026';
    r = await post('/api/auth/change-password', { newPassword: NEW_PW, oldPassword: expectedDefault }, token1);
    check('change-password (first login)', r.json?.success === true, r.json?.error || '');

    // 4. Login again with the private password → firstLogin false
    r = await post('/api/auth/login', { rollNumber: '2201106190', password: NEW_PW });
    check('re-login with new password', r.json?.success === true && r.json?.firstLogin === false, `firstLogin=${r.json?.firstLogin}`);
    const studentToken = r.json?.session?.access_token;

    // 4b. Default password must NOT work anymore
    // NOTE: server auto-provisions only when NO account exists, so the default
    // attempt should now be a plain incorrect-password rejection.
    r = await post('/api/auth/login', { rollNumber: '2201106190', password: expectedDefault });
    check('default password rejected after change', r.status === 401, r.json?.error || '');

    // 5. Staff login
    for (const [roll, pwEnv] of [['WDN-001', 'DEMO_PASSWORD_WARDEN'], ['GRD-001', 'DEMO_PASSWORD_GUARD'], ['ADM-001', 'DEMO_PASSWORD_ADMIN']]) {
        const pw = process.env[pwEnv] || '';
        r = await post('/api/auth/login', { rollNumber: roll, password: pw });
        check(`staff login ${roll}`, r.json?.success === true, r.json?.error || (r.json?.profile?.fullName || ''));
        if (roll === 'WDN-001') var wardenToken = r.json?.session?.access_token;
    }

    // 6. Role gate: STUDENT hitting warden-only route → 403
    r = await post('/api/approve-pass', { passId: 'x' }, studentToken);
    check('student blocked from approve-pass (403)', r.status === 403, r.json?.error || '');
    // Warden allowed to reach the handler (may 400/404 for bad passId, but NOT 401/403)
    r = await post('/api/approve-pass', { passId: 'nonexistent' }, wardenToken);
    check('warden passes approve-pass gate', r.status !== 401 && r.status !== 403, `status=${r.status}`);

    // 7. Refresh flow
    const refreshRes = await fetch(BASE + '/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
    });
    const refreshJson = await refreshRes.json().catch(() => null);
    check('token refresh', refreshJson?.session?.access_token ? true : false, refreshJson?.error || '');

    // 8. dashboard-data with token → success + real stats
    const dash = await fetch(BASE + '/api/dashboard-data', { headers: { Authorization: `Bearer ${studentToken}` } });
    const dashJson = await dash.json().catch(() => null);
    check('dashboard-data authed', dash.status === 200 && dashJson?.success === true, `name=${dashJson?.profile?.full_name}`);

    console.log(results.join('\n'));
    console.log(results.some(r => r.startsWith('FAIL')) ? '\n=== SOME TESTS FAILED ===' : '\n=== ALL TESTS PASSED ===');
})().catch(e => { console.error('RUNNER ERROR:', e.message); process.exit(1); });

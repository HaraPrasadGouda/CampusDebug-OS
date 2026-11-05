// Security batch tests: the REAL server.js + mock Supabase (see harness.mjs).
// Each test here FAILS on the pre-fix code (the leak/hole is reproduced first) and passes after.
// Run: node --test test/security.test.mjs
process.env.TZ = 'Asia/Kolkata';
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp } from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Mock roster + the staff roles the stock roster lacks (WARDEN / DEAN / GUARD) so role checks can be exercised.
export function securityProfilesFile() {
    const base = JSON.parse(fs.readFileSync(path.join(HERE, 'support/profiles.json'), 'utf8'));
    const mk = (n, roll, role, name) => ({ id: `0000${String(n).padStart(4, '0')}-0000-4000-8000-00000000${String(n).padStart(4, '0')}`, roll_number: roll, role, full_name: name, phone_number: `95000${n}`, department: 'Administration' });
    const extra = [mk(9001, 'WARDEN01', 'WARDEN', 'Warden One'), mk(9002, 'DEAN01', 'DEAN', 'Dean One'), mk(9003, 'GUARD01', 'GUARD', 'Guard One')];
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cdb-sec-')), 'profiles.json');
    fs.writeFileSync(f, JSON.stringify([...base, ...extra]));
    return f;
}
export const HOSTELLER = '2301165000', HOSTELLER2 = '2301165001', DAYSCHOLAR = '2301109001', WARDEN = 'WARDEN01', GUARD = 'GUARD01', DEAN = 'DEAN01', ADMIN = 'ADMIN01', TEACHER = 'FAC001';
export const refs = (list) => [...new Set((list || []).map(p => p.pass_ref || p.id))].sort();
export const mkPass = (id, extra = {}) => ({ id, destination: 'Town market', reason: 'Medicines', passType: 'Day Pass', priority: 'NORMAL', validUntil: new Date(Date.now() + 6 * 3600e3).toISOString(), createdAt: new Date().toISOString(), createdAtMs: Date.now(), ...extra });

describe('P1-1 dashboard-data never returns another student\'s passes or tickets', () => {
    let app;
    before(async () => { app = await startApp({ profilesFile: securityProfilesFile() }); });
    after(() => app.stop());

    test('day scholar with no passes of their own does NOT get the hosteller\'s pass (name, roll, destination)', async () => {
        const c = await app.api('POST', '/api/create-pass', HOSTELLER, { passData: mkPass('GP-LEAK01', { destination: 'Secret place 42' }) });
        assert.equal(c.status, 200);
        const mine = await app.api('GET', '/api/dashboard-data', HOSTELLER);
        assert.deepEqual(refs(mine.json.gatePasses), ['GP-LEAK01'], 'the owner still sees their own pass');
        const other = await app.api('GET', '/api/dashboard-data', DAYSCHOLAR);
        assert.equal(other.status, 200);
        assert.deepEqual(other.json.gatePasses, [], 'a student with no pass gets an empty list');
        assert.ok(!JSON.stringify(other.json).includes('Secret place 42'));
    });

    test('a student who HAS a pass sees only their own, never mixed with others', async () => {
        await app.api('POST', '/api/create-pass', HOSTELLER2, { passData: mkPass('GP-LEAK02') });
        const r = await app.api('GET', '/api/dashboard-data', HOSTELLER2);
        assert.deepEqual(refs(r.json.gatePasses), ['GP-LEAK02']);
    });

    test('staff keep the whole ledger on their dashboard (warden/admin flow unchanged)', async () => {
        const w = await app.api('GET', '/api/dashboard-data', WARDEN);
        assert.deepEqual(refs(w.json.gatePasses), ['GP-LEAK01', 'GP-LEAK02']);
    });

    test('tickets: a student with no complaints does not receive the ledger of other students\' complaints', async () => {
        const f = await app.api('POST', '/api/parse-ticket', HOSTELLER, { complaintText: 'Fan not working in my room, very hot' });
        assert.ok([200, 201].includes(f.status), 'ticket filed: ' + JSON.stringify(f.json).slice(0, 200));
        const mine = await app.api('GET', '/api/dashboard-data', HOSTELLER);
        assert.ok(mine.json.tickets.length >= 1, 'owner sees own ticket');
        const other = await app.api('GET', '/api/dashboard-data', DAYSCHOLAR);
        assert.deepEqual(other.json.tickets, []);
        const w = await app.api('GET', '/api/dashboard-data', WARDEN);
        assert.ok(w.json.tickets.length >= 1, 'warden still sees complaints');
    });
});

describe('P1-2 /api/pass-status only for the pass owner or gate staff', () => {
    let app;
    before(async () => {
        app = await startApp({ profilesFile: securityProfilesFile() });
        await app.api('POST', '/api/create-pass', HOSTELLER, { passData: mkPass('GP-STAT01', { destination: 'Private clinic' }) });
    });
    after(() => app.stop());
    const look = (roll) => app.api('GET', '/api/pass-status?id=GP-STAT01', roll);

    test('another student gets nothing (no name, roll, destination, signature)', async () => {
        const r = await look(DAYSCHOLAR);
        assert.equal(r.status, 200);
        assert.equal(r.json.pass, null);
        assert.ok(!JSON.stringify(r.json).includes('Private clinic'));
        assert.deepEqual((await look(TEACHER)).json.pass, null, 'a teacher is not gate staff either');
    });
    test('the owner still gets the pass (student polling flow unchanged)', async () => {
        const r = await look(HOSTELLER);
        assert.equal(r.json.pass.id, 'GP-STAT01');
        assert.equal(r.json.pass.status, 'PENDING');
    });
    test('warden, guard, admin and dean can still look any pass up', async () => {
        for (const who of [WARDEN, GUARD, ADMIN, DEAN]) assert.equal((await look(who)).json.pass?.id, 'GP-STAT01', who);
    });
    test('no login -> 401; unknown id -> pass null', async () => {
        assert.equal((await app.api('GET', '/api/pass-status?id=GP-STAT01', null)).status, 401);
        assert.equal((await app.api('GET', '/api/pass-status?id=GP-NOPE', HOSTELLER)).json.pass, null);
    });
});

describe('P1-4 gate_passes -> profiles embed names its foreign key (DB pass saving stays on)', () => {
    let app;
    const dbPass = (profileId, ref) => ({ pass_ref: ref, student_id: profileId, status: 'APPROVED', destination: 'Bus stand', reason: 'Family', pass_category: 'DAY_PASS', valid_until: new Date(Date.now() + 5 * 3600e3).toISOString(), created_at: new Date().toISOString() });
    const insertRow = (row) => fetch(`http://127.0.0.1:${app.mockPort}/rest/v1/gate_passes`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(row) });
    const dump = async () => (await fetch(`http://127.0.0.1:${app.mockPort}/__dump?t=gate_passes`)).json();
    before(async () => {
        app = await startApp({ profilesFile: securityProfilesFile() });
        // a pass that exists only in the database (e.g. server restarted since): memory has nothing, so the DB branch is used
        await insertRow(dbPass('0000001a-0000-4000-8000-00000000001a', 'GP-654321'));
    });
    after(() => app.stop());

    test('guard manual lookup reads the DB row WITH the student (name + roll) and does not switch DB saving off', async () => {
        const r = await app.api('GET', '/api/pass-lookup?id=GP-654321', GUARD);
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(r.json.pass.name, 'Student A1');
        assert.equal(r.json.pass.rollNo, '2301165000');
        assert.ok(!/persistence disabled/.test(app.logs.srv), 'DB saving was not switched off:\n' + app.logs.srv.slice(-400));
    });
    test('guard offline pass cache lists the DB-only pass with its student', async () => {
        const r = await app.api('GET', '/api/guard/pass-cache', GUARD);
        const p = (r.json.passes || []).find(x => x.number === 'GP-654321');
        assert.ok(p, JSON.stringify(r.json).slice(0, 300));
        assert.equal(p.name, 'Student A1');
        assert.ok(!/persistence disabled/.test(app.logs.srv));
    });
    test('student QR token for a DB-only pass (pass-token) works for the owner', async () => {
        const r = await app.api('POST', '/api/pass-token', HOSTELLER, { kind: 'PASS', id: 'GP-654321' });
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.ok(!/persistence disabled/.test(app.logs.srv));
    });
    test('end to end: a new pass still reaches the gate_passes table after the lookups (saving was never turned off)', async () => {
        await app.api('POST', '/api/create-pass', HOSTELLER2, { passData: mkPass('GP-777001') });
        await new Promise(r => setTimeout(r, 400));
        const rows = await dump();
        assert.ok(rows.some(r => r.pass_ref === 'GP-777001'), 'pass saved to the DB table: ' + JSON.stringify(rows.map(r => r.pass_ref)));
    });
});

describe('P2-16 verify-login returns only what the login screen needs', () => {
    let app;
    before(async () => { app = await startApp({ profilesFile: securityProfilesFile() }); });
    after(() => app.stop());

    test('an anonymous caller gets verified/activated + first name only: no full name, department, block, phone', async () => {
        const r = await app.api('POST', '/api/auth/verify-login', null, { rollNumber: HOSTELLER });
        assert.equal(r.status, 200);
        assert.equal(r.json.verified, true);
        assert.equal(r.json.activated, false);
        assert.equal(r.json.firstName, 'Student');
        for (const k of ['fullName', 'department', 'hostelBlock', 'phone', 'phone_number']) assert.ok(!(k in r.json), `${k} must not be returned`);
        const raw = JSON.stringify(r.json);
        assert.ok(!/A1|Block A|9201165000|Administration/.test(raw), raw);
    });
    test('unknown roll number still gets the same "not in the college records" answer', async () => {
        const r = await app.api('POST', '/api/auth/verify-login', null, { rollNumber: 'NOPE999' });
        assert.equal(r.status, 404);
        assert.equal(r.json.verified, false);
        assert.match(r.json.error, /not in the college records/);
    });
    test('activated is found even when the account is NOT on the first page of auth users (was: first 50 only)', async () => {
        const filler = Array.from({ length: 120 }, (_, i) => ({ email: `filler${i}@campusdebug.os`, password: 'x' }));
        await fetch(`http://127.0.0.1:${app.mockPort}/__auth_users`, { method: 'POST', body: JSON.stringify([...filler, { email: `${DAYSCHOLAR}@campusdebug.os`, password: 'x' }]) });
        const r = await app.api('POST', '/api/auth/verify-login', null, { rollNumber: DAYSCHOLAR });
        assert.equal(r.json.activated, true);
        assert.equal(r.json.firstTimeHint, null);
    });
});

describe('P2-17 login rate limit (wrong attempts only, generous, clear English message)', () => {
    let app;
    before(async () => { app = await startApp({ profilesFile: securityProfilesFile() }); });
    after(() => app.stop());
    const login = async (roll, password, ip = '203.0.113.7') => {
        const r = await fetch(app.base + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip }, body: JSON.stringify({ rollNumber: roll, password }) });
        return { status: r.status, json: await r.json(), retryAfter: r.headers.get('retry-after') };
    };

    test('the existing first-login flow is untouched: default password signs in and asks for a new password', async () => {
        const r = await login('2301165005', 'student@5005');
        assert.equal(r.status, 200, JSON.stringify(r.json));
        assert.equal(r.json.success, true);
        assert.equal(r.json.firstLogin, true);
        assert.equal(r.json.profile.rollNumber, '2301165005');
        assert.ok(r.json.session.access_token);
    });
    test('a student mistyping 5 times, then typing it right, gets in (and the counter resets)', async () => {
        for (let i = 0; i < 5; i++) { const r = await login('2301165001', 'wrong' + i); assert.equal(r.status, 401); assert.match(r.json.error, /Incorrect password/); }
        const ok = await login('2301165001', 'student@5001');
        assert.equal(ok.status, 200);
        for (let i = 0; i < 9; i++) assert.equal((await login('2301165001', 'bad' + i)).status, 401, 'counter was cleared by the success: 9 more wrong tries are still allowed');
    });
    test('10 wrong attempts at one account from one IP -> the 11th is blocked with a clear English wait time (even with the right password)', async () => {
        for (let i = 0; i < 10; i++) assert.equal((await login('2301165002', 'nope' + i)).status, 401);
        const blocked = await login('2301165002', 'student@5002');
        assert.equal(blocked.status, 429);
        assert.match(blocked.json.error, /^Too many wrong attempts\. Please wait \d+ minutes? and try again\.$/);
        assert.ok(blocked.json.retryAfterSeconds > 0 && blocked.json.retryAfterSeconds <= 600);
        assert.equal(Number(blocked.retryAfter), blocked.json.retryAfterSeconds);
        assert.equal(blocked.json.success, false);
    });
    test('another account from the same IP is not locked by that', async () => {
        assert.equal((await login('2301165003', 'student@5003')).status, 200);
    });
    test('the lock lifts after the 10-minute window', async () => {
        app.clock('08:12');   // 12 minutes later on the app clock (it was 08:00)
        assert.equal((await login('2301165002', 'student@5002')).status, 200);
    });
    test('a stranger from a different IP cannot lock a student out with 10 tries of their own', async () => {
        for (let i = 0; i < 10; i++) assert.equal((await login('2301165004', 'guess' + i, '198.51.100.9')).status, 401);
        assert.equal((await login('2301165004', 'guess-again', '198.51.100.9')).status, 429, 'the attacker IP is blocked');
        assert.equal((await login('2301165004', 'student@5004', '192.0.2.44')).status, 200, 'the real student, from their own IP, still gets in');
    });
    test('unknown roll numbers count too: 60 failures from one IP across many rolls -> that IP is blocked, other IPs are not', async () => {
        for (let i = 0; i < 60; i++) assert.equal((await login('NOROLL' + i, 'x', '198.51.100.77')).status, 404);
        const r = await login('NOROLL-x', 'x', '198.51.100.77');
        assert.equal(r.status, 429);
        assert.match(r.json.error, /Too many wrong attempts/);
        assert.equal((await login('2301165005', 'student@5005', '192.0.2.99')).status, 200);
    });
});

describe('P1-11 server revalidates the page shell and the service worker', () => {
    const haveDist = fs.existsSync(path.join(HERE, '../dist/sw.js'));
    let app;
    before(async () => { if (haveDist) app = await startApp({ dist: true }); });
    after(() => app && app.stop());
    test('sw.js, index.html and the SPA fallback are Cache-Control: no-cache; hashed assets are not forced', { skip: !haveDist && 'run `npx vite build` first' }, async () => {
        const cc = async (p) => (await fetch(app.base + p)).headers.get('cache-control');
        assert.equal(await cc('/sw.js'), 'no-cache');
        assert.equal(await cc('/index.html'), 'no-cache');
        assert.equal(await cc('/some/app/route'), 'no-cache');
        const asset = fs.readdirSync(path.join(HERE, '../dist/assets')).find(f => f.endsWith('.js'));
        assert.notEqual(await cc('/assets/' + asset), 'no-cache');
    });
});

describe('verify: warden Reject persists on the server (and cannot be undone by a stale student replay)', () => {
    let app;
    const rowsOf = async () => (await fetch(`http://127.0.0.1:${app.mockPort}/__dump?t=gate_passes`)).json();
    before(async () => { app = await startApp({ profilesFile: securityProfilesFile() }); });
    after(() => app.stop());

    test('reject -> server copy is REJECTED everywhere: warden refresh, student status poll, JSON ledger, database row', async () => {
        const pass = mkPass('GP-REJ001');
        await app.api('POST', '/api/create-pass', HOSTELLER, { passData: pass });
        let w = await app.api('GET', '/api/dashboard-data', WARDEN);
        assert.equal(w.json.gatePasses.find(p => p.id === 'GP-REJ001').status, 'PENDING', 'it is in the warden queue first');
        // exactly what WardenDashboard.handleRejectPass posts
        const rej = await app.api('POST', '/api/create-pass', WARDEN, { passData: { ...pass, rollNo: HOSTELLER, name: 'Student A1', status: 'REJECTED', rejectedAt: new Date().toISOString() } });
        assert.equal(rej.status, 200);
        w = await app.api('GET', '/api/dashboard-data', WARDEN);                 // "refresh"
        assert.equal(w.json.gatePasses.find(p => p.id === 'GP-REJ001').status, 'REJECTED');
        assert.equal((await app.api('GET', '/api/pass-status?id=GP-REJ001', HOSTELLER)).json.pass.status, 'REJECTED', 'student sees Rejected');
        await new Promise(r => setTimeout(r, 400));
        const ledger = JSON.parse(fs.readFileSync(path.join(app.dir, 'data/gate_passes.json'), 'utf8'));
        assert.equal(ledger.find(p => p.id === 'GP-REJ001').status, 'REJECTED', 'survives a restart (JSON ledger)');
        assert.ok((await rowsOf()).some(r => r.pass_ref === 'GP-REJ001' && r.status === 'REJECTED'), 'database row says REJECTED');
    });
    test('a stale offline student replay of the original PENDING request does not bring the pass back', async () => {
        const again = await app.api('POST', '/api/create-pass', HOSTELLER, { passData: mkPass('GP-REJ001') });
        assert.equal(again.status, 200);
        assert.equal(again.json.unchanged, true);
        assert.equal((await app.api('GET', '/api/pass-status?id=GP-REJ001', HOSTELLER)).json.pass.status, 'REJECTED');
    });
});

describe('verify: /api/create-pass needs a login and a student cannot forge another identity or status', () => {
    let app;
    before(async () => {
        app = await startApp({ profilesFile: securityProfilesFile() });
        await app.api('POST', '/api/create-pass', HOSTELLER, { passData: mkPass('GP-OWN001', { destination: 'Owner trip' }) });
    });
    after(() => app.stop());

    test('no token and a bad token are refused (401)', async () => {
        assert.equal((await app.api('POST', '/api/create-pass', null, { passData: mkPass('GP-X1') })).status, 401);
        assert.equal((await app.api('POST', '/api/create-pass', 'NOT-A-USER', { passData: mkPass('GP-X2') })).status, 401);
        assert.equal((await app.api('GET', '/api/dashboard-data', 'NOT-A-USER')).status, 401);
    });
    test('a student posting APPROVED + someone else\'s roll gets a PENDING pass under their OWN roll', async () => {
        const r = await app.api('POST', '/api/create-pass', HOSTELLER2, { passData: { ...mkPass('GP-FORGE1'), status: 'APPROVED', rollNo: HOSTELLER, name: 'Forged Name', hmac_signature: 'x', token: 'y' } });
        assert.equal(r.status, 200);
        const mine = r.json.gatePasses.find(p => p.id === 'GP-FORGE1');
        assert.equal(mine.status, 'PENDING');
        assert.equal(mine.rollNo, HOSTELLER2);
        assert.equal(mine.name, 'Student A2');
        assert.ok(!mine.hmac_signature && !mine.token);
    });
    test('a student cannot overwrite another student\'s pass (403)', async () => {
        const r = await app.api('POST', '/api/create-pass', HOSTELLER2, { passData: mkPass('GP-OWN001', { destination: 'Hijacked' }) });
        assert.equal(r.status, 403);
        assert.equal((await app.api('GET', '/api/pass-status?id=GP-OWN001', HOSTELLER)).json.pass.destination, 'Owner trip');
    });
    test('the reply to a student contains only their own passes', async () => {
        const r = await app.api('POST', '/api/create-pass', HOSTELLER2, { passData: mkPass('GP-OWN002') });
        assert.ok(r.json.gatePasses.every(p => p.rollNo === HOSTELLER2));
    });
});

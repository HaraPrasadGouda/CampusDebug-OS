// Demo fee payment ("Settle Dues"): the REAL server.js + mock Supabase (see harness.mjs).
// Run: node --test test/fees.test.mjs
process.env.TZ = 'Asia/Kolkata';
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp, DAY } from './harness.mjs';
import { newReceiptId, receiptDay, createFeeStore } from '../fee-store.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOSTELLER = '2301165000', HOSTELLER2 = '2301165001', DAYSCHOLAR = '2301109001', WARDEN = 'WARDEN01', GUARD = 'GUARD01', DEAN = 'DEAN01', ADMIN = 'ADMIN01', TEACHER = 'FAC001';

const DUES = { [HOSTELLER]: 12500, [HOSTELLER2]: 3200.5, '2301165002': 800, '2301165003': 450, '2301165004': 99 };
// the security roster + dues on a few students (DAYSCHOLAR has none)
export function feeProfilesFile() {
    const base = JSON.parse(fs.readFileSync(path.join(HERE, 'support/profiles.json'), 'utf8'));
    const mk = (n, roll, role, name) => ({ id: `0000${n}-0000-4000-8000-00000000${n}`, roll_number: roll, role, full_name: name, phone_number: `95000${n}`, department: 'Administration' });
    base.push(mk(9001, WARDEN, 'WARDEN', 'Warden One'), mk(9002, DEAN, 'DEAN', 'Dean One'), mk(9003, GUARD, 'GUARD', 'Guard One'));
    for (const p of base) if (DUES[p.roll_number] != null) p.fee_due_balance = DUES[p.roll_number];
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cdb-fee-')), 'profiles.json');
    fs.writeFileSync(f, JSON.stringify(base));
    return f;
}
const dump = async (app, t) => (await fetch(`http://127.0.0.1:${app.mockPort}/__dump?t=${t}`)).json();
const dues = async (app, roll) => (await app.api('GET', '/api/dashboard-data', roll)).json.profile.fee_due_balance;
const RID = /^RCP-\d{6}-[A-HJ-KM-NP-Z2-9]{4}$/;

describe('receipt ids', () => {
    test('format RCP-YYMMDD-XXXX from India time, unambiguous letters, and they vary', () => {
        assert.equal(receiptDay(new Date('2026-11-05T20:00:00Z')), '261106');   // already the 6th in India
        assert.equal(receiptDay(new Date('2026-11-05T05:00:00Z')), '261105');
        const ids = new Set(Array.from({ length: 300 }, () => newReceiptId(new Date('2026-11-05T05:00:00Z'))));
        assert.ok(ids.size > 290);
        for (const id of ids) assert.match(id, /^RCP-261105-[A-HJ-KM-NP-Z2-9]{4}$/);
    });
});

describe('POST /api/fees/pay records a demo receipt', () => {
    let app;
    before(async () => { app = await startApp({ profilesFile: feeProfilesFile() }); app.clock('09:30'); });
    after(() => app.stop());

    test('pays the exact server-side dues, one receipt with id, roll, name, amount, time, method DEMO', async () => {
        assert.equal(await dues(app, HOSTELLER), 12500);
        const r = await app.api('POST', '/api/fees/pay', HOSTELLER, {});
        assert.equal(r.status, 200);
        assert.equal(r.json.success, true);
        assert.equal(r.json.previous, 12500);
        assert.equal(r.json.amount, 12500);
        assert.equal(r.json.feeDue, 0);
        assert.ok(!r.json.alreadyCleared);
        const rc = r.json.receipt;
        assert.match(rc.receipt_id, RID);
        assert.equal(rc.roll_number, HOSTELLER);
        assert.equal(rc.payer_name, 'Student A1');
        assert.equal(rc.amount, 12500);
        assert.equal(rc.method, 'DEMO');
        assert.equal(rc.paid_at.slice(0, 16), `${DAY}T04:00`, 'paid_at is the server clock (09:30 India time)');
        assert.equal(rc.receipt_id.slice(4, 10), '261104', 'the id carries the India date');
        assert.equal(await dues(app, HOSTELLER), 0);
        const rows = await dump(app, 'fee_payments');
        assert.equal(rows.length, 1, 'stored in the fee_payments table (it exists in this mock)');
        assert.equal(rows[0].receipt_id, rc.receipt_id);
        assert.equal(rows[0].amount, 12500);
    });

    test('decimal dues are paid exactly', async () => {
        const r = await app.api('POST', '/api/fees/pay', HOSTELLER2, {});
        assert.equal(r.json.amount, 3200.5);
        assert.equal(r.json.receipt.amount, 3200.5);
        assert.equal(await dues(app, HOSTELLER2), 0);
    });

    test('a client-supplied amount / roll / receipt id is ignored', async () => {
        const r = await app.api('POST', '/api/fees/pay', '2301165002', { amount: 1, amountPaid: 1, previous: 1, roll_number: HOSTELLER, receipt_id: 'RCP-HACKED', method: 'UPI', payer_name: 'Mallory', feeDue: -5 });
        assert.equal(r.status, 200);
        assert.equal(r.json.amount, 800, 'the server-side dues, not the client number');
        assert.equal(r.json.receipt.roll_number, '2301165002');
        assert.equal(r.json.receipt.method, 'DEMO');
        assert.equal(r.json.receipt.payer_name, 'Student A3');
        assert.match(r.json.receipt.receipt_id, RID);
        assert.equal(await dues(app, '2301165002'), 0);
    });

    test('double tap: the second call is alreadyCleared with the SAME receipt, no second receipt, dues stay 0', async () => {
        const first = await app.api('POST', '/api/fees/pay', '2301165003', {});
        const second = await app.api('POST', '/api/fees/pay', '2301165003', {});
        assert.equal(second.status, 200);
        assert.equal(second.json.success, true);
        assert.equal(second.json.alreadyCleared, true);
        assert.equal(second.json.feeDue, 0);
        assert.equal(second.json.receipt.receipt_id, first.json.receipt.receipt_id);
        const mine = (await dump(app, 'fee_payments')).filter(x => x.roll_number === '2301165003');
        assert.equal(mine.length, 1);
        assert.equal(await dues(app, '2301165003'), 0);
    });

    test('zero dues from the start: no receipt is created, dues stay 0 (never negative)', async () => {
        const before = (await dump(app, 'fee_payments')).length;
        const r = await app.api('POST', '/api/fees/pay', DAYSCHOLAR, {});
        assert.equal(r.status, 200);
        assert.equal(r.json.alreadyCleared, true);
        assert.equal(r.json.receipt, null);
        assert.equal((await dump(app, 'fee_payments')).length, before);
        assert.equal(await dues(app, DAYSCHOLAR) ?? 0, 0);
    });

    test('needs a login', async () => {
        const r = await app.api('POST', '/api/fees/pay', null, {});
        assert.equal(r.status, 401);
    });
});

describe('simultaneous taps create ONE receipt', () => {
    let app;
    before(async () => { app = await startApp({ profilesFile: feeProfilesFile() }); });
    after(() => app.stop());

    test('8 parallel calls from one student: one payment, one receipt, same id in every answer', async () => {
        const rs = await Promise.all(Array.from({ length: 8 }, () => app.api('POST', '/api/fees/pay', '2301165004', {})));
        for (const r of rs) { assert.equal(r.status, 200); assert.equal(r.json.success, true); assert.equal(r.json.feeDue, 0); }
        const paid = rs.filter(r => !r.json.alreadyCleared);
        assert.equal(paid.length, 1, 'exactly one call actually paid');
        assert.equal(paid[0].json.amount, 99);
        const ids = new Set(rs.map(r => r.json.receipt?.receipt_id));
        assert.equal(ids.size, 1, 'every answer points at the same receipt');
        assert.equal((await dump(app, 'fee_payments')).filter(x => x.roll_number === '2301165004').length, 1);
        assert.equal(await dues(app, '2301165004'), 0);
    });

    test('different students paying at the same moment each get their own receipt', async () => {
        const app2 = await startApp({ profilesFile: feeProfilesFile() });
        try {
            const rs = await Promise.all([HOSTELLER, HOSTELLER2, '2301165002', '2301165003'].map(w => app2.api('POST', '/api/fees/pay', w, {})));
            assert.ok(rs.every(r => r.json.success && !r.json.alreadyCleared));
            assert.equal(new Set(rs.map(r => r.json.receipt.receipt_id)).size, 4);
            assert.deepEqual(rs.map(r => r.json.amount), [12500, 3200.5, 800, 450]);
        } finally { app2.stop(); }
    });
});

describe('who can read receipts', () => {
    let app;
    before(async () => {
        app = await startApp({ profilesFile: feeProfilesFile() });
        await app.api('POST', '/api/fees/pay', HOSTELLER, {});
        await app.api('POST', '/api/fees/pay', HOSTELLER2, {});
    });
    after(() => app.stop());

    test('a student sees only their own receipts, newest first; ?roll= does not widen it', async () => {
        const a = await app.api('GET', '/api/fees/receipts', HOSTELLER);
        assert.equal(a.status, 200);
        assert.deepEqual(a.json.receipts.map(r => r.roll_number), [HOSTELLER]);
        assert.equal(a.json.receipts[0].amount, 12500);
        const sneaky = await app.api('GET', `/api/fees/receipts?roll=${HOSTELLER2}&roll_number=${HOSTELLER2}`, HOSTELLER);
        assert.deepEqual(sneaky.json.receipts.map(r => r.roll_number), [HOSTELLER]);
        assert.ok(!JSON.stringify(sneaky.json).includes('Student A2'));
        const none = await app.api('GET', '/api/fees/receipts', DAYSCHOLAR);
        assert.deepEqual(none.json.receipts, []);
    });

    test('the staff list: students, teachers and guards get 403, no login gets 401', async () => {
        for (const who of [HOSTELLER, DAYSCHOLAR, TEACHER, GUARD]) {
            const r = await app.api('GET', '/api/fees/payments', who);
            assert.equal(r.status, 403, who);
            assert.ok(!JSON.stringify(r.json).includes('RCP-'), 'no receipt data in a 403');
        }
        assert.equal((await app.api('GET', '/api/fees/payments', null)).status, 401);
        assert.equal((await app.api('GET', '/api/fees/receipts', null)).status, 401);
    });

    test('warden, admin and dean can read everyone\'s receipts with name, roll, amount, time', async () => {
        for (const who of [WARDEN, ADMIN, DEAN]) {
            const r = await app.api('GET', '/api/fees/payments', who);
            assert.equal(r.status, 200, who);
            assert.equal(r.json.totalCount, 2);
            assert.equal(r.json.totalAmount, 15700.5);
            assert.deepEqual(r.json.payments.map(p => p.roll_number).sort(), [HOSTELLER, HOSTELLER2].sort());
            const p = r.json.payments.find(x => x.roll_number === HOSTELLER);
            assert.match(p.receipt_id, RID);
            assert.equal(p.payer_name, 'Student A1');
            assert.equal(p.amount, 12500);
            assert.ok(p.paid_at);
        }
        const lim = await app.api('GET', '/api/fees/payments?limit=1', ADMIN);
        assert.equal(lim.json.payments.length, 1);
        assert.equal(lim.json.totalCount, 2);
    });

    test('the dashboard payload a student gets contains no other student\'s receipts', async () => {
        const d = await app.api('GET', '/api/dashboard-data', HOSTELLER2);
        assert.ok(!JSON.stringify(d.json).includes('RCP-'));
    });
});

describe('works with the fee_payments table missing (JSON file fallback)', () => {
    let app;
    before(async () => { app = await startApp({ profilesFile: feeProfilesFile(), mockEnv: { MISSING_TABLES: 'fee_payments' } }); });
    after(() => app.stop());

    test('pay, double tap, own receipts and staff list all work from the local file', async () => {
        const r = await app.api('POST', '/api/fees/pay', HOSTELLER, {});
        assert.equal(r.status, 200);
        assert.equal(r.json.amount, 12500);
        assert.match(r.json.receipt.receipt_id, RID);
        assert.equal(await dues(app, HOSTELLER), 0, 'dues are still cleared in profiles');
        const again = await app.api('POST', '/api/fees/pay', HOSTELLER, {});
        assert.equal(again.json.alreadyCleared, true);
        assert.equal(again.json.receipt.receipt_id, r.json.receipt.receipt_id);
        const mine = await app.api('GET', '/api/fees/receipts', HOSTELLER);
        assert.equal(mine.json.receipts.length, 1);
        const staff = await app.api('GET', '/api/fees/payments', WARDEN);
        assert.equal(staff.json.totalCount, 1);
        const file = JSON.parse(fs.readFileSync(path.join(app.dir, 'data', 'fee_payments.json'), 'utf8'));
        assert.equal(file.payments.length, 1);
        assert.equal(file.payments[0].receipt_id, r.json.receipt.receipt_id);
        assert.equal(file.payments[0].method, 'DEMO');
    });
});

describe('fee-store unit behaviour', () => {
    test('a receipt kept in the local file is reloaded by a new store (server restart)', async () => {
        const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cdb-fs-')), 'fee_payments.json');
        const a = createFeeStore({ supabase: null, file: f });
        const saved = await a.add({ receipt_id: 'RCP-261104-AAAA', roll_number: HOSTELLER, payer_name: 'X', amount: 10, paid_at: '2026-11-04T04:00:00.000Z' });
        assert.equal(saved.amount, 10);
        const b = createFeeStore({ supabase: null, file: f });
        assert.deepEqual((await b.listByRoll(HOSTELLER)).map(r => r.receipt_id), ['RCP-261104-AAAA']);
        assert.equal(await b.add({ receipt_id: 'RCP-261104-AAAA', roll_number: HOSTELLER, amount: 10 }), null, 'same id twice is refused');
    });

    test('database says the receipt id is taken (23505): add() returns null so the caller picks another id', async () => {
        const supabase = { from: () => ({ insert: async () => ({ error: { code: '23505', message: 'duplicate key value violates unique constraint' } }) }) };
        const s = createFeeStore({ supabase, file: null });
        assert.equal(await s.add({ receipt_id: 'RCP-261104-AAAA', roll_number: 'R1', amount: 5 }), null);
    });

    test('a database failure other than "missing" or duplicate keeps the receipt in the local file, never loses it', async () => {
        const supabase = { from: () => ({ insert: async () => ({ error: { code: '57014', message: 'canceling statement due to statement timeout' } }), select: () => ({ order: () => ({ limit: async () => ({ error: { message: 'boom' } }) }), eq: () => ({ order: () => ({ limit: async () => ({ error: { message: 'boom' } }) }) }) }) }) };
        const s = createFeeStore({ supabase, file: null });
        const r = await s.add({ receipt_id: 'RCP-261104-BBBB', roll_number: 'R1', amount: 7 });
        assert.equal(r.receipt_id, 'RCP-261104-BBBB');
        assert.equal((await s.listByRoll('R1')).length, 1);
        assert.equal(s.state.tableMissing, false, 'a timeout does not flip the store to "table missing"');
    });

    test('a missing table flips to the local file for good', async () => {
        let calls = 0;
        const supabase = { from: () => ({ insert: async () => { calls++; return { error: { code: 'PGRST205', message: "Could not find the table 'public.fee_payments' in the schema cache" } }; } }) };
        const s = createFeeStore({ supabase, file: null });
        await s.add({ receipt_id: 'RCP-261104-CCCC', roll_number: 'R1', amount: 1 });
        await s.add({ receipt_id: 'RCP-261104-DDDD', roll_number: 'R1', amount: 2 });
        assert.equal(calls, 1, 'the database is not asked again once the table is known to be missing');
        assert.equal(s.state.tableMissing, true);
    });

    test('listAll totals everything and the list is capped by limit', async () => {
        const s = createFeeStore({ supabase: null, file: null });
        for (let i = 0; i < 250; i++) await s.add({ receipt_id: `RCP-261104-${String(i).padStart(4, '0')}`, roll_number: `R${i}`, amount: 10.1, paid_at: new Date(Date.UTC(2026, 10, 4, 4, 0, i)).toISOString() });
        const all = await s.listAll({ limit: 200 });
        assert.equal(all.payments.length, 200);
        assert.equal(all.totalCount, 250);
        assert.equal(all.totalAmount, 2525);
        assert.equal(all.payments[0].receipt_id, 'RCP-261104-0249', 'newest first');
    });
});

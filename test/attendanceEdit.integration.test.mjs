// Teacher edits same-day attendance in college hours (no lock, no admin unlock).
// REAL server.js + mock Supabase + fake clock (see harness.mjs).
process.env.TZ = 'Asia/Kolkata';
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, SEC_B, DAY } from './harness.mjs';

const MSG = 'Attendance can be edited only on the same day during college hours.';
const mark = (app, roll, o) => app.api('POST', '/api/attendance/mark', roll, { sectionKey: SEC_B, department: 'BTech CSE', subjectCode: 'DS', subject: 'Data Structures', day: 'WED', period: 3, kind: 'lecture', present: [], ...o });
const P1 = { subjectCode: 'PHY', subject: 'Physics', period: 1 };      // FAC002 teaches B P1 on WED (09:15-10:15)
const sessions = async (app, roll, q = '') => (await app.api('GET', `/api/attendance/sessions${q}`, roll)).json;
const pct = async (app) => {
    // the rollup is detached: poll the mock's profiles until two reads agree
    let prev = '', cur = '';
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 100));
        const r = await fetch(`http://127.0.0.1:${app.mockPort}/__dump?t=profiles`); const rows = await r.json();
        cur = JSON.stringify(rows.filter(p => p.role === 'STUDENT' && p.course === 'BTech' && p.section === 'B').map(p => [p.roll_number, p.attendance_percentage]).sort());
        if (cur === prev && i > 3) break; prev = cur;
    }
    return JSON.parse(cur);
};
const rosterOf = async (app) => (await app.api('GET', `/api/attendance/roster?section=${encodeURIComponent(SEC_B)}`, 'FAC003')).json.students.map(s => s.roll);

describe('teacher edit: same day, college hours, own class only', () => {
    let app, A, B;
    before(async () => { app = await startApp(); app.clock('11:25'); [A, B] = (await rosterOf(app)); });
    after(() => app.stop());

    test('fresh mark is unchanged (not an edit), then the same teacher edits in college hours: same record, new list, edit stamped, takenBy kept', async () => {
        const first = await mark(app, 'FAC003', { present: [A] });
        assert.equal(first.status, 200, JSON.stringify(first.json)); assert.equal(first.json.edited, false);
        assert.equal(first.json.record.editedAt, undefined);
        app.clock('12:10');
        const ed = await mark(app, 'FAC003', { present: [A, B] });
        assert.equal(ed.status, 200, JSON.stringify(ed.json)); assert.equal(ed.json.edited, true);
        assert.equal(ed.json.record.id, first.json.record.id, 'same record (id kept)');
        assert.deepEqual(ed.json.record.present.sort(), [A, B].sort());
        assert.equal(ed.json.record.takenByLogin, 'FAC003'); assert.equal(ed.json.record.takenAt, first.json.record.takenAt, 'original taker + time kept');
        assert.equal(ed.json.record.editedBy, 'FAC003'); assert.ok(ed.json.record.editedAt); assert.equal(ed.json.record.editCount, 1);
        const s = (await sessions(app, 'FAC003')).sessions.filter(x => x.period === 3);
        assert.equal(s.length, 1, 'overwritten in place, not duplicated');
    });

    test('sessions tell the UI when an edit is allowed (editable + college hours)', async () => {
        const j = await sessions(app, 'FAC003');
        assert.equal(j.sessions[0].editable, true); assert.equal(j.collegeHours.open, true);
        assert.deepEqual([j.collegeHours.startMin, j.collegeHours.endMin], [555, 990], 'first period start .. last period end, from the period grid');
        assert.equal(j.editMessage, MSG);
    });

    test('another teacher cannot edit it', async () => {
        const r = await mark(app, 'FAC005', { present: [] });
        assert.equal(r.status, 403); assert.equal(r.json.notYourClass, true);
        const rec = (await sessions(app, 'FAC003')).sessions.find(x => x.period === 3);
        assert.equal(rec.present.length, 2, 'unchanged');
    });

    test('admin cannot edit (no admin edit / unlock at all); the unlock endpoint is gone', async () => {
        for (const roll of ['ADMIN01']) {   // role !== TEACHER covers the dean too (no dean login in the mock seed)
            const r = await mark(app, roll, { present: [] });
            assert.equal(r.status, 403, roll); assert.match(r.json.error, /Only the teacher who took this class/);
        }
        assert.equal((await sessions(app, 'FAC003')).sessions.find(x => x.period === 3).present.length, 2);
        const un = await app.api('POST', '/api/admin/attendance-unlock', 'ADMIN01', { sectionKey: SEC_B, period: 3 });
        assert.notEqual(un.json?.success, true, 'no such route any more (nothing handles it)');
        assert.equal(un.json?.removed, undefined);
        assert.equal((await sessions(app, 'FAC003')).sessions.find(x => x.period === 3).present.length, 2, 'nothing was deleted');
    });

    test('after college hours the same teacher is rejected with the plain message, and the UI flag goes false', async () => {
        app.clock('16:45');
        const r = await mark(app, 'FAC003', { present: [] });
        assert.equal(r.status, 403); assert.equal(r.json.error, MSG);
        const j = await sessions(app, 'FAC003');
        assert.equal(j.sessions.find(x => x.period === 3).editable, false); assert.equal(j.collegeHours.open, false);
        assert.equal(j.sessions.find(x => x.period === 3).present.length, 2);
    });

    test('next day: yesterday cannot be edited (client naming the date, or not)', async () => {
        app.clock('11:25', '2026-11-05');
        const named = await mark(app, 'FAC003', { present: [], date: DAY });
        assert.equal(named.status, 403); assert.equal(named.json.error, MSG);
        const plain = await mark(app, 'FAC003', { present: [], day: 'WED' });
        assert.equal(plain.status, 403, 'WED is not today (THUR) so it cannot be touched either');
        const old = (await sessions(app, 'FAC003', `?date=${DAY}`)).sessions.find(x => x.period === 3);
        assert.equal(old.present.length, 2, 'yesterday untouched'); assert.equal(old.editable, false);
    });
});

describe('exact college-hours boundaries (P1 starts 09:15, P6 ends 16:30)', () => {
    let app;
    before(async () => { app = await startApp(); });
    after(() => app.stop());
    test('marking opens 09:05 but editing only from 09:15; last edit minute is 16:29', async () => {
        app.clock('09:10');
        assert.equal((await mark(app, 'FAC002', { ...P1, present: [] })).status, 200, 'fresh mark at 09:10 (10 min early gate) still works');
        app.clock('09:14');
        const early = await mark(app, 'FAC002', { ...P1, present: ['x'] });
        assert.equal(early.status, 403); assert.equal(early.json.error, MSG);
        app.clock('09:15');
        assert.equal((await mark(app, 'FAC002', { ...P1, present: ['x'] })).status, 200);
        app.clock('16:29');
        assert.equal((await mark(app, 'FAC002', { ...P1, present: ['y'] })).status, 200);
        app.clock('16:30');
        const late = await mark(app, 'FAC002', { ...P1, present: ['z'] });
        assert.equal(late.status, 403); assert.equal(late.json.error, MSG);
    });
});

describe('student percentages after an edit', () => {
    const run = async (steps) => {
        const app = await startApp(); app.clock('11:25');
        try { const [A, B] = await rosterOf(app); await steps(app, A, B); return { out: await pct(app), A, B }; } finally { app.stop(); }
    };
    test('mark, edit, rollup == a fresh mark of the edited list (no double counting)', async () => {
        const viaEdit = await run(async (app, A, B) => {
            app.clock('10:00'); assert.equal((await mark(app, 'FAC002', { ...P1, present: [A, B] })).status, 200);
            app.clock('11:25'); assert.equal((await mark(app, 'FAC003', { present: [A] })).status, 200);
            app.clock('12:00'); const e = await mark(app, 'FAC003', { present: [B] }); assert.equal(e.json.edited, true);
        });
        const fresh = await run(async (app, A, B) => {
            app.clock('10:00'); assert.equal((await mark(app, 'FAC002', { ...P1, present: [A, B] })).status, 200);
            app.clock('11:25'); assert.equal((await mark(app, 'FAC003', { present: [B] })).status, 200);
        });
        assert.deepEqual(viaEdit.out, fresh.out, 'identical per-student percentages');
        const m = Object.fromEntries(viaEdit.out);
        assert.equal(m[viaEdit.A], 50, 'A: present P1, edited out of P3 -> 1 of 2');
        assert.equal(m[viaEdit.B], 100, 'B: present P1, edited into P3 -> 2 of 2');
    });
});

// Integration tests: the REAL server.js + mock Supabase + fake clock (see harness.mjs).
// Run: node --test test/   (about 20 s)
process.env.TZ = 'Asia/Kolkata';
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, SEC_A, SEC_B } from './harness.mjs';

const absent = (app, roll, on = true, sub = 'FAC019') => app.api('POST', '/api/leave-requests/teacher-absent', roll, on ? { onLeave: true, substituteRoll: sub } : { onLeave: false });
const board = async (app, roll) => (await app.api('GET', '/api/teacher/cover-board', roll)).json;
const ids = (list) => list.map(c => `${c.periodLabel}${c.short.slice(-1)}`);
const count = (app, re) => (app.logs.srv.match(re) || []).length;
const mark = (app, roll, o) => app.api('POST', '/api/attendance/mark', roll, { sectionKey: SEC_B, department: 'BTech CSE', subjectCode: 'OS', subject: 'Operating Systems', day: 'WED', period: 3, kind: 'lecture', present: ['2301109003'], ...o });
const STUDENT_B = '2301109003', STUDENT_A = '2301109001';
const cardId = (period, sec = SEC_B) => `2026-11-04|${sec}|P${period}`;

describe('cover board: cards, eligibility, first-take-wins, release', () => {
    let app;
    before(async () => { app = await startApp(); });
    after(() => app.stop());

    test('marking absent creates one card per REMAINING period + section (P1 already started)', async () => {
        app.clock('09:30');
        const r = await absent(app, 'FAC003');
        assert.equal(r.status, 200);
        assert.deepEqual(r.json.myCards.map(c => `${c.periodLabel} ${c.short}`), ['P3 CSE-B', 'P4 CSE-A', 'P5 CSE-B']);
        assert.equal(r.json.myCards[2].span, 2);
        assert.equal(r.json.delegatedTo, 'FAC019', 'leave forwarding still works');
    });

    test('eligible = free in that period AND teaches that section; nobody else sees the card', async () => {
        const seen = {};
        for (const roll of ['FAC001', 'FAC002', 'FAC004', 'FAC005', 'FAC006', 'FAC019', 'FAC003']) seen[roll] = ids((await board(app, roll)).open);
        assert.deepEqual(seen.FAC001, ['P3B', 'P4A', 'P5B']);    // FAC001: free P3-P6, teaches A and B
        assert.deepEqual(seen.FAC002, ['P4A', 'P5B']);           // busy P3 (teaching A)
        assert.deepEqual(seen.FAC004, ['P3B', 'P4A']);           // busy P5-6 (teaching A P5)
        assert.deepEqual(seen.FAC005, ['P3B', 'P5B']);           // busy P4 (teaching B P4)
        assert.deepEqual(seen.FAC006, [], 'teaches section C only');
        assert.deepEqual(seen.FAC019, [], 'free but teaches neither A nor B (also the leave substitute: no class, no card)');
        assert.deepEqual(seen.FAC003, [], 'the absent teacher sees nothing');
    });

    test('a teacher on leave no longer sees cards; their own classes become cards too', async () => {
        const r = await absent(app, 'FAC004');
        assert.equal(r.status, 200);
        assert.deepEqual(r.json.myCards.map(c => `${c.periodLabel} ${c.short}`), ['P2 CSE-B', 'P5 CSE-A']);
        const b = await board(app, 'FAC004');
        assert.deepEqual([b.open, b.taken, b.mine], [[], [], []]);
        assert.equal(b.onLeave, true);
        assert.deepEqual(ids((await board(app, 'FAC001')).open).sort(), ['P3B', 'P4A', 'P5A', 'P5B'], 'FAC001 teaches A in P2, so FAC004\'s P2 B card is not theirs');
        assert.deepEqual(ids((await board(app, 'FAC005')).open).sort(), ['P2B', 'P3B', 'P5A', 'P5B'], 'FAC005 is free in P2 and teaches B');
    });

    test('FIRST tap wins: two simultaneous takes -> exactly one 200 and one 409', async () => {
        const url = (roll) => app.api('POST', `/api/teacher/cover-board/${encodeURIComponent(cardId(3))}/take`, roll, {});
        const [a, b] = await Promise.all([url('FAC001'), url('FAC005')]);
        const codes = [a.status, b.status].sort();
        assert.deepEqual(codes, [200, 409]);
        const loser = a.status === 409 ? a : b, winnerRoll = a.status === 200 ? 'FAC001' : 'FAC005';
        assert.equal(loser.json.taken, true);
        assert.match(loser.json.error, /already taking/);
        const other = winnerRoll === 'FAC001' ? 'FAC005' : 'FAC001';
        const seeOther = await board(app, other);
        assert.equal(seeOther.taken.find(c => c.id === cardId(3)).takenBy.roll, winnerRoll);
        assert.equal(seeOther.taken.find(c => c.id === cardId(3)).canTake, false);
        assert.ok(!seeOther.open.some(c => c.id === cardId(3)), 'closed for everyone else');
        assert.equal((await board(app, winnerRoll)).mine[0].id, cardId(3));
        // the section's students are told who takes the period (async push -> wait for the log line)
        for (let i = 0; i < 30 && !/students-cover-taken\] ->/.test(app.logs.srv); i++) await new Promise(r => setTimeout(r, 100));
        const line = (app.logs.srv.match(/COVER PUSH students-cover-taken\] -> (\d+) student\(s\) of (\S+) \| (.*)/) || []);
        assert.ok(line[1] && Number(line[1]) > 0, 'students of the section were resolved: ' + app.logs.srv.slice(-400));
        assert.match(line[3], /class will be taken by/);
        app.winner = winnerRoll;
    });

    test('a teacher who is not eligible cannot take it (403); bad subject 400; double booking 403', async () => {
        const take = (id, roll, body = {}) => app.api('POST', `/api/teacher/cover-board/${encodeURIComponent(id)}/take`, roll, body);
        assert.equal((await take(cardId(4, SEC_A), 'FAC005')).status, 403, 'FAC005 is busy in P4');
        assert.equal((await take(cardId(4, SEC_A), 'FAC006')).status, 403, 'wrong section');
        assert.equal((await take(cardId(4, SEC_A), 'FAC019')).status, 403);
        assert.equal((await take(cardId(4, SEC_A), 'FAC001', { subjectCode: 'DS' })).status, 400, 'not one of FAC001\'s subjects in that section');
        const ok = await take(cardId(5, SEC_B), 'FAC001');            // lab P5-6 (2 periods)
        assert.equal(ok.status, 200);
        assert.equal((await take(cardId(5, SEC_A), 'FAC001')).status, 403, 'P5 A overlaps the lab FAC001 already took');
    });

    test('release re-opens the card for others; cannot release after the period starts', async () => {
        const w = app.winner;
        const rel = await app.api('POST', `/api/teacher/cover-board/${encodeURIComponent(cardId(3))}/release`, w, {});
        assert.equal(rel.status, 200);
        const b = await board(app, w === 'FAC001' ? 'FAC004' : 'FAC004');
        assert.ok(b.open.length === 0 && b.onLeave);              // FAC004 is on leave
        const again = await board(app, 'FAC005');
        assert.ok(again.open.some(c => c.id === cardId(3)), 're-opened');
        assert.equal((await app.api('POST', `/api/teacher/cover-board/${encodeURIComponent(cardId(3))}/release`, 'FAC002', {})).status, 409, 'not the taker');
        assert.equal((await app.api('POST', `/api/teacher/cover-board/${encodeURIComponent(cardId(3))}/take`, 'FAC005', {})).status, 200);
        app.clock('11:31');
        assert.equal((await app.api('POST', `/api/teacher/cover-board/${encodeURIComponent(cardId(3))}/release`, 'FAC005', {})).status, 409, 'period already started');
    });
});

describe('attendance ownership for a cover taker', () => {
    let app;
    before(async () => { app = await startApp(); app.clock('09:30'); await absent(app, 'FAC003'); });
    after(() => app.stop());

    test('only the taker, only that section/period, only under their OWN subject', async () => {
        assert.equal((await app.api('POST', `/api/teacher/cover-board/${encodeURIComponent(cardId(3))}/take`, 'FAC001', {})).status, 200);
        app.clock('11:25');                                       // marking opens 10 min before P3 (11:20)
        assert.equal((await mark(app, 'FAC005', {})).status, 403, 'another teacher');
        assert.equal((await mark(app, 'FAC003', { subjectCode: 'DS', subject: 'Data Structures' })).status, 403, 'the absent teacher: their subject gets no class');
        const wrongSubj = await mark(app, 'FAC001', { subjectCode: 'DS', subject: 'Data Structures' });
        assert.equal(wrongSubj.status, 403); assert.equal(wrongSubj.json.wrongSubject, true);
        assert.equal((await mark(app, 'FAC001', { period: 4, sectionKey: SEC_A })).status, 403, 'P4 A is not theirs (untaken card)');
        assert.equal((await mark(app, 'FAC001', { sectionKey: SEC_A })).status, 403, 'wrong section for the period they took');
        const ok = await mark(app, 'FAC001', {});
        assert.equal(ok.status, 200, JSON.stringify(ok.json));
        const sessions = (await app.api('GET', '/api/attendance/me', STUDENT_B)).json.sessions;
        assert.equal(sessions[0].subjectCode, 'OS', 'recorded under the TAKER\'s subject');
        assert.match(sessions[0].takenByName, /Ananya Sharma \(covering/);
        assert.equal((await mark(app, 'FAC001', {})).status, 409, 'locked once saved (existing rule)');
    });
});

describe('escalation ladder + student labels', () => {
    let app;
    before(async () => { app = await startApp(); app.clock('09:30'); await absent(app, 'FAC003'); });
    after(() => app.stop());
    const adminBoard = async () => (await app.api('GET', '/api/admin/cover-board', 'ADMIN01')).json;
    const covAll = async (roll) => (await app.api('GET', '/api/timetable', roll)).json.todayCovers;
    // the student screen shows only its own section's rows
    const cov = async (roll) => (await covAll(roll)).filter(x => x.sectionKey === (roll === STUDENT_A ? SEC_A : SEC_B));

    test('before T-30: no alert, no banner, students see nothing', async () => {
        app.clock('10:59');
        const b = await adminBoard();
        assert.equal(b.banners.length, 0);
        assert.equal(count(app, /COVER ALERT/g), 0);
        assert.deepEqual(await cov(STUDENT_B), []);
    });

    test('T-30 (11:00): ONE alert to admin + banner; repeated ticks stay at one', async () => {
        app.clock('11:00');
        for (let i = 0; i < 3; i++) await adminBoard();
        assert.equal(count(app, /COVER ALERT t30\] P3 CSE-B at 11:30 AM has no cover, nobody has taken it/g), 1);
        const b = await adminBoard();
        assert.deepEqual(b.banners.map(x => [x.text, x.level]), [['P3 CSE-B at 11:30 AM has no cover, nobody has taken it', 'warn']]);
        assert.deepEqual(await cov(STUDENT_B), [], 'still a normal class until it starts');
        assert.equal(count(app, /COVER ALERT t30/g), 1);
    });

    test('T0 (11:30): final alert once + students see "Class cancelled", no attendance, no take', async () => {
        app.clock('11:30');
        for (let i = 0; i < 4; i++) await adminBoard();
        assert.equal(count(app, /COVER ALERT t0\]/g), 1);
        assert.equal(count(app, /COVER ALERT t30/g), 1, 't30 is not repeated');
        const c = await cov(STUDENT_B);
        assert.deepEqual(c.map(x => [x.period, x.status, x.label]), [[3, 'cancelled', 'Class cancelled']]);
        const me = (await app.api('GET', '/api/attendance/me', STUDENT_B)).json;
        assert.deepEqual(me.todayCovers.map(x => x.label), ['Class cancelled']);
        assert.deepEqual((await cov(STUDENT_A)).map(x => x.period), [], 'section A unaffected');
        assert.equal((await app.api('POST', `/api/teacher/cover-board/${encodeURIComponent(cardId(3))}/take`, 'FAC001', {})).status, 409);
        assert.equal((await mark(app, 'FAC003', {})).status, 403);
        assert.equal((await mark(app, 'FAC001', {})).status, 403);
        assert.equal((await adminBoard()).banners[0].level, 'final');
    });

    test('state is stored with the day (alerts flags survive); admin can cancel an open card', async () => {
        const fs = await import('node:fs');
        const st = JSON.parse(fs.readFileSync(app.dir + '/data/teacher_absence.json', 'utf8'));
        assert.ok(st.coverCards[cardId(3)].alerts.t0 && st.coverCards[cardId(3)].alerts.t30);
        app.clock('12:00');
        const cancel = await app.api('POST', `/api/admin/cover-board/${encodeURIComponent(cardId(4, SEC_A))}/cancel`, 'ADMIN01', {});
        assert.equal(cancel.status, 200);
        assert.deepEqual((await cov(STUDENT_A)).map(x => x.label), ['Class cancelled']);
        assert.equal((await app.api('POST', `/api/admin/cover-board/${encodeURIComponent(cardId(4, SEC_A))}/cancel`, 'FAC001', {})).status, 403, 'teachers cannot');
    });
});

describe('late marking + taker labels + "I\'m here now"', () => {
    let app;
    before(async () => { app = await startApp(); });
    after(() => app.stop());

    test('marked absent only 10 minutes before a period: the T-30 alert fires at once, once', async () => {
        app.clock('11:20');
        await absent(app, 'FAC003');
        for (let i = 0; i < 3; i++) await app.api('GET', '/api/admin/cover-board', 'ADMIN01');
        assert.equal(count(app, /COVER ALERT t30\] P3 CSE-B/g), 1);
    });

    test('students see "Taken by Dr X (cover)" for a taken period', async () => {
        app.clock('11:21');
        assert.equal((await app.api('POST', `/api/teacher/cover-board/${encodeURIComponent(cardId(4, SEC_A))}/take`, 'FAC002', {})).status, 200);
        const c = (await app.api('GET', '/api/timetable', STUDENT_A)).json.todayCovers.filter(x => x.sectionKey === SEC_A);
        assert.deepEqual(c.map(x => [x.period, x.label, x.subjectCode]), [[4, 'Taken by Prof. Rajesh Kumar (cover)', 'PHY']]);
        assert.equal((await app.api('GET', '/api/admin/cover-board', 'ADMIN01')).json.banners.some(b => /P4/.test(b.text)), false);
    });

    test("I'm here now: open future cards withdrawn, the taken one stays with its taker", async () => {
        app.clock('11:22');
        const r = await absent(app, 'FAC003', false);
        assert.equal(r.status, 200);
        assert.deepEqual(r.json.myCards.map(c => [c.periodLabel, c.status]), [['P4', 'taken']], 'P3 had started (cancelled, stays); P5 withdrawn');
        const b = await board(app, 'FAC001');
        assert.equal(b.open.length, 0);
        assert.deepEqual((await board(app, 'FAC002')).mine.map(c => c.periodLabel), ['P4']);
    });
});

describe('leave forwarding to ONE mentor-substitute (unchanged behaviour)', () => {
    let app;
    before(async () => { app = await startApp(); app.clock('10:30'); });
    after(() => app.stop());
    const decide = (roll, id, action = 'REJECTED') => app.api('POST', `/api/leave-requests/${id}/decide`, roll, { action, note: '' });
    const L = (n) => `00000000-0000-4000-9000-000000000${n}`;

    test('pending leaves of the absent mentor go to the chosen substitute; classes do NOT', async () => {
        const r = await absent(app, 'FAC003', true, 'FAC019');
        assert.equal(r.status, 200);
        const q = (await app.api('GET', '/api/leave-requests/queue', 'FAC019')).json;
        assert.equal(q.covering[0].leaves.length, 3);
        assert.equal(q.covering[0].pendingCount, 3);
        assert.equal(q.covering[0].classes, undefined, 'no classes are handed to the substitute any more');
        assert.deepEqual(ids((await board(app, 'FAC019')).open), [], 'the substitute gets no class card unless eligible');
    });

    test('absent mentor is READ-ONLY for forwarded leaves (403); substitute decides and is stamped', async () => {
        const forb = await decide('FAC003', L(901));
        assert.equal(forb.status, 403); assert.equal(forb.json.forwarded, true);
        const ok = await decide('FAC019', L(901), 'APPROVED');
        assert.equal(ok.status, 200);
        assert.equal(ok.json.leave.decided_by_name, 'Dr. Meera Iyer (covering Dr. Priya Mishra)');
    });

    test("I'm here now: remaining leaves come back and the mentor can decide again", async () => {
        await absent(app, 'FAC003', false);
        const r = await decide('FAC003', L(902));
        assert.equal(r.status, 200);
    });

    test('On Leave Today only 7:00 AM-4:30 PM; substitute must be present', async () => {
        app.clock('06:55'); assert.equal((await absent(app, 'FAC003')).status, 403);
        app.clock('16:31'); assert.equal((await absent(app, 'FAC003')).status, 403);
        app.clock('10:40'); await absent(app, 'FAC019', true, 'FAC001');
        assert.equal((await absent(app, 'FAC003', true, 'FAC019')).status, 409, 'FAC019 is on leave too');
    });
});

describe('teacher features: analytics (real attendance), lesson plan (local store), my leaves (log)', () => {
    let app;
    before(async () => { app = await startApp(); app.clock('10:30'); });
    after(() => app.stop());

    test('analytics: per section + subject average and students below 75% from the stored records', async () => {
        const m = await mark(app, 'FAC001', { sectionKey: SEC_A, subjectCode: 'OS', subject: 'Operating Systems', period: 2, present: ['2301109001'] });
        assert.equal(m.status, 200, JSON.stringify(m.json));
        const r = (await app.api('GET', '/api/teacher/analytics', 'FAC001')).json;
        const a = r.sections.find(x => x.sectionKey === SEC_A), os = a.subjects.find(x => x.subjectCode === 'OS');
        assert.equal(r.threshold, 75);
        assert.equal(os.sessions, 1);
        assert.ok(a.students >= 9);
        assert.equal(os.below75.length, a.students - 1, 'everyone except the one present student is below 75%');
        assert.equal(os.avgPct, Math.round(100 / a.students * 10) / 10);
        assert.ok(r.sections.some(x => x.sectionKey === SEC_B), 'FAC001 also teaches section B (THUR)');
        assert.equal((await app.api('GET', '/api/teacher/analytics', 'ADMIN01')).status, 403);
    });

    test('lesson plan: add / tick / remove topics, only for my own subject+section', async () => {
        const post = (b, roll = 'FAC001') => app.api('POST', '/api/teacher/lesson-plan', roll, { sectionKey: SEC_A, subjectCode: 'OS', ...b });
        assert.equal((await post({ action: 'add', title: 'Process scheduling' })).status, 200);
        const r = await post({ action: 'add', title: 'Deadlocks' });
        const list = r.json.plans[`${SEC_A}|OS`];
        assert.equal(list.length, 2);
        assert.equal((await post({ action: 'toggle', id: list[0].id })).json.plans[`${SEC_A}|OS`][0].done, true);
        assert.equal((await post({ action: 'add', title: 'x' }, 'FAC006')).status, 403, 'FAC006 does not teach OS in A');
        assert.equal((await post({ action: 'remove', id: list[1].id })).json.plans[`${SEC_A}|OS`].length, 1);
        assert.equal((await app.api('GET', '/api/teacher/lesson-plan', 'FAC001')).json.plans[`${SEC_A}|OS`][0].title, 'Process scheduling');
        assert.deepEqual((await app.api('GET', '/api/teacher/lesson-plan', 'FAC002')).json.plans, {}, 'plans are per teacher');
    });

    test('my leaves: each On Leave Today is logged; count this semester / year', async () => {
        assert.equal((await app.api('GET', '/api/teacher/my-leaves', 'FAC002')).json.semesterDays, 0);
        await absent(app, 'FAC002');
        const r = (await app.api('GET', '/api/teacher/my-leaves', 'FAC002')).json;
        assert.equal(r.semesterDays, 1); assert.equal(r.yearDays, 1); assert.equal(r.leaves[0].date, '2026-11-04');
        assert.equal(r.onLeaveToday, true);
        await absent(app, 'FAC002');                         // marking again the same day does not double count
        assert.equal((await app.api('GET', '/api/teacher/my-leaves', 'FAC002')).json.semesterDays, 1);
    });
});

describe('attendance ownership (fix d792e58) still holds', () => {
    let app;
    before(async () => { app = await startApp(); app.clock('10:20'); });
    after(() => app.stop());
    test('another teacher 403, wrong day 403, the timetable teacher 200, ADMIN 200', async () => {
        const p2A = { sectionKey: SEC_A, subjectCode: 'OS', subject: 'Operating Systems', period: 2 };    // FAC001, WED P2, section A
        assert.equal((await mark(app, 'FAC005', p2A)).status, 403, 'a colleague cannot mark it');
        assert.equal((await mark(app, 'FAC001', { ...p2A, day: 'THUR' })).status, 403, 'not today');
        assert.equal((await mark(app, 'FAC001', p2A)).status, 200, 'own class today');
        assert.equal((await mark(app, 'ADMIN01', { ...p2A, sectionKey: SEC_B, period: 2, subjectCode: 'MA', subject: 'Maths' })).status, 200, 'admin unchanged');
    });
});

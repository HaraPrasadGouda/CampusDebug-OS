// Integration: admin "Undo class cancelled" through the REAL server.js (mock database, fake clock).
// Run: node --test test/coverUndo.integration.test.mjs
process.env.TZ = 'Asia/Kolkata';
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, SEC_A, SEC_B } from './harness.mjs';

const absent = (app, roll) => app.api('POST', '/api/leave-requests/teacher-absent', roll, { onLeave: true, substituteRoll: 'FAC019' });
const board = async (app, roll) => (await app.api('GET', '/api/teacher/cover-board', roll)).json;
const adminBoard = async (app) => (await app.api('GET', '/api/admin/cover-board', 'ADMIN01')).json;
const count = (app, re) => (app.logs.srv.match(re) || []).length;
const STUDENT_B = '2301109003', STUDENT_A = '2301109001';
const cardId = (period, sec = SEC_B) => `2026-11-04|${sec}|P${period}`;
const enc = encodeURIComponent;
const undo = (app, id, roll = 'ADMIN01') => app.api('POST', `/api/admin/cover-board/${enc(id)}/undo-cancel`, roll, {});
const labels = async (app, roll, sec) => (await app.api('GET', '/api/timetable', roll)).json.todayCovers.filter((x) => x.sectionKey === sec).map((x) => x.label);

describe('undo: admin-cancelled card before the period', () => {
  let app;
  before(async () => { app = await startApp(); app.clock('09:30'); await absent(app, 'FAC003'); });
  after(() => app.stop());

  test('cancel -> students see Class cancelled -> undo -> label gone, card open again, a free teacher takes it', async () => {
    app.clock('12:00');
    const id = cardId(4, SEC_A);
    assert.equal((await app.api('POST', `/api/admin/cover-board/${enc(id)}/cancel`, 'ADMIN01', {})).status, 200);
    assert.deepEqual(await labels(app, STUDENT_A, SEC_A), ['Class cancelled']);
    assert.ok(!(await board(app, 'FAC001')).open.some((c) => c.id === id), 'cancelled: nobody can take it');

    const r = await undo(app, id);
    assert.equal(r.status, 200);
    assert.match(r.json.message, /open again/);
    assert.deepEqual(await labels(app, STUDENT_A, SEC_A), [], 'students: Class cancelled is gone');
    assert.ok((await board(app, 'FAC001')).open.some((c) => c.id === id), 'free teachers see it again');
    assert.equal((await app.api('POST', `/api/teacher/cover-board/${enc(id)}/take`, 'FAC001', {})).status, 200);
    assert.match((await labels(app, STUDENT_A, SEC_A))[0], /^Taken by Dr\. Ananya Sharma/);
  });

  test('non-admins get 403 (teacher, student, no login)', async () => {
    const id = cardId(5, SEC_B);
    await app.api('POST', `/api/admin/cover-board/${enc(id)}/cancel`, 'ADMIN01', {});
    assert.equal((await undo(app, id, 'FAC001')).status, 403);
    assert.equal((await undo(app, id, STUDENT_B)).status, 403);
    assert.equal((await undo(app, id, null)).status, 401);
    assert.ok((await labels(app, STUDENT_B, SEC_B)).includes('Class cancelled'), 'still cancelled (the lab covers 2 periods)');
  });

  test('undo of a card that is not cancelled -> 409; unknown card -> 404; double undo -> 409', async () => {
    assert.equal((await undo(app, cardId(4, SEC_A))).status, 409, 'taken card');
    assert.equal((await undo(app, cardId(1, SEC_A))).status, 404, 'no such card');
    assert.equal((await undo(app, cardId(5, SEC_B))).status, 200);
    assert.equal((await undo(app, cardId(5, SEC_B))).status, 409, 'now open: nothing to undo');
  });

  test('the alert ladder fires once for the period even after cancel + undo', async () => {
    app.clock('14:00');
    for (let i = 0; i < 3; i++) await adminBoard(app);
    assert.equal(count(app, /COVER ALERT t30\] P5 CSE-B/g), 1);
    const id = cardId(5, SEC_B);
    await app.api('POST', `/api/admin/cover-board/${enc(id)}/cancel`, 'ADMIN01', {});
    assert.equal((await undo(app, id)).status, 200);
    for (let i = 0; i < 3; i++) await adminBoard(app);
    assert.equal(count(app, /COVER ALERT t30\] P5 CSE-B/g), 1, 'no second t30');
  });
});

describe('undo: a class cancelled automatically at the period start', () => {
  let app;
  before(async () => { app = await startApp(); app.clock('09:30'); await absent(app, 'FAC003'); });
  after(() => app.stop());

  test('after T0 the admin banner offers Undo; undo reopens it for the rest of the period; no new alerts', async () => {
    app.clock('11:00'); await adminBoard(app);
    app.clock('11:31');
    const b = await adminBoard(app);
    assert.deepEqual(b.banners.map((x) => [x.level, x.canUndo]), [['final', true]]);
    assert.equal(count(app, /COVER ALERT t0\] P3 CSE-B/g), 1);
    assert.deepEqual(await labels(app, STUDENT_B, SEC_B), ['Class cancelled']);

    app.clock('11:40');
    assert.equal((await undo(app, cardId(3))).status, 200);
    assert.deepEqual(await labels(app, STUDENT_B, SEC_B), [], 'label cleared');
    for (let i = 0; i < 3; i++) await adminBoard(app);
    assert.equal(count(app, /COVER ALERT t0\]/g), 1, 'no second final alert');
    assert.equal(count(app, /COVER ALERT t30\] P3 CSE-B/g), 1, 'no second t30');
    const after = await adminBoard(app);
    assert.deepEqual(after.banners.map((x) => [x.level, x.canUndo, x.canCancel]), [['warn', false, true]]);

    assert.ok((await board(app, 'FAC001')).open.some((c) => c.id === cardId(3)));
    assert.equal((await app.api('POST', `/api/teacher/cover-board/${enc(cardId(3))}/take`, 'FAC001', {})).status, 200);
    assert.match((await labels(app, STUDENT_B, SEC_B))[0], /^Taken by Dr\. Ananya Sharma/);
  });

  test('the reopened state survives a day-state reload (stored with the day)', async () => {
    const fs = await import('node:fs');
    const st = JSON.parse(fs.readFileSync(app.dir + '/data/teacher_absence.json', 'utf8'));
    assert.equal(st.coverCards[cardId(3)].reopened, true);
  });
});

describe('undo after the period ended', () => {
  let app;
  before(async () => { app = await startApp(); app.clock('09:30'); await absent(app, 'FAC003'); });
  after(() => app.stop());

  test('409 once the period is over; students keep seeing Class cancelled', async () => {
    app.clock('11:31'); await adminBoard(app);
    app.clock('12:30');
    const r = await undo(app, cardId(3));
    assert.equal(r.status, 409);
    assert.match(r.json.error, /over/);
    assert.deepEqual(await labels(app, STUDENT_B, SEC_B), ['Class cancelled']);
  });

  test('a reopened class that nobody takes shows Class cancelled again after the period ends', async () => {
    const a2 = await startApp(); try {
      a2.clock('09:30'); await absent(a2, 'FAC003');
      a2.clock('11:31'); await adminBoard(a2);
      a2.clock('11:45'); assert.equal((await undo(a2, cardId(3))).status, 200);
      assert.deepEqual(await labels(a2, STUDENT_B, SEC_B), []);
      a2.clock('12:31'); assert.deepEqual(await labels(a2, STUDENT_B, SEC_B), ['Class cancelled']);
    } finally { a2.stop(); }
  });
});

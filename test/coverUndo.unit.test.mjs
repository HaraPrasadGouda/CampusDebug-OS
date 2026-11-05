// Unit tests: admin undo of "Class cancelled" (coverBoard.js). Run: node --test test/coverUndo.unit.test.mjs
process.env.TZ = 'Asia/Kolkata';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as cb from '../coverBoard.js';
import { buildTimetable, SEC_A, SEC_B } from './harness.mjs';

const slots = buildTimetable().slots;
const at = (hm) => new Date(`2026-11-04T${hm}:00+05:30`);   // a Wednesday
const T = (roll, name = '') => ({ roll, name });
const fresh = () => { const st = { absent: {}, delegated: {}, coverCards: {} }; st.absent.FAC003 = true; cb.createCards(st, slots, { roll: 'FAC003', name: 'Dr. Priya Mishra' }, at('09:30')); return st; };
const card = (st, period) => Object.values(st.coverCards).find((c) => c.period === period);

test('admin-cancelled before the start: undo reopens, flags untouched, teacher can take', () => {
  const st = fresh(); const p4 = card(st, 4);
  assert.equal(cb.adminCancel(st, p4.id, at('12:00')).ok, true);
  assert.equal(cb.cardState(p4, at('12:00')), 'cancelled');
  const r = cb.adminUndoCancel(st, p4.id, at('12:05'));
  assert.equal(r.ok, true);
  assert.equal(cb.cardState(p4, at('12:05')), 'open');
  assert.equal(p4.reopened, undefined, 'period not started: nothing special');
  assert.deepEqual(p4.alerts, { t30: null, t0: null } , 'flags were never set, never reset');
  assert.equal(cb.takeCard(st, slots, p4.id, T('FAC001', 'Dr. Ananya Sharma'), null, at('12:06')).ok, true);
  assert.deepEqual(cb.studentOverrides(st, SEC_A, at('12:07')).map((o) => o.status), ['taken']);
});

test('alerts that already fired are never fired again after an undo', () => {
  const st = fresh(); const p3 = card(st, 3);
  assert.equal(cb.tick(st, at('11:00')).length, 1);          // t30
  assert.equal(cb.tick(st, at('11:30')).length, 1);          // t0 (class cancelled)
  const stamp = { ...p3.alerts };
  assert.equal(cb.adminUndoCancel(st, p3.id, at('11:40')).ok, true);   // auto-cancelled, period running
  assert.deepEqual(p3.alerts, stamp, 'real timestamps kept');
  for (const hm of ['11:41', '11:50', '12:10', '12:29']) assert.equal(cb.tick(st, at(hm)).length, 0, 'no alert at ' + hm);
  assert.equal(cb.cardState(p3, at('12:29')), 'open', 'stays open until the period ends, not auto-cancelled again');
});

test('undo after the start with no alert flags yet: no stale "class cancelled" alert is created', () => {
  const st = fresh(); const p3 = card(st, 3);
  cb.adminCancel(st, p3.id, at('11:35'));                    // admin cancelled while the ladder never ran
  assert.equal(cb.adminUndoCancel(st, p3.id, at('11:36')).ok, true);
  assert.equal(cb.tick(st, at('11:37')).length, 0);
  assert.equal(cb.adminView(st, at('11:37')).cards.find((c) => c.id === p3.id).finalAlertAt, null);
  assert.equal(cb.takeCard(st, slots, p3.id, T('FAC001', 'Dr. Ananya Sharma'), null, at('11:38')).ok, true);
});

test('undo is allowed up to the last minute of the period and refused (409) from its end', () => {
  const st = fresh(); const p3 = card(st, 3);
  assert.equal(cb.adminUndoCancel(st, p3.id, at('12:29')).ok, true);
  const st2 = fresh(); const q = card(st2, 3);
  const late = cb.adminUndoCancel(st2, q.id, at('12:30'));
  assert.equal(late.http, 409); assert.match(late.error, /over/);
  assert.equal(cb.cardState(q, at('12:30')), 'cancelled');
});

test('undo of something that is not cancelled is 409: open, taken, already reopened; unknown card 404', () => {
  const st = fresh(); const p4 = card(st, 4), p5 = card(st, 5);
  assert.equal(cb.adminUndoCancel(st, p4.id, at('10:00')).http, 409, 'open card');
  cb.takeCard(st, slots, p5.id, T('FAC001', 'Dr. Ananya Sharma'), null, at('10:00'));
  assert.equal(cb.adminUndoCancel(st, p5.id, at('10:01')).http, 409, 'taken card');
  assert.equal(cb.adminUndoCancel(st, 'nope', at('10:01')).http, 404);
  cb.adminCancel(st, p4.id, at('12:00'));
  assert.equal(cb.adminUndoCancel(st, p4.id, at('12:01')).ok, true);
  assert.equal(cb.adminUndoCancel(st, p4.id, at('12:02')).http, 409, 'second undo');
});

test('the admin can cancel again after an undo, and undo again', () => {
  const st = fresh(); const p3 = card(st, 3);
  cb.tick(st, at('11:30'));
  cb.adminUndoCancel(st, p3.id, at('11:35'));
  assert.equal(cb.adminCancel(st, p3.id, at('11:40')).ok, true);
  assert.equal(cb.cardState(p3, at('11:41')), 'cancelled');
  assert.equal(cb.adminUndoCancel(st, p3.id, at('11:42')).ok, true);
  assert.equal(cb.cardState(p3, at('11:43')), 'open');
});

test('admin view: canUndo only on a cancelled, not-yet-over card; the banner carries it', () => {
  const st = fresh(); const p3 = card(st, 3);
  cb.tick(st, at('11:00')); cb.tick(st, at('11:30'));
  const v = cb.adminView(st, at('11:31'));
  assert.equal(v.cards.find((c) => c.id === p3.id).canUndo, true);
  assert.deepEqual(v.banners.map((b) => [b.level, b.canUndo, b.canCancel]), [['final', true, false]]);
  cb.adminUndoCancel(st, p3.id, at('11:32'));
  const v2 = cb.adminView(st, at('11:33'));
  assert.equal(v2.cards.find((c) => c.id === p3.id).canUndo, false);
  assert.equal(v2.cards.find((c) => c.id === p3.id).reopened, true);
  assert.deepEqual(v2.banners.map((b) => [b.level, b.canUndo, b.canCancel]), [['warn', false, true]]);
  assert.equal(cb.adminView(st, at('12:31')).cards.find((c) => c.id === p3.id).canUndo, false, 'over');
});

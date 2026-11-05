// Unit tests for coverBoard.js (pure rules, injected clock). Run: node --test test/
process.env.TZ = 'Asia/Kolkata';   // the college clock (the server also runs on local time)
import test from 'node:test';
import assert from 'node:assert/strict';
import * as cb from '../coverBoard.js';
import { buildTimetable, SEC_A, SEC_B } from './harness.mjs';

const slots = buildTimetable().slots;
const at = (hm) => new Date(`2026-11-04T${hm}:00+05:30`);   // a Wednesday
const T = (roll, name = '') => ({ roll, name });
const fresh = () => ({ absent: {}, delegated: {}, coverCards: {} });
const absentate = (st, roll, name, hm) => { st.absent[roll] = true; return cb.createCards(st, slots, { roll, name }, at(hm)); };

test('one card per REMAINING class of the absent teacher (started periods are skipped)', () => {
    const st = fresh();
    const made = absentate(st, 'FAC003', 'Dr. Priya Mishra', '09:30');     // P1 (9:15) already started
    assert.deepEqual(made.map(c => `${c.periodLabel} ${c.short}`), ['P3 CSE-B', 'P4 CSE-A', 'P5 CSE-B']);
    assert.equal(made.find(c => c.period === 5).span, 2, 'the 2-period lab is ONE card');
    assert.equal(Object.keys(st.coverCards).length, 3);
    assert.equal(cb.createCards(st, slots, { roll: 'FAC003', name: 'Dr. Priya Mishra' }, at('09:31')).length, 0, 'idempotent');
});

test('eligibility: free + teaches that section; excluded: busy, on leave, wrong section, the absent teacher', () => {
    const st = fresh();
    absentate(st, 'FAC003', 'Dr. Priya Mishra', '09:30');
    const p3B = Object.values(st.coverCards).find(c => c.period === 3);
    const why = (roll) => cb.eligibility(st, slots, p3B, T(roll), at('09:35'));
    assert.equal(why('FAC001').ok, true);          // free P3, teaches B (THUR)
    assert.equal(why('FAC004').ok, true);
    assert.equal(why('FAC005').ok, true);
    assert.equal(why('FAC002').why, 'busy');       // teaching A in P3
    assert.equal(why('FAC006').why, 'wrongSection');
    assert.equal(why('FAC019').why, 'wrongSection'); // free, but teaches neither A nor B
    assert.equal(why('FAC003').why, 'onLeave');      // the absent teacher
    st.absent.FAC004 = true;
    assert.equal(why('FAC004').why, 'onLeave');
    assert.equal(cb.eligibility(st, slots, p3B, T('FAC003'), at('09:35')).ok, false);
});

test('first take wins; the second gets 409; release re-opens; release after start refused', () => {
    const st = fresh(); absentate(st, 'FAC003', 'Dr. Priya Mishra', '09:30');
    const id = Object.values(st.coverCards).find(c => c.period === 3).id;
    const a = cb.takeCard(st, slots, id, T('FAC001', 'Dr. Ananya Sharma'), null, at('10:00'));
    const b = cb.takeCard(st, slots, id, T('FAC004', 'Prof. Sandeep Das'), null, at('10:00'));
    assert.equal(a.ok, true); assert.equal(a.card.takenBy.subjectCode, 'OS');
    assert.equal(b.http, 409); assert.match(b.error, /Dr\. Ananya Sharma/);
    assert.equal(cb.boardFor(st, slots, T('FAC004', 'Prof. Sandeep Das'), at('10:01')).taken[0].takenBy.name, 'Dr. Ananya Sharma');
    assert.equal(cb.releaseCard(st, id, T('FAC004'), at('10:02')).http, 409, 'only the taker can release');
    assert.equal(cb.releaseCard(st, id, T('FAC001'), at('10:02')).ok, true);
    assert.equal(st.coverCards[id].status, 'open');
    assert.equal(cb.takeCard(st, slots, id, T('FAC004', 'Prof. Sandeep Das'), 'MA', at('10:05')).ok, true);
    assert.equal(cb.releaseCard(st, id, T('FAC004'), at('11:31')).http, 409, 'period started');
});

test('ladder: T-30 alert once, T0 final alert once, then Class cancelled; repeated ticks add nothing', () => {
    const st = fresh(); absentate(st, 'FAC003', 'Dr. Priya Mishra', '09:30');
    const p3 = Object.values(st.coverCards).find(c => c.period === 3);       // starts 11:30
    assert.equal(cb.tick(st, at('10:59')).length, 0);
    const e1 = cb.tick(st, at('11:00'));
    assert.deepEqual(e1.map(e => e.type), ['t30']);
    assert.equal(e1[0].text, 'P3 CSE-B at 11:30 AM has no cover, nobody has taken it');
    assert.equal(cb.tick(st, at('11:01')).length, 0); assert.equal(cb.tick(st, at('11:29')).length, 0);
    assert.deepEqual(cb.tick(st, at('11:30')).map(e => e.type), ['t0']);
    assert.equal(cb.tick(st, at('11:31')).length, 0); assert.equal(cb.tick(st, at('11:32')).length, 0);
    assert.equal(cb.cardState(p3, at('11:29')), 'open'); assert.equal(cb.cardState(p3, at('11:30')), 'cancelled');
    assert.deepEqual(cb.studentOverrides(st, SEC_B, at('11:31')).map(o => [o.period, o.status, o.label]), [[3, 'cancelled', 'Class cancelled']]);
});

test('a taken card never alerts or cancels; student sees "Taken by"', () => {
    const st = fresh(); absentate(st, 'FAC003', 'Dr. Priya Mishra', '09:30');
    const id = Object.values(st.coverCards).find(c => c.period === 4).id;     // P4 A, 13:30
    cb.takeCard(st, slots, id, T('FAC001', 'Dr. Ananya Sharma'), null, at('10:00'));
    assert.ok(!cb.tick(st, at('13:40')).some(e => e.card.id === id));
    assert.deepEqual(cb.studentOverrides(st, SEC_A, at('13:40')).map(o => o.label), ['Taken by Dr. Ananya Sharma (cover)']);
});

test("I'm here now: future open cards withdrawn, taken ones stay", () => {
    const st = fresh(); absentate(st, 'FAC003', 'Dr. Priya Mishra', '09:30');
    const p4 = Object.values(st.coverCards).find(c => c.period === 4);
    cb.takeCard(st, slots, p4.id, T('FAC001', 'Dr. Ananya Sharma'), null, at('10:00'));
    const out = cb.withdrawFor(st, 'FAC003', at('10:30'));
    assert.deepEqual(out.map(c => c.period).sort(), [3, 5]);
    assert.equal(p4.status, 'taken');
    // goes on leave again later: withdrawn cards revive
    assert.deepEqual(cb.createCards(st, slots, { roll: 'FAC003', name: 'Dr. Priya Mishra' }, at('10:40')).map(c => c.period).sort(), [3, 5]);
});

test('taker may mark only that section/period under their own subject', () => {
    const st = fresh(); absentate(st, 'FAC003', 'Dr. Priya Mishra', '09:30');
    const p4 = Object.values(st.coverCards).find(c => c.period === 4);
    cb.takeCard(st, slots, p4.id, T('FAC001', 'Dr. Ananya Sharma'), null, at('10:00'));
    const may = (roll, o) => cb.takerMayMark(st, roll, { sectionKey: SEC_A, period: 4, subjectCode: 'OS', ...o }, at('13:25'));
    assert.equal(may('fac001').ok, true);
    assert.equal(may('FAC001', { subjectCode: 'DS' }).wrongSubject, true);
    assert.equal(may('FAC001', { period: 3 }).ok, false);
    assert.equal(may('FAC001', { sectionKey: SEC_B }).ok, false);
    assert.equal(may('FAC002').ok, false);
    assert.equal(may('FAC003').ok, false);
});

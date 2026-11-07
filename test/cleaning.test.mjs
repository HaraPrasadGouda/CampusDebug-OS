// Node tests for the room cleaning rules (cleaning.js) with an in-memory store and an injected clock.
// Run: node --test test/cleaning.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSettings, answerWindow, lastClosedWindowDate, classifyRoom, studentView,
  answerRoom, closeWindow, morningSms, pendingSmsText, wardenBlockView, fmtClock
} from '../cleaning.js';

// 2026-11-08 is a Sunday. IST = UTC+5:30, so 13:00 IST = 07:30Z.
const ist = (iso) => new Date(iso); // pass UTC instants written explicitly
const SUN_12 = ist('2026-11-08T06:30:00Z'); // 12:00 IST  (before window)
const SUN_13 = ist('2026-11-08T07:30:00Z'); // 13:00 IST  (window opens)
const SUN_15 = ist('2026-11-08T09:30:00Z'); // 15:00 IST
const SUN_2059 = ist('2026-11-08T15:29:00Z'); // 20:59 IST (last open minute)
const SUN_21 = ist('2026-11-08T15:30:00Z'); // 21:00 IST (closed)
const MON_0730 = ist('2026-11-08T02:00:00Z'); // Mon 07:30 IST? (02:00Z = 07:30 IST on Sunday)
const MON_0730_REAL = ist('2026-11-09T02:00:00Z'); // Mon 07:30 IST
const MON_1245 = ist('2026-11-09T07:15:00Z'); // Mon 12:45 IST

const S = normalizeSettings({}, 'Block B'); // defaults: Sunday, 08:00-13:00

function memStore() {
  const rows = [];
  const key = (r) => `${r.block}|${r.room}|${r.check_date}`;
  let n = 0;
  return {
    rows,
    async listChecks({ block, date } = {}) { return rows.filter((r) => (!block || r.block === block) && (!date || r.check_date === date)).map((r) => ({ ...r })); },
    async getCheck(block, room, date) { const r = rows.find((x) => x.block === block && x.room === room && x.check_date === date); return r ? { ...r } : null; },
    async upsertCheck(row) {
      const i = rows.findIndex((r) => key(r) === key(row));
      const saved = { id: i >= 0 ? rows[i].id : `c${++n}`, ...(i >= 0 ? rows[i] : {}), ...row };
      if (i >= 0) rows[i] = saved; else rows.push(saved);
      return { ...saved };
    }
  };
}

// roster helper: rooms with roll lists and an away set
function roomsFixture(extra = {}) {
  return {
    'Block B|101': { room: '101', rolls: ['R1', 'R2', 'R3'], away: new Set(), names: { R1: 'Ravi', R2: 'Ajay', R3: 'Sana' }, ids: { R1: 'p1', R2: 'p2', R3: 'p3' } },
    'Block B|102': { room: '102', rolls: ['R4', 'R5'], away: new Set(['R4', 'R5']), names: { R4: 'Om', R5: 'Pia' }, ids: { R4: 'p4', R5: 'p5' } },
    'Block B|103': { room: '103', rolls: ['R6'], away: new Set(), names: { R6: 'Dev' }, ids: { R6: 'p6' } },
    'Block B|104': { room: '104', rolls: ['R7', 'R8'], away: new Set(), names: { R7: 'Kiran', R8: 'Lipi' }, ids: { R7: 'p7', R8: 'p8' } },
    ...extra
  };
}
function deps(store, rooms = roomsFixture()) {
  const tickets = [];
  return {
    store,
    tickets,
    roomOf: async (b, r) => rooms[`${b}|${r}`] || null,
    roster: async (b) => Object.values(rooms).filter((r) => r.block === undefined || true).map((r) => ({ ...r })).filter((r) => `${'Block B'}|${r.room}` in rooms),
    createTicket: async ({ block, room, date, check }) => { tickets.push({ block, room, date, from: check?.answered_by }); return `T${tickets.length}`; },
    cleanersOf: async () => [{ id: 'TECH-B1', name: 'Asha', phone: '+919000000006' }, { id: 'TECH-B2', name: 'Bhanu', phone: '+919000000007' }],
    sendSms: async (c, text) => ({ mode: 'dry-run', to: c.id, text }),
  };
}

test('settings default to Sunday 8 AM to 1 PM', () => {
  assert.deepEqual(S.weekdays, [0]);
  assert.equal(S.startTime, '08:00');
  assert.equal(S.endTime, '13:00');
});

test('answer window: closed before 1 PM, open 1-9 PM on cleaning day, none on other days', () => {
  assert.equal(answerWindow(S, SUN_12).state, 'before');
  assert.equal(answerWindow(S, SUN_13).state, 'open');
  assert.equal(answerWindow(S, SUN_2059).state, 'open');
  assert.equal(answerWindow(S, SUN_21).state, 'closed');
  assert.equal(answerWindow(S, MON_1245).state, 'none');
  assert.equal(answerWindow(S, SUN_13).date, '2026-11-08');
});

test('lastClosedWindowDate: today only after 9 PM, else the previous cleaning day', () => {
  assert.equal(lastClosedWindowDate(S, SUN_21), '2026-11-08');
  assert.equal(lastClosedWindowDate(S, SUN_15), '2026-11-01');
  assert.equal(lastClosedWindowDate(S, MON_0730_REAL), '2026-11-08');
});

test('room classification: cleaned / not_cleaned / no_reply / vacant', () => {
  assert.equal(classifyRoom({ occupants: ['a'], check: { answer: 'yes' } }), 'cleaned');
  assert.equal(classifyRoom({ occupants: ['a'], check: { answer: 'no' } }), 'not_cleaned');
  assert.equal(classifyRoom({ occupants: ['a', 'b'], away: new Set(['a']) }), 'no_reply');
  assert.equal(classifyRoom({ occupants: ['a', 'b'], away: new Set(['a', 'b']) }), 'vacant');
});

test('lock: first roommate answers for the room; others get 409 with the name', async () => {
  const st = memStore(); const d = deps(st);
  const a = await answerRoom(d, { block: 'Block B', room: '101', roll: 'R1', answer: 'no', now: SUN_13, settings: S });
  assert.equal(a.ok, true);
  const b = await answerRoom(d, { block: 'Block B', room: '101', roll: 'R2', answer: 'yes', now: SUN_15, settings: S });
  assert.equal(b.status, 409);
  assert.equal(b.body.answeredByName, 'Ravi');
  assert.match(b.body.error, /Ravi/);
});

test('the answerer may change Haan <-> Nahi until 9 PM, and that row stays one row', async () => {
  const st = memStore(); const d = deps(st);
  await answerRoom(d, { block: 'Block B', room: '101', roll: 'R1', answer: 'no', now: SUN_13, settings: S });
  const c = await answerRoom(d, { block: 'Block B', room: '101', roll: 'R1', answer: 'yes', now: SUN_15, settings: S });
  assert.equal(c.ok, true);
  assert.equal(c.body.answer, 'yes');
  assert.equal(st.rows.length, 1);
});

test('window gating: no answer before 1 PM or after 9 PM, nor on other days', async () => {
  const st = memStore(); const d = deps(st);
  for (const now of [SUN_12, SUN_21, MON_1245]) {
    const r = await answerRoom(d, { block: 'Block B', room: '101', roll: 'R1', answer: 'yes', now, settings: S });
    assert.equal(r.status, 403, `at ${now.toISOString()}`);
  }
  assert.equal(st.rows.length, 0);
});

test('away students are not asked; a room with only away students cannot be answered', async () => {
  const st = memStore(); const d = deps(st);
  const r = await answerRoom(d, { block: 'Block B', room: '102', roll: 'R4', answer: 'yes', now: SUN_13, settings: S });
  assert.equal(r.status, 403);
  assert.equal(st.rows.length, 0);
});

test('student view: open, locked by roommate, answered by me, and hidden when away or outside the window', async () => {
  const st = memStore(); const d = deps(st);
  await answerRoom(d, { block: 'Block B', room: '101', roll: 'R1', answer: 'no', now: SUN_13, settings: S });
  const check = await st.getCheck('Block B', '101', '2026-11-08');
  assert.equal(studentView({ settings: S, now: SUN_13, roll: 'R2', check }).state, 'locked_by_other');
  assert.equal(studentView({ settings: S, now: SUN_13, roll: 'R2', check }).answeredByName, 'Ravi');
  assert.equal(studentView({ settings: S, now: SUN_13, roll: 'R1', check }).state, 'answered_by_me');
  assert.equal(studentView({ settings: S, now: SUN_13, roll: 'R3', check: null }).state, 'open');
  assert.equal(studentView({ settings: S, now: SUN_12, roll: 'R3', check: null }).show, false);
  assert.equal(studentView({ settings: S, now: SUN_21, roll: 'R3', check: null }).show, false);
  assert.equal(studentView({ settings: S, now: SUN_13, roll: 'R4', away: new Set(['R4']) }).show, false);
});

test('close: not-cleaned rooms get one ticket each, no_reply and vacant get none; a second close creates nothing', async () => {
  const st = memStore(); const d = deps(st);
  await answerRoom(d, { block: 'Block B', room: '101', roll: 'R1', answer: 'no', now: SUN_13, settings: S });
  await answerRoom(d, { block: 'Block B', room: '104', roll: 'R7', answer: 'yes', now: SUN_15, settings: S });
  const first = await closeWindow(d, { block: 'Block B', date: '2026-11-08' });
  assert.equal(first.counts.not_cleaned, 1);
  assert.equal(first.counts.cleaned, 1);
  assert.equal(first.counts.vacant, 1);      // room 102: all away
  assert.equal(first.counts.no_reply, 1);    // room 103: one resident, nobody answered
  assert.equal(d.tickets.length, 1);
  assert.equal(d.tickets[0].room, '101');
  const again = await closeWindow(d, { block: 'Block B', date: '2026-11-08' });
  assert.equal(again.tickets, 0);
  assert.equal(d.tickets.length, 1, 'ticket exactly once per room per day');
});

test('pending SMS: one message per block to both cleaners, ASCII, within 160 chars, idempotent', async () => {
  const st = memStore(); const rooms = roomsFixture();
  // many not-cleaned rooms to force the 160 limit
  for (let i = 0; i < 40; i++) {
    const r = String(200 + i);
    rooms[`Block B|${r}`] = { room: r, rolls: [`X${i}`], away: new Set(), names: { [`X${i}`]: 'S' }, ids: { [`X${i}`]: `q${i}` } };
  }
  const d = deps(st, rooms);
  for (const r of Object.keys(rooms).map((k) => k.split('|')[1])) {
    await answerRoom(d, { block: 'Block B', room: r, roll: rooms[`Block B|${r}`].rolls[0], answer: 'no', now: SUN_13, settings: S });
  }
  await closeWindow(d, { block: 'Block B', date: '2026-11-08' });
  const sent = [];
  d.sendSms = async (c, text) => { sent.push({ to: c.id, text }); return { mode: 'dry-run' }; };
  const first = await morningSms(d, { block: 'Block B', date: '2026-11-08', settings: S, now: MON_0730_REAL });
  assert.equal(first.sent, true);
  assert.equal(sent.length, 2, 'both cleaners get it');
  assert.deepEqual(sent.map((s) => s.to), ['TECH-B1', 'TECH-B2']);
  assert.equal(sent[0].text, sent[1].text);
  assert.ok(sent[0].text.length <= 160, `length ${sent[0].text.length}`);
  assert.match(sent[0].text, /^Block B: \d+ rooms need cleaning today\. Check with the warden\. Clean by 1 PM$/);
  assert.ok(!/\d{3}, /.test(sent[0].text), 'no room list in the SMS');
  assert.ok(/^[\x20-\x7e]*$/.test(sent[0].text), 'plain ASCII');
  const second = await morningSms(d, { block: 'Block B', date: '2026-11-08', settings: S, now: MON_0730_REAL });
  assert.equal(second.sent, false);
  assert.equal(sent.length, 2, 're-run sends nothing');
});

test('pending SMS: outside the 07:30-13:00 morning slot nothing is sent', async () => {
  const st = memStore(); const d = deps(st);
  await answerRoom(d, { block: 'Block B', room: '101', roll: 'R1', answer: 'no', now: SUN_13, settings: S });
  await closeWindow(d, { block: 'Block B', date: '2026-11-08' });
  const early = await morningSms(d, { block: 'Block B', date: '2026-11-08', settings: S, now: ist('2026-11-09T01:00:00Z') }); // 06:30 IST
  assert.equal(early.sent, false);
});

test('pendingSmsText: one generic line with the room count', () => {
  const short = pendingSmsText({ block: 'Block B', rooms: [{ room: '204' }, { room: '210' }], endTime: '13:00' });
  assert.equal(short, 'Block B: 2 rooms need cleaning today. Check with the warden. Clean by 1 PM');
  assert.equal(pendingSmsText({ block: 'Block B', rooms: [{ room: '204' }], endTime: '13:00' }), 'Block B: 1 room needs cleaning today. Check with the warden. Clean by 1 PM');
  assert.equal(fmtClock(13 * 60 + 30), '1:30 PM');
});

test('warden view: per-room status, who answered, counts', async () => {
  const st = memStore(); const d = deps(st);
  await answerRoom(d, { block: 'Block B', room: '101', roll: 'R2', answer: 'yes', now: SUN_13, settings: S });
  await closeWindow(d, { block: 'Block B', date: '2026-11-08' });
  const checks = await st.listChecks({ block: 'Block B', date: '2026-11-08' });
  const rooms = Object.values(roomsFixture()).filter((r) => r.room);
  const v = wardenBlockView({ settings: S, rooms, checks, cleaners: [], ticketsById: new Map() });
  const r101 = v.rooms.find((r) => r.room === '101');
  assert.equal(r101.status, 'cleaned');
  assert.equal(r101.answeredByName, 'Ajay');
  assert.equal(v.counts.vacant, 1);
});

test('a closed day is final: a room that was no_reply stays no_reply even if everyone leaves later', async () => {
  const st = memStore(); const rooms = roomsFixture(); const d = deps(st, rooms);
  await closeWindow(d, { block: 'Block B', date: '2026-11-08' });
  assert.equal((await st.getCheck('Block B', '101', '2026-11-08')).status, 'no_reply');
  rooms['Block B|101'].away = new Set(['R1', 'R2', 'R3']); // all leave on Monday
  await closeWindow(d, { block: 'Block B', date: '2026-11-08' });
  assert.equal((await st.getCheck('Block B', '101', '2026-11-08')).status, 'no_reply');
});

test('a room answered Haan is cleaned and gets no ticket; Nahi from the first answerer files the ticket under that student', async () => {
  const st = memStore(); const d = deps(st);
  await answerRoom(d, { block: 'Block B', room: '103', roll: 'R6', answer: 'yes', now: SUN_15, settings: S });
  await answerRoom(d, { block: 'Block B', room: '104', roll: 'R8', answer: 'no', now: SUN_15, settings: S });
  await closeWindow(d, { block: 'Block B', date: '2026-11-08' });
  assert.equal(d.tickets.length, 1);
  assert.deepEqual(d.tickets[0], { block: 'Block B', room: '104', date: '2026-11-08', from: 'R8' });
});

test('answer exactly at 21:00 is closed, at 20:59 still open (boundaries)', async () => {
  const st = memStore(); const d = deps(st);
  assert.equal((await answerRoom(d, { block: 'Block B', room: '101', roll: 'R1', answer: 'yes', now: SUN_2059, settings: S })).status, 200);
  assert.equal((await answerRoom(d, { block: 'Block B', room: '101', roll: 'R1', answer: 'no', now: SUN_21, settings: S })).status, 403);
  assert.equal((await st.getCheck('Block B', '101', '2026-11-08')).answer, 'yes', 'the 21:00 attempt changed nothing');
});

test('warden may change days: a Wednesday-only block has no window on Sunday', () => {
  const wed = normalizeSettings({ weekdays: [3], start_time: '09:00', end_time: '12:00' }, 'Block A');
  assert.equal(answerWindow(wed, SUN_15).state, 'none');
  assert.equal(answerWindow(wed, ist('2026-11-11T06:30:00Z')).state, 'open'); // Wed 12:00 IST = window opens at the end time
  assert.equal(answerWindow(wed, ist('2026-11-11T06:29:00Z')).state, 'before');
});

test('warden view reports Not fixed counts for the red alert', async () => {
  const st = memStore(); const d = deps(st);
  await answerRoom(d, { block: 'Block B', room: '104', roll: 'R7', answer: 'no', now: SUN_15, settings: S });
  await closeWindow(d, { block: 'Block B', date: '2026-11-08' });
  const checks = await st.listChecks({ block: 'Block B', date: '2026-11-08' });
  const rooms = Object.values(roomsFixture());
  const t = checks.find((c) => c.room === '104').ticket_id;
  const v = wardenBlockView({ settings: S, rooms, checks, cleaners: [], ticketsById: new Map([[String(t), { not_fixed_count: 2 }]]) });
  assert.equal(v.rooms.find((r) => r.room === '104').notFixedCount, 2);
});

test('SMS text never exceeds 160 chars, even with 300 rooms', () => {
  const rooms = Array.from({ length: 300 }, (_, i) => ({ room: String(1000 + i) }));
  const t = pendingSmsText({ block: 'Block D', rooms, endTime: '13:00' });
  assert.ok(t.length <= 160 && /^Block D: 300 rooms need cleaning today/.test(t), t);
});

test('pending SMS: up to 5 rooms only the first cleaner is texted, more rooms both', async () => {
  const st = memStore(); const d = deps(st);
  await answerRoom(d, { block: 'Block B', room: '101', roll: 'R1', answer: 'no', now: SUN_13, settings: S });
  await closeWindow(d, { block: 'Block B', date: '2026-11-08' });
  const sent = [];
  d.sendSms = async (c, text) => { sent.push({ to: c.id, text }); return { mode: 'dry-run' }; };
  const r = await morningSms(d, { block: 'Block B', date: '2026-11-08', settings: S, now: MON_0730_REAL });
  assert.equal(r.sent, true);
  assert.equal(sent.length, 1, 'few rooms: one cleaner');
  assert.deepEqual(r.to, ['TECH-B1']);
});

test('warden choice of cleaners overrides the automatic rule, and normalizeSettings reads it', async () => {
  assert.equal(normalizeSettings({ cleaner_count: 2 }, 'Block B').cleanerCount, 2);
  assert.equal(normalizeSettings({ cleaner_count: 9 }, 'Block B').cleanerCount, 0);
  assert.equal(normalizeSettings({}, 'Block B').cleanerCount, 0);
  const st = memStore(); const d = deps(st);
  await answerRoom(d, { block: 'Block B', room: '101', roll: 'R1', answer: 'no', now: SUN_13, settings: S });
  await closeWindow(d, { block: 'Block B', date: '2026-11-08' });
  const sent = [];
  d.sendSms = async (c, text) => { sent.push(c.id); return { mode: 'dry-run' }; };
  const r = await morningSms(d, { block: 'Block B', date: '2026-11-08', settings: { ...S, cleanerCount: 2 }, now: MON_0730_REAL });
  assert.equal(sent.length, 2, 'warden chose both even for one room');
  assert.deepEqual(r.to, ['TECH-B1', 'TECH-B2']);
});

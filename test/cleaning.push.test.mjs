// Node tests for the 1 PM "Room check" push (cleaning.js openingPush + cleaning-store.js push log).
// Run: node --test test/cleaning.push.test.mjs   (no database, no network: in-memory store, injected clock)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalizeSettings, openingPush, pushRecipients, pushBody, PUSH_TITLE } from '../cleaning.js';
import { createCleaningStore } from '../cleaning-store.js';

// 2026-11-08 is a Sunday; IST = UTC+5:30 so 13:00 IST = 07:30Z.
const at = (iso) => new Date(iso);
const SUN_1259 = at('2026-11-08T07:29:00Z');
const SUN_13 = at('2026-11-08T07:30:00Z');
const SUN_1301 = at('2026-11-08T07:31:00Z');
const SUN_2059 = at('2026-11-08T15:29:00Z');
const SUN_21 = at('2026-11-08T15:30:00Z');
const MON_13 = at('2026-11-09T07:30:00Z');      // not a cleaning day for the default settings
const S = normalizeSettings({}, 'Block B');     // Sunday, 08:00-13:00 -> question 13:00-21:00

const rooms = () => [
  { block: 'Block B', room: '101', rolls: ['R1', 'R2', 'R3'], away: new Set() },
  { block: 'Block B', room: '102', rolls: ['R4', 'R5'], away: new Set(['R4', 'R5']) },     // vacant: both away
  { block: 'Block B', room: '103', rolls: ['R6', 'R7'], away: new Set(['R7']) },          // R7 away
  { block: 'Block B', room: '104', rolls: ['R8', 'R9'], away: new Set() }
];

// A store with the same methods the server uses, only in memory.
function memStore() {
  const checks = [];
  const pushed = {};
  return {
    checks,
    async listChecks({ block, date }) { return checks.filter((c) => c.block === block && c.check_date === date); },
    async listPushed({ date }) { return new Set(pushed[date] || []); },
    async markPushed({ date, rolls }) { pushed[date] = [...new Set([...(pushed[date] || []), ...rolls])]; }
  };
}
function harness(store = memStore(), roomList = rooms()) {
  const sent = [];
  return { store, sent, deps: { store, roster: async () => roomList, send: async (rolls, msg) => { sent.push({ rolls, msg }); } } };
}

test('sends once at 13:00 to the students who will be asked, with the real closing time', async () => {
  const h = harness();
  const r = await openingPush(h.deps, { block: 'Block B', settings: S, now: SUN_13 });
  assert.equal(r.sent, 6);
  assert.equal(h.sent.length, 1);
  assert.deepEqual(h.sent[0].rolls.sort(), ['R1', 'R2', 'R3', 'R6', 'R8', 'R9']);   // R4,R5 (vacant) and R7 (away) skipped
  assert.equal(h.sent[0].msg.title, 'Room check');
  assert.equal(h.sent[0].msg.body, 'Was your room cleaned today? Answer before 9 PM.');
});

test('the closing time in the text follows the block settings (window end 14:30 -> 10:30 PM)', async () => {
  const h = harness();
  const late = normalizeSettings({ end_time: '14:30:00' }, 'Block B');
  assert.equal(pushBody(22 * 60 + 30), 'Was your room cleaned today? Answer before 10:30 PM.');
  assert.equal((await openingPush(h.deps, { block: 'Block B', settings: late, now: SUN_13 })).sent, 0, 'window starts 14:30');
  const r = await openingPush(h.deps, { block: 'Block B', settings: late, now: at('2026-11-08T09:00:00Z') });   // 14:30 IST
  assert.equal(r.sent, 6);
  assert.match(h.sent[0].msg.body, /10:30 PM/);
});

test('nothing at 12:59', async () => {
  const h = harness();
  const r = await openingPush(h.deps, { block: 'Block B', settings: S, now: SUN_1259 });
  assert.equal(r.sent, 0);
  assert.equal(h.sent.length, 0);
  assert.deepEqual([...(await h.store.listPushed({ date: '2026-11-08' }))], [], 'nothing logged either');
});

test('a second tick (or a restart that reuses the persisted log) never sends twice', async () => {
  const h = harness();
  await openingPush(h.deps, { block: 'Block B', settings: S, now: SUN_13 });
  await openingPush(h.deps, { block: 'Block B', settings: S, now: SUN_1301 });
  await openingPush(h.deps, { block: 'Block B', settings: S, now: SUN_2059 });
  assert.equal(h.sent.length, 1);
  // "restart": a brand-new harness object on the SAME store (the persisted log) -> still nothing new
  const h2 = harness(h.store);
  assert.equal((await openingPush(h2.deps, { block: 'Block B', settings: S, now: SUN_1301 })).sent, 0);
  assert.equal(h2.sent.length, 0);
});

test('a student who becomes eligible later (comes back from leave) gets exactly one push; the others none', async () => {
  const list = rooms();
  const h = harness(memStore(), list);
  await openingPush(h.deps, { block: 'Block B', settings: S, now: SUN_13 });
  list[2].away = new Set();                                         // R7 returns at 3 PM
  const r = await openingPush(h.deps, { block: 'Block B', settings: S, now: at('2026-11-08T09:30:00Z') });
  assert.equal(r.sent, 1);
  assert.deepEqual(h.sent[1].rolls, ['R7']);
  assert.equal((await openingPush(h.deps, { block: 'Block B', settings: S, now: SUN_2059 })).sent, 0);
});

test('a room that a roommate already answered (locked) is skipped', async () => {
  const h = harness();
  h.store.checks.push({ block: 'Block B', room: '101', check_date: '2026-11-08', answered_by: 'R2', answer: 'yes' });
  await openingPush(h.deps, { block: 'Block B', settings: S, now: SUN_1301 });
  assert.deepEqual(h.sent[0].rolls.sort(), ['R6', 'R8', 'R9']);
});

test('a check row without an answer (no answered_by) does not lock the room', () => {
  const rolls = pushRecipients({ rooms: rooms(), checks: [{ room: '101', answered_by: null }], alreadyPushed: new Set() });
  assert.ok(rolls.includes('R1') && rolls.includes('R2') && rolls.includes('R3'));
});

test('nothing at 21:00 or after, nothing on a non-cleaning day, answered rooms of other blocks do not matter', async () => {
  const h = harness();
  assert.equal((await openingPush(h.deps, { block: 'Block B', settings: S, now: SUN_21 })).sent, 0);
  assert.equal((await openingPush(h.deps, { block: 'Block B', settings: S, now: MON_13 })).sent, 0);
  assert.equal(h.sent.length, 0);
  assert.equal((await openingPush(h.deps, { block: 'Block B', settings: S, now: SUN_2059 })).sent, 6, 'the last open minute still counts');
});

test('the next cleaning day is a new day: one push again', async () => {
  const h = harness();
  await openingPush(h.deps, { block: 'Block B', settings: S, now: SUN_13 });
  const next = at('2026-11-15T07:30:00Z');
  assert.equal((await openingPush(h.deps, { block: 'Block B', settings: S, now: next })).sent, 6);
  assert.equal(h.sent.length, 2);
});

test('if marking the log fails nothing is sent (never twice, even on a broken store)', async () => {
  const h = harness();
  h.store.markPushed = async () => { throw new Error('db down'); };
  await assert.rejects(openingPush(h.deps, { block: 'Block B', settings: S, now: SUN_13 }), /db down/);
  assert.equal(h.sent.length, 0);
});

test('real store, local JSON fallback (no database): log survives a restart of the store', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cdb-push-')), 'cleaning_store.json');
  const a = createCleaningStore({ supabase: null, file });
  const h = harness(a);
  assert.equal((await openingPush(h.deps, { block: 'Block B', settings: S, now: SUN_13 })).sent, 6);
  const b = createCleaningStore({ supabase: null, file });            // server restart: store re-reads the file
  const h2 = harness(b);
  assert.equal((await openingPush(h2.deps, { block: 'Block B', settings: S, now: SUN_1301 })).sent, 0);
  assert.equal(h2.sent.length, 0);
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).pushLog['2026-11-08'].includes('R1'));
});

test('local log keeps only the last 14 days', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cdb-push-')), 's.json');
  const st = createCleaningStore({ supabase: null, file });
  for (let d = 1; d <= 20; d++) await st.markPushed({ block: 'Block B', date: `2026-10-${String(d).padStart(2, '0')}`, rolls: ['R1'] });
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).pushLog).length, 14);
});

// A tiny fake of the supabase-js query builder: every table answers normally except the ones in `missing`.
function fakeSupabase({ missing = [] } = {}) {
  const tables = {};
  const calls = [];
  const builder = (name) => {
    const q = { filters: {} };
    const result = () => {
      calls.push(name);
      if (missing.includes(name)) return { data: null, error: { code: '42P01', message: `relation "public.${name}" does not exist` } };
      return { data: (tables[name] || []).filter((r) => Object.entries(q.filters).every(([k, v]) => String(r[k]) === String(v))), error: null };
    };
    const api = {
      select: () => api, eq: (k, v) => { q.filters[k] = v; return api; }, limit: () => api, order: () => api,
      upsert: (rows) => {
        if (missing.includes(name)) return { then: (f) => f(result()) };
        (tables[name] = tables[name] || []).push(...[].concat(rows));
        return { select: () => ({ single: async () => ({ data: [].concat(rows)[0], error: null }) }), then: (f) => f({ data: null, error: null }) };
      },
      then: (f) => f(result())
    };
    return api;
  };
  return { from: builder, tables, calls };
}

test('database mode: log goes to cleaning_push_log and is read back', async () => {
  const sb = fakeSupabase();
  const st = createCleaningStore({ supabase: sb, file: '' });
  const h = harness(st);
  assert.equal((await openingPush(h.deps, { block: 'Block B', settings: S, now: SUN_13 })).sent, 6);
  assert.equal(sb.tables.cleaning_push_log.length, 6);
  assert.deepEqual(Object.keys(sb.tables.cleaning_push_log[0]).sort(), ['block', 'check_date', 'roll_number']);
  assert.equal((await openingPush(h.deps, { block: 'Block B', settings: S, now: SUN_1301 })).sent, 0);
});

test('database mode with ONLY the push-log table missing: push still works from the local file and the checks keep using the database', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cdb-push-')), 's.json');
  const sb = fakeSupabase({ missing: ['cleaning_push_log'] });
  const st = createCleaningStore({ supabase: sb, file });
  const h = harness(st);
  assert.equal((await openingPush(h.deps, { block: 'Block B', settings: S, now: SUN_13 })).sent, 6);
  assert.equal((await openingPush(h.deps, { block: 'Block B', settings: S, now: SUN_1301 })).sent, 0);
  assert.equal(st.state.setupPending, false, 'cleaning_checks mode is untouched');
  assert.equal(st.pushState.local, true);
  await st.listChecks({ block: 'Block B', date: '2026-11-08' });
  assert.ok(sb.calls.includes('cleaning_checks'), 'checks still go to the database');
});

test('the push body is English only', () => {
  assert.match(pushBody(21 * 60), /^[\x20-\x7e]+$/);
  assert.equal(PUSH_TITLE, 'Room check');
});

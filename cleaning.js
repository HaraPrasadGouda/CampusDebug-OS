// Room cleaning checks — the rules as plain functions (no AI, no I/O here).
// The server passes in its store and its dependencies; the tests pass fakes.
// Times are Asia/Kolkata (IST, a fixed UTC+05:30, no DST).
//
// Flow (HARA's rules):
//  • Each hostel block has cleaners; the warden sets the cleaning days and the
//    cleaning time window (default: Sunday, 8 AM - 1 PM).
//  • On a cleaning day, from the window's end for 8 hours (default 1 PM - 9 PM)
//    every hosteller in the room is asked "Was your room cleaned today?".
//  • The FIRST roommate to answer locks the room; the answerer may change
//    Yes <-> No until the window closes, the others see who answered.
//  • Away students (approved leave / out on a gate pass) are not asked. A room
//    where everyone is away is "vacant"; nobody answering is "no reply".
//  • At close: one complaint ticket per not-cleaned room (once per room per day).
//  • Next morning 07:30: ONE SMS per block to both cleaners with the pending rooms.

export const IST_OFFSET_MIN = 330;
export const DEFAULT_SETTINGS = Object.freeze({ weekdays: [0], startTime: '08:00', endTime: '13:00' });
export const ANSWER_HOURS = 8;            // answer window = cleaning end .. +8h (1 PM - 9 PM by default)
export const MORNING_SMS_MIN = 7 * 60 + 30;
export const MORNING_SMS_LAST_MIN = 13 * 60; // a morning SMS is not sent after the cleaner's deadline
export const SMS_LIMIT = 160;
export const RED_ALERT_NOT_FIXED = 2;

// "08:00" / "08:00:00" → minutes after midnight
export function hmToMin(s) {
  const [h, m] = String(s || '0:0').split(':').map((x) => Number(x) || 0);
  return h * 60 + m;
}

// minutes after midnight → "1 PM", "1:30 PM"
export function fmtClock(min) {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const ap = h24 < 12 ? 'AM' : 'PM';
  return m ? `${h12}:${String(m).padStart(2, '0')} ${ap}` : `${h12} ${ap}`;
}

// The IST calendar day, weekday (0 = Sunday) and minutes after IST midnight.
export function istParts(now) {
  const d = new Date(new Date(now).getTime() + IST_OFFSET_MIN * 60000);
  return {
    ymd: d.toISOString().slice(0, 10),
    weekday: d.getUTCDay(),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes()
  };
}

export function weekdayOf(ymd) {
  return new Date(`${ymd}T00:00:00Z`).getUTCDay();
}

export function shiftYmd(ymd, days) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// A row from cleaning_schedules (or nothing) → the settings the rules use.
export function normalizeSettings(row = {}, block = '') {
  const days = Array.isArray(row.weekdays)
    ? [...new Set(row.weekdays.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort((a, b) => a - b)
    : [];
  return {
    block: String(row.block || block || ''),
    weekdays: days.length ? days : [...DEFAULT_SETTINGS.weekdays],
    startTime: String(row.start_time || row.startTime || DEFAULT_SETTINGS.startTime).slice(0, 5),
    endTime: String(row.end_time || row.endTime || DEFAULT_SETTINGS.endTime).slice(0, 5)
  };
}

export function answerBounds(settings) {
  const opensAt = hmToMin(settings.endTime);
  return { opensAt, closesAt: opensAt + ANSWER_HOURS * 60 };
}

// Is the answer window open right now for this block? (date is the IST day)
export function answerWindow(settings, now) {
  const { ymd, weekday, minutes } = istParts(now);
  if (!settings.weekdays.includes(weekday)) return { state: 'none', date: null };
  const { opensAt, closesAt } = answerBounds(settings);
  const state = minutes < opensAt ? 'before' : minutes < closesAt ? 'open' : 'closed';
  return { state, date: ymd, opensAt, closesAt };
}

// The latest cleaning day whose answer window has closed (null if none in a week).
export function lastClosedWindowDate(settings, now) {
  const { ymd, minutes } = istParts(now);
  const { closesAt } = answerBounds(settings);
  for (let back = 0; back < 8; back++) {
    const day = shiftYmd(ymd, -back);
    if (!settings.weekdays.includes(weekdayOf(day))) continue;
    if (back === 0 && minutes < closesAt) continue; // today's window is still open or not started
    return day;
  }
  return null;
}

// Hostel occupancy is read from the profiles; "away" is leave or a gate pass out.
// A room with an answer keeps it; otherwise all-away is vacant, nothing is no reply.
export function classifyRoom({ occupants = [], away = new Set(), check = null }) {
  if (check && check.answer) return check.answer === 'yes' ? 'cleaned' : 'not_cleaned';
  const present = occupants.filter((roll) => !away.has(roll));
  if (occupants.length && present.length === 0) return 'vacant';
  return 'no_reply';
}

// What the student's home card shows. Only a hosteller who is in the room
// (not away) is asked, and only inside the answer window.
export function studentView({ settings, now, roll, away = new Set(), check = null, answererName = null }) {
  const w = answerWindow(settings, now);
  if (w.state !== 'open') return { show: false, reason: w.state === 'none' ? 'not_cleaning_day' : w.state };
  if (away.has(roll)) return { show: false, reason: 'away' };
  const base = { show: true, date: w.date, closesAtMin: w.closesAt };
  if (check && check.answered_by && check.answered_by !== roll) {
    return { ...base, state: 'locked_by_other', answer: check.answer, answeredByName: check.answered_by_name || 'A roommate' };
  }
  if (check && check.answered_by === roll) {
    return { ...base, state: 'answered_by_me', answer: check.answer };
  }
  return { ...base, state: 'open', answererName };
}

// "Block B pending: 204, 210, 305. Please clean today by 1 PM" — ASCII, <= 160.
// rooms: [{ room }] already in priority order.
export function pendingSmsText({ block, rooms, endTime }) {
  const head = `${block} pending: `;
  const tail = `. Please clean today by ${fmtClock(hmToMin(endTime))}`;
  const list = rooms.map((r) => String(r.room));
  const used = [];
  for (let i = 0; i < list.length; i++) {
    const left = list.length - (i + 1);
    const more = left > 0 ? `, +${left} more` : '';
    const candidate = [...used, list[i]].join(', ');
    if ((head + candidate + more + tail).length <= SMS_LIMIT) used.push(list[i]);
    else break;
  }
  if (used.length === 0) return `${head}${list.length} rooms${tail}`.slice(0, SMS_LIMIT);
  const rest = list.length - used.length;
  const more = rest > 0 ? `, +${rest} more` : '';
  return `${head}${used.join(', ')}${more}${tail}`;
}

// Lock-free helper: one async chain per key (single server process).
const chains = new Map();
export function withLock(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  chains.set(key, next.catch(() => {}));
  return next;
}

// Record a student's answer for their room. deps:
//   store.getCheck(block, room, date) / store.upsertCheck(row)
//   roomOf(block, room) → { rolls: [roll], away: Set, names: {roll: name}, ids: {roll: id} } | null
// Returns { ok, status, body }.
export async function answerRoom(deps, { block, room, roll, answer, now, settings }) {
  if (answer !== 'yes' && answer !== 'no') return fail(400, 'Answer Yes or No.');
  const w = answerWindow(settings, now);
  if (w.state !== 'open') {
    return fail(403, w.state === 'before' ? 'The answer opens at 1 PM on cleaning day.' : 'The answer window is closed for today.');
  }
  return withLock(`${block}|${room}|${w.date}`, async () => {
    const r = await deps.roomOf(block, room);
    if (!r || !r.rolls.includes(roll)) return fail(403, 'This room is not yours.');
    if (r.away.has(roll)) return fail(403, 'You are away on leave or gate pass, so you are not asked.');
    const existing = await deps.store.getCheck(block, room, w.date);
    if (existing && existing.answered_by && existing.answered_by !== roll) {
      return {
        ok: false,
        status: 409,
        body: { error: `${existing.answered_by_name || 'A roommate'} already answered for this room.`, answeredByName: existing.answered_by_name, answer: existing.answer }
      };
    }
    const row = {
      ...(existing || {}),
      block, room, check_date: w.date,
      answered_by: roll,
      answered_by_name: r.names[roll] || roll,
      answered_by_id: r.ids[roll] || null,
      answer,
      answered_at: now.toISOString(),
      locked: true
    };
    const saved = await deps.store.upsertCheck(row);
    return { ok: true, status: 200, body: { answer: saved.answer, answeredByName: saved.answered_by_name, answeredByMe: true } };
  });
}

function fail(status, error) {
  return { ok: false, status, body: { error } };
}

// Close a window: one row per room of the block, a ticket per not-cleaned room.
// Idempotent: running it again changes nothing that is already recorded.
// deps: store, roster(block) → [{ room, rolls, away, ids, names }],
//       createTicket({ block, room, date, check, cleaners, room }) → ticket id
export async function closeWindow(deps, { block, date }) {
  const rooms = await deps.roster(block);
  const existing = await deps.store.listChecks({ block, date });
  const byRoom = new Map(existing.map((c) => [String(c.room), c]));
  const out = { block, date, counts: { cleaned: 0, not_cleaned: 0, no_reply: 0, vacant: 0 }, tickets: 0, rooms: [] };
  for (const r of rooms) {
    const check = byRoom.get(String(r.room)) || null;
    // Once a room has a result for the day it is final (later leave/gate changes must not rewrite it).
    const status = check && check.status ? check.status : classifyRoom({ occupants: r.rolls, away: r.away, check });
    let row = check ? { ...check } : { block, room: String(r.room), check_date: date, locked: false };
    let changed = !check || row.status !== status;
    row.status = status;
    if (status === 'not_cleaned' && !row.ticket_id) {
      row.ticket_id = await deps.createTicket({
        block, room: String(r.room), date, check, roster: r
      });
      out.tickets += 1;
      changed = true;
    }
    if (changed) row = await deps.store.upsertCheck(row);
    out.counts[status] += 1;
    out.rooms.push({ room: String(r.room), status, answeredByName: row.answered_by_name || null, ticketId: row.ticket_id || null, id: row.id });
  }
  return out;
}

// Next morning: one SMS per block to every cleaner of that block.
// deps: store, cleanersOf(block) → [{ id, name, phone }], sendSms(cleaner, text) → result
// Idempotent: rows get sms_sent_at once; a second run finds nothing pending.
export async function morningSms(deps, { block, date, settings, now }) {
  const { minutes } = istParts(now);
  if (minutes < MORNING_SMS_MIN || minutes >= MORNING_SMS_LAST_MIN) return { sent: false, reason: 'outside the morning slot' };
  const rows = (await deps.store.listChecks({ block, date })).filter((c) => c.status === 'not_cleaned');
  const pending = rows.filter((c) => !c.sms_sent_at);
  if (pending.length === 0) return { sent: false, reason: 'nothing pending' };
  const cleaners = (await deps.cleanersOf(block)).slice(0, 2);
  if (cleaners.length === 0) return { sent: false, reason: 'no cleaners for this block' };
  // rooms flagged before come first (cleaner sees the repeat offenders on top)
  const repeats = deps.repeatCounts ? await deps.repeatCounts(block, date) : {};
  const ordered = [...pending].sort((a, b) => (repeats[b.room] || 0) - (repeats[a.room] || 0) || Number(a.room) - Number(b.room));
  const text = pendingSmsText({ block, rooms: ordered, endTime: settings.endTime });
  const results = [];
  for (const c of cleaners) results.push(await deps.sendSms(c, text));
  for (const row of pending) await deps.store.upsertCheck({ ...row, sms_sent_at: now.toISOString() });
  return { sent: true, text, to: cleaners.map((c) => c.id), results, ticketIds: pending.map((c) => c.ticket_id).filter(Boolean) };
}

// The warden's block view for one date (pure, from already-read rows).
export function wardenBlockView({ settings, rooms, checks, cleaners, ticketsById }) {
  const byRoom = new Map(checks.map((c) => [String(c.room), c]));
  const list = rooms.map((r) => {
    const c = byRoom.get(String(r.room)) || null;
    const ticket = c && c.ticket_id ? ticketsById.get(String(c.ticket_id)) || null : null;
    return {
      room: String(r.room),
      status: c && c.status ? c.status : 'open',
      answeredByName: c ? c.answered_by_name || null : null,
      answer: c ? c.answer || null : null,
      ticketId: c ? c.ticket_id || null : null,
      notFixedCount: ticket ? Number(ticket.not_fixed_count) || 0 : 0,
      occupants: r.rolls.length
    };
  });
  const counts = { cleaned: 0, not_cleaned: 0, no_reply: 0, vacant: 0, open: 0 };
  list.forEach((r) => { counts[r.status] = (counts[r.status] || 0) + 1; });
  return { block: settings.block, settings, cleaners, counts, rooms: list };
}


// ---- 1 PM "Room check" push (one per student per cleaning day) ------------------------------------
export const PUSH_TITLE = 'Room check';
export function pushBody(closesAtMin) {
  return `Was your room cleaned today? Answer before ${fmtClock(closesAtMin)}.`;
}

// Who gets the push: the same students who are asked on the card — hostellers of the block who are
// not away and whose room is not already locked by a roommate's answer — minus those already pushed today.
// rooms: [{ block, room, rolls, away:Set }]; checks: rows of this block for the day; alreadyPushed: Set of rolls.
export function pushRecipients({ rooms = [], checks = [], alreadyPushed = new Set() }) {
  const answered = new Set(checks.filter((c) => c && c.answered_by).map((c) => String(c.room)));
  const out = [];
  for (const r of rooms) {
    if (answered.has(String(r.room))) continue;
    for (const roll of r.rolls || []) {
      if (r.away && r.away.has(roll)) continue;
      if (alreadyPushed.has(String(roll))) continue;
      out.push(String(roll));
    }
  }
  return out;
}

// One block, one tick. Only while the answer window is OPEN (never before it opens, never after it closes).
// deps: store.listChecks / listPushed / markPushed, roster(block) → rooms, send(rolls, { title, body }).
// Returns { sent, date } — sent is the number of students pushed this tick (0 on a re-tick).
export async function openingPush(deps, { block, settings, now }) {
  const w = answerWindow(settings, now);
  if (w.state !== 'open') return { sent: 0, date: w.date, reason: w.state };
  const [rooms, checks, already] = await Promise.all([
    deps.roster(block),
    deps.store.listChecks({ block, date: w.date }),
    deps.store.listPushed({ block, date: w.date })
  ]);
  const rolls = pushRecipients({ rooms, checks, alreadyPushed: already });
  if (!rolls.length) return { sent: 0, date: w.date, reason: 'nobody_left' };
  await deps.store.markPushed({ block, date: w.date, rolls });   // log first: at most once per student per day
  await deps.send(rolls, { title: PUSH_TITLE, body: pushBody(w.closesAt) });
  return { sent: rolls.length, date: w.date };
}

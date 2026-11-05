/**
 * CampusDebug OS — COVER BOARD (pure logic, no Express / no database).
 *
 * When a teacher goes "On Leave Today", each of that teacher's remaining
 * classes today becomes a COVER CARD. Cards are REQUESTS, never assignments:
 *   - only teachers who are FREE in that period and who TEACH in that SAME
 *     section (per the published timetable) can see a card;
 *   - the first one to tap "Le lunga" takes it (server-checked, 409 for the rest);
 *   - the taker teaches THEIR OWN subject and marks attendance under it;
 *   - nobody took it: admin is alerted 30 min before the period, and again
 *     (final) at the period start, when students see "Class cancelled".
 *
 * Everything here takes `state` (the day's absence file, see server.js),
 * `slots` (timetable slots) and `now` (a Date — injectable, so tests can
 * move the clock). Time-based status is DERIVED from `now`, so it stays
 * right after a restart; only the "admin was told" flags are stored.
 */

export const ALERT_LEAD_MIN = 30;                 // admin alert this long before the period

const DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THUR', 'FRI', 'SAT'];
export const dayKeyOf = (d) => DAY_KEYS[d.getDay()];
export const minOf = (d) => d.getHours() * 60 + d.getMinutes();
export const dateKeyOf = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function fmtMin(m) {
    const h = Math.floor(m / 60), mm = String(m % 60).padStart(2, '0');
    return `${h > 12 ? h - 12 : h || 12}:${mm} ${h >= 12 ? 'PM' : 'AM'}`;
}

const isClass = (s) => s && s.kind !== 'free' && s.kind !== 'study';
export const slotPeriods = (s) => {
    const n = Math.max(1, parseInt(s.span, 10) || 1);
    return Array.from({ length: n }, (_, i) => s.period + i);
};
export const shortSection = (s) => {
    const dept = String(s.department || '').trim();
    return s.section ? `${dept}-${s.section}` : (s.departmentLabel || dept);
};

/** Does this timetable slot belong to the teacher? (FAC id on the roll, else display name.) */
export function ownsSlot(slot, roll, name) {
    const rid = String(roll || '').trim().toUpperCase();
    const nm = String(name || '').trim().toLowerCase();
    if (rid.startsWith('FAC')) return slot.teacherId === rid;
    return !!nm && !!slot.teacherName && String(slot.teacherName).toLowerCase() === nm;
}

export const emptyBoard = () => ({});
const cards = (state) => (state.coverCards = state.coverCards || {});
export const cardId = (date, sectionKey, period) => `${date}|${sectionKey}|P${period}`;

/** The periods a card covers (a lab is 2 periods in one card). */
export const cardPeriods = (c) => Array.from({ length: c.span || 1 }, (_, i) => c.period + i);

/**
 * Create one card per remaining class of an absent teacher today.
 * Idempotent: an existing card is left alone; a withdrawn one is revived.
 * Returns the cards that are NEW (or revived) so the caller can push.
 */
export function createCards(state, slots, absent, now) {
    const today = dateKeyOf(now), day = dayKeyOf(now), nm = minOf(now);
    const made = [];
    const mine = slots.filter(s => s.day === day && isClass(s) && ownsSlot(s, absent.roll, absent.name))
        .sort((a, b) => a.period - b.period);
    for (const s of mine) {
        const start = s.startMin;
        if (!(start > nm)) continue;                  // already started: nothing to cover
        const id = cardId(today, s.sectionKey, s.period);
        const old = cards(state)[id];
        if (old) {
            if (old.status === 'withdrawn' && old.absentRoll === absent.roll) {
                old.status = 'open'; old.takenBy = null; delete old.withdrawnAt;
                made.push(old);
            }
            continue;
        }
        const c = cards(state)[id] = {
            id, date: today, sectionKey: s.sectionKey, short: shortSection(s),
            department: s.department, departmentLabel: s.departmentLabel || s.department,
            sectionLabel: (s.course && s.section) ? `${s.departmentLabel || s.department} — Sec ${s.section}` : null,
            period: s.period, span: Math.max(1, parseInt(s.span, 10) || 1), periodLabel: s.periodLabel || `P${s.period}`,
            startMin: s.startMin, endMin: s.endMin, time: s.time, room: s.room || null, kind: s.kind || 'lecture',
            subjectCode: s.subjectCode, subject: s.subject,
            absentRoll: absent.roll, absentName: absent.name,
            status: 'open',                           // open | taken | withdrawn | cancelled (admin)
            takenBy: null,
            alerts: { t30: null, t0: null },
            createdAt: now.toISOString()
        };
        made.push(c);
    }
    return made;
}

/** Teachers who may currently see/take this card. Returns { ok, why }. */
export function eligibility(state, slots, card, teacher, now, { ignoreOwnTakings = false } = {}) {
    const day = dayKeyOf(now);
    const roll = String(teacher.roll || '').trim();
    if (!roll) return { ok: false, why: 'unknown' };
    const abs = state.absent || {};
    if (abs[roll]) return { ok: false, why: 'onLeave' };
    if (roll === card.absentRoll) return { ok: false, why: 'absentTeacher' };
    const periods = cardPeriods(card);
    // (a) free: no class of mine in those periods today
    const busy = slots.some(s => s.day === day && isClass(s) && ownsSlot(s, roll, teacher.name)
        && slotPeriods(s).some(p => periods.includes(p)));
    if (busy) return { ok: false, why: 'busy' };
    if (!ignoreOwnTakings) {
        const clash = Object.values(cards(state)).some(c => c.id !== card.id && c.date === card.date
            && c.status === 'taken' && c.takenBy?.roll === roll
            && cardPeriods(c).some(p => periods.includes(p)));
        if (clash) return { ok: false, why: 'alreadyCovering' };
    }
    // (b) teaches at least one subject in the SAME section (any day of the timetable)
    const subjects = subjectsIn(slots, card.sectionKey, roll, teacher.name);
    if (!subjects.length) return { ok: false, why: 'wrongSection' };
    return { ok: true, subjects };
}

/** The teacher's own subjects in one section, from the timetable. */
export function subjectsIn(slots, sectionKey, roll, name) {
    const seen = new Map();
    for (const s of slots) {
        if (s.sectionKey !== sectionKey || !isClass(s) || !ownsSlot(s, roll, name)) continue;
        if (!seen.has(s.subjectCode)) seen.set(s.subjectCode, { subjectCode: s.subjectCode, subject: s.subject, kind: s.kind || 'lecture' });
    }
    return [...seen.values()];
}

/** Derived, clock-based state of a card. */
export function cardState(card, now) {
    const nm = minOf(now);
    if (card.status === 'withdrawn') return 'withdrawn';
    if (card.status === 'cancelled') return 'cancelled';
    if (card.status === 'taken') return nm >= card.endMin ? 'done' : 'taken';
    // open (an admin who undid a cancellation after the start keeps it open until the period ends)
    if (card.reopened && nm < card.endMin) return 'open';
    return nm >= card.startMin ? 'cancelled' : 'open';
}
const label = (c) => `${c.periodLabel} ${c.short}`;

/** What a teacher sees on their cover board. */
export function boardFor(state, slots, teacher, now) {
    const nm = minOf(now);
    const open = [], taken = [], mine = [];
    for (const c of Object.values(cards(state)).sort((a, b) => a.startMin - b.startMin)) {
        if (c.date !== dateKeyOf(now) || c.status === 'withdrawn') continue;
        if (nm >= c.endMin) continue;                 // over
        const st = cardState(c, now);
        const view = publicCard(c, now);
        if (c.status === 'taken' && c.takenBy?.roll === teacher.roll) { mine.push({ ...view, mine: true }); continue; }
        if (st === 'cancelled') continue;             // nobody can take it any more
        const e = eligibility(state, slots, c, teacher, now, { ignoreOwnTakings: c.status === 'taken' });
        if (!e.ok) continue;
        if (c.status === 'taken') taken.push({ ...view, canTake: false });
        else open.push({ ...view, canTake: true, subjects: e.subjects });
    }
    return { open, taken, mine };
}

export function publicCard(c, now) {
    return {
        id: c.id, sectionKey: c.sectionKey, short: c.short, sectionLabel: c.sectionLabel,
        department: c.department, departmentLabel: c.departmentLabel, kind: c.kind || 'lecture', day: DAY_KEYS[new Date(c.date + 'T00:00:00').getDay()],
        period: c.period, span: c.span, periodLabel: c.periodLabel, time: c.time, startMin: c.startMin, endMin: c.endMin,
        room: c.room, absentName: c.absentName, subject: c.subject, subjectCode: c.subjectCode,
        status: cardState(c, now),
        takenBy: c.takenBy ? { roll: c.takenBy.roll, name: c.takenBy.name, subjectCode: c.takenBy.subjectCode, subject: c.takenBy.subject } : null,
        minutesToStart: Math.max(0, c.startMin - minOf(now))
    };
}

/** Atomic by construction: no await between the check and the write. */
export function takeCard(state, slots, id, teacher, subjectCode, now) {
    const c = cards(state)[id];
    if (!c || c.date !== dateKeyOf(now) || c.status === 'withdrawn') return { ok: false, http: 404, error: 'That cover card is gone.' };
    const st = cardState(c, now);
    if (st === 'taken') {
        return { ok: false, http: 409, taken: true, error: `${c.takenBy.name} is already taking this.`, takenBy: c.takenBy.name };
    }
    if (st !== 'open') return { ok: false, http: 409, closed: true, error: st === 'cancelled' ? 'This class has already been cancelled.' : 'This period is over.' };
    const e = eligibility(state, slots, c, teacher, now);
    if (!e.ok) {
        const msg = { onLeave: 'You are on leave today.', busy: 'You have a class in that period.', wrongSection: 'You do not teach in that section.', alreadyCovering: 'You are already covering a class in that period.', absentTeacher: 'This is your own class.' }[e.why] || 'You cannot take this card.';
        return { ok: false, http: 403, why: e.why, error: msg };
    }
    const pick = subjectCode ? e.subjects.find(s => s.subjectCode === subjectCode) : e.subjects[0];
    if (!pick) return { ok: false, http: 400, error: 'Pick one of your own subjects for this section.' };
    c.status = 'taken';
    c.takenBy = { roll: teacher.roll, name: teacher.name, subjectCode: pick.subjectCode, subject: pick.subject, kind: pick.kind };
    c.takenAt = now.toISOString();
    return { ok: true, card: c };
}

export function releaseCard(state, id, teacher, now) {
    const c = cards(state)[id];
    if (!c || c.status !== 'taken' || c.takenBy?.roll !== teacher.roll) return { ok: false, http: 409, error: 'You are not taking this card.' };
    if (minOf(now) >= c.startMin) return { ok: false, http: 409, error: 'The period has started — it can no longer be released.' };
    c.status = 'open'; c.takenBy = null; c.releasedAt = now.toISOString();
    return { ok: true, card: c };
}

/** The teacher goes on leave themselves: their not-yet-started takings re-open. */
export function reopenTakenBy(state, roll, now) {
    const out = [];
    for (const c of Object.values(cards(state))) {
        if (c.date === dateKeyOf(now) && c.status === 'taken' && c.takenBy?.roll === roll && c.startMin > minOf(now)) {
            c.status = 'open'; c.takenBy = null; out.push(c);
        }
    }
    return out;
}

/** "I'm here now": future open cards go back to the returning teacher. Taken ones stay. */
export function withdrawFor(state, absentRoll, now) {
    const out = [];
    for (const c of Object.values(cards(state))) {
        if (c.date !== dateKeyOf(now) || c.absentRoll !== absentRoll) continue;
        if (c.status === 'open' && c.startMin > minOf(now)) {
            c.status = 'withdrawn'; c.withdrawnAt = now.toISOString(); out.push(c);
        }
    }
    return out;
}

/** Admin marks a no-taker card as cancelled. */
export function adminCancel(state, id, now) {
    const c = cards(state)[id];
    if (!c || c.date !== dateKeyOf(now) || c.status === 'withdrawn') return { ok: false, http: 404, error: 'Card not found.' };
    if (c.status === 'taken') return { ok: false, http: 409, error: `${c.takenBy.name} is taking this class.` };
    c.status = 'cancelled'; c.cancelledAt = now.toISOString();
    return { ok: true, card: c };
}

/**
 * Admin takes back "Class cancelled" (cancelled by the admin, or automatically at the period start
 * with no taker). The card goes back to 'open' so free teachers of the section can take it again.
 * - Only while the period has not ENDED (409 afterwards); only a cancelled card (409 otherwise).
 * - Alert flags are never reset, so no escalation fires twice for one period. If the period has already
 *   started, the t30/t0 flags are closed as 'skipped' (no stale "class cancelled" alert) and the card is
 *   marked `reopened` so it stays open until the period ends instead of being auto-cancelled again.
 */
export function adminUndoCancel(state, id, now) {
    const c = cards(state)[id];
    if (!c || c.date !== dateKeyOf(now) || c.status === 'withdrawn') return { ok: false, http: 404, error: 'Card not found.' };
    const nm = minOf(now);
    if (cardState(c, now) !== 'cancelled') return { ok: false, http: 409, error: 'This class is not cancelled.' };
    if (nm >= c.endMin) return { ok: false, http: 409, error: 'This period is already over, so it can no longer be reopened.' };
    c.alerts = c.alerts || { t30: null, t0: null };
    if (nm >= c.startMin) {
        c.reopened = true;
        if (!c.alerts.t0) c.alerts.t0 = 'skipped';
        if (!c.alerts.t30) c.alerts.t30 = 'skipped';
    }
    c.status = 'open'; c.takenBy = null;
    c.cancelUndoneAt = now.toISOString();
    return { ok: true, card: c };
}

/**
 * The escalation ladder. Call on a timer and before reads. Returns the NEW
 * admin alerts [{type:'t30'|'t0', card, text}] — each fires exactly once.
 */
export function tick(state, now) {
    const nm = minOf(now), out = [];
    for (const c of Object.values(cards(state))) {
        if (c.date !== dateKeyOf(now) || c.status !== 'open' || c.reopened) continue;   // reopened = admin already knows
        c.alerts = c.alerts || { t30: null, t0: null };
        const start = fmtMin(c.startMin);
        if (nm >= c.startMin) {
            if (!c.alerts.t0) {
                c.alerts.t0 = now.toISOString();
                if (!c.alerts.t30) c.alerts.t30 = 'skipped';   // never alerted early (e.g. server was down)
                out.push({ type: 't0', card: c, text: `${label(c)} at ${start} has no cover — class cancelled for students` });
            }
        } else if (nm >= c.startMin - ALERT_LEAD_MIN && !c.alerts.t30) {
            c.alerts.t30 = now.toISOString();
            out.push({ type: 't30', card: c, text: `${label(c)} at ${start} has no cover, nobody has taken it` });
        }
    }
    return out;
}

/** Admin dashboard: every card of today plus the banner list. */
export function adminView(state, now) {
    const nm = minOf(now);
    const all = Object.values(cards(state)).filter(c => c.date === dateKeyOf(now) && c.status !== 'withdrawn')
        .sort((a, b) => a.startMin - b.startMin);
    const view = all.map(c => ({
        ...publicCard(c, now),
        alertedAt: c.alerts?.t30 && c.alerts.t30 !== 'skipped' ? c.alerts.t30 : null,
        finalAlertAt: c.alerts?.t0 && c.alerts.t0 !== 'skipped' ? c.alerts.t0 : null,
        cancelledByAdmin: c.status === 'cancelled',
        reopened: !!c.reopened,
        canUndo: cardState(c, now) === 'cancelled' && nm < c.endMin
    }));
    // banner: open + inside the 30-min window (or past start = cancelled), not yet over
    const banners = view.filter(v => nm < v.endMin && (v.status === 'cancelled' || (v.status === 'open' && v.minutesToStart <= ALERT_LEAD_MIN)))
        .map(v => ({
            id: v.id, level: v.status === 'cancelled' ? 'final' : 'warn',
            text: v.status === 'cancelled'
                ? `${v.periodLabel} ${v.short} at ${fmtMin(v.startMin)} — class cancelled, nobody took it`
                : `${v.periodLabel} ${v.short} at ${fmtMin(v.startMin)} has no cover, nobody has taken it`,
            canCancel: v.status === 'open',
            canUndo: v.canUndo
        }));
    return { cards: view, banners };
}

/** Student side: per-period overrides for one section today. */
export function studentOverrides(state, sectionKey, now) {
    const out = [];
    for (const c of Object.values(cards(state))) {
        if (c.date !== dateKeyOf(now) || c.sectionKey !== sectionKey || c.status === 'withdrawn') continue;
        const st = cardState(c, now);
        if (st === 'cancelled') out.push({ id: c.id, period: c.period, span: c.span, status: 'cancelled', label: 'Class cancelled' });
        else if (st === 'taken' || st === 'done') out.push({
            id: c.id, period: c.period, span: c.span, status: 'taken', label: `Taken by ${c.takenBy.name} (cover)`,
            takerName: c.takenBy.name, subject: c.takenBy.subject, subjectCode: c.takenBy.subjectCode
        });
    }
    return out;
}

/** May this teacher mark attendance for exactly this section/period/day as a cover taker? */
export function takerMayMark(state, roll, { sectionKey, period, subjectCode }, now) {
    const c = cards(state)[cardId(dateKeyOf(now), sectionKey, parseInt(period, 10))] ||
        Object.values(cards(state)).find(x => x.date === dateKeyOf(now) && x.sectionKey === sectionKey && x.status === 'taken'
            && cardPeriods(x).includes(parseInt(period, 10)));
    if (!c || c.status !== 'taken' || String(c.takenBy?.roll || '').toUpperCase() !== String(roll || '').trim().toUpperCase()) return { ok: false };
    if (subjectCode && subjectCode !== c.takenBy.subjectCode) return { ok: false, wrongSubject: true, card: c };
    return { ok: true, card: c };
}

/** The live card (not withdrawn) of a section/period today, if any — also when the period is inside a 2-period lab card. */
export function cardAt(state, sectionKey, period, now) {
    const p = parseInt(period, 10), d = dateKeyOf(now);
    return Object.values(cards(state)).find(c => c.date === d && c.sectionKey === sectionKey && c.status !== 'withdrawn'
        && cardPeriods(c).includes(p)) || null;
}

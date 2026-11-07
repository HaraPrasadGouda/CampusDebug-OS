// Teacher navigation (bottom bar / sidebar SECTIONS / Today-Students-Classes-Me) in headless Chromium.
// REAL server.js + mock Supabase + the BUILT app (skipped, loudly, if python playwright or dist/ is missing).
// Needs `npx vite build` first. Run: node --test test/teacherNav.ui.test.mjs
process.env.TZ = 'Asia/Kolkata';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startApp } from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const have = spawnSync('python3', ['-c', 'import playwright.sync_api']).status === 0 && fs.existsSync(path.join(HERE, '../dist/index.html'));
const seed = JSON.parse(fs.readFileSync(path.join(HERE, 'support/seed.json'), 'utf8'));
const oneSeed = path.join(fs.mkdtempSync(path.join((await import('node:os')).tmpdir(), 'nav-seed-')), 'one.json');
fs.writeFileSync(oneSeed, JSON.stringify({ leave_requests: [{ ...seed.leave_requests[0], created_at: '2026-11-04T09:02:00+05:30' }] }));
const absent = (app, roll, sub) => app.api('POST', '/api/leave-requests/teacher-absent', roll, { onLeave: true, substituteRoll: sub });

// busy: 3 own pending requests + FAC019 on leave (FAC003 covers 1 request) + open/taken cover cards
async function busyApp(take = true) {
    const app = await startApp({ dist: true });
    app.clock('09:20');
    await absent(app, 'FAC019', 'FAC003'); await absent(app, 'FAC002', 'FAC005'); await absent(app, 'FAC001', 'FAC005'); await absent(app, 'FAC004', 'FAC005');
    const b = (await app.api('GET', '/api/teacher/cover-board', 'FAC003')).json;
    assert.ok((b.open || []).length >= 2, 'two cover cards are open for FAC003');
    if (take) await app.api('POST', `/api/teacher/cover-board/${encodeURIComponent(b.open[0].id)}/take`, 'FAC003', {});   // FAC003 now teaches that period, so the other card is no longer theirs
    return { app, now: '2026-11-04T09:20:00+05:30' };
}
async function quietApp() { const app = await startApp({ dist: true, seed: false }); app.clock('09:08'); return { app, now: '2026-11-04T09:08:00+05:30' }; }
async function oneApp() { const app = await startApp({ dist: true, mockEnv: { SEED_FILE: oneSeed } }); app.clock('09:08'); return { app, now: '2026-11-04T09:08:00+05:30' }; }
const make = { busy: busyApp, busyOpen: () => busyApp(false), quiet: quietApp, one: oneApp };
const run = (app, vp, scenario, now) => {
    const r = spawnSync('python3', [path.join(HERE, 'ui/teacher_nav.py'), JSON.stringify({ base: app.base, vp, scenario, now, shots: process.env.NAV_SHOTS || '' })], { encoding: 'utf8', timeout: 240000 });
    assert.equal(r.status, 0, r.stderr.slice(-1800));
    return JSON.parse(r.stdout.trim().split('\n').pop());
};
const PHONES = [[360, 740, 1.3], [390, 844, 1.3], [412, 915, 1.3]];
const LAPTOP = [1440, 900, 1.0];

function commonChecks(o, vp) {
    const phone = vp[0] < 1024;
    assert.deepEqual(o.errors, [], 'no page errors');
    assert.equal(o.side_today, false, 'no sideways scroll on Today');
    for (const [t, s] of Object.entries(o.side_tabs)) assert.equal(s, false, `no sideways scroll on ${t}`);
    assert.equal(o.side_final, false);
    assert.deepEqual(o.tabs_seen, { students: 'students', classes: 'classes', me: 'me', today: 'today' }, 'the four tabs switch');
    // ME: identity (display only) + exactly Notices / My leaves / Alerts; nothing of the menu
    assert.deepEqual(o.me.ids, ['me-notices', 'me-leaves', 'me-alerts']);
    assert.equal(o.me.rows, 3);
    assert.ok(/FAC003 • Faculty Mentor/.test(o.me.identity) && /Priya/.test(o.me.identity), o.me.identity);
    for (const bad of ['Profile', 'Settings', 'Logout', 'Log out']) assert.ok(!o.me.text.includes(bad), `Me must not contain "${bad}"`);
    for (const good of ['Notices', 'My leaves', 'Alerts']) assert.ok(o.me.text.includes(good), `Me has ${good}`);
    assert.equal(o.me.toggle, true);
    assert.equal(o.my_leaves_open, true, 'My leaves opens inline');
    assert.equal(o.notices_open, true, 'Notices opens the existing notice board');
    // Students / Classes content is the old components, nothing removed
    assert.ok(o.students.approvals && o.students.gatelog && o.students.create && o.students.mentees && o.students.search, JSON.stringify(o.students));
    assert.ok(!o.classes.attendance && !o.classes.cover && o.classes.insights, JSON.stringify(o.classes)); // covers + attendance live on Today only
    assert.deepEqual(o.classes.tabs.map(s => s.trim().toLowerCase()), ['lesson plan', 'analytics']);
    // alerts banner: shown while push is off, dismissible, stays dismissed after reload
    assert.equal(o.alerts.banner, true); assert.equal(o.alerts.after_dismiss, false); assert.equal(o.alerts.after_reload, false);
    assert.match(o.alerts.me_sub, /Off on this device/);
    // deep links
    assert.equal(o.deep_students, 'students'); assert.equal(o.deep_hash, 'classes');
    if (phone) {
        assert.equal(o.bar_present, true);
        assert.equal(o.btns.length, 4);
        assert.deepEqual(o.btns.map(b => b.text), ['Today', 'Students', 'Classes', 'Me']);
        for (const b of o.btns) { assert.ok(b.w >= 44 && b.h >= 44, `${b.tab} target ${b.w}x${b.h}`); assert.ok(b.left >= 0 && b.right <= o.bar.iw + 0.5, `${b.tab} on screen`); assert.equal(b.labelClip, false, `${b.tab} label not clipped`); }
        assert.ok(Math.abs(o.bar.bottom - o.bar.ih) < 1.5, 'bar sits at the bottom edge');
        assert.ok(o.bottom_gap.footerBottom <= o.bottom_gap.barTop + 1, `last content (footer) ${o.bottom_gap.footerBottom} ends above the bar ${o.bottom_gap.barTop}`);
        assert.ok(o.bar_over_drawer.zbar < o.bar_over_drawer.zaside, 'drawer covers the bar');
        // hamburger: the OLD drawer, exactly four items, no SECTIONS list
        assert.deepEqual(o.drawer.items, ['Home', 'Profile', 'Settings', 'Logout']);
        assert.equal(o.drawer.sectionsVisible, false); assert.match(o.drawer.label, /^menu$/i);
        assert.equal(o.bar_hidden_in_modal, true, 'bar hides while a modal is open'); assert.equal(o.bar_back_after_modal, true);
        assert.equal(o.bar_hidden_with_keyboard, true, 'bar hides while a text box has focus (keyboard up)'); assert.equal(o.bar_back_after_keyboard, true);
    } else {
        assert.equal(o.bar_present, false, 'no bottom bar on the laptop');
        assert.deepEqual(o.sections.labels, ['today', 'students', 'classes', 'me']);
        const t = o.sidebar_text.replace(/\s+/g, ' ');
        assert.ok(/Sections.*Today.*Students.*Classes.*Me.*Account.*Home.*Profile.*Settings.*Logout/i.test(t), t);
    }
}

describe('Teacher navigation (headless Chromium)', { skip: have ? false : 'python playwright or dist/ missing' }, () => {
    for (const vp of [...PHONES, LAPTOP]) {
        const take = vp[0] === 390 || vp[0] === 412;   // 390/412: one card taken by me; 360/1440: both cards still open
        test(`busy day @${vp[0]}px (text x${vp[2]}, ${take ? 'one cover card taken' : 'two cover cards open'}): tabs, Me, drawer/sidebar, needs-you rows, badges, scroll memory`, async () => {
            const { app, now } = await make[take ? 'busy' : 'busyOpen']();
            try {
                const o = run(app, vp, 'busy', now);
                commonChecks(o, vp);
                const t = o.today;
                assert.equal(t.all_clear, false); assert.equal(t.next_class, false, 'a busy day (cover cards / covering) shows no Next class card'); assert.equal(t.quick, 0); assert.ok(t.needs_badge, 'Needs you now badge');
                assert.match(t.own_row, /3 leave requests waiting/); assert.match(t.own_row, /Your own mentees · oldest 0?9:40/i);
                assert.match(t.cover_row, /Covering Dr\. Meera Iyer's mentees/); assert.match(t.cover_row, /1 leave request · until they are back/);
                if (take) { assert.equal(t.cover_cards, 0); assert.match(t.cover_text, /You're taking/); assert.match(t.cover_text, /Mark attendance|Marking opens/); }
                else { assert.equal(t.cover_cards, 2, 'two open cover cards with "I\'ll take it"'); assert.match(t.cover_text, /I'll teach/); }
                assert.equal(t.banner, true); assert.equal(t.timetable, true, 'My day timetable stays on Today'); assert.equal(t.present_btn, true);
                // badge = own 3 + covering 1 + cover cards (2 open, or 1 taken-not-yet-marked) ; Students badge = 3 + 1
                const want = take ? 5 : 6;
                assert.equal(Number(t.needs_badge), want);
                if (vp[0] < 1024) { const m = Object.fromEntries(o.btns.map(b => [b.tab, b.badge])); assert.equal(m.today, String(want)); assert.equal(m.students, '4'); assert.equal(m.classes, null); assert.equal(m.me, null); }
                assert.ok(o.students.covering && /Covering for Dr\. Meera Iyer/.test(o.students.covering_text), o.students.covering_text);
                assert.equal(o.row_jump.tab, 'students'); assert.ok(Math.abs(o.row_jump.approvals_top) < 200, `approvals scrolled into view (${o.row_jump.approvals_top})`);
                assert.equal(o.cover_jump.tab, 'students'); assert.equal(o.cover_jump.visible, true);
                if (vp[0] < 1024) assert.ok(o.scroll.students_restored >= 300 && o.scroll.other_tab < 50, JSON.stringify(o.scroll));
            } finally { await app.stop(); }
        });
    }
    for (const vp of [PHONES[1], LAPTOP]) {
        test(`quiet day @${vp[0]}px: All clear + Next class + 3 quick actions + My day, no Needs-you`, async () => {
            const { app, now } = await make.quiet();
            try {
                const o = run(app, vp, 'quiet', now);
                commonChecks(o, vp);
                const t = o.today;
                assert.equal(t.needs_badge, null); assert.equal(t.own_row, null); assert.equal(t.cover_row, null); assert.equal(t.cover_cards, 0);
                assert.equal(t.all_clear, true); assert.equal(t.next_class, true); assert.equal(t.quick, 3); assert.equal(t.timetable, true);
                assert.equal(t.quiet_line, 'Cover board: no open requests');
                assert.match(t.next_text, /next class/i); assert.match(t.next_text, /P1/); assert.match(t.next_text, /starts in 7 min/); assert.equal(t.mark_btn, 1, 'primary Mark attendance (inside the 10-minute window)');
                if (vp[0] < 1024) { const m = Object.fromEntries(o.btns.map(b => [b.tab, b.badge])); assert.equal(m.today, null); assert.equal(m.students, null); }
                assert.equal(o.qa_gate.tab, 'students'); assert.equal(o.qa_gate.gate, true);
                assert.equal(o.qa_plan.tab, 'classes'); assert.match(o.qa_plan.plan_selected, /Lesson plan/);
                assert.equal(o.qa_create.tab, 'today'); assert.equal(o.qa_create.modal, true);
            } finally { await app.stop(); }
        });
    }
    test('quiet day + one student request arrives: All clear gives way to "Needs you now (1)"', async () => {
        const { app, now } = await make.one();
        try {
            const o = run(app, PHONES[1], 'one', now);
            const t = o.today;
            assert.equal(t.all_clear, false); assert.equal(t.needs_badge, '1'); assert.match(t.own_row, /1 leave request waiting/); assert.match(t.own_row, /Your own mentees · oldest 0?9:02/i);
            assert.equal(t.next_class, true, 'next class card stays under the request row'); assert.equal(t.quick, 3); assert.equal(t.timetable, true); assert.equal(t.quiet_line, 'Cover board: no open requests');
            assert.equal(o.qa_gate.tab, 'students'); assert.equal(o.qa_plan.tab, 'classes');
            const m = Object.fromEntries(o.btns.map(b => [b.tab, b.badge])); assert.equal(m.today, '1'); assert.equal(m.students, '1');
        } finally { await app.stop(); }
    });
    for (const [who, vp] of [['student', PHONES[1]], ['admin', PHONES[1]], ['student', LAPTOP], ['admin', LAPTOP]]) {
        test(`${who} @${vp[0]}px is untouched: no teacher bottom bar, no SECTIONS group`, async () => {
            const { app, now } = await make.quiet();
            try {
                const o = run(app, vp, who, now);
                assert.equal(o.bar, false); assert.equal(o.sections, false); assert.equal(o.side, false);
            } finally { await app.stop(); }
        });
    }
});

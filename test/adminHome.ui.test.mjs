// Admin / Dean HOME ("Needs you now") at 360/390/412 (130% text) and 1440, heavy data: 60 certificate requests, a class with no cover,
// a cancelled class, escalated complaints. Also the one-tap actions (Ready for pickup / Reject / Mark class cancelled / Undo) against the REAL server.
// REAL server.js + mock Supabase + the BUILT app in headless Chromium (skipped, loudly, if python playwright or dist/ is missing).
// Needs `npx vite build` first. Run: node --test test/adminHome.ui.test.mjs   (LAYOUT_SHOTS=/some/dir keeps full-page screenshots)
process.env.TZ = 'Asia/Kolkata';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startApp } from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const have = spawnSync('python3', ['-c', 'import playwright.sync_api']).status === 0 && fs.existsSync(path.join(HERE, '../dist/index.html'));
const ADMIN = { id: '0000002c-0000-4000-8000-00000000002c', roll_number: 'ADMIN01', role: 'ADMIN', full_name: 'Admin A', phone_number: '9000000999' };
const DEAN = { id: '0000002d-0000-4000-8000-00000000002d', roll_number: 'DEAN01', role: 'DEAN', full_name: 'Dr. Meera Rath', phone_number: '9000000998' };
const TYPES = ['BONAFIDE_CERTIFICATE', 'MIGRATION_NOC', 'CONDUCT_CERTIFICATE', 'FEE_RECEIPT_COPY'];

function fixtures(busy) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdb-adminhome-fx-'));
    const profiles = JSON.parse(fs.readFileSync(path.join(HERE, 'support/profiles.json'), 'utf8'));
    profiles.push(DEAN);
    const studs = profiles.filter((p) => p.role === 'STUDENT');
    const iso = (m) => new Date(Date.parse('2026-11-04T14:05:00+05:30') - m * 60000).toISOString();
    const docs = !busy ? [] : Array.from({ length: 60 }, (_, i) => ({
        id: `d0c00000-0000-4000-8000-${String(i).padStart(12, '0')}`, student_id: studs[i % studs.length].id, doc_type: TYPES[i % 4], status: i % 5 === 4 ? 'PROCESSING' : 'PENDING',
        remarks: i % 3 === 0 ? 'Scholarship application for the national merit programme, original and two attested copies' : 'Passport application', created_at: iso(30 + i * 97)
    }));
    const cats = ['Plumbing', 'Electrical', 'Wi-Fi / LAN'];
    const tickets = !busy ? [] : [
        ['Water leakage on the 3rd floor corridor outside the washrooms, the floor is wet and unsafe to walk on', 'Plumbing', 'Hostel B, Room 304', 600],
        ['Wi-Fi is down in the study hall', 'Wi-Fi / LAN', 'Hostel A, Study hall', 360],
        ['Fan not working', 'Electrical', 'Hostel C, Room 112', 250]
    ].map(([txt, cat, loc, ageMin], i) => ({ id: `7000000${i}-0000-4000-8000-00000000000${i}`, student_id: studs[i].id, category: cat, location: loc, urgency: 'High', status: 'ESCALATED_TO_DEAN', raw_text: txt, created_at: iso(ageMin + 240) }))
        .concat([{ id: '70000009-0000-4000-8000-000000000009', student_id: studs[3].id, category: cats[1], location: 'Hostel A, Room 9', urgency: 'Low', status: 'PENDING', raw_text: 'Tube light flickers', created_at: iso(30) }]);
    fs.writeFileSync(path.join(dir, 'profiles.json'), JSON.stringify(profiles));
    fs.writeFileSync(path.join(dir, 'extra.json'), JSON.stringify({ document_requests: docs, tickets }));
    return dir;
}
const run = (app, vp, who, scenario) => {
    const cfg = { base: app.base, vp, roll: who.roll_number, profile: { ...who, rollNumber: who.roll_number, fullName: who.full_name }, now: '2026-11-04T14:05:00+05:30', scenario, shots: process.env.LAYOUT_SHOTS || '' };
    const r = spawnSync('python3', [path.join(HERE, 'ui/admin_home.py'), JSON.stringify(cfg)], { encoding: 'utf8', timeout: 300000 });
    assert.equal(r.status, 0, r.stderr.slice(-1800));
    return JSON.parse(r.stdout.trim().split('\n').pop());
};
async function boot(busy, lastNotice = false) {
    const fx = fixtures(busy);
    const app = await startApp({ dist: true, profilesFile: path.join(fx, 'profiles.json'), mockEnv: { EXTRA_TABLES_FILE: path.join(fx, 'extra.json') } });
    const stop = app.stop; app.stop = async () => { await stop(); fs.rmSync(fx, { recursive: true, force: true }); };
    if (busy) {   // Dr. Priya Mishra (FAC003) is on leave since morning: her P4 (1:30) is already cancelled (Undo), her P5 lab (2:30) has no cover yet
        app.clock('09:30');
        assert.equal((await app.api('POST', '/api/leave-requests/teacher-absent', 'FAC003', { onLeave: true, substituteRoll: 'FAC019' })).status, 200);
    }
    if (lastNotice) { app.clock('09:40'); assert.equal((await app.api('POST', '/api/notices', 'ADMIN01', { title: 'Water supply restored in Block B', content: 'Supply is back in all rooms.', target: 'All Students', category: 'General', urgency: 'Normal' })).status, 200); }
    app.clock('14:05');
    return app;
}
const common = (o, vp) => {
    const phone = vp[0] < 800;
    if (phone) assert.deepEqual(o.small, [], `controls under 44px: ${JSON.stringify(o.small)}`);   // 44px is the phone rule (the admin tap-target fix is phones only)
    assert.equal(o.side, false, 'sideways scroll');
    assert.deepEqual(o.edge, [], `something past the screen edge: ${JSON.stringify(o.edge)}`);
    assert.deepEqual(o.clipped, [], `clipped text: ${JSON.stringify(o.clipped)}`);
    assert.deepEqual(o.errors, []);
    assert.equal(o.hasForm, 0, phone ? 'phone: the notice form is one tap away, not on Home' : 'laptop: the notice form starts closed');
    assert.equal(o.noticeCard, phone ? 0 : 1, 'laptop: a compact closed "Send a Notice" card sits beside Needs you now');
    assert.equal(o.noticeBtn, phone ? 0 : 1, 'laptop: one "Write a notice" button');
    // no greeting / wish card: a slim counter strip + a muted date caption instead
    assert.equal(o.greeting, false, 'no "Good morning/afternoon/evening" anywhere on Home');
    assert.equal(o.h1, 0);
    assert.match(o.date, /^Wednesday,? 4 November$/, 'date is a plain muted caption, no clock time');
    assert.deepEqual(Object.keys(o.counters), ['On leave', 'No cover', 'Requests', 'Escalated']);
    if (!o.clear) {   // busy day: slim counter strip above "Needs you now"; quiet day: the same four numbers are friendly tiles inside the All clear card
        assert.ok(o.strip.h < 90, `counter strip is slim (${o.strip.h}px)`);
        assert.ok(o.strip.bottom < o.first.headTop, 'strip sits above "Needs you now"');
    }
    assert.ok(o.first.headBottom < o.first.navTop, `Needs-you heading must be inside the first viewport ${JSON.stringify(o.first)}`);
    if (!phone) assert.ok(o.first.firstBottom == null || o.first.firstBottom <= o.first.ih, `first action inside the first laptop viewport ${JSON.stringify(o.first)}`);
    assert.equal(o.tiles, 4);
    if (phone) {
        assert.equal(o.bar.length, 5);
        assert.deepEqual(o.bar.map((g) => g.t), ['Home', 'Notices', 'Academics', 'Campus', 'More']);
        for (const [i, g] of o.bar.entries()) {
            assert.ok(!g.clip && g.sl >= g.l - 0.5 && g.sr <= g.r + 0.5, `bar label ${g.t} clipped`);
            assert.ok(g.l >= -0.5 && g.r <= vp[0] + 0.5, `bar item ${g.t} off screen`);
            if (i) assert.ok(g.sl >= o.bar[i - 1].sr - 0.5, `bar labels ${o.bar[i - 1].t} / ${g.t} overlap`);
        }
        assert.equal(o.quick, 3, 'Send notice / Fee payments / Reset password');
    }
};

describe('Admin / Dean Home — Needs you now (headless Chromium)', { skip: have ? false : 'python playwright or dist/ missing' }, () => {
    for (const who of [ADMIN, DEAN]) {
        for (const vp of [[360, 740, 1.3], [390, 844, 1.3], [412, 915, 1.3], [1440, 900, 1.0]]) {
            test(`${who.role} ${vp[0]}px busy day (60 requests, no cover, cancelled class, escalations): everything fits, 44px targets`, async () => {
                const app = await boot(true);
                try {
                    const o = run(app, vp, who, 'busy'); common(o, vp);
                    assert.deepEqual(o.counters, { 'On leave': '1', 'No cover': '1', Requests: '60', Escalated: '3' });
                    assert.equal(o.clear, 0);
                    assert.deepEqual(o.needs, { cover: 1, docs: 1, escalated: 1 });
                    assert.equal(o.docRows, 3, 'three requests inline, the rest behind "See all"');
                    assert.equal(o.escRows, 3);
                    assert.equal(o.cancelledRows, 1);
                    if (vp[0] < 800) {   // first screen: heading and the first action are above the bottom bar
                        assert.ok(o.first.headBottom < o.first.navTop, `Needs-you heading below the first screen ${JSON.stringify(o.first)}`);
                        assert.ok(o.first.firstBottom <= o.first.navTop, `first action below the first screen ${JSON.stringify(o.first)}`);
                    }
                } finally { await app.stop(); }
            });
        }
        for (const vp of [[360, 740, 1.3], [390, 844, 1.3], [412, 915, 1.3], [1440, 900, 1.0]]) {
            test(`${who.role} ${vp[0]}px quiet day: All clear hero, today at a glance (zeros as tiles), quick actions, Last notice shown once`, async () => {
                const app = await boot(false, true);
                try {
                    const o = run(app, vp, who, 'quiet'); common(o, vp);
                    const phone = vp[0] < 800;
                    assert.deepEqual(o.counters, { 'On leave': '0', 'No cover': '0', Requests: '0', Escalated: '0' });
                    assert.equal(o.clear, 1);
                    assert.deepEqual(o.needs, { cover: 0, docs: 0, escalated: 0 });
                    const q = o.quiet;
                    assert.equal(q.allClear, 1, 'one "All clear" headline');
                    assert.equal(q.glance, 1, '"Today at a glance" label');
                    assert.equal(q.stats, 4, 'four friendly stat tiles, zeros included');
                    assert.equal(q.stripCount, 0, 'no separate counter strip on a quiet day (the tiles are the counters)');
                    assert.ok(q.iconBox >= 44, `hero icon is a clear 44px+ badge (${q.iconBox}px)`);
                    assert.equal(q.lastNoticeCount, 1, '"Last notice sent" appears exactly once on Home');
                    assert.match(q.lastNoticeText, /Last notice sent .*(09:40|9:40)/i);
                    assert.equal(q.mock, false, 'no mock/placeholder labels');
                    assert.ok(q.hero.h > 150, `hero is substantial (${q.hero.h}px)`);
                    if (phone) {
                        assert.ok(q.hero.bottom <= o.first.navTop, `hero fits above the bottom bar ${JSON.stringify([q.hero, o.first])}`);
                        assert.ok(q.lastNoticeInHero, 'phone: last notice is the hero footer');
                        assert.ok(q.glanceRows >= 2, 'phone: 2 x 2 tiles');
                    } else {
                        assert.ok(!q.lastNoticeInHero && q.lastNoticeInCard, 'laptop: last notice lives in the Send a Notice card only');
                        assert.equal(q.glanceRows, 1, 'laptop: the four tiles sit in one row');
                        assert.equal(q.quickLg, 4, 'laptop: four quick actions beside the notice card');
                        assert.ok(Math.abs(q.sideBottom - q.mainBottom) < 330, `laptop columns are balanced (${q.sideBottom} vs ${q.mainBottom})`);
                    }
                } finally { await app.stop(); }
            });
        }
        test(`${who.role} quiet day without any notice sent yet: no "Last notice" line, nothing broken`, async () => {
            const app = await boot(false);
            try {
                const o = run(app, [390, 844, 1.3], who, 'quiet'); common(o, [390, 844, 1.3]);
                assert.equal(o.quiet.lastNoticeCount, 0);
                assert.equal(o.clear, 1);
            } finally { await app.stop(); }
        });
    }
    for (const vp of [[390, 844, 1.3], [1440, 900, 1.0]]) {
        test(`ADMIN ${vp[0]}px one-tap actions work as before (Ready for pickup, Reject, Mark class cancelled, Undo), every tool reachable`, async () => {
            const app = await boot(true);
            try {
                const o = run(app, vp, ADMIN, 'actions'); const a = o.actions;
                assert.deepEqual(o.errors, []);
                // certificate requests: same PATCH as the Document Desk, one tap each, no confirm step
                assert.deepEqual(a.docCounters, ['60', '58']);
                assert.equal(a.gone, 0);
                const docs = (await app.api('GET', '/api/document-requests', 'ADMIN01')).json.requests;
                assert.equal(docs.find((d) => d.id === a.docIds[0]).status, 'READY_FOR_PICKUP');
                assert.equal(docs.find((d) => d.id === a.docIds[1]).status, 'REJECTED');
                // cover board: cancel -> moves to Today's covers with Undo -> Undo puts it back
                assert.deepEqual(a.coverBefore, ['1', 1]);
                assert.deepEqual(a.coverAfterCancel, ['0', 2, 0]);
                assert.deepEqual(a.coverAfterUndo, ['1', 1, 1]);
                const banners = (await app.api('GET', '/api/admin/cover-board', 'ADMIN01')).json.banners;
                assert.deepEqual(banners.map((b) => [b.level, b.canCancel, b.canUndo]).sort(), [['final', false, true], ['warn', true, false]]);
                assert.ok(a.noticeForm >= 1, 'notice form reachable from Home');
                if (vp[0] >= 800) {   // laptop: closed at first, ONE click opens the real form in place, sending still works, Close folds it back
                    assert.equal(a.formBefore, 0);
                    assert.equal(a.noticeForm, 1);
                    assert.deepEqual(a.closedAgain, [1, 0]);
                    const sent = (await app.api('GET', '/api/notices', 'ADMIN01')).json;
                    const list = Array.isArray(sent) ? sent : (sent.notices || []);
                    assert.ok(list.some((n) => n.title === 'Water supply restored in Block B'), 'notice sent from the Home form reached the server');
                }
                assert.equal(a.backHome, 1);
                const all = ['dispatcher', 'timetable', 'setup', 'mess', 'docs', 'fees', 'security', 'csv', 'metrics'];
                if (vp[0] < 800) {
                    assert.deepEqual(a.reach.Campus.sort(), ['mess', 'setup']);
                    assert.deepEqual(a.reach.More.sort(), ['csv', 'docs', 'fees', 'metrics', 'security']);
                } else {
                    assert.deepEqual(a.reach.sidebar.sort(), [...all].sort());
                    assert.equal(a.leftHome, 0);
                }
            } finally { await app.stop(); }
        });
    }
});

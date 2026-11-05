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
async function boot(busy) {
    const fx = fixtures(busy);
    const app = await startApp({ dist: true, profilesFile: path.join(fx, 'profiles.json'), mockEnv: { EXTRA_TABLES_FILE: path.join(fx, 'extra.json') } });
    const stop = app.stop; app.stop = async () => { await stop(); fs.rmSync(fx, { recursive: true, force: true }); };
    if (busy) {   // Dr. Priya Mishra (FAC003) is on leave since morning: her P4 (1:30) is already cancelled (Undo), her P5 lab (2:30) has no cover yet
        app.clock('09:30');
        assert.equal((await app.api('POST', '/api/leave-requests/teacher-absent', 'FAC003', { onLeave: true, substituteRoll: 'FAC019' })).status, 200);
    }
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
    assert.equal(o.hasForm, phone ? 0 : 1, phone ? 'phone: the notice form is one tap away, not on Home' : 'laptop: the notice form sits beside Needs you now');
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
                    assert.match(o.greeting, who.role === 'DEAN' ? /Good (morning|afternoon|evening), Dr\. Rath!/ : /Good (morning|afternoon|evening), Admin!/);
                    if (vp[0] < 800) {   // first screen: heading and the first action are above the bottom bar
                        assert.ok(o.first.headBottom < o.first.navTop, `Needs-you heading below the first screen ${JSON.stringify(o.first)}`);
                        assert.ok(o.first.firstBottom <= o.first.navTop, `first action below the first screen ${JSON.stringify(o.first)}`);
                    }
                } finally { await app.stop(); }
            });
        }
        for (const vp of [[390, 844, 1.3], [1440, 900, 1.0]]) {
            test(`${who.role} ${vp[0]}px quiet day: "All clear" card, zero counters, tools still there`, async () => {
                const app = await boot(false);
                try {
                    const o = run(app, vp, who, 'quiet'); common(o, vp);
                    assert.deepEqual(o.counters, { 'On leave': '0', 'No cover': '0', Requests: '0', Escalated: '0' });
                    assert.equal(o.clear, 1);
                    assert.deepEqual(o.needs, { cover: 0, docs: 0, escalated: 0 });
                } finally { await app.stop(); }
            });
        }
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

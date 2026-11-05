// Admin / Dean console phone layout at 130% text: bottom bar, cover banner, Fee Payments, timetable list, 44px tap targets.
// REAL server.js + mock Supabase + the BUILT app in headless Chromium (skipped, loudly, if python playwright or dist/ is missing).
// Needs `npx vite build` first. Run: node --test test/adminLayout.ui.test.mjs
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
const DEAN = { id: '0000002d-0000-4000-8000-00000000002d', roll_number: 'DEAN01', role: 'DEAN', full_name: 'Dr. Dean D', phone_number: '9000000998' };

// Fixtures: a DEAN profile on top of the shared profiles, and receipts big enough that the total is a 7-digit rupee figure
function fixtures() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdb-admin-fx-'));
    const profiles = JSON.parse(fs.readFileSync(path.join(HERE, 'support/profiles.json'), 'utf8'));
    profiles.push(DEAN);
    const studs = profiles.filter((p) => p.role === 'STUDENT');
    const fees = Array.from({ length: 12 }, (_, i) => ({
        id: `fee-${i}`, receipt_id: `RCP-261104-A${i}B${i}`, roll_number: studs[i % studs.length].roll_number, payer_name: studs[i % studs.length].full_name,
        amount: 98765.5 + i * 1000, method: 'DEMO', status: 'PAID', paid_at: `2026-11-04T0${i % 9}:15:00+05:30`
    }));
    const docs = Array.from({ length: 4 }, (_, i) => ({ id: `doc-${i}`, student_id: studs[i].id, doc_type: 'BONAFIDE_CERTIFICATE', status: 'PENDING', remarks: 'For scholarship', created_at: '2026-11-04T10:10:00+05:30' }));
    fs.writeFileSync(path.join(dir, 'profiles.json'), JSON.stringify(profiles));
    fs.writeFileSync(path.join(dir, 'extra.json'), JSON.stringify({ fee_payments: fees, document_requests: docs }));
    return dir;
}
const run = (app, vp, who) => {
    const cfg = { base: app.base, vp, roll: who.roll_number, profile: { ...who, rollNumber: who.roll_number, fullName: who.full_name }, now: '2026-11-04T13:05:00+05:30', shots: process.env.LAYOUT_SHOTS || '' };
    const r = spawnSync('python3', [path.join(HERE, 'ui/admin_layout.py'), JSON.stringify(cfg)], { encoding: 'utf8', timeout: 240000 });
    assert.equal(r.status, 0, r.stderr.slice(-1500));
    return JSON.parse(r.stdout.trim().split('\n').pop());
};

describe('Admin / Dean console phone layout (headless Chromium)', { skip: have ? false : 'python playwright or dist/ missing' }, () => {
    for (const who of [ADMIN, DEAN]) {
        for (const vp of [[360, 740, 1.3], [390, 844, 1.3], [412, 915, 1.3], [1440, 900, 1.0]]) {
            test(`${who.role} ${vp[0]}px (text x${vp[2]}): nothing clipped, no sideways scroll, 44px targets`, async () => {
                const fx = fixtures();
                const app = await startApp({ dist: true, profilesFile: path.join(fx, 'profiles.json'), mockEnv: { EXTRA_TABLES_FILE: path.join(fx, 'extra.json') } });
                try {
                    app.clock('09:30');
                    assert.equal((await app.api('POST', '/api/leave-requests/teacher-absent', 'FAC003', { onLeave: true, substituteRoll: 'FAC019' })).status, 200);
                    app.clock('13:05');
                    const o = run(app, vp, who);
                    const phone = vp[0] < 800;
                    // cover banner: icon and text share a row on phones; the action is a 44px button fully on screen
                    assert.ok(Math.abs(o.banner.iconTop - o.banner.textTop) < 30, `icon/text rows ${o.banner.iconTop}/${o.banner.textTop}`);
                    assert.ok(o.banner.btnH >= 44 && o.banner.btnL >= 0 && o.banner.btnR <= o.banner.iw, `banner button ${JSON.stringify(o.banner)}`);
                    if (phone) {
                        // bottom bar: five labels, none cut off, none overlapping the next, all inside the screen
                        assert.equal(o.bar.length, 5);
                        for (const [i, g] of o.bar.entries()) {
                            assert.ok(!g.clip && g.sl >= g.l - 0.5 && g.sr <= g.r + 0.5, `bar label ${g.t} clipped`);
                            assert.ok(g.l >= -0.5 && g.r <= vp[0] + 0.5, `bar item ${g.t} off screen`);
                            if (i) assert.ok(g.sl >= o.bar[i - 1].sr - 0.5, `bar labels ${o.bar[i - 1].t} / ${g.t} overlap`);
                        }
                        // notice form selects stack to full width on a phone, nothing past the edge
                        for (const s of o.selects) assert.ok(s[1] <= s[2], `select past the edge ${s}`);
                        for (const key of ['small_home', 'small_notice', 'small_fees', 'small_tt', 'small_mess', 'small_docs', 'small_setup']) assert.deepEqual(o[key], [], `${key}: controls under 44px`);
                    }
                    // Fee Payments: both totals on a single line, refresh is a 44px target next to the search box and on screen
                    assert.deepEqual(o.fees.kpiLines, [1, 1], `totals wrap: ${o.fees.amounts}`);
                    assert.ok(o.fees.refreshW >= 44 && o.fees.refreshH >= 44 && o.fees.refreshRight <= o.fees.iw, `refresh ${JSON.stringify(o.fees)}`);
                    assert.ok(Math.abs(o.fees.refreshTop - o.fees.searchTop) < 12, 'refresh sits beside the search box');
                    // Timetable: bounded scrolling section list, names not cut off
                    assert.ok(o.tt && o.tt.overflowY === 'auto' && o.tt.maxH > 0, `section list ${JSON.stringify(o.tt)}`);
                    for (const [name, fits] of o.tt.names) assert.ok(fits, `section name cut off: ${name}`);
                    assert.equal(o.title.clip, false, 'tool title is not cut off');
                    for (const key of ['side_home', 'side_fees', 'side_tt', 'side_mess', 'side_docs', 'side_setup']) assert.equal(o[key], false, `${key}: sideways scroll`);
                    assert.deepEqual(o.errors, []);
                } finally { await app.stop(); fs.rmSync(fx, { recursive: true, force: true }); }
            });
        }
    }
});

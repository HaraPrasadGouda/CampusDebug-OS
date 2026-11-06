// Student request/history list: the progress tracker sits in one fixed right-hand slot on laptop (same x / width on every row),
// full width under the title on phones, no side-scroll, no raw UUID titles. REAL server.js + mock Supabase + the BUILT app in
// headless Chromium (skipped, loudly, if python playwright or dist/ is missing). Needs `npx vite build` first.
// Run: node --test test/historyList.ui.test.mjs
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
const ROLL = '2301165000', PID = '0000001a-0000-4000-8000-00000000001a';
const have = spawnSync('python3', ['-c', 'import playwright.sync_api']).status === 0 && fs.existsSync(path.join(HERE, '../dist/index.html'));
const NOW = Date.parse('2026-11-04T10:30:00+05:30');
const iso = (hoursAgo) => new Date(NOW - hoursAgo * 3600000).toISOString();

// Seeded history: 1 returned pass, 1 approved pass, 1 rejected pass, 2 documents with refs (ready / pending),
// 1 document that only has a server UUID (no DOC- ref), 1 rejected document.
export const seedTables = () => ({
    gate_passes: [
        { id: 'GP-217530', student_id: PID, rollNo: ROLL, reason: 'visit', destination: 'park', status: 'RETURNED', statusLabel: 'Returned to Campus', created_at: iso(240) },
        { id: 'GP-217611', student_id: PID, rollNo: ROLL, reason: 'Family function with a very long reason text', destination: 'Cuttack city centre', status: 'APPROVED', statusLabel: 'Warden Approved (Signed)', created_at: iso(30) },
        { id: 'GP-217702', student_id: PID, rollNo: ROLL, reason: 'shopping', destination: 'market', status: 'REJECTED', statusLabel: 'Rejected by Warden', created_at: iso(60) }
    ],
    document_requests: [
        { id: 'a1b2c3d4-0000-4000-8000-000000007091', student_id: PID, doc_type: 'FEE_RECEIPT', status: 'READY_FOR_PICKUP', remarks: '[DOC-7091] For internship application at a company', created_at: iso(250), ready_at: iso(200) },
        { id: 'a1b2c3d4-0000-4000-8000-000000007092', student_id: PID, doc_type: 'BONAFIDE', status: 'PENDING', remarks: '[DOC-7092] Scholarship', created_at: iso(5) },
        { id: '8db37a02-5922-4c1e-9f0a-3b6d2e1c7f44', student_id: PID, doc_type: 'NO_DUES', status: 'PENDING', remarks: 'Hostel clearance', created_at: iso(100) },
        { id: 'a1b2c3d4-0000-4000-8000-000000007093', student_id: PID, doc_type: 'CHARACTER', status: 'REJECTED', remarks: '[DOC-7093] Visa', created_at: iso(120) }
    ]
});
export const profile = () => ({ id: PID, roll_number: ROLL, rollNumber: ROLL, fullName: 'Student A1', full_name: 'Student A1', role: 'STUDENT', hostelBlock: 'A', roomNumber: '100', resident_type: 'hosteller', department: 'Computer Science & Engineering', course: 'BTech', section: 'A' });

export async function runHistory(app, vp, extra = {}) {
    const r = spawnSync('python3', [path.join(HERE, 'ui/history_list.py'), JSON.stringify({ base: app.base, roll: ROLL, profile: profile(), vp, shots: process.env.HISTORY_SHOTS || '', ...extra })], { encoding: 'utf8', timeout: 170000 });
    assert.equal(r.status, 0, r.stderr.slice(-1500));
    return JSON.parse(r.stdout.trim().split('\n').pop());
}
export async function startSeeded() {
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cdb-hist-')), 'extra.json');
    fs.writeFileSync(f, JSON.stringify(seedTables()));
    const app = await startApp({ dist: true, mockEnv: { EXTRA_TABLES_FILE: f } });
    app.clock('10:30');
    return app;
}

describe('student history list (headless Chromium)', { skip: have ? false : 'python playwright or dist/ missing' }, () => {
    for (const vp of [[1440, 900, 1.0], [390, 844, 1.3]]) {
        test(`${vp[0]}px (text x${vp[2]}): trackers line up, nothing overflows, no raw UUID`, async () => {
            const app = await startSeeded();
            try {
                const o = await runHistory(app, vp);
                assert.deepEqual(o.errors, []);
                const rows = o.rows.filter(r => r.tracker);
                assert.ok(o.count >= 7, `expected the 7 seeded rows, saw ${o.count}`);
                assert.equal(rows.length, 7, 'every pass and document row has a tracker slot');
                // same x and same width for every tracker, and for every bar inside it
                const xs = new Set(rows.map(r => r.tracker.x)), ws = new Set(rows.map(r => r.tracker.w));
                assert.equal(xs.size, 1, `tracker x differs: ${[...xs]}`);
                assert.equal(ws.size, 1, `tracker width differs: ${[...ws]}`);
                assert.equal(new Set(rows.map(r => r.bar.x)).size, 1, 'bar x differs');
                assert.equal(new Set(rows.map(r => r.bar.w)).size, 1, 'bar width differs');
                if (vp[0] >= 1024) {
                    // laptop: tracker is a right-hand column beside the title, never under it; titles are left of it
                    for (const r of rows) {
                        assert.ok(r.tracker.x >= r.title.r - 1 || r.tracker.x > r.row.x + r.row.w * 0.5, 'tracker sits to the right of the title block');
                        assert.ok(r.tracker.y < r.row.y + r.row.h && r.tracker.y + r.tracker.h > r.row.y, 'tracker is on the same line as the row');
                        assert.ok(r.titleLines <= 2, 'title wraps to at most 2 lines');
                    }
                    assert.ok(Math.max(...rows.map(r => r.row.h)) - Math.min(...rows.map(r => r.row.h)) <= 24, `row heights differ a lot: ${rows.map(r => r.row.h)}`);
                } else {
                    // phone: tracker under the title, full width of the row (minus padding)
                    for (const r of rows) {
                        assert.ok(r.tracker.y >= r.title.y + r.title.h - 2, 'tracker sits below the title on phones');
                        assert.ok(r.tracker.w >= r.row.w - 40, `tracker spans the row (${r.tracker.w} of ${r.row.w})`);
                        assert.ok(r.row.h >= 44, 'row is a >= 44px tap target');
                    }
                }
                // no sideways scroll anywhere
                assert.ok(o.doc[0] <= o.doc[1], `page scrolls sideways: ${o.doc}`);
                for (const r of o.rows) {
                    assert.equal(r.scrollOverflow, false, `row overflows: ${r.text}`);
                    assert.equal(r.overflowing, 0, `a child pokes out of its row: ${r.text}`);
                }
                // raw UUID title is gone, shown as a short id
                const all = o.rows.map(r => r.text).join('\n');
                assert.doesNotMatch(all, /[0-9a-f]{8}-[0-9a-f]{4}-/i, 'no raw UUID text');
                assert.match(all, /#8DB37A02/);
                // a gate pass and a rejected row carry the right state in the same slot
                assert.match(o.rows.find(r => /GP-217530/.test(r.text)).barLabel, /Returned/);
                assert.match(o.rows.find(r => /GP-217611/.test(r.text)).barLabel, /Approved/);
                assert.match(o.rows.find(r => /DOC-7091/.test(r.text)).barLabel, /Ready for Pickup/);
                assert.match(o.rows.find(r => /DOC-7093/.test(r.text)).text, /Rejected by Office/);
            } finally { app.stop(); }
        });
    }
});

// Admin Timetable tab: the Attendance locks card + unlock button are gone, At-Risk Students stays.
// REAL server.js + mock Supabase + the BUILT app (skipped, loudly, if python playwright or dist/ is missing).
process.env.TZ = 'Asia/Kolkata';
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { startApp, SEC_B } from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const have = spawnSync('python3', ['-c', 'import playwright.sync_api']).status === 0 && fs.existsSync(path.join(HERE, '../dist/index.html'));
const ADMIN = { id: '0000002c-0000-4000-8000-00000000002c', roll_number: 'ADMIN01', role: 'ADMIN', full_name: 'Admin A', phone_number: '9000000999', rollNumber: 'ADMIN01', fullName: 'Admin A' };
describe('admin Timetable tab has no attendance locks (UI)', { skip: have ? false : 'needs python3 playwright + a built dist/' }, () => {
    for (const vp of [[390, 844, 1.3], [1440, 900, 1]]) {
        test(`no lock / unlock UI even when a class is saved today (${vp[0]}px)`, async () => {
            const app = await startApp({ dist: true });
            try {
                app.clock('11:25');
                assert.equal((await app.api('POST', '/api/attendance/mark', 'FAC003', { sectionKey: SEC_B, department: 'BTech CSE', subjectCode: 'DS', subject: 'Data Structures', day: 'WED', period: 3, present: [] })).status, 200);
                const r = spawnSync('python3', [path.join(HERE, 'ui/admin_tt_nolock.py'), JSON.stringify({ base: app.base, vp, roll: 'ADMIN01', profile: ADMIN, now: '2026-11-04T11:30:00+05:30', shots: process.env.ATT_SHOTS || '' })], { encoding: 'utf8', timeout: 240000 });
                assert.equal(r.status, 0, r.stderr.slice(-1500));
                const o = JSON.parse(r.stdout.trim().split('\n').pop());
                assert.deepEqual(o.errors, []);
                assert.equal(o.has_tt, true, 'Timetable tab opened');
                assert.equal(o.has_locks, false, 'no Attendance locks / Unlock text');
                assert.equal(o.has_atrisk, true, 'At-Risk Students card is left where it was');
                assert.equal(o.side, false, 'no sideways scroll');
            } finally { app.stop(); }
        });
    }
});

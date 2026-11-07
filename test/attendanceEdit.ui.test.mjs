// Teacher 'Edit attendance' button in headless Chromium: visible in college hours, absent outside them.
// REAL server.js + mock Supabase + the BUILT app (skipped, loudly, if python playwright or dist/ is missing).
// Needs `npx vite build` first. Run: node --test test/attendanceEdit.ui.test.mjs
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
const PHONES = [[360, 740, 1.3], [390, 844, 1.3], [412, 915, 1.3]];
const LAPTOP = [1440, 900, 1.0];
const mark = (app, o) => app.api('POST', '/api/attendance/mark', 'FAC003', { sectionKey: SEC_B, department: 'BTech CSE', subjectCode: 'DS', subject: 'Data Structures', day: 'WED', period: 3, kind: 'lecture', present: [], ...o });

async function setup(scenario) {
    const app = await startApp({ dist: true });
    app.clock('11:25');
    const roster = (await app.api('GET', `/api/attendance/roster?section=${encodeURIComponent(SEC_B)}`, 'FAC003')).json.students.map(s => s.roll);
    assert.equal((await mark(app, { present: roster.slice(0, 3) })).status, 200);
    const t = scenario === 'inhours' ? '12:00' : '16:45';
    app.clock(t);
    return { app, roster, now: `2026-11-04T${t}:00+05:30` };
}
const run = (app, vp, scenario, now) => {
    const r = spawnSync('python3', [path.join(HERE, 'ui/teacher_att_edit.py'), JSON.stringify({ base: app.base, vp, scenario, now, shots: process.env.ATT_SHOTS || '' })], { encoding: 'utf8', timeout: 240000 });
    assert.equal(r.status, 0, r.stderr.slice(-1800));
    return JSON.parse(r.stdout.trim().split('\n').pop());
};

describe('teacher Edit attendance button (UI)', { skip: have ? false : 'needs python3 playwright + a built dist/ (run npx vite build)' }, () => {
    for (const vp of [...PHONES, LAPTOP]) {
        test(`in college hours: Edit button on Today + Classes, prefilled modal, saves as an edit (${vp[0]}px)`, async () => {
            const { app, roster, now } = await setup('inhours');
            try {
                const o = run(app, vp, 'inhours', now);
                assert.deepEqual(o.errors, [], 'no page errors');
                assert.equal(o.side_today, false); assert.equal(o.side_classes, false, 'no sideways scroll');
                assert.ok(o.today.edit_btns >= 1, 'Edit on My day: ' + JSON.stringify(o.today).slice(0, 300));
                assert.ok(/Marked 3/.test(o.today.timeline), 'chip says Marked 3');
                assert.equal(o.today.has_locked_word, false, 'the word Locked is gone');
                assert.equal(o.classes.edit_btns, 0, 'Classes no longer repeats Mark/Edit (Today only)');
                assert.equal(o.modal.title, 'Edit Attendance');
                assert.equal(o.modal.ticked, 3, 'modal prefilled with the saved present list');
                assert.match(o.modal.save, /Save changes — present 3\//, 'button reads Save changes: ' + o.modal.save);
                assert.equal(o.modal.side, false);
                const rec = (await app.api('GET', '/api/attendance/sessions', 'FAC003')).json.sessions.find(s => s.period === 3);
                assert.equal(rec.present.length, 2, 'the edit was saved'); assert.equal(rec.editedBy, 'FAC003');
                assert.ok(rec.present.every(r => roster.includes(r)));
            } finally { app.stop(); }
        });
    }
    for (const vp of [PHONES[1], LAPTOP]) {
        test(`after college hours: no Edit button anywhere, chip still shows Marked (${vp[0]}px)`, async () => {
            const { app, now } = await setup('after');
            try {
                const o = run(app, vp, 'after', now);
                assert.deepEqual(o.errors, [], 'no page errors');
                assert.equal(o.today.edit_btns, 0); assert.equal(o.today.next_edit, 0); assert.equal(o.classes.edit_btns, 0);
                assert.ok(/Marked 3/.test(o.classes.text + o.today.timeline), 'still shows the saved class');
                assert.equal(o.today.has_locked_word, false);
                assert.equal(o.modal, undefined);
            } finally { app.stop(); }
        });
    }
});

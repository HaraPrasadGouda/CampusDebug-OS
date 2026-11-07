// Teacher dashboard phone layout at 130% text: Mark Attendance footer, Gate Log title, create-leave roll numbers, note box.
// REAL server.js + mock Supabase + the BUILT app in headless Chromium (skipped, loudly, if python playwright or dist/ is missing).
// Needs `npx vite build` first. Run: node --test test/teacherLayout.ui.test.mjs
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
const run = (app, vp) => {
    const r = spawnSync('python3', [path.join(HERE, 'ui/teacher_layout.py'), JSON.stringify({ base: app.base, vp, shots: process.env.LAYOUT_SHOTS || '' })], { encoding: 'utf8', timeout: 170000 });
    assert.equal(r.status, 0, r.stderr.slice(-1500));
    return JSON.parse(r.stdout.trim().split('\n').pop());
};

describe('Teacher dashboard phone layout (headless Chromium)', { skip: have ? false : 'python playwright or dist/ missing' }, () => {
    for (const vp of [[360, 740, 1.3], [390, 844, 1.3], [412, 915, 1.3], [1440, 900, 1.0]]) {
        test(`${vp[0]}px (text x${vp[2]}): nothing clipped, no sideways scroll`, async () => {
            const app = await startApp({ dist: true });
            try {
                app.clock('10:30');
                const o = run(app, vp);
                const phone = vp[0] < 800;
                // Gate Log: the title is not squeezed into a sliver; refresh stays a 44px target inside the screen
                assert.ok(o.gate.w >= 150, `gate title width ${o.gate.w}`);
                assert.ok(o.gate.lines <= 2, `gate title lines ${o.gate.lines}`);
                assert.ok(o.gate.btnW >= 44 && o.gate.btnH >= 44 && o.gate.btnRight <= o.gate.iw);
                // Mark Attendance: Save and Cancel fully on screen and at least 44px tall on phones; the hint is not a tall narrow column
                assert.ok(o.att.saveL >= 0 && o.att.saveR <= o.att.iw, `save rect ${o.att.saveL}-${o.att.saveR} of ${o.att.iw}`);
                if (phone) assert.ok(o.att.saveH >= 44 && o.att.cancelH >= 44, `heights ${o.att.saveH}/${o.att.cancelH}`);
                assert.ok(o.att.hintW >= 100 && o.att.hintLines <= 2, `hint ${o.att.hintW}px x ${o.att.hintLines} lines`);
                assert.ok(o.att_search && o.att_search[0] <= o.att_search[1] + 0.5, `search placeholder ${o.att_search}`);
                assert.equal(o.att_saved, true, 'Save still closes the modal');
                assert.ok(o.rows.length > 0);
                for (const r of o.rows) { assert.ok(r.rollRight <= r.rowRight - 4 && r.scr, `roll ${r.txt} clipped`); }
                assert.ok(o.cards > 0, 'seed has a pending leave for this mentor');
                assert.ok(o.approval_text.includes('Requested ') && !/one-way|back next working/i.test(o.approval_text), 'mentor card keeps only "Requested <time>"');
                // note placeholder fully visible: it wraps inside the box (phones) or fits one line (laptop); never cut off
                assert.ok(o.note_need[0] <= o.note_need[1] + 1, `note placeholder needs ${o.note_need[2]} lines = ${o.note_need[0]}px but the box is ${o.note_need[1]}px`);
                assert.equal(o.side_scroll, false);
                assert.deepEqual(o.errors, []);
            } finally { await app.stop(); }
        });
    }
});

// Settle Dues now asks "Pay ₹X? Confirm & Pay / Cancel" first. REAL server.js + mock Supabase + the BUILT app in
// headless Chromium (python playwright; the test is skipped, loudly, if that is not installed).
// Needs `npx vite build` to have been run (dist/ is what the browser loads).
// Run: node --test test/feeConfirm.ui.test.mjs
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
const ROLL = '2301165000', DUE = 12500;
const have = spawnSync('python3', ['-c', 'import playwright.sync_api']).status === 0 && fs.existsSync(path.join(HERE, '../dist/index.html'));
const profiles = () => {
    const base = JSON.parse(fs.readFileSync(path.join(HERE, 'support/profiles.json'), 'utf8'));
    for (const p of base) if (p.roll_number === ROLL) p.fee_due_balance = DUE;
    const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cdb-feeui-')), 'profiles.json');
    fs.writeFileSync(f, JSON.stringify(base));
    return f;
};
const runPy = (cfg) => {
    const r = spawnSync('python3', [path.join(HERE, 'ui/confirm_flow.py'), JSON.stringify(cfg)], { encoding: 'utf8', timeout: 170000 });
    assert.equal(r.status, 0, r.stderr.slice(-1500));
    return JSON.parse(r.stdout.trim().split('\n').pop());
};
const cfgFor = (app, extra = {}) => ({ base: app.base, roll: ROLL, name: 'Test Hosteller', due: DUE, shots: process.env.CONFIRM_SHOTS || '', ...extra });

describe('Settle Dues confirm step (headless Chromium)', { skip: have ? false : 'python playwright or dist/ missing' }, () => {
    for (const vp of [[360, 740, 1.3], [390, 844, 1.3], [412, 915, 1.3], [1440, 900, 1.0]]) {
        test(`${vp[0]}px (text x${vp[2]}): tap alone pays nothing, Cancel/Escape/outside pay nothing, Confirm pays once`, async () => {
            const app = await startApp({ dist: true, profilesFile: profiles() });
            try {
                app.clock('10:30');
                const out = runPy(cfgFor(app, { viewports: [vp] })).viewports[String(vp[0])];
                // the tap on Settle Dues only switches the same modal to the question
                assert.equal(out.dues_view_has_confirm, 0);
                assert.equal(out.pays_after_settle_tap, 0, 'Settle Dues alone must not call the pay endpoint');
                assert.match(out.confirm_text, new RegExp(`Pay ₹12,500\\?`));
                assert.match(out.confirm_text, /no real money is charged/i);
                assert.equal(out.dialogs, 1, 'same modal, no second popup layered on top');
                assert.ok(out.confirm_btn_h[0] >= 44 && out.cancel_btn_h[0] >= 44, 'tap targets >= 44px');
                assert.ok(out.confirm_btn_h[1] <= out.confirm_btn_h[2], 'Confirm & Pay is on screen without scrolling');
                assert.deepEqual([out.scroll_confirm[0] <= out.scroll_confirm[1], out.scroll_paid[0] <= out.scroll_paid[1]], [true, true], 'no sideways scroll');
                // cancel / escape / outside / close: nothing paid
                assert.ok(out.after_cancel_confirm_gone && out.after_cancel_settle_back);
                assert.ok(out.after_escape_confirm_gone && out.after_outside_confirm_gone);
                assert.equal(out.pays_after_cancel, 0);
                assert.equal(out.pays_after_all_cancels, 0);
                assert.ok(out.reopen_shows_dues_not_confirm, 'closing while asking resets to the dues view');
                assert.ok(out.buttons_disabled_while_running, 'buttons disabled while the request runs');
                assert.equal(out.pays_after_confirm_dblclick, 1, 'one request even for a double tap');
                assert.ok(out.paid_card && out.settle_gone);
                assert.deepEqual(out.errors, []);
                const r = await app.api('GET', '/api/fees/receipts', ROLL);
                assert.equal(r.json.receipts.length, 1, 'exactly one receipt');
                assert.equal(Number(r.json.receipts[0].amount), DUE);
                const d = await app.api('GET', '/api/dashboard-data', ROLL);
                assert.equal(Number(d.json.profile.fee_due_balance), 0);
            } finally { app.stop(); }
        });
    }

    test('after Settle Dues tap + Cancel + Escape + outside tap + close (never Confirm): server dues unchanged, no receipt', async () => {
        const app = await startApp({ dist: true, profilesFile: profiles() });
        try {
            app.clock('10:30');
            const out = runPy(cfgFor(app, { viewports: [[390, 844, 1.3]], stop: 'before_confirm' })).viewports['390'];
            assert.equal(out.pays_after_all_cancels, 0);
            assert.deepEqual(out.errors, []);
            const d = await app.api('GET', '/api/dashboard-data', ROLL);
            assert.equal(Number(d.json.profile.fee_due_balance), DUE, 'dues unchanged');
            const rc = await app.api('GET', '/api/fees/receipts', ROLL);
            assert.equal(rc.json.receipts.length, 0, 'no receipt');
            assert.equal(app.logs.srv.includes('/api/fees/pay'), false);
        } finally { app.stop(); }
    });

    test('dues cleared elsewhere while the confirm view is open: Confirm shows the settled state, no error, no second receipt', async () => {
        const app = await startApp({ dist: true, profilesFile: profiles() });
        try {
            app.clock('10:30');
            const out = runPy(cfgFor(app, { scenario: 'underneath' }));
            assert.equal(out.asked, true);
            assert.equal(out.elsewhere_status, 200);
            assert.ok(out.paid_card && out.no_error_text);
            assert.deepEqual(out.errors, []);
            const r = await app.api('GET', '/api/fees/receipts', ROLL);
            assert.equal(r.json.receipts.length, 1, 'still exactly one receipt');
        } finally { app.stop(); }
    });
});

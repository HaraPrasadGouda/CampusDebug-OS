// Warden Home (proposal A "Needs you now"): layout + behaviour in headless Chromium.
// REAL server.js + mock Supabase + the BUILT app. Needs `npx vite build` first (skipped, loudly, if python playwright or dist/ is missing).
// Run: node --test test/wardenHome.ui.test.mjs      (LAYOUT_SHOTS=dir keeps screenshots)
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
const uid = (n) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

// scenario: busy = heavy queues everywhere, 7 students out | quiet = nothing pending, 3 students out | empty = nothing pending, nobody out
function buildData(scenario) {
    const profiles = JSON.parse(fs.readFileSync(path.join(HERE, 'support/profiles.json'), 'utf8'));
    const person = (i, roll, role, name, extra = {}) => ({ id: uid(i), roll_number: roll, role, full_name: name, phone_number: `9${String(i).padStart(9, '0')}`, ...extra });
    profiles.push(person(900, 'WARD01', 'WARDEN', 'Mr. Subrat Kumar Panda', { department: 'Hostel Administration' }));
    const names = ['Ananya Mishra', 'Rakesh Kumar Behera', 'Subhashree Satapathy', 'Debasish Mohapatra', 'Priyanka Pattnaik', 'Soumya Ranjan Nayak'];
    const studs = Array.from({ length: 60 }, (_, i) => person(1000 + i, `24011${String(i).padStart(5, '0')}`, 'STUDENT', names[i % names.length] + (i >= names.length ? ' Jr.' : ''),
        { resident_type: 'hosteler', hostel_block: 'Hostel ' + 'ABC'[i % 3], room_number: String(100 + i), mentor_roll: 'FAC003', department: 'Computer Science & Engineering', course: 'BTech', section: 'A' }));
    profiles.push(...studs);
    const now = Date.now();
    const iso = (m) => new Date(now - m * 60000).toISOString();
    // minutes since local midnight: keeps "today" scans on today's date whatever time the suite runs
    const msm = Math.max(12, Math.floor((now - new Date(new Date().setHours(0, 0, 0, 0)).getTime()) / 60000) - 2);
    const at = (m) => iso(Math.min(m, msm));
    const busy = scenario === 'busy';
    const cats = ['Plumbing', 'Electrical', 'Wi-Fi / LAN', 'Furniture', 'Cleanliness'];
    const tickets = busy ? Array.from({ length: 40 }, (_, i) => ({ id: `7000${String(i).padStart(4, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`, student_id: studs[i % 60].id, category: cats[i % 5],
        location: `${studs[i % 60].hostel_block}, Room ${studs[i % 60].room_number}`, urgency: ['Low', 'Medium', 'High'][i % 3], status: 'PENDING',
        raw_text: i % 4 === 0 ? 'Water leaking from the tap in the bathroom and the floor is flooded, please send someone urgently' : 'Fan not working', created_at: iso(10 + i * 37) })) : [];
    const master_incidents = busy ? Array.from({ length: 8 }, (_, i) => ({ id: `8000${String(i).padStart(4, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`, category: cats[i % 5], hostel_block: 'ABC'[i % 3],
        floor_number: `Floor ${i % 4 + 1}`, status: ['OPEN', 'IN_PROGRESS', 'OPEN', 'ESCALATED_TO_DEAN'][i % 4], ticket_count: 3 + i, created_at: iso(60 + i * 90), sla_hours: 4 })) : [];
    const technicians = [['Ramesh Chandra Sahu', 'Plumber', 'Plumbing'], ['Bikash Ranjan Behera', 'Electrician', 'Electrical'], ['Sanjay Kumar Muduli', 'LAN Engineer', 'Wi-Fi / LAN'], ['Gopal Krushna Das', 'Carpenter', 'Furniture'], ['Mamata Behera', 'Housekeeping', 'Cleanliness']]
        .map(([full_name, role, category], i) => ({ id: `T0${i}`, full_name, role, category, phone_number: `98765000${i}0`, active: true }));
    const dests = ['Bhubaneswar Market', 'Home - Cuttack', 'Hospital', 'Railway Station'];
    const scan = (id, ref, i, dir, m, late = false) => ({ id, pass_ref: ref, student_roll: studs[i % 60].roll_number, student_name: studs[i % 60].full_name, destination: dests[i % 4], category: i % 4 === 2 ? 'MEDICAL' : 'OUTING',
        direction: dir, method: 'QR', scanned_by: 'GUARD01', scanned_at: at(m), late_return: late });
    const nOut = busy ? 7 : scenario === 'quiet' ? 3 : 0;
    const pass_scans = [];
    for (let i = 0; i < nOut; i++) pass_scans.push(scan(`o${i}`, `GP-OUT${i}`, i, 'EXIT', 25 + i * 31));
    // returned passes: EXIT then RETURN (must NOT count as still out); the last two came back late
    for (let i = 0; i < (busy ? 11 : 4); i++) { pass_scans.push(scan(`x${i}`, `GP-RET${i}`, 10 + i, 'EXIT', 200 + i * 9)); pass_scans.push(scan(`r${i}`, `GP-RET${i}`, 10 + i, 'RETURN', 120 + i * 5, busy && i < 2)); }
    return { profiles, seed: { tickets, master_incidents, technicians, pass_scans, leave_requests: [] }, nOut };
}

const run = (app, vp, scenario) => {
    const r = spawnSync('python3', [path.join(HERE, 'ui/warden_home.py'), JSON.stringify({ base: app.base, vp, scenario, shots: process.env.LAYOUT_SHOTS || '' })], { encoding: 'utf8', timeout: 240000 });
    assert.equal(r.status, 0, r.stderr.slice(-1500));
    return JSON.parse(r.stdout.trim().split('\n').pop());
};
const fitsPhone = (o, label) => {
    assert.ok(o.controls.length > 0, `${label}: no controls`);
    assert.ok(o.controls.every(c => c.h >= 43.5 && c.l >= -0.5 && c.r <= (o.iw || 1e9)), `${label}: controls under 44px or off-screen ${JSON.stringify(o.controls.filter(c => c.h < 43.5))}`);
};

describe('Warden Home "Needs you now" (headless Chromium)', { skip: have ? false : 'python playwright or dist/ missing' }, () => {
    for (const vp of [[360, 740, 1.3], [390, 844, 1.3], [412, 915, 1.3], [1440, 900, 1.0]]) {
        test(`${vp[0]}px (text x${vp[2]}): busy day - 14 passes + overdue complaints + incidents + cleaning alert, heavy data`, async () => {
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-'));
            const d = buildData('busy');
            fs.writeFileSync(path.join(tmp, 'profiles.json'), JSON.stringify(d.profiles));
            fs.writeFileSync(path.join(tmp, 'seed.json'), JSON.stringify(d.seed));
            const app = await startApp({ dist: true, profilesFile: path.join(tmp, 'profiles.json'), mockEnv: { SEED_FILE: path.join(tmp, 'seed.json') } });
            try {
                fs.writeFileSync(path.join(app.dir, 'now.txt'), '');   // server on real time: the browser and the seeded rows use it too
                for (let i = 0; i < 14; i++) {
                    const roll = `24011${String(i).padStart(5, '0')}`;
                    const r = await app.api('POST', '/api/create-pass', 'WARD01', { passData: { id: `GP-${90000 + i}`, name: `Student ${i}`, rollNo: roll, studentId: roll, passType: i % 5 === 0 ? 'Medical' : 'Outing', destination: 'Bhubaneswar Market',
                        reason: 'Going home for a family function, will return Sunday evening before 8 PM', status: 'PENDING', priority: i % 5 === 0, createdAt: new Date(Date.now() - i * 2400000).toISOString(), validUntil: new Date(Date.now() + 86400000).toISOString() } });
                    assert.equal(r.status, 200);
                }
                const o = run(app, vp, 'busy');
                const phone = vp[0] < 800;
                assert.ok(o.home_visible, 'Home is the first screen');
                assert.ok(o.kpi_strip_hidden, 'old KPI strip is replaced by the hero on Home');
                assert.match(o.heading, /^Good (morning|afternoon|evening), Subrat!$/);
                assert.equal(o.hero_tiles.length, 4);
                assert.match(o.hero_tiles[0], /^7\s*Still out$/, `still out must ignore passes that already came back: ${o.hero_tiles[0]}`);
                assert.match(o.needs_badge, /Needs you now\s*\d+/);
                // passes first: 2 cards on a phone, 4 on a laptop; "View all" opens all 14 in place
                assert.equal(o.cards_initial, phone ? 2 : 4);
                assert.equal(o.cards_expanded, 14);
                // Approve = big full-width button; Reject = small, in the corner, never beside Approve
                assert.ok(o.approve_full_width && o.approve_h >= 50, `approve ${o.approve_h}`);
                assert.ok(o.reject_above_approve, 'reject sits above approve');
                assert.ok(o.reject_h >= 43.5 && o.reject_w < 140, `reject ${o.reject_w}x${o.reject_h}`);
                // rows: overdue complaints, incidents without technician, cleaning alert, late returns
                for (const k of ['home-row-overdue', 'home-row-incident', 'home-row-cleaning']) assert.ok(o.rows.some(x => x.startsWith(k)), `${k} row missing: ${JSON.stringify(o.rows)}`);
                assert.ok(o.rows.some(x => /Hostel B · Room 207/.test(x)), `cleaning row names the room: ${JSON.stringify(o.rows)}`);
                assert.equal(o.grid_tiles, 8);
                // sizes, clipping, scrolling
                o.iw = vp[0]; fitsPhone(o, 'home'); o.controls = o.controls_expanded; fitsPhone(o, 'home expanded');
                assert.deepEqual(o.clip, [], `clipped: ${JSON.stringify(o.clip)}`); assert.deepEqual(o.clip_expanded, [], `clipped (expanded): ${JSON.stringify(o.clip_expanded)}`);
                assert.equal(o.side_scroll, false);
                // approve and reject use the same endpoints as before: both passes are gone after a reload
                assert.equal(o.after_approve, phone ? 2 : 4);
                assert.equal(o.cards_after_reload, 12, `approved + rejected passes must stay gone after reload (got ${o.cards_after_reload})`);
                // every section reachable in one tap from the grid; Home chip comes back; Create pass opens the existing modal
                assert.ok(o.incident_open && o.home_chip_back, 'incident row opens Master Incidents, Home chip returns');
                assert.deepEqual(Object.values(o.reach), Array(8).fill(true), `sections: ${JSON.stringify(o.reach)}`);
                assert.ok(o.create_modal, 'Create pass quick action opens the modal');
                assert.match(o.register_still_out || '', /^7\b/, `the register header and Home agree on who is still out: ${o.register_still_out}`);
                assert.deepEqual(o.errors, []);
            } finally { await app.stop(); fs.rmSync(tmp, { recursive: true, force: true }); }
        });

        test(`${vp[0]}px (text x${vp[2]}): quiet day - All clear + students out; and nobody out`, async () => {
            for (const scenario of ['quiet', 'empty']) {
                const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wh-'));
                const d = buildData(scenario);
                fs.writeFileSync(path.join(tmp, 'profiles.json'), JSON.stringify(d.profiles));
                fs.writeFileSync(path.join(tmp, 'seed.json'), JSON.stringify(d.seed));
                const app = await startApp({ dist: true, profilesFile: path.join(tmp, 'profiles.json'), mockEnv: { SEED_FILE: path.join(tmp, 'seed.json') } });
                try {
                    fs.writeFileSync(path.join(app.dir, 'now.txt'), '');   // server on real time: the browser and the seeded rows use it too
                    const o = run(app, vp, scenario);
                    assert.ok(o.home_visible && o.all_clear, `${scenario}: All clear card`);
                    assert.ok(o.out_card, `${scenario}: Out right now card is always there`);
                    assert.equal(o.rows.length, 0, `${scenario}: no needs-you rows ${JSON.stringify(o.rows)}`);
                    assert.match(o.hero_tiles[0], new RegExp(`^${d.nOut}\\s*Still out$`));
                    if (scenario === 'empty') { assert.ok(o.nobody_out, 'empty state "Everyone is back in the hostel"'); assert.equal(o.out_rows, 0); }
                    else { assert.equal(o.nobody_out, false); assert.equal(o.out_rows, 3); }
                    assert.equal(o.grid_tiles, 8);
                    o.iw = vp[0]; fitsPhone(o, scenario);
                    assert.deepEqual(o.clip, [], `${scenario} clipped: ${JSON.stringify(o.clip)}`);
                    assert.equal(o.side_scroll, false);
                    assert.deepEqual(o.errors, []);
                } finally { await app.stop(); fs.rmSync(tmp, { recursive: true, force: true }); }
            }
        });
    }
});

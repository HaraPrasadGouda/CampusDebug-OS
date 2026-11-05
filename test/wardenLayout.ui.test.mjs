// Warden + guard phone layout at 130% text: pass-queue header, KPI labels, register refs, cluster rooms, create-pass modal targets, guard gate-log title.
// REAL server.js + mock Supabase (seeded with a warden, a guard, 60 hostel students, 40 complaints, 8 incidents, 80 gate scans, 14 pending passes) + the BUILT app in headless Chromium.
// Needs `npx vite build` first (skipped, loudly, if python playwright or dist/ is missing). Run: node --test test/wardenLayout.ui.test.mjs
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

// Heavy but plausible hostel data (50+ rows everywhere a queue can grow).
function buildData() {
    const profiles = JSON.parse(fs.readFileSync(path.join(HERE, 'support/profiles.json'), 'utf8'));
    const person = (i, roll, role, name, extra = {}) => ({ id: uid(i), roll_number: roll, role, full_name: name, phone_number: `9${String(i).padStart(9, '0')}`, ...extra });
    profiles.push(person(900, 'WARD01', 'WARDEN', 'Mr. Subrat Kumar Panda', { department: 'Hostel Administration' }), person(901, 'GUARD01', 'GUARD', 'Gate Guard Bhaskar'));
    const names = ['Ananya Mishra', 'Rakesh Kumar Behera', 'Subhashree Satapathy', 'Debasish Mohapatra', 'Priyanka Pattnaik', 'Soumya Ranjan Nayak'];
    const studs = Array.from({ length: 60 }, (_, i) => person(1000 + i, `24011${String(i).padStart(5, '0')}`, 'STUDENT', names[i % names.length] + (i >= names.length ? ' Jr.' : ''),
        { resident_type: 'hosteler', hostel_block: 'Hostel ' + 'ABC'[i % 3], room_number: String(100 + i), mentor_roll: 'FAC003', department: 'Computer Science & Engineering', course: 'BTech', section: 'A' }));
    profiles.push(...studs);
    const iso = (m) => new Date(Date.now() - m * 60000).toISOString();
    const cats = ['Plumbing', 'Electrical', 'Wi-Fi / LAN', 'Furniture', 'Cleanliness'];
    const tickets = Array.from({ length: 40 }, (_, i) => ({ id: `7000${String(i).padStart(4, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`, student_id: studs[i % 60].id, category: cats[i % 5],
        location: `${studs[i % 60].hostel_block}, Room ${studs[i % 60].room_number}`, urgency: ['Low', 'Medium', 'High'][i % 3], status: 'PENDING',
        raw_text: i % 4 === 0 ? 'Water leaking from the tap in the bathroom and the floor is flooded, please send someone urgently' : 'Fan not working', created_at: iso(10 + i * 37) }));
    const master_incidents = Array.from({ length: 8 }, (_, i) => ({ id: `8000${String(i).padStart(4, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`, category: cats[i % 5], hostel_block: 'ABC'[i % 3],
        floor_number: `Floor ${i % 4 + 1}`, status: ['OPEN', 'IN_PROGRESS', 'OPEN', 'ESCALATED_TO_DEAN'][i % 4], ticket_count: 3 + i, created_at: iso(60 + i * 90), sla_hours: 4 }));
    const technicians = [['Ramesh Chandra Sahu', 'Plumber', 'Plumbing'], ['Bikash Ranjan Behera', 'Electrician', 'Electrical'], ['Sanjay Kumar Muduli', 'LAN Engineer', 'Wi-Fi / LAN'], ['Gopal Krushna Das', 'Carpenter', 'Furniture'], ['Mamata Behera', 'Housekeeping', 'Cleanliness']]
        .map(([full_name, role, category], i) => ({ id: `T0${i}`, full_name, role, category, phone_number: `98765000${i}0`, active: true }));
    const pass_scans = Array.from({ length: 80 }, (_, i) => ({ id: `sc${i}`, pass_ref: `GP-${String(i).padStart(5, '0')}`, student_roll: studs[i % 60].roll_number, student_name: studs[i % 60].full_name,
        destination: ['Bhubaneswar Market', 'Home - Cuttack', 'Hospital', 'Railway Station'][i % 4], category: ['OUTING', 'OUTING', 'MEDICAL', 'HOME'][i % 4], direction: i % 2 ? 'RETURN' : 'EXIT', method: 'QR', scanned_by: 'GUARD01', scanned_at: iso(5 + i * 11), late_return: i % 7 === 0 }));
    return { profiles, seed: { tickets, master_incidents, technicians, pass_scans, leave_requests: [] } };
}

const run = (app, vp) => {
    const r = spawnSync('python3', [path.join(HERE, 'ui/warden_layout.py'), JSON.stringify({ base: app.base, vp, shots: process.env.LAYOUT_SHOTS || '' })], { encoding: 'utf8', timeout: 170000 });
    assert.equal(r.status, 0, r.stderr.slice(-1500));
    return JSON.parse(r.stdout.trim().split('\n').pop());
};

describe('Warden + guard phone layout (headless Chromium)', { skip: have ? false : 'python playwright or dist/ missing' }, () => {
    for (const vp of [[360, 740, 1.3], [390, 844, 1.3], [412, 915, 1.3], [1440, 900, 1.0]]) {
        test(`${vp[0]}px (text x${vp[2]}): headers, labels and targets fit; no sideways scroll`, async () => {
            const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-'));
            const d = buildData();
            fs.writeFileSync(path.join(tmp, 'profiles.json'), JSON.stringify(d.profiles));
            fs.writeFileSync(path.join(tmp, 'seed.json'), JSON.stringify(d.seed));
            const app = await startApp({ dist: true, profilesFile: path.join(tmp, 'profiles.json'), mockEnv: { SEED_FILE: path.join(tmp, 'seed.json') } });
            try {
                app.clock('10:30');
                for (let i = 0; i < 14; i++) {
                    const roll = `24011${String(i).padStart(5, '0')}`;
                    const r = await app.api('POST', '/api/create-pass', 'WARD01', { passData: { id: `GP-${90000 + i}`, name: `Student ${i}`, rollNo: roll, studentId: roll, passType: i % 5 === 0 ? 'Medical' : 'Outing', destination: 'Bhubaneswar Market',
                        reason: 'Going home for a family function, will return Sunday evening before 8 PM', status: 'PENDING', priority: i % 5 === 0, createdAt: new Date(Date.now() - i * 2400000).toISOString(), validUntil: new Date(Date.now() + 86400000).toISOString() } });
                    assert.equal(r.status, 200);
                }
                const o = run(app, vp);
                const phone = vp[0] < 800;
                // pass-queue header: title keeps real width (<=3 lines, not a 1-3 word sliver); Create is a 44px target fully on screen
                assert.ok(o.hdr.titleW >= 150, `title width ${o.hdr.titleW}`);
                assert.ok(o.hdr.titleLines <= 3, `title lines ${o.hdr.titleLines}`);
                assert.ok(o.hdr.btnH >= 43.5 && o.hdr.btnL >= 0 && o.hdr.btnR <= o.hdr.iw, `create button ${JSON.stringify(o.hdr)}`);
                // KPI sub-labels never break mid-word
                assert.ok(o.kpi.length >= 3 && o.kpi.every(x => x.lines <= 1), `kpi labels ${JSON.stringify(o.kpi)}`);
                // incident without mapped rooms: a dash, never an empty box
                assert.ok(o.rooms_empty && /Impacted Rooms:\s*—/.test(o.rooms_empty), `rooms box: ${o.rooms_empty}`);
                // register: pass ref on one line
                assert.ok(o.ref && o.ref.lines <= 1, `register ref ${JSON.stringify(o.ref)}`);
                // create-pass modal targets
                assert.ok(o.modal.closeW >= 43.5 && o.modal.closeH >= 43.5 && o.modal.inputH >= 43.5, `modal ${JSON.stringify(o.modal)}`);
                // guard gate-log title on one line, count inside the screen
                assert.ok(o.glog.lines <= 1 && o.glog.cRight <= o.glog.iw, `guard log header ${JSON.stringify(o.glog)}`);
                assert.equal(o.w_side_scroll, false); assert.equal(o.g_side_scroll, false);
                assert.deepEqual(o.errors, []);
                void phone;
            } finally { await app.stop(); fs.rmSync(tmp, { recursive: true, force: true }); }
        });
    }
});

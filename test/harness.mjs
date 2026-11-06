// Test harness: starts the mock Supabase + the REAL server.js in a scratch copy,
// with a fake clock the tests can move. No real database, no network, no .env.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export const DAY = '2026-11-04';                  // a Wednesday
export const SEC_A = 'BTech|Computer Science & Engineering|A';
export const SEC_B = 'BTech|Computer Science & Engineering|B';
export const SEC_C = 'BTech|Computer Science & Engineering|C';
const GRID = [
    { label: 'P1', start: '09:15 AM', startMin: 555, end: '10:15 AM', endMin: 615 },
    { label: 'P2', start: '10:15 AM', startMin: 615, end: '11:15 AM', endMin: 675 },
    { label: 'P3', start: '11:30 AM', startMin: 690, end: '12:30 PM', endMin: 750 },
    { label: 'P4', start: '01:30 PM', startMin: 810, end: '02:30 PM', endMin: 870 },
    { label: 'P5', start: '02:30 PM', startMin: 870, end: '03:30 PM', endMin: 930 },
    { label: 'P6', start: '03:30 PM', startMin: 930, end: '04:30 PM', endMin: 990 }
];
const T = { FAC001: 'Dr. Ananya Sharma', FAC002: 'Prof. Rajesh Kumar', FAC003: 'Dr. Priya Mishra', FAC004: 'Prof. Sandeep Das', FAC005: 'Dr. Neha Singh', FAC006: 'Prof. Amit Patnaik', FAC019: 'Dr. Meera Iyer' };
function slot(day, period, sectionKey, fac, code, subject, span = 1, kind = 'lecture') {
    const sec = sectionKey.split('|').pop();
    const g = GRID[period - 1], g2 = GRID[period - 1 + span - 1];
    return {
        department: 'CSE', departmentLabel: 'BTech CSE', course: 'BTech', section: sec, sectionKey,
        day, period, span, kind, subjectCode: code, subject, teacherId: fac, teacherName: T[fac],
        room: `R${period}0${sec}`, startMin: g.startMin, periodLabel: `P${period}`,
        time: `${g.start} - ${g2.end}`, endMin: g2.endMin
    };
}
/** Small, readable timetable. WEDNESDAY (today in the tests):
 *  P1 A:FAC003 DS | B:FAC002 PHY | C:FAC001 MA      P2 A:FAC001 OS | B:FAC004 MA
 *  P3 A:FAC002 PHY | B:FAC003 DS                      P4 A:FAC003 DS | B:FAC005 CN
 *  P5-6 B:FAC003 DS-Lab (2 periods) | A:FAC004 MA(P5)   FAC006 / FAC019 never teach A or B.
 *  Other days only prove "teaches this section": FAC005 teaches A on THUR, FAC004 teaches A and B. */
export function buildTimetable() {
    const slots = [
        slot('WED', 1, SEC_A, 'FAC003', 'DS', 'Data Structures'), slot('WED', 1, SEC_B, 'FAC002', 'PHY', 'Physics'), slot('WED', 1, SEC_C, 'FAC001', 'MA', 'Maths'),
        slot('WED', 2, SEC_A, 'FAC001', 'OS', 'Operating Systems'), slot('WED', 2, SEC_B, 'FAC004', 'MA', 'Maths'),
        slot('WED', 3, SEC_A, 'FAC002', 'PHY', 'Physics'), slot('WED', 3, SEC_B, 'FAC003', 'DS', 'Data Structures'),
        slot('WED', 4, SEC_A, 'FAC003', 'DS', 'Data Structures'), slot('WED', 4, SEC_B, 'FAC005', 'CN', 'Computer Networks'),
        slot('WED', 5, SEC_B, 'FAC003', 'DSL', 'DS Lab', 2, 'lab'), slot('WED', 5, SEC_A, 'FAC004', 'MA', 'Maths'),
        slot('THUR', 1, SEC_A, 'FAC005', 'CN', 'Computer Networks'), slot('THUR', 2, SEC_A, 'FAC004', 'MA', 'Maths'),
        slot('THUR', 1, SEC_B, 'FAC001', 'OS', 'Operating Systems'), slot('THUR', 3, SEC_B, 'FAC004', 'MA', 'Maths'),
        slot('THUR', 2, SEC_C, 'FAC006', 'EE', 'Electronics'), slot('FRI', 1, SEC_A, 'FAC003', 'DS', 'Data Structures')
    ];
    return {
        version: 'tt-test', generatedAt: `${DAY}T00:00:00Z`, generatedBy: 'test', grid: GRID, days: ['MON', 'TUE', 'WED', 'THUR', 'FRI', 'SAT'],
        sections: [SEC_A, SEC_B, SEC_C].map(k => ({ key: k, course: 'BTech', department: 'Computer Science & Engineering', section: k.split('|').pop(), label: `BTech CSE — Sec ${k.split('|').pop()}` })),
        summary: {}, conflicts: [], slots
    };
}

export async function startApp({ seed = true, dist = false, profilesFile = '', attendanceFile = '', timetableFile = '', env = {}, mockEnv = {} } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdb-teacher-'));
    for (const f of ['server.js', 'coverBoard.js', 'noticeAudience.js', 'passSigning.js', 'cleaning.js', 'cleaning-store.js', 'fee-store.js', 'package.json']) fs.copyFileSync(path.join(REPO, f), path.join(dir, f));
    fs.cpSync(path.join(REPO, 'src'), path.join(dir, 'src'), { recursive: true });
    fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(dir, 'node_modules'));
    if (dist) for (const d of ['dist', 'public']) if (fs.existsSync(path.join(REPO, d))) fs.symlinkSync(path.join(REPO, d), path.join(dir, d));   // live: a rebuild shows at once
    fs.mkdirSync(path.join(dir, 'data'));
    fs.writeFileSync(path.join(dir, 'data', 'timetable.json'), JSON.stringify(buildTimetable()));
    if (timetableFile) fs.copyFileSync(timetableFile, path.join(dir, 'data', 'timetable.json'));   // e.g. the real 1,367-slot timetable (heavy-data shots)
    if (attendanceFile) fs.copyFileSync(attendanceFile, path.join(dir, 'data', 'attendance.json'));
    const nowFile = path.join(dir, 'now.txt');
    const clock = (hm, day = DAY) => { fs.writeFileSync(nowFile, `${day}T${hm}:00+05:30`); };
    clock('08:00');
    const mockPort = await freePort(), port = await freePort();
    const logs = { mock: '', srv: '' };
    const mock = spawn('node', [path.join(REPO, 'test/support/mock.mjs')], {
        env: { ...process.env, PROFILES_FILE: profilesFile, MOCK_PORT: String(mockPort), SEED_FILE: seed ? path.join(REPO, 'test/support/seed.json') : '', ...mockEnv }, stdio: ['ignore', 'pipe', 'pipe']
    });
    mock.stdout.on('data', d => logs.mock += d);
    const srv = spawn('node', ['--import', path.join(REPO, 'test/support/fakeclock.mjs'), 'server.js'], {
        cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
        env: {
            PATH: process.env.PATH, HOME: process.env.HOME, TZ: 'Asia/Kolkata', PORT: String(port), FAKE_NOW_FILE: nowFile,
            SUPABASE_URL: `http://127.0.0.1:${mockPort}`, SUPABASE_SERVICE_ROLE_KEY: 'test-not-a-key', HMAC_SECRET: 'test-not-a-secret', ...env
        }
    });
    srv.stdout.on('data', d => logs.srv += d); srv.stderr.on('data', d => logs.srv += d);
    for (let i = 0; i < 100 && !/running on/.test(logs.srv); i++) await sleep(100);
    if (!/running on/.test(logs.srv)) throw new Error('server did not start:\n' + logs.srv.slice(-600));
    const base = `http://127.0.0.1:${port}`;
    const api = async (method, p, roll, body) => {
        const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(roll ? { authorization: `Bearer tok-${roll}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
        let json = null; try { json = await r.json(); } catch { /* empty */ }
        return { status: r.status, json };
    };
    const stop = () => { srv.kill('SIGKILL'); mock.kill('SIGKILL'); fs.rmSync(dir, { recursive: true, force: true }); };
    return { api, clock, stop, logs, dir, base, port, mockPort };
}

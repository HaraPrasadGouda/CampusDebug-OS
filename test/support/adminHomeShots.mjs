
// Contact-sheet screenshots from the REAL built app (not part of the suite): node test/support/adminHomeShots.mjs <outDir>
process.env.TZ = 'Asia/Kolkata';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { spawnSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
import { startApp } from '../harness.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url)); const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
const DEAN = { id: '0000002d-0000-4000-8000-00000000002d', roll_number: 'DEAN01', role: 'DEAN', full_name: 'Dr. Meera Rath', phone_number: '9000000998' };
const TYPES = ['BONAFIDE_CERTIFICATE', 'MIGRATION_NOC', 'CONDUCT_CERTIFICATE', 'FEE_RECEIPT_COPY'];
const REMARKS = ['Scholarship application', 'Moving to another college', 'Passport application', 'Bank account opening'];
for (const busy of [true, false]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdb-sheet-'));
  const profiles = JSON.parse(fs.readFileSync(path.join(HERE, '../support/profiles.json'), 'utf8')); profiles.push(DEAN);
  const studs = profiles.filter((p) => p.role === 'STUDENT');
  const iso = (m) => new Date(Date.parse('2026-11-04T14:05:00+05:30') - m * 60000).toISOString();
  const docs = !busy ? [] : Array.from({ length: 14 }, (_, i) => ({ id: `d0c00000-0000-4000-8000-${String(i).padStart(12, '0')}`, student_id: studs[i % studs.length].id, doc_type: TYPES[i % 4], status: 'PENDING', remarks: REMARKS[i % 4], created_at: iso(180 + i * 310) }));
  const tickets = !busy ? [] : [['Water leakage, 3rd floor corridor', 'Plumbing', 'Hostel B, Block B', 600], ['Wi-Fi down in study hall', 'Wi-Fi / LAN', 'Hostel A, Block A', 360]]
    .map(([txt, cat, loc, age], i) => ({ id: `7000000${i}-0000-4000-8000-00000000000${i}`, student_id: studs[i].id, category: cat, location: loc, urgency: 'High', status: 'ESCALATED_TO_DEAN', raw_text: txt, created_at: iso(age + 240) }));
  fs.writeFileSync(path.join(dir, 'profiles.json'), JSON.stringify(profiles)); fs.writeFileSync(path.join(dir, 'extra.json'), JSON.stringify({ document_requests: docs, tickets }));
  const app = await startApp({ dist: true, profilesFile: path.join(dir, 'profiles.json'), mockEnv: { EXTRA_TABLES_FILE: path.join(dir, 'extra.json') } });
  try {
    if (busy) { app.clock('09:30'); await app.api('POST', '/api/leave-requests/teacher-absent', 'FAC003', { onLeave: true, substituteRoll: 'FAC019' }); }
    app.clock('14:05');
    for (const vp of [[390, busy ? 3300 : 1700, 1.3], [1440, busy ? 1500 : 1000, 1.0]]) {
      const cfg = { base: app.base, vp, roll: 'DEAN01', profile: { ...DEAN, rollNumber: 'DEAN01', fullName: DEAN.full_name }, now: '2026-11-04T14:05:00+05:30', scenario: busy ? 'busy' : 'quiet', shots: out, shotOnly: true };
      const r = spawnSync('python3', [path.join(HERE, '../ui/admin_home.py'), JSON.stringify(cfg)], { encoding: 'utf8', timeout: 300000 });
      if (r.status !== 0) console.error(r.stderr.slice(-800));
    }
  } finally { await app.stop(); fs.rmSync(dir, { recursive: true, force: true }); }
}

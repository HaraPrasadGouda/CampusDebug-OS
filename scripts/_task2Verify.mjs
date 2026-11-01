// Task 2 live verification: create passes in all 3 categories, confirm
// pass_category + priority land in Supabase, then clean up test rows.
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'node:fs';

const env = readFileSync('.env', 'utf8');
const pick = (n) => {
  const m = env.match(new RegExp(n + '=(.+)'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
};
const sb = createClient(pick('SUPABASE_URL'), pick('SUPABASE_SERVICE_ROLE_KEY'));
const BASE = 'http://localhost:5050';
const TEST_STUDENT_PASSWORD = pick('TEST_STUDENT_PASSWORD');

// 1. Login as Diya
const login = await fetch(`${BASE}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ rollNumber: '2201107101', password: TEST_STUDENT_PASSWORD })
}).then((r) => r.json());
if (!login.success) { console.error('login failed', login); process.exit(1); }

const cases = [
  { label: 'DAY_PASS', passType: 'Day Pass', priority: false, dest: 'City Market' },
  { label: 'MEDICAL', passType: 'Medical Outing', priority: true, dest: 'Apollo Hospital' },
  { label: 'HOME_LEAVE', passType: 'Home Leave', priority: false, dest: 'Home, Cuttack' }
];

const ids = [];
for (const c of cases) {
  const passData = {
    id: `GP-T${Math.floor(100000 + Math.random() * 900000)}`,
    passId: null,
    rollNo: '2201107101',
    studentId: '2201107101',
    name: 'Diya Rath',
    destination: c.dest,
    reason: 'task2 verification',
    passType: c.passType,
    priority: c.priority,
    validUntil: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };
  passData.passId = passData.id;
  ids.push(passData.id);
  const r = await fetch(`${BASE}/api/create-pass`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.session.access_token}` },
    body: JSON.stringify({ passData })
  }).then((x) => x.json());
  console.log('created', passData.id, c.label, '->', r.success ? 'ok' : JSON.stringify(r));
}

// Give the best-effort async upserts a moment
await new Promise((r) => setTimeout(r, 1500));

// 2. Read back from Supabase
const { data: rows, error } = await sb
  .from('gate_passes')
  .select('pass_ref, pass_type, pass_category, priority, status, destination')
  .in('pass_ref', ids);
if (error) { console.error('select error', error.message); process.exit(1); }
console.log('\nSupabase rows:');
for (const row of rows) console.log(' ', JSON.stringify(row));
console.log('rows found:', rows.length, '/', ids.length);

// 3. Cleanup: delete test rows from Supabase
const { error: delErr } = await sb.from('gate_passes').delete().in('pass_ref', ids);
console.log('supabase cleanup:', delErr ? 'ERR ' + delErr.message : 'deleted');

// 4. Cleanup: remove test entries from the JSON ledger (BOM-safe read,
//    UTF-8 no-BOM write — see the BOM incident note in the project)
try {
  const raw = readFileSync('data/gate_passes.json', 'utf8').replace(/^\uFEFF/, '');
  const ledger = JSON.parse(raw);
  const before = ledger.length;
  const kept = ledger.filter((p) => !ids.includes(p.id));
  writeFileSync('data/gate_passes.json', JSON.stringify(kept, null, 2), 'utf8');
  console.log(`ledger cleanup: ${before} -> ${kept.length} entries`);
} catch (e) {
  console.log('ledger cleanup failed:', e.message);
}

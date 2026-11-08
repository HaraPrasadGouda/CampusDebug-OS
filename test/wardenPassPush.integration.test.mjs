process.env.TZ = 'Asia/Kolkata';
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startApp } from './harness.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const HOSTELLER = '2301165000', WARDEN = 'WARDEN01';
const profilesFile = () => {
  const base = JSON.parse(fs.readFileSync(path.join(HERE, 'support/profiles.json'), 'utf8'));
  const w = { id: '00009001-0000-4000-8000-000000009001', roll_number: WARDEN, role: 'WARDEN', full_name: 'Warden One', phone_number: '950009001', department: 'Administration' };
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cdb-wp-')), 'profiles.json');
  fs.writeFileSync(f, JSON.stringify([...base, w]));
  return f;
};
const mkPass = (id) => ({ id, destination: 'Town market', reason: 'Medicines', passType: 'Day Pass', priority: 'NORMAL', validUntil: new Date(Date.now() + 6 * 3600e3).toISOString(), createdAt: new Date().toISOString(), createdAtMs: Date.now() });
const lines = (app) => app.logs.srv.match(/\[PASS PUSH\] new request GP-[A-Z0-9]+ from \d+ -> \d+ warden/g) || [];

describe('warden gets a push when a student requests a pass', () => {
  let app;
  before(async () => { app = await startApp({ profilesFile: profilesFile() }); });
  after(() => app.stop());

  test('no warden device registered: logged with 0 devices, request still succeeds', async () => {
    const r = await app.api('POST', '/api/create-pass', HOSTELLER, { passData: mkPass('GP-WP0001') });
    assert.equal(r.status, 200);
    for (let i = 0; i < 30 && !lines(app).length; i++) await sleep(100);
    assert.match(app.logs.srv, /\[PASS PUSH\] new request GP-WP0001 from \d+ -> 0 warden/);
  });

  test('warden device registered: logged with 1; a replay of the same pass does not push again', async () => {
    const sub = { endpoint: 'https://example.invalid/push/wp-test', keys: { p256dh: 'x', auth: 'y' } };
    const s = await app.api('POST', '/api/push/subscribe', WARDEN, { subscription: sub });
    assert.equal(s.status, 200);
    const r = await app.api('POST', '/api/create-pass', HOSTELLER, { passData: mkPass('GP-WP0002') });
    assert.equal(r.status, 200);
    for (let i = 0; i < 30 && !/GP-WP0002 from \d+ -> 1 warden/.test(app.logs.srv); i++) await sleep(100);
    assert.match(app.logs.srv, /GP-WP0002 from \d+ -> 1 warden/);
    const before = lines(app).length;
    await app.api('POST', '/api/create-pass', HOSTELLER, { passData: mkPass('GP-WP0002') });
    await sleep(500);
    assert.equal(lines(app).length, before, 'replay of an existing pass must not push again');
  });
});

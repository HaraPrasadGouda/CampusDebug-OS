// Integration: the REAL server.js (mock database, fake clock) sends the 1 PM "Room check" push once.
// Run: node --test test/cleaning.push.integration.test.mjs
import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startApp } from './harness.mjs';

const require = createRequire(import.meta.url);
const webpush = require('web-push');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUNDAY = '2026-11-08';
const pushLines = (app) => (app.logs.srv.match(/\[CLEANING PUSH\] Block A: (\d+) student\(s\) asked/g) || []);
const dump = async (app, t) => (await fetch(`http://127.0.0.1:${app.mockPort}/__dump?t=${t}`)).json();

describe('1 PM room-check push through the real server', () => {
  let app;
  before(async () => {
    const keys = webpush.generateVAPIDKeys();
    app = await startApp({ env: { CLEANING_TICK_MS: '300', VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey } });
    app.clock('12:59', SUNDAY);
  });
  after(() => app.stop());

  test('12:59: nothing is sent and nothing is logged', async () => {
    await sleep(1500);
    assert.equal(pushLines(app).length, 0, app.logs.srv.slice(-500));
    assert.equal((await dump(app, 'cleaning_push_log')).length, 0);
  });

  test('13:00: one push round, logged per student; further ticks send nothing more', async () => {
    app.clock('13:00', SUNDAY);
    for (let i = 0; i < 40 && !pushLines(app).length; i++) await sleep(100);
    assert.equal(pushLines(app).length, 1, app.logs.srv.slice(-500));
    const n = Number(pushLines(app)[0].match(/: (\d+) student/)[1]);
    assert.ok(n >= 12, `most of the 18 hostellers asked (got ${n})`);
    const log = await dump(app, 'cleaning_push_log');
    assert.equal(log.length, n);
    assert.ok(log.every((r) => r.check_date === SUNDAY && r.block === 'Block A'));
    await sleep(1800);                                                // ~6 more ticks
    assert.equal(pushLines(app).length, 1, 'no second push');
    assert.equal((await dump(app, 'cleaning_push_log')).length, n, 'log unchanged');
  });

  test('21:00 the question is closed: no push; the next cleaning Sunday is a new day', async () => {
    app.clock('21:00', SUNDAY);
    await sleep(1200);
    assert.equal(pushLines(app).length, 1);
    app.clock('13:05', '2026-11-15');
    for (let i = 0; i < 40 && pushLines(app).length < 2; i++) await sleep(100);
    assert.equal(pushLines(app).length, 2, 'new cleaning day, new push');
  });
});

describe('without push keys (dry run)', () => {
  let app;
  before(async () => { app = await startApp({ env: { CLEANING_TICK_MS: '300' } }); app.clock('13:10', SUNDAY); });
  after(() => app.stop());
  test('logs a dry run, does not crash, still logs once per student', async () => {
    for (let i = 0; i < 40 && !/dry run/.test(app.logs.srv); i++) await sleep(100);
    assert.match(app.logs.srv, /\[CLEANING PUSH\] Block A: \d+ student\(s\) asked \(push keys missing — dry run\)/);
    const first = (await dump(app, 'cleaning_push_log')).length;
    await sleep(1200);
    assert.equal((await dump(app, 'cleaning_push_log')).length, first);
    assert.equal((app.logs.srv.match(/dry run/g) || []).length, 1);
  });
});

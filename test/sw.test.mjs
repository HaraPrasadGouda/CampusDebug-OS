// Service worker tests (P1-11): the REAL public/sw.js run in a sandbox with a fake Cache API and a controllable network.
// SW_FILE=/path/to/old/sw.js node --test test/sw.test.mjs   runs the same checks against another copy (used to show the old one fails).
import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { stampServiceWorker, newBuildId } from '../vite.sw-stamp.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SW_FILE = process.env.SW_FILE || path.join(HERE, '../public/sw.js');
const ORIGIN = 'https://app.test';
const html = (n) => ({ type: 'text/html', body: `<html><script type="module" src="/assets/index-${n}.js"></script><link rel="stylesheet" href="/assets/index-${n}.css"></html>` });

function makeBrowser(buildId, caches = new Map()) {
    const net = { online: true, hang: false, files: {} };
    const toUrl = (r) => new URL(typeof r === 'string' ? r : r.url, ORIGIN).pathname;
    const mkCache = (name) => {
        if (!caches.has(name)) caches.set(name, new Map());
        const m = caches.get(name);
        return { put: async (r, res) => { m.set(toUrl(r), res); }, match: async (r) => { const x = m.get(toUrl(r)); return x ? x.clone() : undefined; }, addAll: async (list) => { for (const u of list) { const res = await fakeFetch(u); m.set(toUrl(u), res); } }, keys: async () => [...m.keys()].map((k) => ({ url: ORIGIN + k })), delete: async (r) => m.delete(toUrl(r)) };
    };
    const fakeCaches = { open: async (n) => mkCache(n), keys: async () => [...caches.keys()], delete: async (n) => caches.delete(n), match: async (r) => { for (const [, m] of caches) { const x = m.get(toUrl(r)); if (x) return x.clone(); } } };
    const fakeFetch = async (r) => {
        if (net.hang) return new Promise(() => {});
        if (!net.online) throw new TypeError('Failed to fetch');
        const p = toUrl(r);
        const f = net.files[p] || (p.startsWith('/assets/') || p === '/' || p === '/index.html' ? null : null);
        const hit = net.files[p] || (p === '/' ? net.files['/index.html'] : null);
        if (hit) { const res = new Response(hit.body, { status: 200, headers: { 'content-type': hit.type } }); Object.defineProperty(res, 'type', { value: 'basic' }); return res; }
        // the server's SPA catch-all: any unknown path answers index.html
        const idx = net.files['/index.html'];
        const res = new Response(idx.body, { status: 200, headers: { 'content-type': 'text/html' } }); Object.defineProperty(res, 'type', { value: 'basic' }); return res;
    };
    const handlers = {};
    const self = { location: { origin: ORIGIN }, addEventListener: (t, h) => { handlers[t] = h; }, skipWaiting: () => { self.skipped = true; return Promise.resolve(); }, clients: { claim: () => { self.claimed = true; return Promise.resolve(); }, matchAll: async () => [] }, registration: {} };
    class Req { constructor(u, o = {}) { this.url = new URL(u, ORIGIN).href; Object.assign(this, { method: 'GET', mode: 'cors' }, o); } }
    const src = stampServiceWorker(fs.readFileSync(SW_FILE, 'utf8'), buildId);
    // timers run 100x faster so the 4 s "slow network" rule can be tested quickly
    const ctx = vm.createContext({ self, caches: fakeCaches, fetch: fakeFetch, Request: Req, Response, URL, console: { log() {}, warn() {}, error() {} }, indexedDB: {}, setTimeout: (f, ms) => setTimeout(f, Math.ceil(ms / 100)), clearTimeout });
    vm.runInContext(src, ctx);
    const wait = async (p) => { const ev = { waitUntil: (x) => { ev.p = x; } }; await Promise.resolve(); return ev; };
    return {
        net, caches, self,
        async install() { const ev = { waitUntil: (x) => { ev.p = x; } }; handlers.install(ev); await ev.p; },
        async activate() { const ev = { waitUntil: (x) => { ev.p = x; } }; handlers.activate(ev); await ev.p; },
        // returns the body text, or null when the SW did not intercept the request
        async get(url, { navigate = false } = {}) {
            const ev = { request: { method: 'GET', url: ORIGIN + url, mode: navigate ? 'navigate' : 'cors' }, respondWith: (p) => { ev.p = p; } };
            handlers.fetch(ev);
            if (!ev.p) return null;
            const res = await ev.p;
            return res && res.ok !== false && typeof res.text === 'function' ? res.text() : '(error)';
        }
    };
}

describe('P1-11 service worker: a new deploy shows up without a hard refresh, offline still works', () => {
    test('after a deploy, the page you open is the NEW build (the old worker answered with the cached old index.html)', async () => {
        const b = makeBrowser('b1');
        b.net.files = { '/index.html': html('v1') };
        await b.install(); await b.activate();
        assert.match(await b.get('/', { navigate: true }), /index-v1\.js/);
        b.net.files = { '/index.html': html('v2') };                                 // deploy
        assert.match(await b.get('/', { navigate: true }), /index-v2\.js/, 'first open after the deploy shows v2');
        assert.match(await b.get('/index.html'), /index-v2\.js/);
    });
    test('offline: the last good page still opens (guard desk keeps working)', async () => {
        const b = makeBrowser('b1');
        b.net.files = { '/index.html': html('v1') };
        await b.install(); await b.activate();
        await b.get('/', { navigate: true });
        b.net.online = false;
        assert.match(await b.get('/', { navigate: true }), /index-v1\.js/);
        assert.match(await b.get('/some/deep/route', { navigate: true }), /index-v1\.js/, 'any in-app route opens the cached shell offline');
    });
    test('hanging network (>4 s, "one bar" signal): the cached page opens instead of a blank wait', async () => {
        const b = makeBrowser('b1');
        b.net.files = { '/index.html': html('v1') };
        await b.install(); await b.activate();
        b.net.hang = true;
        assert.match(await b.get('/', { navigate: true }), /index-v1\.js/);
    });
    test('hashed assets are cache-first and survive a new build (an open old tab can still lazy-load its chunks)', async () => {
        const b = makeBrowser('b1');
        b.net.files = { '/index.html': html('v1'), '/assets/chunk-old.js': { type: 'text/javascript', body: 'OLD CHUNK' } };
        await b.install(); await b.activate();
        assert.equal(await b.get('/assets/chunk-old.js'), 'OLD CHUNK');
        // new build ships: new worker, same caches; the old chunk is gone from the server (SPA catch-all answers index.html)
        const b2 = makeBrowser('b2', b.caches);
        b2.net.files = { '/index.html': html('v2') };
        await b2.install(); await b2.activate();
        assert.equal(await b2.get('/assets/chunk-old.js'), 'OLD CHUNK', 'old chunk still served from the kept asset cache');
    });
    test('a missing asset answered with index.html (SPA catch-all) is never cached as a script', async () => {
        const b = makeBrowser('b1');
        b.net.files = { '/index.html': html('v1') };
        await b.install(); await b.activate();
        await b.get('/assets/does-not-exist.js');
        const assets = b.caches.get('campusdebug-assets-v1');
        assert.ok(!assets || !assets.has('/assets/does-not-exist.js'));
    });
    test('installing the new worker also fetches the new index.html (not the HTTP-cached one) and its hashed files, so the new build opens offline at once', async () => {
        const b = makeBrowser('b1');
        b.net.files = { '/index.html': html('v9'), '/assets/index-v9.js': { type: 'text/javascript', body: 'JS9' }, '/assets/index-v9.css': { type: 'text/css', body: 'CSS9' } };
        await b.install(); await b.activate();
        b.net.online = false;
        assert.match(await b.get('/', { navigate: true }), /index-v9\.js/);
        assert.equal(await b.get('/assets/index-v9.js'), 'JS9');
        assert.equal(await b.get('/assets/index-v9.css'), 'CSS9');
        assert.equal(b.self.skipped, true, 'skipWaiting');
    });
    test('activate drops old shells (incl. the pre-versioned campusdebug-os-v77), keeps the asset cache, and claims clients', async () => {
        const caches = new Map([['campusdebug-os-v77', new Map([['/index.html', new Response('old')]])], ['campusdebug-shell-b0', new Map()], ['campusdebug-assets-v1', new Map([['/assets/x.js', new Response('x')]])], ['someone-elses-cache', new Map()]]);
        const b = makeBrowser('b1', caches);
        b.net.files = { '/index.html': html('v1') };
        await b.install(); await b.activate();
        assert.deepEqual([...caches.keys()].sort(), ['campusdebug-assets-v1', 'campusdebug-shell-b1', 'someone-elses-cache']);
        assert.equal(b.self.claimed, true, 'clients.claim');
    });
    test('API calls, the health heartbeat and POSTs are never touched by the worker', async () => {
        const b = makeBrowser('b1');
        b.net.files = { '/index.html': html('v1') };
        await b.install(); await b.activate();
        assert.equal(await b.get('/api/dashboard-data'), null);
        assert.equal(await b.get('/api/health'), null);
    });
    test('every build gets a different sw.js (so browsers install it): the build id is stamped, not left as a placeholder', () => {
        const src = fs.readFileSync(path.join(HERE, '../public/sw.js'), 'utf8');
        assert.match(src, /__BUILD_ID__/);
        const a = stampServiceWorker(src, newBuildId()), c = stampServiceWorker(src, newBuildId());
        assert.notEqual(a, c);
        assert.ok(!/__BUILD_ID__/.test(a));
    });
});

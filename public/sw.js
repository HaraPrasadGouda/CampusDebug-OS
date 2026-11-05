// Stamped with a fresh id by every `vite build` (see vite.config.js) so a new deploy ships a different sw.js.
const BUILD_ID = '__BUILD_ID__';
const SHELL_CACHE = `campusdebug-shell-${BUILD_ID}`;
const ASSET_CACHE = 'campusdebug-assets-v1';   // hashed build files: kept across builds

// ----------------------------------------------------
// Web Push handler: the browser push service wakes this SW even when the
// PWA is closed. THIS is what makes phone notifications work in the
// background (in-page timers cannot — Chrome suspends them).
// ----------------------------------------------------
self.addEventListener('push', (event) => {
    let data = { title: 'CampusDebug OS', body: 'New campus update', url: '/' };
    try {
        if (event.data) data = { ...data, ...event.data.json() };
    } catch (e) {
        // payload wasn't JSON — fall back to defaults
    }
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: '/brand_icon_128.png',
            badge: '/brand_icon_sm.png',
            tag: 'campusdebug-push',
            data: { url: data.url || '/' }
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const url = (event.notification.data && event.notification.data.url) || '/';
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            const hit = clients.find(c => c.url.includes(self.registration.scope));
            if (hit) return hit.focus();
            return self.clients.openWindow(url);
        })
    );
});
const SHELL_FILES = ['/', '/index.html', '/manifest.json'];

// ----------------------------------------------------
// Caching (P1-11 — "old screen after every deploy").
//   • The page itself (navigations, /, /index.html) is NETWORK-FIRST: online you
//     always get the newest build. If the network is slow (>4 s) or down, the last
//     cached copy opens instead, so the app still opens offline (guard desk!).
//   • Hashed build files (/assets/index-<hash>.js|css) never change, so they are
//     CACHE-FIRST and kept in a cache that is NOT wiped on a new build — an
//     already-open old page can still lazy-load its own old chunks.
//   • Everything else (icons, manifest, images) is stale-while-revalidate.
//   • BUILD_ID is stamped at build time (vite.config.js), so every build gives the
//     browser a byte-different sw.js: it installs, skipWaiting()s and claim()s
//     at once and drops the old shell cache. No hard refresh needed.
// ----------------------------------------------------
const NAV_TIMEOUT_MS = 4000;
const MAX_ASSET_ENTRIES = 240;

const isHtmlResponse = (res) => /text\/html/i.test((res && res.headers && res.headers.get('content-type')) || '');

// The new index.html names its hashed JS/CSS; fetch them now so the new build also opens offline.
async function precacheAssetsOf(indexResponse) {
  try {
    const html = await indexResponse.text();
    const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    const cache = await caches.open(ASSET_CACHE);
    await Promise.all(urls.map((u) => fetch(u).then((r) => (r && r.ok && !isHtmlResponse(r) ? cache.put(u, r) : null)).catch(() => null)));
  } catch (e) { /* offline shell still works from the lazy cache */ }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => Promise.all(SHELL_FILES.map((f) =>
        // 'reload' bypasses the HTTP cache so the shell is the NEW build, not a stale copy
        fetch(new Request(f, { cache: 'reload' })).then(async (res) => {
          if (!res || !res.ok) return null;
          if (f === '/index.html') await precacheAssetsOf(res.clone());
          return cache.put(f, res);
        }).catch(() => null)
      )))
      .then(() => self.skipWaiting())
  );
});

async function pruneAssets() {
  const cache = await caches.open(ASSET_CACHE);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_ASSET_ENTRIES; i++) await cache.delete(keys[i]);   // oldest first
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.map((key) => {
      // Old shells (including the pre-versioned 'campusdebug-os-vNN') go; the hashed-asset cache stays.
      const ours = key.startsWith('campusdebug-os-') || key.startsWith('campusdebug-shell-');
      if (ours && key !== SHELL_CACHE) return caches.delete(key);
    }))).then(() => pruneAssets()).catch(() => null).then(() => self.clients.claim())
  );
});

// Network first, cached copy when the network is down or slower than NAV_TIMEOUT_MS.
function networkFirstPage(request) {
  const network = fetch(request).then(async (res) => {
    if (res && res.ok && res.type === 'basic' && isHtmlResponse(res)) {
      const cache = await caches.open(SHELL_CACHE);
      cache.put('/index.html', res.clone());
      cache.put('/', res.clone());
    }
    return res;
  });
  const fallback = async () => {
    const cache = await caches.open(SHELL_CACHE);
    return (await cache.match(request)) || (await cache.match('/index.html')) || (await cache.match('/'));
  };
  return new Promise((resolve) => {
    let settled = false;
    const done = (res) => { if (!settled && res) { settled = true; resolve(res); } };
    const timer = setTimeout(async () => { const c = await fallback(); if (c) done(c); }, NAV_TIMEOUT_MS);
    network.then((res) => { clearTimeout(timer); done(res); })
      .catch(async () => {
        clearTimeout(timer);
        const c = await fallback();
        if (c) done(c);
        else if (!settled) { settled = true; resolve(Response.error()); }
      });
  });
}

async function cacheFirstAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  // The server answers an unknown path with index.html (SPA catch-all): never keep that as a "script".
  if (res && res.ok && res.type === 'basic' && !isHtmlResponse(res)) {
    cache.put(request, res.clone());
    pruneAssets();
  }
  return res;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(request);
  const refresh = fetch(request).then((res) => {
    if (res && res.ok && res.type === 'basic' && !isHtmlResponse(res)) cache.put(request, res.clone());
    return res;
  });
  if (hit) { refresh.catch(() => null); return hit; }
  return refresh;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  let url;
  try { url = new URL(request.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;     // fonts etc.: the browser handles them as before

  // Connectivity heartbeat must hit the real network every time — a cached
  // response would make the status pill show "Online" even when offline.
  if (url.pathname.includes('/api/health')) return;
  // API calls must NEVER be served from the SW cache: regenerated timetables,
  // approval queues and pass states change server-side in place.
  // Offline resilience for data comes from IndexedDB, not this cache.
  if (url.pathname.includes('/api/')) return;
  if (url.pathname === '/sw.js') return;

  if (request.mode === 'navigate' || url.pathname === '/' || url.pathname === '/index.html') {
    event.respondWith(networkFirstPage(request));
  } else if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cacheFirstAsset(request));
  } else {
    event.respondWith(staleWhileRevalidate(request));
  }
});

// Background Sync for Offline Ticket Flushing
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-tickets') {
    console.log('[CampusDebug SW] Connectivity restored! Triggering offline ticket sync...');
    event.waitUntil(flushOfflineTicketQueue());
  }
});

async function flushOfflineTicketQueue() {
  try {
    // Open IndexedDB database directly inside Service Worker
    const dbRequest = indexedDB.open('CampusDebugOS_DB', 1);
    dbRequest.onsuccess = async (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('offline_queue')) return;

      const tx = db.transaction('offline_queue', 'readonly');
      const store = tx.objectStore('offline_queue');
      const getReq = store.getAll();

      getReq.onsuccess = async () => {
        const queue = getReq.result || [];
        const ticketActions = queue.filter(item => item.action === 'CREATE_TICKET');

        for (const item of ticketActions) {
          try {
            // Same-origin relative URL: the Express server serves both the PWA
            // (dist/) and the API, so no host/port literal is needed here.
            // (Service workers cannot read import.meta.env.)
            const res = await fetch('/api/parse-ticket', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(item.payload)
            });

            if (res.ok) {
              console.log('[CampusDebug SW] Successfully synced offline ticket to server:', item.payload);
              // Remove synced item from store
              const delTx = db.transaction('offline_queue', 'readwrite');
              delTx.objectStore('offline_queue').delete(item.id);
            }
          } catch (err) {
            console.warn('[CampusDebug SW] Failed to sync ticket item:', err);
          }
        }
      };
    };
  } catch (err) {
    console.error('[CampusDebug SW] Error flushing offline ticket queue:', err);
  }
}


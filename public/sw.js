const CACHE_NAME = 'campusdebug-os-v77';

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
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[CampusDebug SW] Pre-caching offline shell');
      return cache.addAll(ASSETS_TO_CACHE);
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[CampusDebug SW] Removing legacy cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Connectivity heartbeat must hit the real network every time — a cached
  // response would make the status pill show "Online" even when offline.
  if (event.request.url.includes('/api/health')) return;
  // API calls must NEVER be served from the SW cache: regenerated timetables,
  // approval queues and pass states change server-side in place, and a
  // stale-while-revalidate read would show yesterday's truth for one visit.
  // Offline resilience for data comes from IndexedDB, not this cache.
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        // Fetch in background for fresh cache (stale-while-revalidate for fast render)
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
            }
          })
          .catch(() => { /* Silent catch when offline */ });
        return cachedResponse;
      }

      // If not cached, fetch from network and cache
      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });
          return networkResponse;
        })
        .catch(() => {
      // Offline fallback for navigation requests
          if (event.request.mode === 'navigate') {
            return caches.match('/index.html');
          }
        });
    })
  );
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


export function registerServiceWorker() {
  if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('[CampusDebug SW] Registered successfully with scope:', reg.scope);
          
          // Look for a newer build whenever the app comes back to the foreground
          // (an installed PWA is rarely cold-started, so it would never re-check on its own).
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') reg.update().catch(() => {});
          });

          reg.onupdatefound = () => {
            const installingWorker = reg.installing;
            if (installingWorker == null) return;
            installingWorker.onstatechange = () => {
              if (installingWorker.state === 'installed') {
                if (navigator.serviceWorker.controller) {
                  console.log('[CampusDebug SW] New content available; please refresh.');
                } else {
                  console.log('[CampusDebug SW] Content cached for offline use.');
                }
              }
            };
          };
        })
        .catch((error) => {
          console.error('[CampusDebug SW] Registration failed:', error);
        });
    });
  } else if ('serviceWorker' in navigator) {
    // In dev mode, log availability
    console.log('[CampusDebug SW] Service Worker supported (dev mode active)');
  }
}

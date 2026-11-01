export function registerServiceWorker() {
  if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('[CampusDebug SW] Registered successfully with scope:', reg.scope);
          
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

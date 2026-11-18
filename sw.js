// Sixfold Alliance — minimal service worker (installable app; always loads the latest site from the network)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

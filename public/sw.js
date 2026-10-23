'use strict';

const OFFLINE_CACHE = 'project-room-offline-v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('push', event => {
  // Keep job descriptions, people, photos and personal Hub links off the lock screen.
  let data = {}; try { data = event.data ? event.data.json() : {}; } catch {}
  let destination = '/';
  try { const url = new URL(data.url || '/', self.location.origin); if (url.origin === self.location.origin && url.pathname === '/') destination = url.pathname + url.search; } catch {}
  event.waitUntil(self.registration.showNotification('Teamstead Crew', {
    body: data.body === 'Your phone notification test is ready.' ? data.body : data.kind === 'chat' ? 'You have a new chat message.' : 'You have a new Maintenance update.',
    tag: data.kind === 'chat' ? 'pms-chat-' + destination : 'pms-maintenance', data: { url: destination }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow(event.notification.data?.url || '/'));
});

self.addEventListener('install', event => {
  // Notification startup must not depend on an optional offline page or storage.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    try {
      for (const name of await caches.keys()) {
        if (name.startsWith('project-room-offline-') && name !== OFFLINE_CACHE) await caches.delete(name);
      }
      // Only this generic page may be cached. Private content stays on the network.
      const response = await fetch(OFFLINE_URL, { cache: 'no-store', credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(8000) });
      if (!response.ok) return;
      const html = await response.text();
      if (!html.includes('<meta name="project-room-offline" content="generic-only">')) return;
      const cache = await caches.open(OFFLINE_CACHE);
      await cache.put(OFFLINE_URL, new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
    } catch {
      // Missing offline assets or unavailable browser storage must not disable push.
    }
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || request.mode !== 'navigate' || url.origin !== self.location.origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    try {
      // Always use the network for navigation; never store its response.
      return await fetch(request, { cache: 'no-store' });
    } catch {
      const cache = await caches.open(OFFLINE_CACHE);
      return await cache.match(OFFLINE_URL) || new Response('Teamstead Crew is offline. Connect to the internet and try again.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});

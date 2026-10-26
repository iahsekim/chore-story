/* Paper Pig service worker: makes the site installable and lets it open without a connection.
   Always asks the network first, so families get updates right away; the saved copy is only a fallback.
   Only this site's own files are kept. Sign-in, data (Supabase) and email are never cached. */
const CACHE = 'paperpig-v1';
self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/index.html']).catch(() => { }))) });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())) });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin || u.pathname.startsWith('/.netlify/')) return;
  e.respondWith(fetch(r).then(res => { if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(r, copy)) } return res })
    .catch(() => caches.match(r).then(hit => hit || (r.mode === 'navigate' ? caches.match('/') : Response.error()))));
});

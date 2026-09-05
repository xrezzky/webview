// ╔══════════════════════════════════════════════════════════╗
// ║  XREZZKY CHAT — Service Worker (PWA + Offline)            ║
// ║  Upload file ini ke root repo (sama dengan index.html)    ║
// ║  Nama file: sw.js                                         ║
// ╚══════════════════════════════════════════════════════════╝
//
// Strategi:
// 1. APP SHELL (html/css/js/manifest/icon) → precache saat install,
//    dipakai cache-first biar app tetap kebuka walau offline (seperti WA).
// 2. MEDIA (Cloudinary — foto/video Status, avatar, banner, chat) →
//    runtime cache-first: begitu sebuah media pernah diambil (misal
//    status yang sudah kamu buka), otomatis kesimpan dan bisa
//    diputar ulang lagi walau offline.
// 3. SUPABASE (auth/data/storage/realtime) → SELALU network-only,
//    TIDAK PERNAH di-cache. Ini penting: data harus selalu fresh,
//    realtime tidak boleh keganggu atau kelambatan gara-gara cache.

const CACHE_VERSION = 'v3';
const SHELL_CACHE  = `xrezzky-shell-${CACHE_VERSION}`;
const MEDIA_CACHE  = `xrezzky-media-${CACHE_VERSION}`;
const RUNTIME_CACHE = `xrezzky-runtime-${CACHE_VERSION}`;
const ALL_CACHES = [SHELL_CACHE, MEDIA_CACHE, RUNTIME_CACHE];

// Semua file statis inti aplikasi (app shell).
const SHELL_URLS = [
  '/', '/index.html', '/manifest.json',
  '/css/base.css', '/css/auth.css', '/css/layout.css', '/css/components.css',
  '/css/profile.css', '/css/chat.css', '/css/call.css', '/css/status.css',
  '/js/config.js', '/js/utils.js', '/js/auth.js', '/js/profile.js',
  '/js/notifications.js', '/js/presence.js', '/js/follows.js', '/js/people.js',
  '/js/conversations.js', '/js/messages.js', '/js/groups.js', '/js/communities.js',
  '/js/status.js', '/js/call.js', '/js/ui.js', '/js/misc.js', '/js/init.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
];

// Domain yang TIDAK BOLEH pernah di-cache (harus selalu network fresh).
function isBypassDomain(url){
  return url.hostname.includes('supabase.co') || url.hostname.includes('supabase.in');
}
// Domain media (Cloudinary) yang aman & berguna buat di-cache opportunistik.
function isMediaDomain(url){
  return url.hostname.includes('cloudinary.com') || url.hostname.includes('ui-avatars.com');
}

// ── INSTALL: precache app shell (per-file, biar 1 file gagal nggak bikin semua gagal) ──
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(SHELL_CACHE).then(cache =>
      Promise.all(SHELL_URLS.map(url =>
        cache.add(url).catch(()=>{ /* file belum ada / gagal fetch, lewati saja */ })
      ))
    )
  );
});

// ── ACTIVATE: buang cache versi lama ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !ALL_CACHES.includes(k)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── FETCH ──
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) Supabase (auth/rest/storage/realtime) → SELALU langsung ke network,
  //    tidak disentuh sama sekali. Realtime & backup data tetap secepat biasa.
  if (isBypassDomain(url)) {
    return; // biarkan browser handle fetch ini secara native, SW tidak ikut campur
  }

  // 2) Media Cloudinary / avatar → cache-first (biar status yang sudah
  //    dibuka bisa diputar lagi walau offline), lalu update cache di background.
  if (isMediaDomain(url)) {
    event.respondWith(
      caches.open(MEDIA_CACHE).then(async cache => {
        const cached = await cache.match(req);
        const networkFetch = fetch(req).then(res => {
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        }).catch(() => null);
        return cached || (await networkFetch) || new Response('', {status: 504});
      })
    );
    return;
  }

  // 3) Same-origin app shell → cache-first, fallback network, update cache.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(cached => {
        const networkFetch = fetch(req).then(res => {
          if (res && res.ok) caches.open(SHELL_CACHE).then(c => c.put(req, res.clone()));
          return res;
        }).catch(() => cached);
        return cached || networkFetch;
      })
    );
    return;
  }

  // 4) Lainnya (CDN font-awesome, supabase-js library, dst) →
  //    network-first, fallback ke runtime cache kalau offline.
  event.respondWith(
    fetch(req).then(res => {
      if (res && res.ok) caches.open(RUNTIME_CACHE).then(c => c.put(req, res.clone()));
      return res;
    }).catch(() => caches.match(req))
  );
});

// ── Push notification dari server ──
self.addEventListener('push', event => {
  if(!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch(e) { data = {title:'XREZZKY Chat', body: event.data.text()}; }

  const title   = data.title || 'XREZZKY Chat';
  const options = {
    body:    data.body    || 'Ada pesan baru',
    icon:    data.icon    || '/icons/icon-192.png',
    badge:   '/icons/icon-192.png',
    vibrate: [200, 100, 200, 100, 200],
    tag:     data.tag     || 'xrezzky-msg',
    renotify: true,
    data: {
      url: data.url || '/',
      convoId: data.convoId || null
    },
    actions: [
      { action: 'open',    title: '💬 Buka Chat' },
      { action: 'dismiss', title: '❌ Tutup' }
    ]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Klik notifikasi → buka/fokus app ──
self.addEventListener('notificationclick', event => {
  event.notification.close();

  if(event.action === 'dismiss') return;

  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(clientList => {
      const existing = clientList.find(c => c.url.includes(self.location.origin));
      if(existing) {
        existing.focus();
        existing.postMessage({type:'NOTIF_CLICK', convoId: event.notification.data?.convoId});
        return;
      }
      return clients.openWindow(url);
    })
  );
});

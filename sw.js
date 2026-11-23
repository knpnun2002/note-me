// แคชไฟล์ของแอปไว้ให้เปิดได้แม้ออฟไลน์
// เปิดจากแคชก่อนให้เร็ว แล้วโหลดเวอร์ชันใหม่เก็บไว้ใช้ครั้งถัดไป
// แก้ CACHE ทุกครั้งที่อัปเดตแอปขึ้นเว็บ

const CACHE = 'noteme-v10';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/app.js',
  'js/config.js',
  'js/utils.js',
  'js/store.js',
  'js/logic.js',
  'js/sync.js',
  'js/ui.js',
  'js/habit-templates.js',
  'js/tasks.js',
  'js/quickadd.js',
  'js/finance.js',
  'js/promptpay.js',
  'js/slips.js',
  'js/reminders.js',
  'js/views/dashboard.js',
  'js/views/habits.js',
  'js/views/plan.js',
  'js/views/money.js',
  'js/views/settings.js',
  'icons/icon-192.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ไลบรารีอ่านสลิปและ QR โหลดจาก CDN ครั้งแรก แล้วเก็บไว้ใช้ออฟไลน์
// (ไฟล์ภาษาของตัวอ่านสลิป Tesseract เก็บใน IndexedDB ของมันเองอยู่แล้ว)
const CACHEABLE_HOSTS = [self.location.host, 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'];

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || !CACHEABLE_HOSTS.includes(url.host)) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const key = e.request.mode === 'navigate' ? './' : e.request;
      const cached = await cache.match(key, { ignoreSearch: e.request.mode === 'navigate' });
      const fresh = fetch(e.request)
        .then((res) => {
          if (res.ok) cache.put(key, res.clone());
          return res;
        })
        .catch(() => cached);
      return cached || fresh;
    })
  );
});

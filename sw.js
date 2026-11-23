// Service worker mínimo: guarda la app para que abra rápido y sin conexión (las estimaciones de IA sí necesitan Internet).
const CACHE = 'mi-comida-v21';
const FILES = ['./', 'index.html', 'style.css', 'logic.js', 'app.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'datos/maquinas.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // la API de Gemini nunca se cachea
  // Red primero (para recibir actualizaciones); si no hay red, caché.
  e.respondWith(
    fetch(e.request)
      .then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
      .catch(() => caches.match(e.request))
  );
});

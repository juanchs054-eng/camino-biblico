// Service worker de Camino Bíblico.
// Sube este número cada vez que quieras forzar que los usuarios instalados
// reciban los archivos nuevos (no es obligatorio, el propio index.html ya
// tiene su sistema de BUILD_VERSION para las imágenes).
const CACHE_NAME = 'camino-biblico-v1';
const APP_SHELL = ['./', './index.html', './icon-192.png', './icon-512.png', './manifest.json'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL).catch(()=>{}))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Las funciones de pago (Wompi) NUNCA se deben servir desde caché: siempre
  // tienen que ir directo a la red, sin que el service worker intervenga.
  if (url.pathname.startsWith('/api/')) return;

  // El HTML principal: red primero (para recibir actualizaciones al instante),
  // y si no hay internet, se usa la última copia guardada.
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html')) {
    event.respondWith(
      fetch(event.request)
        .then(resp => {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          return resp;
        })
        .catch(() => caches.match(event.request).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // Imágenes y demás archivos: primero caché, y si no está, se pide y se
  // guarda. Como cada imagen nueva ya viene con su propio parámetro de
  // versión en la URL, esto nunca sirve una imagen vieja por error.
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(resp => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return resp;
      }).catch(()=> cached);
    })
  );
});

// Service worker de Camino Bíblico.
//
// Dos estrategias, según lo que se pida:
//
// 1) CACHÉ PRIMERO para las imágenes de /imagenes/. Son archivos que no
//    cambian: cuando se sube una imagen nueva se cambia BUILD_VERSION en el
//    index.html, y como esa versión va pegada a la URL (?20260912-2), el
//    navegador la pide como si fuera un archivo distinto. Así el juego abre
//    al instante en la segunda visita, sin volver a bajar los trajes.
//
// 2) RED PRIMERO para todo lo demás (HTML, manifest, etc.). Mientras haya
//    internet siempre se sirve lo más nuevo del servidor, así una versión
//    nueva del index.html se ve de inmediato, sin arrastrar caché vieja.
//
// El caché queda como respaldo para cuando el celular se quede sin conexión.
const CACHE_NAME = 'camino-biblico-v2';
const APP_SHELL = ['./', './index.html', './icon-192.png', './icon-512.png', './manifest.json'];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL).catch(()=>{}))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Las funciones de pago (Wompi) NUNCA se deben servir desde caché: siempre
  // van directo a la red, sin que el service worker intervenga.
  if (url.pathname.startsWith('/api/')) return;

  // ---- Imágenes: caché primero ----
  if (url.pathname.includes('/imagenes/')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(resp => {
          // Solo guardamos respuestas correctas, para no dejar errores pegados.
          if (resp && resp.ok) {
            const copy = resp.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
          }
          return resp;
        });
      })
    );
    return;
  }

  // ---- Todo lo demás: red primero ----
  event.respondWith(
    fetch(event.request)
      .then(resp => {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
        return resp;
      })
      .catch(() =>
        caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.mode === 'navigate') return caches.match('./index.html');
        })
      )
  );
});

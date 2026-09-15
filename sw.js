// Service worker de Camino Bíblico.
// Estrategia: RED PRIMERO PARA TODO (HTML, imágenes, manifest, lo que sea).
// Mientras haya internet, siempre se sirve/guarda lo más nuevo que haya en
// el servidor — así, si abrís un index.html distinto (o subís una versión
// nueva del mismo archivo), se ve al instante, sin arrastrar caché vieja.
// El caché queda solo como respaldo para cuando el celular se quede sin
// conexión. No hace falta subir ningún número de versión a mano.
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

  // RED PRIMERO para todo. Si responde, se actualiza el caché con lo nuevo
  // y se muestra eso. Si no hay conexión, se cae de vuelta al caché (y si
  // era una navegación de página sin nada guardado, al index.html).
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

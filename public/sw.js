/**
 * Service worker minimo. Esiste per due motivi:
 *  1. senza, il telefono non offre di installare il gioco sulla home;
 *  2. le librerie pesanti (MapillaryJS, Leaflet) restano in cache e la
 *     partita successiva parte subito.
 *
 * Strategia: PRIMA LA RETE, la cache solo come riserva. E` la scelta
 * obbligata per un gioco che aggiorniamo di continuo — con la cache in
 * testa vi ritrovereste una versione vecchia senza capire perche'.
 */
// Alzare il numero butta via TUTTA la cache vecchia alla prossima visita:
// e' la leva da tirare quando un aggiornamento importante non deve convivere
// con nessun residuo del passato.
const CACHE = 'geoduello-v2';

// Solo roba che non cambia mai: le librerie di terze parti e le icone.
const STABILI = /\/vendor\/|\/icone\//;

self.addEventListener('install', (e) => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((chiavi) => Promise.all(chiavi.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Mapillary e mappe: mai toccati
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return;

  // Le librerie stabili si possono servire dalla cache senza rischi.
  if (STABILI.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  // Tutto il resto: rete, e cache solo se la rete non risponde.
  e.respondWith(
    fetch(req)
      .then((res) => {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copia)).catch(() => {});
        return res;
      })
      .catch(() => caches.match(req))
  );
});

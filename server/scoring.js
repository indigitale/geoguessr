// Punteggio in stile GeoGuessr: 5000 punti al centro, decadimento esponenziale
// sulla distanza. "scale" e' la dimensione caratteristica della mappa in km.

export function haversineKm(a, b) {
  const R = 6371.0088;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Scale per ambito. Il valore mondo e' quello usato da GeoGuessr.
export const SCORE_SCALE_KM = {
  mondo: 14916.862,
  europa: 3500,
  italia: 1100,
};

/**
 * `vantaggio` e' l'handicap del giocatore, da 0 a 1: allarga la scala, quindi
 * lo stesso errore costa meno. Con 0.3 un tiro a 300 km rende quanto ne
 * renderebbe uno a circa 230 km a un giocatore senza vantaggio.
 */
export function scoreFor(distanceKm, scope, vantaggio = 0) {
  const base = SCORE_SCALE_KM[scope] ?? SCORE_SCALE_KM.mondo;
  const scale = base * (1 + Math.max(0, Math.min(1, vantaggio)));
  const raw = 5000 * Math.exp((-10 * distanceKm) / scale);
  return Math.max(0, Math.round(raw));
}

export function formatDistance(km) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(2)} km`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString('it-IT')} km`;
}

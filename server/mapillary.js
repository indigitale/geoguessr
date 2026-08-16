import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { areasForScope } from './locations.js';

// PERCHE' LE TILE E NON LA RICERCA PER BBOX
// ------------------------------------------------------------------
// L'endpoint di ricerca graph.mapillary.com/images?bbox=... e' risultato
// inutilizzabile in pratica: 5-20 secondi di attesa, spesso una lista vuota
// anche in pieno centro citta', e altrettanto spesso un HTTP 500 "Please
// reduce the amount of data you're asking for" che il parametro limit non
// aiuta a evitare (limita l'output, non la scansione).
//
// Le tile vettoriali di copertura, che sono quelle che Mapillary usa per
// disegnare la propria mappa, rispondono invece in ~1 secondo e contengono
// gia' tutto quello che serve: id immagine, coordinate, is_pano, data e
// punteggio di qualita'. A zoom 14 una tile del centro di Milano contiene
// oltre centomila immagini. Zoom superiori non sono serviti per questo layer.

const TILES = 'https://tiles.mapillary.com/maps/vtp/mly1_public/2';
const Z = 14;

// Spostamento casuale del centro dell'area prima di scegliere la tile: a
// questa latitudine una tile z14 e' larga circa 1,5 km, quindi +/- 0,05 gradi
// fa cadere i round su tile diverse e non si rigioca sempre lo stesso isolato.
const JITTER = 0.05;

// Da ogni tile si estrae un campione invece di deserializzare tutte le
// feature: leggerle una per una e' la parte lenta, scaricarle no.
const SAMPLE = 400;

const cache = new Map(); // "z/x/y" -> { at, images }
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_MAX = 120;

const RECENT = Date.UTC(2019, 0, 1);

export function tileOf(lat, lng, z = Z) {
  const n = 2 ** z;
  const r = (lat * Math.PI) / 180;
  return {
    z,
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n),
  };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function remember(key, images) {
  cache.set(key, { at: Date.now(), images });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

/** Scarica una tile e ne estrae un campione di immagini utilizzabili. */
export async function tileImages(token, { z, x, y }, { signal } = {}) {
  const key = `${z}/${x}/${y}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.images;

  const url = `${TILES}/${z}/${x}/${y}?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { signal });
  if (!res.ok) {
    const err = new Error(`tile ${key}: HTTP ${res.status}`);
    err.status = res.status;
    err.badToken = res.status === 401 || res.status === 403;
    throw err;
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) {
    remember(key, []); // tile vuota: nessuna copertura qui
    return [];
  }

  let layer;
  try {
    layer = new VectorTile(new PbfReader(buf)).layers?.image;
  } catch (e) {
    throw new Error(`tile ${key} illeggibile: ${e.message}`);
  }
  if (!layer || !layer.length) {
    remember(key, []);
    return [];
  }

  const total = layer.length;
  const wanted = Math.min(SAMPLE, total);
  const picked = new Set();
  while (picked.size < wanted) picked.add(Math.floor(Math.random() * total));

  const images = [];
  for (const i of picked) {
    let f;
    try {
      f = layer.feature(i);
    } catch {
      continue;
    }
    const p = f.properties || {};
    if (!p.id) continue;
    let coords;
    try {
      coords = f.toGeoJSON(x, y, z)?.geometry?.coordinates;
    } catch {
      continue;
    }
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const [lng, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    images.push({
      id: String(p.id),
      lat,
      lng,
      isPano: !!p.is_pano,
      sequenceId: p.sequence_id != null ? String(p.sequence_id) : null,
      capturedAt: typeof p.captured_at === 'number' ? p.captured_at : 0,
      quality: typeof p.quality_score === 'number' ? p.quality_score : 0,
    });
  }

  // Una foto isolata puo` essere bellissima ma non permette di camminare.
  // La presenza di piu` scatti della stessa sequenza nel campione e` un buon
  // indicatore di una strada realmente percorribile.
  const frequenze = new Map();
  for (const img of images) {
    if (img.sequenceId) frequenze.set(img.sequenceId, (frequenze.get(img.sequenceId) || 0) + 1);
  }
  for (const img of images) img.sequencePeers = img.sequenceId ? (frequenze.get(img.sequenceId) || 0) : 0;

  remember(key, images);
  return images;
}

/**
 * Sceglie l'immagine piu' adatta a giocarci. Con panoOnly le foto frontali
 * vengono scartate: guardarsi attorno a 360 gradi e' meta' del gioco, quindi
 * conviene prima cercare un panorama altrove.
 */
function pickBest(images, { panoOnly = false } = {}, quanti = 1) {
  if (!images.length) return [];
  const recent = (i) => i.capturedAt >= RECENT;
  const tiers = panoOnly
    ? [
        images.filter((i) => i.isPano && recent(i) && i.quality >= 0.6),
        images.filter((i) => i.isPano && recent(i)),
        images.filter((i) => i.isPano),
      ]
    : [
        images.filter((i) => i.isPano && recent(i) && i.quality >= 0.6),
        images.filter((i) => i.isPano && recent(i)),
        images.filter((i) => i.isPano),
        images.filter((i) => recent(i) && i.quality >= 0.6),
        images.filter(recent),
        images,
      ];

  const out = [];
  const visti = new Set();
  for (const t of tiers) {
    const ordinati = shuffle(t).sort((a, b) =>
      (b.sequencePeers || 0) - (a.sequencePeers || 0)
      || (b.quality || 0) - (a.quality || 0)
      || (b.capturedAt || 0) - (a.capturedAt || 0));
    for (const img of ordinati) {
      if (visti.has(img.id)) continue;
      visti.add(img.id);
      out.push(img);
      if (out.length >= quanti) return out;
    }
  }
  return out;
}

// Sotto queste larghezze l'immagine si vede sgranata, soprattutto sui
// panorami: un equirettangolare da 2048 px copre 360 gradi, quindi a schermo
// ne resta pochissimo. I 360 buoni stanno sui 5760 px.
const MIN_W_PANO = 4000;
const MIN_W_FLAT = 1900;
const SHORTLIST = 6;

/**
 * Fra piu' candidati sceglie quello che si vedra' meglio: interroga Mapillary
 * per le dimensioni reali e tiene il piu' grande sopra la soglia. In piu'
 * garantisce che l'immagine sia davvero leggibile, quindi il visore non puo'
 * ritrovarsi senza niente da mostrare.
 */
async function scegliNitida(token, candidati) {
  const info = await Promise.all(
    candidati.map((c) =>
      imageEntity(token, c.id, 'id,width,height,thumb_2048_url')
        .then((e) => (e && e.width
          ? { ...c, width: e.width, height: e.height, thumbUrl: e.thumb_2048_url || null }
          : null))
        .catch(() => null)
    )
  );
  const validi = info.filter(Boolean).sort((a, b) =>
    (b.sequencePeers || 0) - (a.sequencePeers || 0)
    || b.width - a.width
    || (b.quality || 0) - (a.quality || 0));
  if (!validi.length) return { scelta: null, ripiego: null };

  const soglia = validi.filter((v) => v.width >= (v.isPano ? MIN_W_PANO : MIN_W_FLAT));
  return { scelta: soglia[0] || null, ripiego: validi[0] };
}

/**
 * Estrae una localita' giocabile. Prova piu' aree perche' la copertura
 * Mapillary e' collaborativa e non uniforme.
 */
export async function pickLocation({ token, scope, exclude = new Set(), attempts = 10 }) {
  if (!token) throw new Error('MAPILLARY_TOKEN non configurato');

  const pool = shuffle(areasForScope(scope)).filter((a) => !exclude.has(a.name));
  const candidates = pool.length ? pool : shuffle(areasForScope(scope));

  const errors = [];
  let failures = 0;
  let miglioreScartata = null; // rete di sicurezza se nessuna area e` nitida

  const descrivi = (img, area) => ({
    imageId: img.id,
    lat: img.lat,
    lng: img.lng,
    isPano: img.isPano,
    width: img.width,
    // indirizzo diretto della foto: serve alla modalita' semplice, quella che
    // funziona anche dove il visore 3D non ce la fa
    thumbUrl: img.thumbUrl || null,
    area: { name: area.name, country: area.country },
  });

  // Le prime aree si esplorano pretendendo un panorama a 360 gradi; solo se
  // non se ne trova nessuno ci si accontenta di una foto frontale.
  const list = candidates.slice(0, attempts);
  const panoUntil = Math.floor(list.length * 0.7);

  for (const [n, area] of list.entries()) {
    const lat = area.lat + (Math.random() - 0.5) * 2 * JITTER;
    const lng = area.lng + (Math.random() - 0.5) * 2 * JITTER;

    let images;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20000);
    try {
      images = await tileImages(token, tileOf(lat, lng), { signal: ac.signal });
    } catch (e) {
      errors.push(`${area.name}: ${e.message}`);
      if (e.badToken) {
        const err = new Error(`Token Mapillary rifiutato (${e.message})`);
        err.likelyToken = true;
        throw err;
      }
      failures += 1;
      if (failures >= 3) throw new Error(`Mapillary non risponde. Ultimo errore -> ${e.message}`);
      continue;
    } finally {
      clearTimeout(timer);
    }

    const candidati = pickBest(images, { panoOnly: n < panoUntil }, SHORTLIST);
    if (!candidati.length) continue; // niente di adatto qui: prossima area

    let scelta, ripiego;
    try {
      ({ scelta, ripiego } = await scegliNitida(token, candidati));
    } catch (e) {
      errors.push(`${area.name}: ${e.message}`);
      continue;
    }

    if (ripiego && !miglioreScartata) miglioreScartata = { img: ripiego, area };
    if (!scelta) continue; // qui ci sono solo immagini sgranate: si cerca altrove

    return descrivi(scelta, area);
  }

  // Nessuna area ha prodotto un'immagine ad alta risoluzione: meglio giocare
  // con la migliore trovata che non giocare affatto.
  if (miglioreScartata) return descrivi(miglioreScartata.img, miglioreScartata.area);

  const detail = errors.length ? ` Dettagli: ${errors.slice(0, 3).join(' | ')}` : '';
  throw new Error(`Nessuna immagine trovata dopo ${attempts} aree provate.${detail}`);
}

/**
 * Legge i dati di una singola immagine. Serve come controllo, perche' e'
 * esattamente la chiamata che fa MapillaryJS nel browser per mostrare il
 * panorama: se questa non funziona, il giocatore vede solo nero.
 */
export async function imageEntity(token, imageId, fields = 'id,thumb_1024_url') {
  const url = `https://graph.mapillary.com/${encodeURIComponent(imageId)}?fields=${fields}`;
  const res = await fetch(url, { headers: { Authorization: `OAuth ${token}` } });
  const body = await res.text().catch(() => '');
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * Verifica il token su ENTRAMBE le strade che il gioco usa:
 *  - le tile di copertura, lato server, per scegliere il posto;
 *  - la lettura della singola immagine, lato browser, per mostrarla.
 * Un token puo' avere accesso alle prime e non alla seconda: e' il caso in cui
 * il gioco sembra funzionare ma il visore resta nero.
 */
export async function checkToken(token) {
  if (!token) return { ok: false, error: 'MAPILLARY_TOKEN mancante' };
  if (!/^MLY\|/.test(token)) {
    return {
      ok: false,
      error: 'il token non inizia con "MLY|": probabilmente hai copiato il Client ID invece del Client token',
    };
  }

  let images;
  try {
    images = await tileImages(token, tileOf(45.4642, 9.19)); // Duomo di Milano
  } catch (e) {
    return { ok: false, error: `le tile di copertura non rispondono -> ${e.message}` };
  }
  if (!images.length) return { ok: false, error: 'il token legge le tile ma quella di prova e` vuota' };

  try {
    const ent = await imageEntity(token, images[0].id);
    if (!ent || !ent.id) throw new Error('risposta senza dati immagine');
  } catch (e) {
    return {
      ok: false,
      tilesOk: true,
      error:
        'il token legge le mappe ma NON le singole immagini, quindi il visore ' +
        'resterebbe nero. Nella dashboard Mapillary la tua applicazione ha piu` ' +
        'di un token: usa quello che ha il permesso di leggere le immagini ' +
        `pubbliche. Dettaglio -> ${e.message}`,
    };
  }

  return { ok: true, sample: images.length };
}

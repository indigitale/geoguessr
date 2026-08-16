import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { GameServer, SCOPE_VALUES, ROUND_VALUES, TIMER_VALUES, VANTAGGIO_VALUES } from './game.js';
import { checkToken, pickLocation, imageEntity } from './mapillary.js';
import { carica, riassuntoLeggibile } from './albo.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

// Caricatore .env minimale: evita una dipendenza per tre righe.
// Le variabili gia' presenti nell'ambiente vincono sul file.
(function loadEnv() {
  try {
    const txt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const line of txt.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch { /* nessun .env: si usa l'ambiente */ }
})();

const PORT = Number(process.env.PORT || 3000);
const TOKEN = process.env.MAPILLARY_TOKEN || '';
// Facoltativo: se valorizzato, per entrare serve anche questa parola d'ordine.
// Utile quando l'app e' esposta su internet, per non far consumare la quota
// Mapillary a chi passa di li' per caso.
const GATE_CODE = process.env.GATE_CODE || '';
// ALBO_OFF=1 spegne il campionato permanente. Serve sulle piattaforme dove il
// disco viene azzerato a ogni riavvio: meglio non tenere un albo che sparisce.
const ALBO_OFF = process.env.ALBO_OFF === '1';

// FAKE_LOCATIONS=1 avvia il gioco con localita' finte, senza chiamare Mapillary.
// Serve solo per provare il flusso (lobby, turni, punteggi) senza token:
// il visore panoramico restera' nero.
const FAKE = process.env.FAKE_LOCATIONS === '1';
const fakeProvider = async ({ scope, exclude }) => {
  const { areasForScope } = await import('./locations.js');
  const pool = areasForScope(scope).filter((a) => !exclude?.has(a.name));
  const a = (pool.length ? pool : areasForScope(scope))[
    Math.floor(Math.random() * (pool.length || areasForScope(scope).length))
  ];
  return {
    imageId: 'fake-' + Math.random().toString(36).slice(2, 10),
    lat: a.lat + (Math.random() - 0.5) * 0.02,
    lng: a.lng + (Math.random() - 0.5) * 0.02,
    isPano: true,
    area: { name: a.name, country: a.country },
  };
};

const game = new GameServer({
  token: TOKEN,
  conAlbo: !ALBO_OFF,
  gate: GATE_CODE,
  // Le localita` finte servono ai test automatici: li` il 3-2-1 rallenterebbe
  // soltanto la suite. Nelle partite reali e` sincronizzato dal server.
  introMs: Number(process.env.ROUND_INTRO_MS ?? (FAKE ? 0 : 3000)),
  ...(FAKE ? { provider: fakeProvider } : {}),
});

/**
 * Indirizzi con cui gli altri dispositivi sulla stessa rete possono
 * raggiungere questo server. Serve sia per stamparli all'avvio sia perche'
 * chi apre il gioco su "localhost" possa condividere un link che funziona.
 */
function lanUrls() {
  const out = [];
  for (const [nome, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      // le interfacce virtuali di Docker/VPN non servono a nessuno
      if (/^(docker|br-|veth|utun|awdl|llw|bridge)/i.test(nome)) continue;
      out.push(`http://${a.address}:${PORT}`);
    }
  }
  return out;
}

// ------------------------------------------------------------------ static

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * Impronta della versione dell'interfaccia. Serve a una cosa sola ma
 * importante: poter rispondere a "ho aggiornato ma vedo ancora la versione
 * vecchia" guardando un numero invece che tirando a indovinare. Si vede in
 * fondo al pannello "Come si gioca".
 */
const VERSIONE = (() => {
  try {
    const h = crypto.createHash('sha1');
    for (const f of [
      'app.js', 'index.html', 'style.css', 'suoni.js', 'sw.js',
      'vendor/qrcode/qrcode.js',
      'vendor/mapillary/mapillary.js', 'vendor/mapillary/mapillary.css',
      'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
    ]) {
      h.update(fs.readFileSync(path.join(PUBLIC_DIR, f)));
    }
    return h.digest('hex').slice(0, 7);
  } catch { return 'sconosciuta'; }
})();

/**
 * La cache dei browser e' la trappola classica di un gioco senza build step:
 * si aggiorna il server e i giocatori continuano a vedere il codice vecchio,
 * senza capire perche'. Qui il codice dell'applicazione si rivalida sempre
 * (con ETag: se non e' cambiato niente la risposta e' un 304 vuoto), mentre
 * le librerie di terze parti, che cambiano una volta l'anno, restano in cache
 * a lungo.
 */
function politicaCache(rel) {
  if (/^\/(vendor|icone)\//.test(rel)) return 'public, max-age=604800';
  return 'no-cache';
}

/**
 * L'unica difesa che funziona contro OGNI cache — browser, proxy, service
 * worker — e' cambiare l'indirizzo: la pagina principale chiede
 * "app.js?v=IMPRONTA", e quando il codice cambia, cambia anche l'indirizzo.
 * Una cache non puo' servire una risposta vecchia per un indirizzo che non
 * ha mai visto. E' successo davvero: dopo un aggiornamento un telefono ha
 * eseguito per ore il JavaScript vecchio sopra l'HTML nuovo, con i pulsanti
 * nuovi disegnati ma sordi.
 */
function iniettaVersione(html) {
  return html.toString('utf8').replaceAll('{{V}}', VERSIONE);
}

function rispondi(req, res, buf, type, rel) {
  const etag = '"' + crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"';
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag, 'cache-control': politicaCache(rel) }).end();
    return;
  }
  res.writeHead(200, {
    'content-type': type,
    etag,
    'cache-control': politicaCache(rel),
  }).end(buf);
}

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      // SPA: qualsiasi rotta sconosciuta torna la pagina principale
      fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, html) => {
        if (e2) return res.writeHead(404).end('Not found');
        rispondi(req, res, iniettaVersione(html), MIME['.html'], '/index.html');
      });
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const corpo = rel === '/index.html' ? iniettaVersione(buf) : buf;
    rispondi(req, res, corpo, type, rel);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ ok: true, rooms: game.rooms.size, hasToken: !!TOKEN }));
    return;
  }

  // Dati per la pagina di diagnostica: un'immagine vera con il suo indirizzo
  // gia' firmato, cosi' il browser puo' provare a scaricarla senza che il
  // token esca da qui.
  if (url.pathname === '/api/diag') {
    (async () => {
      try {
        const loc = await pickLocation({ token: TOKEN, scope: 'europa' });
        const ent = await imageEntity(TOKEN, loc.imageId, 'id,thumb_1024_url,width,height');
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            ok: true,
            imageId: loc.imageId,
            thumbUrl: ent?.thumb_1024_url || null,
            width: ent?.width,
            luogo: `${loc.area.name} (${loc.area.country})`,
          })
        );
      } catch (e) {
        res.writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ ok: false, error: e.message }));
      }
    })();
    return;
  }

  // Scarico dell'albo, per portarselo via o metterlo al sicuro altrove.
  // Se e' attiva la parola d'ordine, serve anche qui.
  if (url.pathname === '/api/albo' || url.pathname === '/api/albo.txt') {
    if (ALBO_OFF) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        .end('Campionato disattivato su questa istanza.');
      return;
    }
    if (GATE_CODE && url.searchParams.get('gate') !== GATE_CODE) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        .end('Serve la parola d`ordine: aggiungi ?gate=...');
      return;
    }
    const testo = url.pathname.endsWith('.txt');
    const corpo = testo ? riassuntoLeggibile() : JSON.stringify(carica(), null, 2);
    res.writeHead(200, {
      'content-type': testo ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="albo-geoduello${testo ? '.txt' : '.json'}"`,
    }).end(corpo);
    return;
  }

  if (url.pathname === '/api/config') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        hasToken: !!TOKEN || FAKE,
        fake: FAKE,
        versione: VERSIONE,
        lanUrls: lanUrls(),
        gated: !!GATE_CODE,
        scopes: SCOPE_VALUES,
        rounds: ROUND_VALUES,
        timers: TIMER_VALUES,
        vantaggi: VANTAGGIO_VALUES,
      })
    );
    return;
  }

  serveStatic(req, res);
});

// ---------------------------------------------------------------- websocket

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function fail(ws, message) {
  send(ws, { type: 'error', message });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.ctx = { room: null, playerId: null };
  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', async (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return fail(ws, 'Messaggio non valido');
    }
    const { room, playerId } = ws.ctx;

    try {
      switch (msg.type) {
        case 'ping':
          return send(ws, { type: 'pong' });

        case 'create': {
          if (GATE_CODE && String(msg.gate || '') !== GATE_CODE) {
            return fail(ws, 'Parola d`ordine errata.');
          }
          if (!TOKEN && !FAKE) return fail(ws, 'Il server non ha un token Mapillary configurato.');
          const { room: r, player } = game.createRoom({
            name: msg.name,
            scope: msg.scope,
            rounds: msg.rounds,
            timer: msg.timer,
          });
          player.ws = ws;
          ws.ctx = { room: r, playerId: player.id };
          send(ws, { type: 'joined', playerId: player.id, code: r.code, room: game.snapshot(r) });
          return game.sync(r);
        }

        case 'join': {
          if (GATE_CODE && String(msg.gate || '') !== GATE_CODE) {
            return fail(ws, 'Parola d`ordine errata.');
          }
          const r = game.getRoom(msg.code);
          const player = game.addPlayer(r, { name: msg.name, playerId: msg.playerId });
          player.ws = ws;
          ws.ctx = { room: r, playerId: player.id };
          send(ws, { type: 'joined', playerId: player.id, code: r.code, room: game.snapshot(r) });
          // Chi rientra a partita in corso riparte da dove si era interrotto.
          if (r.phase === 'playing' && r.location) send(ws, game.roundMessage(r));
          else if (r.phase === 'reveal' && r.lastReveal) send(ws, r.lastReveal);
          else if (r.phase === 'finished' && r.lastFinal) send(ws, r.lastFinal);
          return game.sync(r);
        }

        case 'settings':
          if (!room) return fail(ws, 'Non sei in una stanza.');
          return game.updateSettings(room, playerId, msg);

        case 'start':
          if (!room) return fail(ws, 'Non sei in una stanza.');
          return await game.startGame(room, playerId);

        case 'next':
          if (!room) return fail(ws, 'Non sei in una stanza.');
          return await game.nextRound(room, playerId);

        case 'guess': {
          if (!room) return fail(ws, 'Non sei in una stanza.');
          const roundIndex = room.roundIndex;
          const accepted = game.guess(room, playerId, Number(msg.lat), Number(msg.lng));
          return send(ws, {
            type: 'guess_ack',
            accepted: !!accepted,
            roundIndex,
            guessId: typeof msg.guessId === 'string' ? msg.guessId.slice(0, 100) : null,
          });
        }

        case 'force':
          if (!room) return fail(ws, 'Non sei in una stanza.');
          return game.forceReveal(room, playerId);

        case 'avatar':
          if (!room) return fail(ws, 'Non sei in una stanza.');
          return game.setAvatar(room, playerId, msg.avatar);

        case 'vantaggio':
          if (!room) return fail(ws, 'Non sei in una stanza.');
          return game.setVantaggio(room, playerId, msg.giocatore, msg.valore);

        case 'aiutino': {
          if (!room) return fail(ws, 'Non sei in una stanza.');
          const testo = game.aiutino(room, playerId);
          return send(ws, { type: 'aiutino', indizio: testo });
        }

        case 'reaction':
          if (!room) return fail(ws, 'Non sei in una stanza.');
          return game.reaction(room, playerId, msg.emoji);

        case 'lobby':
          if (!room) return fail(ws, 'Non sei in una stanza.');
          return game.backToLobby(room, playerId);

        // Uscita esplicita col pulsante: diversa dal collegamento che cade,
        // perche' qui la volonta' e' chiara e non serve nessuna finestra di
        // grazia. Il socket verra' chiuso dal client subito dopo.
        case 'leave':
          if (room && playerId) game.leaveRoom(room, playerId);
          ws.ctx = { room: null, playerId: null };
          return;

        default:
          return fail(ws, `Comando sconosciuto: ${msg.type}`);
      }
    } catch (e) {
      return fail(ws, e.message || 'Errore imprevisto');
    }
  });

  ws.on('close', () => {
    const { room, playerId } = ws.ctx;
    if (room && playerId) game.disconnect(room, playerId, ws);
  });

  ws.on('error', () => {});
});

// Ping periodico: chiude le connessioni morte (proxy, tunnel, wifi che cade).
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      ws.ping();
    } catch {
      /* ignora */
    }
  }
}, 30000);
heartbeat.unref?.();

server.listen(PORT, async () => {
  const lan = lanUrls();
  console.log('');
  console.log('  GeoDuello e` in ascolto.');
  console.log(`    su questo computer   http://localhost:${PORT}`);
  if (lan.length) {
    console.log(`    dai telefoni in wifi ${lan[0]}`);
    for (const u of lan.slice(1)) console.log(`                         ${u}`);
    console.log('');
    console.log('  Apri il gioco dall`indirizzo wifi: la lobby mostrera` un QR');
    console.log('  da inquadrare con la fotocamera del telefono.');
  } else {
    console.log('    nessuna rete locale rilevata: solo questo computer.');
  }
  console.log('');
  if (!TOKEN) {
    console.warn('\n  ATTENZIONE: MAPILLARY_TOKEN non impostato. Le partite non partiranno.');
    console.warn('  Crea un token su https://www.mapillary.com/dashboard/developers e mettilo in .env\n');
  } else {
    const r = await checkToken(TOKEN);
    console.log(r.ok ? '  Token Mapillary: valido.' : `  Token Mapillary NON valido -> ${r.error}`);
  }
  if (GATE_CODE) console.log('  Parola d`ordine attiva (GATE_CODE).');
  console.log(ALBO_OFF
    ? '  Campionato permanente: spento (ALBO_OFF=1).'
    : '  Campionato permanente: attivo, copie di sicurezza in data/storico/.');
});

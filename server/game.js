import { randomUUID } from 'node:crypto';
import { pickLocation } from './mapillary.js';
import { haversineKm, scoreFor } from './scoring.js';
import { registraPartita, riassunto } from './albo.js';
import { indizio } from './locations.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // niente I/O/0/1

// Quando il primo giocatore risponde, agli altri resta questo tempo: evita le
// attese infinite e mette un po' di pressione, che e' meta' del divertimento.
// Si applica solo se ne restava di piu', e solo nei round a tempo.
const SPRINT_MS = 30_000;

// Quando un telefono va in standby o cambia cella, il collegamento cade per
// qualche secondo senza che il giocatore se ne accorga. Se in quel momento
// l'altro risponde, il round si chiuderebbe lasciandolo fuori: cosa che e'
// puntualmente successa. Per questo un giocatore che sparisce resta "atteso"
// ancora per un po', dando tempo al suo dispositivo di riagganciarsi.
// Regolabile dai test, che non possono aspettare venticinque secondi.
const GRAZIA_MS = Number(process.env.GRAZIA_MS || 25_000);
const ROOM_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PLAYERS = 8;

export const SCOPE_VALUES = ['mondo', 'europa', 'italia'];
export const ROUND_VALUES = [3, 5, 7, 10];
export const TIMER_VALUES = [0, 60, 120, 180, 300]; // 0 = senza limite
export const VANTAGGIO_VALUES = [0, 0.15, 0.3, 0.5];

// Emoji scegliibili come avatar. Il colore invece lo assegna il server, cosi`
// due giocatori non finiscono mai con lo stesso sulla mappa.
export const AVATAR_VALUES = ['🦊', '🐧', '🐼', '🦁', '🐸', '🦉', '🐙', '🦄', '🚀', '⚽', '🍕', '👑'];
export const COLORI = ['#4a9eff', '#f0a83c', '#c77dff', '#3fb950', '#f0575e', '#00d4c8', '#ff8fab', '#a0e548'];

// Ambiti dei round quando si gioca "in crescendo": si parte vicino e si
// finisce dall'altra parte del mondo.
const CRESCENDO = ['italia', 'italia', 'europa', 'europa', 'mondo'];

// Quanto costa l'aiutino: si tiene il 70% dei punti del round.
const AIUTINO_FATTORE = 0.7;

function code() {
  let s = '';
  for (let i = 0; i < 4; i++) {
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return s;
}

function clean(name) {
  const n = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return n || 'Giocatore';
}

export class GameServer {
  // provider e' iniettabile: in produzione e' Mapillary, nei test e' finto.
  constructor({ token, provider = pickLocation, conAlbo = true, gate = '',
                lobbyGrazia = Number(process.env.LOBBY_GRAZIA_MS || 300_000) }) {
    this.token = token;
    this.provider = provider;
    this.conAlbo = conAlbo; // i test non devono sporcare l'albo vero
    // Quanto a lungo la lobby aspetta chi ha perso il collegamento prima di
    // toglierlo davvero. Cinque minuti: il tempo di passare a WhatsApp,
    // mandare il link, rispondere a un messaggio e tornare.
    this.lobbyGrazia = lobbyGrazia;
    // La parola d'ordine viaggia anche nello stato della stanza: la ricevono
    // solo i giocatori che l'hanno gia' superata, e serve al client per
    // costruire link e QR d'invito senza dipendere da cosa si ricorda —
    // il QR di un tablet che l'aveva "dimenticata" usciva senza parola.
    this.gate = String(gate || '');
    this.rooms = new Map();
    setInterval(() => this.sweep(), 10 * 60 * 1000).unref?.();
  }

  sweep() {
    const now = Date.now();
    for (const [c, room] of this.rooms) {
      if (now - room.touchedAt > ROOM_TTL_MS) {
        if (room.timer) clearTimeout(room.timer);
        this.rooms.delete(c);
      }
    }
  }

  newCode() {
    let c;
    do {
      c = code();
    } while (this.rooms.has(c));
    return c;
  }

  // ---------------------------------------------------------------- stanze

  createRoom({ name, scope, rounds, timer }) {
    const c = this.newCode();
    const room = {
      code: c,
      scope: SCOPE_VALUES.includes(scope) ? scope : 'mondo',
      rounds: ROUND_VALUES.includes(Number(rounds)) ? Number(rounds) : 5,
      timer: TIMER_VALUES.includes(Number(timer)) ? Number(timer) : 120,
      crescendo: false,
      players: new Map(),
      hostId: null,
      phase: 'lobby', // lobby | loading | playing | reveal | finished
      roundIndex: -1,
      location: null,
      guesses: new Map(),
      history: [],
      // Chi ci si aspetta risponda in questo round: fotografato all'inizio.
      // Senza questa fotografia, chiunque entri a meta` round (o una sessione
      // fantasma il cui socket non e` ancora morto) terrebbe il round in
      // ostaggio per sempre.
      expected: new Set(),
      usedAreas: new Set(),
      spareggio: false,
      spareggioFra: null,
      spareggiFatti: 0,
      deadline: null,
      timerHandle: null,
      error: null,
      touchedAt: Date.now(),
    };
    this.rooms.set(c, room);
    const player = this.addPlayer(room, { name });
    room.hostId = player.id;
    return { room, player };
  }

  addPlayer(room, { name, playerId }) {
    if (playerId && room.players.has(playerId)) {
      const p = room.players.get(playerId);
      p.name = clean(name) || p.name;
      p.connected = true;
      p.disconnectedAt = null;
      return p;
    }
    if (room.players.size >= MAX_PLAYERS) throw new Error('Stanza piena');
    const p = {
      id: playerId && /^[\w-]{6,64}$/.test(playerId) ? playerId : randomUUID(),
      name: clean(name),
      score: 0,
      vantaggio: 0, // handicap, deciso in lobby da chi ospita
      avatar: AVATAR_VALUES[room.players.size % AVATAR_VALUES.length],
      colore: COLORI[room.players.size % COLORI.length],
      connected: true,
      ws: null,
    };
    room.players.set(p.id, p);
    if (!room.hostId) room.hostId = p.id;
    return p;
  }

  getRoom(c) {
    const room = this.rooms.get(String(c || '').toUpperCase().trim());
    if (!room) throw new Error('Stanza inesistente. Controlla il codice.');
    room.touchedAt = Date.now();
    return room;
  }

  // ------------------------------------------------------------ snapshot

  snapshot(room) {
    return {
      code: room.code,
      gate: this.gate || null,
      scope: room.scope,
      rounds: room.rounds,
      timer: room.timer,
      crescendo: !!room.crescendo,
      phase: room.phase,
      spareggio: !!room.spareggio,
      roundIndex: room.roundIndex,
      hostId: room.hostId,
      deadline: room.deadline,
      error: room.error,
      waitingFor: room.phase === 'playing' ? this.pendingDettaglio(room) : [],
      albo:
        room.phase === 'lobby' && this.conAlbo
          ? riassunto([...room.players.values()].map((p) => p.name))
          : null,
      players: [...room.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        score: p.score,
        connected: p.connected,
        vantaggio: p.vantaggio || 0,
        avatar: p.avatar,
        colore: p.colore,
        hasGuessed: room.guesses.has(p.id),
      })),
    };
  }

  broadcast(room, msg) {
    const data = JSON.stringify(msg);
    for (const p of room.players.values()) {
      if (p.ws && p.ws.readyState === 1) {
        try {
          p.ws.send(data);
        } catch {
          /* client sparito, se ne accorge la chiusura */
        }
      }
    }
  }

  sync(room) {
    this.broadcast(room, { type: 'state', room: this.snapshot(room) });
  }

  // -------------------------------------------------------------- partita

  async startGame(room, playerId) {
    if (room.hostId !== playerId) throw new Error('Solo chi ha creato la stanza puo` avviare.');
    if (room.players.size < 2) throw new Error('Servono almeno 2 giocatori.');
    for (const p of room.players.values()) p.score = 0;
    room.history = [];
    room.usedAreas = new Set();
    room.roundIndex = -1;
    room.error = null;
    room.spareggio = false;
    room.spareggioFra = null;
    room.spareggiFatti = 0;
    await this.nextRound(room, playerId);
  }

  async nextRound(room, playerId) {
    if (room.hostId !== playerId) throw new Error('Solo chi ha creato la stanza puo` proseguire.');
    // Durante lo spareggio si gioca un round extra, che non conta nel totale.
    if (room.phase === 'spareggio') return this.giocaSpareggio(room);
    if (room.roundIndex + 1 >= room.rounds) return this.finish(room);

    this.clearTimer(room);
    room.phase = 'loading';
    room.guesses = new Map();
    room.aiutini = new Map();
    room.location = null;
    room.deadline = null;
    room.error = null;
    room.lastReveal = null;
    room.lastFinal = null;
    this.sync(room);

    // In crescendo l'ambito cambia round per round: i primi vicini, gli
    // ultimi dall'altra parte del mondo.
    const ambito = room.crescendo
      ? CRESCENDO[Math.min(
          CRESCENDO.length - 1,
          Math.floor(((room.roundIndex + 1) / Math.max(1, room.rounds)) * CRESCENDO.length)
        )]
      : room.scope;

    let loc;
    try {
      loc = await this.provider({
        token: this.token,
        scope: ambito,
        exclude: room.usedAreas,
      });
    } catch (e) {
      room.phase = 'lobby';
      room.error = `Impossibile caricare una localita': ${e.message}`;
      this.sync(room);
      return;
    }

    room.usedAreas.add(loc.area.name);
    room.expected = new Set(
      [...room.players.values()].filter((p) => p.connected).map((p) => p.id)
    );
    room.roundIndex += 1;
    room.location = loc;
    room.roundScope = ambito;
    room.phase = 'playing';
    room.roundStartedAt = Date.now();
    room.deadline = room.timer > 0 ? Date.now() + room.timer * 1000 : null;

    this.sync(room);
    this.broadcast(room, this.roundMessage(room));

    if (room.deadline) {
      room.timerHandle = setTimeout(() => this.reveal(room), room.timer * 1000 + 500);
    }
  }

  /** Round secco di spareggio: non aumenta il conteggio dei round. */
  async giocaSpareggio(room) {
    room.spareggiFatti = (room.spareggiFatti || 0) + 1;
    this.clearTimer(room);
    room.phase = 'loading';
    room.guesses = new Map();
    room.aiutini = new Map();
    room.location = null;
    room.deadline = null;
    room.lastReveal = null;
    room.lastFinal = null;
    this.sync(room);

    let loc;
    try {
      loc = await this.provider({ token: this.token, scope: room.scope, exclude: room.usedAreas });
    } catch (e) {
      room.phase = 'finished';
      room.error = `Spareggio non riuscito: ${e.message}`;
      this.sync(room);
      return;
    }

    room.usedAreas.add(loc.area.name);
    room.expected = new Set(
      [...room.players.values()].filter((p) => p.connected).map((p) => p.id)
    );
    room.location = loc;
    room.roundScope = room.scope;
    room.phase = 'playing';
    room.roundStartedAt = Date.now();
    room.deadline = room.timer > 0 ? Date.now() + room.timer * 1000 : null;

    this.sync(room);
    this.broadcast(room, { ...this.roundMessage(room), spareggio: true });
    if (room.deadline) {
      room.timerHandle = setTimeout(() => this.reveal(room), room.timer * 1000 + 500);
    }
  }

  roundMessage(room) {
    return {
      type: 'round',
      roundIndex: room.roundIndex,
      rounds: room.rounds,
      imageId: room.location.imageId,
      isPano: room.location.isPano,
      thumbUrl: room.location.thumbUrl || null,
      scope: room.roundScope || room.scope,
      deadline: room.deadline,
      now: Date.now(),
      token: this.token,
    };
  }

  /**
   * L'aiutino: rivela una zona larga (continente, area d'Europa, area
   * d'Italia) in cambio di una fetta dei punti del round. Si puo` chiedere
   * una volta sola, e solo prima di aver risposto.
   */
  aiutino(room, playerId) {
    if (room.phase !== 'playing' || !room.location) throw new Error('Non ora.');
    if (room.guesses.has(playerId)) throw new Error('Hai gia` risposto.');
    room.aiutini = room.aiutini || new Map();
    if (room.aiutini.has(playerId)) return room.aiutini.get(playerId);

    const testo = indizio(
      { lat: room.location.lat, lng: room.location.lng, country: room.location.area.country },
      room.roundScope || room.scope
    );
    room.aiutini.set(playerId, testo);
    this.sync(room);
    return testo;
  }

  /** Chi manca ancora all'appello, fra quelli attesi e ancora collegati. */
  pending(room) {
    const ora = Date.now();
    return [...room.expected]
      .map((id) => room.players.get(id))
      .filter((p) => {
        if (!p || room.guesses.has(p.id)) return false;
        if (p.connected) return true;
        // scollegato da poco: gli si tiene il posto
        return !!p.disconnectedAt && ora - p.disconnectedAt < GRAZIA_MS;
      });
  }

  /** Come sopra, ma dice anche chi e` momentaneamente scollegato. */
  pendingDettaglio(room) {
    return this.pending(room).map((p) => ({ nome: p.name, collegato: !!p.connected }));
  }

  /** Chiude il round se hanno risposto tutti quelli che dovevano. */
  maybeReveal(room) {
    if (room.phase !== 'playing') return;
    if (!room.guesses.size) return; // nessuno ha ancora risposto
    if (this.pending(room).length === 0) this.reveal(room);
  }

  clearTimer(room) {
    if (room.timerHandle) {
      clearTimeout(room.timerHandle);
      room.timerHandle = null;
    }
  }

  guess(room, playerId, lat, lng) {
    if (room.phase !== 'playing') return;
    if (!room.players.has(playerId)) return;
    if (room.guesses.has(playerId)) return;
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return;

    const primo = room.guesses.size === 0;
    room.guesses.set(playerId, {
      lat,
      lng,
      elapsedMs: Date.now() - room.roundStartedAt,
    });

    if (primo) this.startSprint(room, playerId);

    // Annuncio agli altri: sapere che l'avversario ha gia` risposto e` meta`
    // della tensione del gioco.
    this.broadcast(room, {
      type: 'guessed',
      playerId,
      name: room.players.get(playerId)?.name || 'Un giocatore',
      quanti: room.guesses.size,
      attesi: room.expected.size,
    });

    this.sync(room);
    this.maybeReveal(room);
  }

  /** Il primo ha risposto: agli altri restano SPRINT_MS, se ne avevano di piu'. */
  startSprint(room, playerId) {
    if (room.timer <= 0 || !room.deadline) return; // round senza limite di tempo
    const restante = room.deadline - Date.now();
    if (restante <= SPRINT_MS) return; // gia` piu` stretto di cosi`

    room.deadline = Date.now() + SPRINT_MS;
    this.clearTimer(room);
    room.timerHandle = setTimeout(() => this.reveal(room), SPRINT_MS + 500);
    this.broadcast(room, {
      type: 'deadline',
      deadline: room.deadline,
      now: Date.now(),
      sprint: true,
      by: room.players.get(playerId)?.name || 'Un giocatore',
      seconds: Math.round(SPRINT_MS / 1000),
    });
  }

  /**
   * Chiusura forzata del round, richiesta da un giocatore che ha gia'
   * risposto. E` la via d'uscita quando l'altro ha il telefono in tasca o si
   * e' scollegato senza che il server se ne sia accorto.
   */
  forceReveal(room, playerId) {
    if (room.phase !== 'playing') return;
    if (!room.guesses.has(playerId)) throw new Error('Prima rispondi anche tu.');
    this.reveal(room);
  }

  reveal(room) {
    if (room.phase !== 'playing') return;
    this.clearTimer(room);
    room.phase = 'reveal';
    room.deadline = null;

    const truth = { lat: room.location.lat, lng: room.location.lng };
    const results = [];
    for (const p of room.players.values()) {
      const g = room.guesses.get(p.id);
      if (!g) {
        results.push({
          playerId: p.id,
          name: p.name,
          avatar: p.avatar,
          colore: p.colore,
          guess: null,
          distanceKm: null,
          points: 0,
          elapsedMs: null,
        });
        continue;
      }
      const distanceKm = haversineKm(truth, g);
      const conAiuto = !!(room.aiutini && room.aiutini.has(p.id));
      const pieno = scoreFor(distanceKm, room.roundScope || room.scope, p.vantaggio || 0);
      const points = conAiuto ? Math.round(pieno * AIUTINO_FATTORE) : pieno;
      p.score += points;
      results.push({
        playerId: p.id,
        name: p.name,
        avatar: p.avatar,
        colore: p.colore,
        guess: { lat: g.lat, lng: g.lng },
        distanceKm,
        points,
        conAiuto,
        elapsedMs: g.elapsedMs,
      });
    }
    results.sort((a, b) => b.points - a.points);
    room.history.push({ roundIndex: room.roundIndex, truth, results });

    // Nello spareggio conta solo la distanza fra chi era in parita`.
    if (room.spareggio) {
      const fra = results.filter((r) => room.spareggioFra.has(r.playerId) && r.guess);
      if (fra.length) {
        const migliore = fra.reduce((a, b) => (a.distanceKm <= b.distanceKm ? a : b));
        const pari = fra.filter((r) => r.distanceKm === migliore.distanceKm);
        if (pari.length === 1) {
          // un punto simbolico decide la partita
          room.players.get(migliore.playerId).score += 1;
          room.spareggio = false;
        }
      }
    }

    room.lastReveal = {
      type: 'reveal',
      roundIndex: room.roundIndex,
      rounds: room.rounds,
      truth,
      area: room.location.area,
      results,
      spareggio: !!room.spareggioFra && room.spareggiFatti > 0 && room.phase === 'reveal' && room.roundIndex + 1 >= room.rounds,
      isLast: room.roundIndex + 1 >= room.rounds,
    };
    this.sync(room);
    this.broadcast(room, room.lastReveal);
  }

  finish(room) {
    this.clearTimer(room);

    // Parita` in testa: invece di chiudere con un pareggio, un round secco fra
    // chi e` in cima. Vince chi va piu` vicino.
    const punteggi = [...room.players.values()].map((p) => p.score);
    const massimo = Math.max(...punteggi, 0);
    const inTesta = [...room.players.values()].filter((p) => p.score === massimo);
    if (inTesta.length > 1 && room.spareggiFatti < 3) {
      room.spareggio = true;
      room.spareggioFra = new Set(inTesta.map((p) => p.id));
      room.phase = 'spareggio';
      this.sync(room);
      this.broadcast(room, {
        type: 'spareggio',
        fra: inTesta.map((p) => ({ playerId: p.id, name: p.name, avatar: p.avatar })),
      });
      return;
    }

    room.spareggio = false;
    room.phase = 'finished';
    room.deadline = null;
    const standings = [...room.players.values()]
      .map((p) => ({ playerId: p.id, name: p.name, score: p.score, avatar: p.avatar, colore: p.colore }))
      .sort((a, b) => b.score - a.score);
    let albo = null;
    let novita = [];
    if (this.conAlbo) {
      try {
        const esito = registraPartita({ standings, history: room.history, scope: room.scope });
        novita = esito?.novita || [];
        albo = riassunto(standings.map((s) => s.name));
      } catch (e) {
        console.warn('  Albo non aggiornato:', e.message);
      }
    }

    room.lastFinal = { type: 'final', standings, history: room.history, albo, novita };
    this.sync(room);
    this.broadcast(room, room.lastFinal);
  }

  backToLobby(room, playerId) {
    if (room.hostId !== playerId) throw new Error('Solo chi ha creato la stanza puo` farlo.');
    this.clearTimer(room);
    room.phase = 'lobby';
    room.roundIndex = -1;
    room.location = null;
    room.guesses = new Map();
    room.deadline = null;
    room.error = null;
    room.lastReveal = null;
    room.lastFinal = null;
    for (const p of room.players.values()) p.score = 0;
    this.sync(room);
  }

  setVantaggio(room, playerId, bersaglio, valore) {
    if (room.hostId !== playerId) throw new Error('Solo chi ospita puo` cambiare il vantaggio.');
    if (room.phase !== 'lobby') throw new Error('Si cambia solo prima di iniziare.');
    const p = room.players.get(bersaglio);
    if (!p) throw new Error('Giocatore inesistente.');
    const v = Number(valore);
    if (!VANTAGGIO_VALUES.includes(v)) throw new Error('Valore non ammesso.');
    p.vantaggio = v;
    this.sync(room);
  }

  setAvatar(room, playerId, avatar) {
    const p = room.players.get(playerId);
    if (!p) return;
    if (!AVATAR_VALUES.includes(avatar)) throw new Error('Avatar non valido.');
    p.avatar = avatar;
    this.sync(room);
  }

  updateSettings(room, playerId, { scope, rounds, timer, crescendo }) {
    if (room.hostId !== playerId) throw new Error('Solo chi ha creato la stanza puo` cambiare le impostazioni.');
    if (room.phase !== 'lobby') throw new Error('Impostazioni modificabili solo prima dell`avvio.');
    if (SCOPE_VALUES.includes(scope)) room.scope = scope;
    if (ROUND_VALUES.includes(Number(rounds))) room.rounds = Number(rounds);
    if (TIMER_VALUES.includes(Number(timer))) room.timer = Number(timer);
    if (typeof crescendo === 'boolean') room.crescendo = crescendo;
    this.sync(room);
  }

  disconnect(room, playerId) {
    const p = room.players.get(playerId);
    if (!p) return;
    p.connected = false;
    p.disconnectedAt = Date.now();
    p.ws = null;

    /*
     * IN LOBBY NON SI CANCELLA NESSUNO. Il caso tipico e' chi crea la stanza
     * e passa a WhatsApp per mandare l'invito: il telefono gli chiude il
     * collegamento dopo pochi secondi, e prima questa funzione lo rimuoveva
     * subito — stanza vuota, stanza cancellata, e al ritorno "la stanza non
     * esiste". Ora si resta soci per qualche minuto anche da scollegati; la
     * rimozione vera avviene solo a finestra scaduta, o con l'uscita
     * esplicita dal pulsante (leaveRoom). Nemmeno il ruolo di host si
     * trasferisce per una sparizione momentanea.
     */
    if (room.phase === 'lobby') {
      this.programmaPulizia(room);
      this.sync(room);
      return;
    }

    if (room.hostId === playerId) {
      const next = [...room.players.values()].find((x) => x.connected);
      if (next) room.hostId = next.id;
    }
    this.sync(room);

    // Non si chiude subito: chi e` appena caduto ha ancora la sua finestra di
    // grazia per rientrare. Si ricontrolla quando quella finestra scade.
    this.maybeReveal(room);
    clearTimeout(room.graziaHandle);
    room.graziaHandle = setTimeout(() => {
      this.maybeReveal(room);
      this.sync(room);
    }, GRAZIA_MS + 500);
    room.graziaHandle.unref?.();
  }

  programmaPulizia(room) {
    clearTimeout(room.puliziaHandle);
    room.puliziaHandle = setTimeout(() => this.pulisciLobby(room), this.lobbyGrazia + 200);
    room.puliziaHandle.unref?.();
  }

  /** A finestra scaduta: via chi non e' tornato, e la stanza solo se vuota. */
  pulisciLobby(room) {
    if (this.rooms.get(room.code) !== room) return;
    if (room.phase !== 'lobby') return; // a partita in corso decide la logica dei round
    const ora = Date.now();
    for (const [id, p] of [...room.players]) {
      if (!p.connected && p.disconnectedAt && ora - p.disconnectedAt >= this.lobbyGrazia) {
        room.players.delete(id);
      }
    }
    if (room.players.size === 0) {
      this.clearTimer(room);
      this.rooms.delete(room.code);
      return;
    }
    if (!room.players.has(room.hostId)) {
      const next = [...room.players.values()].find((x) => x.connected)
        || room.players.values().next().value;
      room.hostId = next.id;
    }
    // qualcuno e' ancora scollegato ma dentro la finestra: si ricontrolla
    if ([...room.players.values()].some((x) => !x.connected)) this.programmaPulizia(room);
    this.sync(room);
  }

  /** Uscita esplicita col pulsante: qui si` che si toglie subito. */
  leaveRoom(room, playerId) {
    if (!room.players.has(playerId)) return;
    room.players.delete(playerId);
    if (room.players.size === 0) {
      this.clearTimer(room);
      clearTimeout(room.puliziaHandle);
      clearTimeout(room.graziaHandle);
      this.rooms.delete(room.code);
      return;
    }
    if (room.hostId === playerId) {
      const next = [...room.players.values()].find((x) => x.connected)
        || room.players.values().next().value;
      room.hostId = next.id;
    }
    this.sync(room);
    // se se ne va a round in corso, gli altri non devono aspettarlo
    if (room.phase === 'playing') this.maybeReveal(room);
  }
}

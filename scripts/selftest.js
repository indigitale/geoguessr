// Test end-to-end del flusso di partita: due client WebSocket veri contro il
// server vero, con localita' finte (FAKE_LOCATIONS=1). Non tocca Mapillary.
//
//   FAKE_LOCATIONS=1 PORT=3999 node scripts/selftest.js

import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { haversineKm, scoreFor, formatDistance } from '../server/scoring.js';
import { GameServer } from '../server/game.js';
import { AREAS, areasForScope } from '../server/locations.js';

const PORT = Number(process.env.PORT || 3999);
const BASE = `ws://127.0.0.1:${PORT}/ws`;
// albo usa e getta: nemmeno il server di prova deve toccare quello vero
const ALBO_TMP = `/tmp/geoduello-selftest-albo-${process.pid}.json`;

let failures = 0;
const ok = (cond, label) => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${label}`);
  if (!cond) failures++;
};

function client(tag) {
  const ws = new WebSocket(BASE);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(String(raw));
    if (process.env.VERBOSE) console.log(`   [${tag}] <- ${msg.type}`);
    inbox.push(msg);
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].match(msg)) {
        waiters.splice(i, 1)[0].resolve(msg);
      }
    }
  });
  return {
    ws,
    tag,
    open: () => new Promise((r) => ws.once('open', r)),
    send: (m) => ws.send(JSON.stringify(m)),
    close: () => ws.close(),
    /** aspetta un messaggio, guardando anche quelli gia' arrivati */
    wait(match, ms = 6000) {
      const fn = typeof match === 'string' ? (m) => m.type === match : match;
      const found = inbox.find(fn);
      if (found) return Promise.resolve(found);
      return new Promise((resolve, reject) => {
        const w = { match: fn, resolve };
        waiters.push(w);
        setTimeout(() => {
          const i = waiters.indexOf(w);
          if (i >= 0) {
            waiters.splice(i, 1);
            reject(new Error(`[${tag}] timeout su ${match}`));
          }
        }, ms);
      });
    },
    drain: () => inbox.splice(0, inbox.length),
    inbox,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------- controlli in-process */

function unitTests() {
  console.log('\nDati e punteggio');

  // localita'
  const dup = AREAS.map((a) => a.name).filter((n, i, arr) => arr.indexOf(n) !== i);
  ok(dup.length === 0, 'nessuna localita` duplicata (' + AREAS.length + ' aree totali)');
  ok(
    AREAS.every((a) => a.lat >= -90 && a.lat <= 90 && a.lng >= -180 && a.lng <= 180),
    'tutte le coordinate sono dentro i limiti geografici'
  );
  ok(areasForScope('italia').every((a) => a.country === 'Italia'), 'l`ambito Italia contiene solo localita` italiane');
  ok(
    areasForScope('italia').length < areasForScope('europa').length &&
      areasForScope('europa').length < areasForScope('mondo').length,
    'gli ambiti sono via via piu` ampi'
  );

  // punteggio
  ok(scoreFor(0, 'mondo') === 5000, 'distanza zero vale 5000 punti');
  ok(scoreFor(20000, 'mondo') < 100, 'dall`altra parte del mondo il punteggio crolla');
  ok(scoreFor(300, 'italia') < scoreFor(300, 'mondo'), 'lo stesso errore pesa di piu` in modalita` Italia');
  ok(
    Math.round(haversineKm({ lat: 45.4642, lng: 9.19 }, { lat: 41.9028, lng: 12.4964 })) === 477,
    'la distanza Milano-Roma torna (477 km)'
  );
  ok(formatDistance(0.42) === '420 m' && formatDistance(1500).includes('500'), 'le distanze sono formattate in italiano');
}

/** Il round a tempo si chiude da solo quando scade il timer. */
async function timeoutTest() {
  console.log('\nScadenza del tempo');
  const provider = async () => ({
    imageId: 'x', lat: 45, lng: 9, isPano: true, area: { name: 'Test', country: 'Italia' },
  });
  const g = new GameServer({ token: 'x', provider, conAlbo: false });
  const { room, player } = g.createRoom({ name: 'A', scope: 'italia', rounds: 1, timer: 60 });
  g.addPlayer(room, { name: 'B' });
  room.timer = 1; // accorciato apposta: 60s renderebbero il test inutilizzabile
  await g.startGame(room, player.id);
  ok(room.phase === 'playing', 'il round parte');
  g.guess(room, player.id, 45.1, 9.1); // risponde solo uno
  ok(room.phase === 'playing', 'con una sola risposta il round resta aperto');
  await sleep(1800);
  ok(room.phase === 'reveal', 'allo scadere del tempo il round si chiude da solo');
  const missing = room.lastReveal.results.find((r) => r.guess === null);
  ok(missing && missing.points === 0, 'chi non ha risposto in tempo prende 0');
  g.clearTimer(room);
}

/** Il round non deve poter restare bloccato. */
async function bloccoTest() {
  console.log('\nRound che non si chiude');
  const provider = async () => ({
    imageId: 'x', lat: 45, lng: 9, isPano: true, area: { name: 'Test', country: 'Italia' },
  });
  const g = new GameServer({ token: 'x', provider, conAlbo: false });

  // 1. chi entra a meta` round non deve tenerlo in ostaggio
  const { room, player: a } = g.createRoom({ name: 'A', scope: 'italia', rounds: 1, timer: 0 });
  const b = g.addPlayer(room, { name: 'B' });
  await g.startGame(room, a.id);
  const c = g.addPlayer(room, { name: 'C-arrivato-dopo' });
  ok(room.expected.size === 2, 'il round si aspetta risposta solo da chi c`era all`inizio');
  g.guess(room, a.id, 45.1, 9.1);
  g.guess(room, b.id, 45.2, 9.2);
  ok(room.phase === 'reveal', 'il round si chiude anche se e` entrato qualcuno a meta`');
  ok(room.lastReveal.results.some((r) => r.playerId === c.id),
    'chi e` entrato dopo compare comunque nei risultati');
  g.clearTimer(room);

  // 2. un giocatore fantasma, collegato ma muto, non blocca per sempre
  const { room: r2, player: x } = g.createRoom({ name: 'X', scope: 'italia', rounds: 1, timer: 0 });
  g.addPlayer(r2, { name: 'Fantasma' });
  await g.startGame(r2, x.id);
  g.guess(r2, x.id, 44, 11);
  ok(r2.phase === 'playing', 'con uno solo che ha risposto il round resta aperto');
  ok(g.pending(r2).length === 1, 'il server sa esattamente chi manca');
  g.forceReveal(r2, x.id);
  ok(r2.phase === 'reveal', 'chi ha gia` risposto puo` chiudere il round a mano');
  g.clearTimer(r2);

  // 3. chi non ha risposto non puo` chiudere il round
  const { room: r3, player: y } = g.createRoom({ name: 'Y', scope: 'italia', rounds: 1, timer: 0 });
  g.addPlayer(r3, { name: 'Z' });
  await g.startGame(r3, y.id);
  let rifiutato = false;
  try { g.forceReveal(r3, y.id); } catch { rifiutato = true; }
  ok(rifiutato && r3.phase === 'playing', 'non si puo` chiudere il round senza aver risposto');
  g.clearTimer(r3);
}

/** Dopo la prima risposta, agli altri restano 30 secondi. */
async function sprintTest() {
  console.log('\nSprint di 30 secondi');
  const provider = async () => ({
    imageId: 'x', lat: 45, lng: 9, isPano: true, area: { name: 'Test', country: 'Italia' },
  });
  const g = new GameServer({ token: 'x', provider, conAlbo: false });

  // round lungo: la scadenza deve accorciarsi a 30 secondi
  const { room, player: a } = g.createRoom({ name: 'A', scope: 'italia', rounds: 1, timer: 180 });
  const b = g.addPlayer(room, { name: 'B' });
  await g.startGame(room, a.id);
  const prima = room.deadline - Date.now();
  ok(prima > 170000, 'il round parte con i 3 minuti scelti');
  g.guess(room, a.id, 45.1, 9.1);
  const dopo = room.deadline - Date.now();
  ok(dopo > 28000 && dopo <= 30000, `dopo la prima risposta restano 30 secondi (${Math.round(dopo / 1000)}s)`);
  g.guess(room, b.id, 45.2, 9.2);
  ok(room.phase === 'reveal', 'il round si chiude normalmente se risponde anche il secondo');
  g.clearTimer(room);

  // se restava gia` meno di 30 secondi, non si allunga il tempo
  const { room: r2, player: x } = g.createRoom({ name: 'X', scope: 'italia', rounds: 1, timer: 60 });
  g.addPlayer(r2, { name: 'Y' });
  await g.startGame(r2, x.id);
  r2.deadline = Date.now() + 12000; // simula 12 secondi rimasti
  g.guess(r2, x.id, 45.1, 9.1);
  const rimasto = r2.deadline - Date.now();
  ok(rimasto <= 12000, `con meno di 30 secondi rimasti il tempo non si allunga (${Math.round(rimasto / 1000)}s)`);
  g.clearTimer(r2);

  // senza limite di tempo non si inventa nessuna scadenza
  const { room: r3, player: z } = g.createRoom({ name: 'Z', scope: 'italia', rounds: 1, timer: 0 });
  g.addPlayer(r3, { name: 'W' });
  await g.startGame(r3, z.id);
  g.guess(r3, z.id, 45.1, 9.1);
  ok(r3.deadline === null, 'in modalita` Libero la prima risposta non fa partire nessun conto alla rovescia');
  g.clearTimer(r3);
}

/** L'albo d'oro tiene il conto fra una partita e l'altra. */
async function alboTest() {
  console.log('\nAlbo d`oro');
  const { registraPartita, riassunto, _azzera } = await import('../server/albo.js');
  _azzera();

  const storia = () => [{
    roundIndex: 0, truth: { lat: 45, lng: 9 }, area: { name: 'Milano', country: 'Italia' },
    results: [
      { playerId: 'p1', name: 'Papa', guess: { lat: 45, lng: 9 }, distanceKm: 0.8, points: 4900 },
      { playerId: 'p2', name: 'Figlio', guess: { lat: 46, lng: 10 }, distanceKm: 130, points: 1200 },
    ],
  }];
  const partita = (a, b) => registraPartita({
    standings: [
      { playerId: 'p1', name: 'Papa', score: a },
      { playerId: 'p2', name: 'Figlio', score: b },
    ],
    history: storia(), scope: 'italia', quando: '2026-08-11T20:00:00Z',
  });

  partita(4000, 3000);
  partita(4200, 3100);
  const terza = partita(3000, 4700);

  const r = riassunto(['Papa', 'Figlio']);
  const papa = r.giocatori.find((g) => g.nome === 'Papa');
  const figlio = r.giocatori.find((g) => g.nome === 'Figlio');

  ok(r.partiteTotali === 3, 'conta le partite giocate');
  ok(papa.vittorie === 2 && figlio.vittorie === 1, 'conta le vittorie di ciascuno');
  ok(papa.strisciaAttuale === 0 && figlio.strisciaAttuale === 1, 'la striscia si azzera quando si perde');
  ok(papa.migliorTiroKm === 0.8, 'ricorda il tiro piu` vicino di sempre');
  ok(papa.mediaPunti === Math.round((4000 + 4200 + 3000) / 3), 'calcola la media punti');
  ok(r.sfida && r.sfida.partite === 3, 'tiene il testa a testa fra i due');
  ok(terza.novita.some((n) => /Figlio/.test(n)), 'segnala i nuovi primati a fine partita');

  const soloUno = riassunto(['Papa']);
  ok(soloUno.giocatori.length === 1 && !soloUno.sfida, 'con un solo nome non inventa un testa a testa');
  _azzera();
}

/** Chi perde il collegamento per un attimo non deve restare tagliato fuori. */
async function graziaTest() {
  console.log('\nGiocatore che perde il collegamento');
  const provider = async () => ({
    imageId: 'x', lat: 45, lng: 9, isPano: true, area: { name: 'Test', country: 'Italia' },
  });
  const g = new GameServer({ token: 'x', provider, conAlbo: false });
  const { room, player: papa } = g.createRoom({ name: 'Papa', scope: 'italia', rounds: 1, timer: 0 });
  const figlio = g.addPlayer(room, { name: 'Figlio' });
  await g.startGame(room, papa.id);

  // al figlio cade la linea (telefono in standby, cambio cella…)
  g.disconnect(room, figlio.id);
  ok(room.players.has(figlio.id), 'chi cade a partita in corso non viene rimosso');

  // il papa` risponde: PRIMA questo chiudeva il round e lo lasciava fuori
  g.guess(room, papa.id, 45.1, 9.1);
  ok(room.phase === 'playing', 'il round NON si chiude mentre l`altro si sta ricollegando');
  ok(g.pending(room).length === 1, 'resta in attesa di chi e` caduto');
  ok(g.pendingDettaglio(room)[0].collegato === false, 'e sa dire che e` scollegato, non assente');

  // rientra e riesce a giocare il suo turno
  const rientrato = g.addPlayer(room, { name: 'Figlio', playerId: figlio.id });
  ok(rientrato.id === figlio.id && rientrato.connected, 'rientrando riprende il suo posto');
  g.guess(room, figlio.id, 45.2, 9.2);
  ok(room.phase === 'reveal', 'una volta rientrato puo` rispondere e il round si chiude');
  ok(room.lastReveal.results.every((r) => r.guess), 'entrambi i tiri sono finiti nel risultato');
  clearTimeout(room.graziaHandle);
  g.clearTimer(room);

  // se pero` non torna piu`, il round non resta appeso per sempre
  const { room: r2, player: a } = g.createRoom({ name: 'A', scope: 'italia', rounds: 1, timer: 0 });
  const b = g.addPlayer(r2, { name: 'B' });
  await g.startGame(r2, a.id);
  g.disconnect(r2, b.id);
  r2.players.get(b.id).disconnectedAt = Date.now() - 60_000; // sparito da un minuto
  g.guess(r2, a.id, 45, 9);
  ok(r2.phase === 'reveal', 'chi e` sparito da un pezzo non blocca piu` il round');
  clearTimeout(r2.graziaHandle);
  g.clearTimer(r2);
}

/** La partita deve reggere anche in tre o quattro. */
async function tantiTest() {
  console.log('\nPartita in quattro');
  const provider = async () => ({
    imageId: 'x', lat: 45, lng: 9, isPano: true, area: { name: 'Test', country: 'Italia' },
  });
  const g = new GameServer({ token: 'x', provider, conAlbo: false });
  // 2 non e` fra i valori ammessi per i round: il server ripiegherebbe su 5
  const { room, player: p1 } = g.createRoom({ name: 'Papa', scope: 'mondo', rounds: 3, timer: 0 });
  ok(room.rounds === 3, 'la stanza accetta il numero di round richiesto');
  const p2 = g.addPlayer(room, { name: 'Figlio' });
  const p3 = g.addPlayer(room, { name: 'Mamma' });
  const p4 = g.addPlayer(room, { name: 'Nonno' });
  await g.startGame(room, p1.id);
  ok(room.expected.size === 4, 'il round aspetta tutti e quattro');

  g.guess(room, p1.id, 45.0, 9.0);
  g.guess(room, p2.id, 46.0, 9.0);
  g.guess(room, p3.id, 47.0, 9.0);
  ok(room.phase === 'playing', 'con tre risposte su quattro si aspetta ancora');
  g.guess(room, p4.id, 48.0, 9.0);
  ok(room.phase === 'reveal', 'quando rispondono tutti e quattro il round si chiude');

  const res = room.lastReveal.results;
  ok(res.length === 4, 'il risultato elenca quattro giocatori');
  ok(res[0].points >= res[1].points && res[1].points >= res[2].points && res[2].points >= res[3].points,
    'i risultati sono ordinati dal migliore al peggiore');
  ok(res[0].playerId === p1.id, 'chi ha tirato piu` vicino e` in testa');

  for (const n of [2, 3]) {
    await g.nextRound(room, p1.id);
    for (const [i, p] of [p1, p2, p3, p4].entries()) g.guess(room, p.id, 45 + i * 0.4, 9);
    ok(room.phase === 'reveal', `anche il round ${n} si chiude con quattro giocatori`);
  }
  await g.nextRound(room, p1.id);          // oltre l'ultimo: si va alla classifica
  const fin = room.lastFinal;
  ok(fin && fin.standings.length === 4, 'la classifica finale contiene tutti e quattro');
  ok(fin.standings.every((s) => typeof s.score === 'number'), 'ognuno ha il suo totale');
  g.clearTimer(room);
}

/** Handicap e aiutino: devono cambiare i punti in modo prevedibile. */
async function equilibrioTest() {
  console.log('\nEquilibrio fra giocatori');
  const provider = async () => ({
    imageId: 'x', lat: 45, lng: 9, isPano: true, area: { name: 'Milano', country: 'Italia' },
  });
  const g = new GameServer({ token: 'x', provider, conAlbo: false });

  // stesso tiro, vantaggi diversi
  const { room, player: papa } = g.createRoom({ name: 'Papa', scope: 'italia', rounds: 3, timer: 0 });
  const figlio = g.addPlayer(room, { name: 'Figlio' });
  g.setVantaggio(room, papa.id, figlio.id, 0.3);
  ok(room.players.get(figlio.id).vantaggio === 0.3, 'chi ospita puo` dare un vantaggio');

  await g.startGame(room, papa.id);
  g.guess(room, papa.id, 46, 9);      // stesso identico errore
  g.guess(room, figlio.id, 46, 9);
  const res = room.lastReveal.results;
  const pPapa = res.find((r) => r.playerId === papa.id).points;
  const pFiglio = res.find((r) => r.playerId === figlio.id).points;
  ok(pFiglio > pPapa, `a parita` + '`' + ` di errore il vantaggio rende di piu` + '`' + ` (${pFiglio} contro ${pPapa})`);
  ok(pFiglio <= 5000, 'il vantaggio non sfonda il massimo di 5000');
  g.clearTimer(room);

  // vantaggio rifiutato fuori dalla lobby e da chi non ospita
  let bloccato = 0;
  try { g.setVantaggio(room, papa.id, figlio.id, 0.3); } catch { bloccato++; }
  try { g.setVantaggio(room, figlio.id, papa.id, 0.5); } catch { bloccato++; }
  try { g.setVantaggio(room, papa.id, figlio.id, 0.9); } catch { bloccato++; }
  ok(bloccato === 3, 'il vantaggio non si cambia a partita iniziata, ne` da chi non ospita, ne` a valori strani');

  // aiutino
  await g.nextRound(room, papa.id);
  const ind = g.aiutino(room, figlio.id);
  ok(typeof ind === 'string' && ind.length > 3, `l'aiutino dice una zona larga ("${ind}")`);
  ok(g.aiutino(room, figlio.id) === ind, 'richiesto due volte, ripete lo stesso indizio');

  g.guess(room, papa.id, 45.5, 9);
  g.guess(room, figlio.id, 45.5, 9);
  const r2 = room.lastReveal.results;
  const conAiuto = r2.find((r) => r.playerId === figlio.id);
  const senza = r2.find((r) => r.playerId === papa.id);
  ok(conAiuto.conAiuto === true && senza.conAiuto === false, 'il risultato segnala chi ha usato l`aiutino');
  // il figlio ha +30% di vantaggio ma paga il 30% per l'aiutino
  ok(conAiuto.points < scoreFor(conAiuto.distanceKm, 'italia', 0.3),
    'l`aiutino toglie punti a chi lo usa');
  g.clearTimer(room);

  // non si puo` chiedere dopo aver risposto
  await g.nextRound(room, papa.id);
  g.guess(room, papa.id, 45, 9);
  let rifiutato = false;
  try { g.aiutino(room, papa.id); } catch { rifiutato = true; }
  ok(rifiutato, 'l`aiutino non si puo` chiedere dopo aver risposto');
  g.clearTimer(room);
}

/** Crescendo e spareggio. */
async function arcoTest() {
  console.log('\nArco della partita');
  const visti = [];
  const provider = async ({ scope }) => {
    visti.push(scope);
    return { imageId: 'x', lat: 45, lng: 9, isPano: true, area: { name: 'T' + visti.length, country: 'Italia' } };
  };
  const g = new GameServer({ token: 'x', provider, conAlbo: false });
  const { room, player: a } = g.createRoom({ name: 'A', scope: 'mondo', rounds: 5, timer: 0 });
  const b = g.addPlayer(room, { name: 'B' });
  g.updateSettings(room, a.id, { crescendo: true });
  ok(room.crescendo === true, 'l`andamento in crescendo si attiva dalla lobby');

  await g.startGame(room, a.id);
  for (let i = 0; i < 4; i++) {
    g.guess(room, a.id, 45, 9); g.guess(room, b.id, 46, 9);
    await g.nextRound(room, a.id);
  }
  ok(visti[0] === 'italia', 'il primo round e` vicino a casa');
  ok(visti[visti.length - 1] === 'mondo', 'l`ultimo e` dall`altra parte del mondo');
  ok(new Set(visti).size >= 3, `l'ambito si allarga round dopo round (${visti.join(' → ')})`);
  g.clearTimer(room);

  // spareggio: due giocatori a pari punti
  const g2 = new GameServer({ token: 'x', provider: async () => ({
    imageId: 'x', lat: 45, lng: 9, isPano: true, area: { name: 'S' + Math.random(), country: 'Italia' },
  }), conAlbo: false });
  const { room: r2, player: x } = g2.createRoom({ name: 'X', scope: 'italia', rounds: 3, timer: 0 });
  const y = g2.addPlayer(r2, { name: 'Y' });
  await g2.startGame(r2, x.id);
  for (let i = 0; i < 3; i++) {
    g2.guess(r2, x.id, 46, 9);   // tiri identici: finiranno pari
    g2.guess(r2, y.id, 46, 9);
    if (i < 2) await g2.nextRound(r2, x.id);
  }
  ok(r2.players.get(x.id).score === r2.players.get(y.id).score, 'la partita finisce in parita`');
  await g2.nextRound(r2, x.id);
  ok(r2.phase === 'spareggio', 'la parita` fa scattare lo spareggio invece del pareggio');

  await g2.nextRound(r2, x.id);
  ok(r2.phase === 'playing', 'lo spareggio e` un round vero');
  g2.guess(r2, x.id, 45.01, 9);  // X va molto piu` vicino
  g2.guess(r2, y.id, 48, 9);
  ok(r2.phase === 'reveal', 'il round di spareggio si chiude');
  await g2.nextRound(r2, x.id);
  ok(r2.phase === 'finished', 'e la partita si chiude davvero');
  ok(r2.lastFinal.standings[0].playerId === x.id, 'vince chi e` andato piu` vicino nello spareggio');
  g2.clearTimer(r2);
}

/** Avatar e colori distinti. */
async function avatarTest() {
  console.log('\nAvatar');
  const provider = async () => ({
    imageId: 'x', lat: 45, lng: 9, isPano: true, area: { name: 'T', country: 'Italia' },
  });
  const g = new GameServer({ token: 'x', provider, conAlbo: false });
  const { room, player: a } = g.createRoom({ name: 'A', scope: 'italia', rounds: 3, timer: 0 });
  const b = g.addPlayer(room, { name: 'B' });
  const c = g.addPlayer(room, { name: 'C' });
  const avatar = [a, b, c].map((p) => room.players.get(p.id).avatar);
  const colori = [a, b, c].map((p) => room.players.get(p.id).colore);
  ok(new Set(avatar).size === 3, 'ogni giocatore nasce con un simbolo diverso');
  ok(new Set(colori).size === 3, 'e con un colore diverso');

  g.setAvatar(room, b.id, '🚀');
  ok(room.players.get(b.id).avatar === '🚀', 'si puo` cambiare il proprio simbolo');
  let rifiutato = false;
  try { g.setAvatar(room, b.id, 'pippo'); } catch { rifiutato = true; }
  ok(rifiutato, 'un simbolo non previsto viene rifiutato');

  await g.startGame(room, a.id);
  for (const p of [a, b, c]) g.guess(room, p.id, 45.5, 9);
  ok(room.lastReveal.results.every((r) => r.avatar && r.colore),
    'simbolo e colore arrivano fino ai risultati');
  g.clearTimer(room);
}

async function main() {
  unitTests();
  await timeoutTest();
  await bloccoTest();
  await sprintTest();
  await alboTest();
  await graziaTest();
  await tantiTest();
  await equilibrioTest();
  await arcoTest();
  await avatarTest();

  console.log('\nPartita completa su WebSocket');
  console.log('Avvio server di prova…');
  const srv = spawn(process.execPath, ['server/index.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT), FAKE_LOCATIONS: '1', MAPILLARY_TOKEN: '',
           GRAZIA_MS: '800', ALBO_PATH: ALBO_TMP,
           ALBO_BACKUP_DIR: `${ALBO_TMP}-storico` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', (d) => process.env.VERBOSE && process.stdout.write(`   [srv] ${d}`));
  srv.stderr.on('data', (d) => process.env.VERBOSE && process.stderr.write(`   [srv] ${d}`));

  // attende che la porta risponda
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/health`);
      if (r.ok) break;
    } catch { /* non ancora su */ }
    await sleep(120);
  }

  try {
    // ---------------------------------------------------------- 1. config
    const cfg = await (await fetch(`http://127.0.0.1:${PORT}/api/config`)).json();
    ok(cfg.fake === true, 'server in modalita` localita` finte');

    const html = await fetch(`http://127.0.0.1:${PORT}/`);
    ok(html.ok && (await html.text()).includes('GeoDuello'), 'la pagina principale viene servita');

    // -------------------------------------------------------- 2. creazione
    const a = client('papa');
    await a.open();
    a.send({ type: 'create', name: 'Papa', scope: 'italia', rounds: 3, timer: 0 });
    const joinedA = await a.wait('joined');
    ok(/^[A-Z0-9]{4}$/.test(joinedA.code), `stanza creata con codice ${joinedA.code}`);

    // ------------------------------------------------------ 3. avvio a uno
    a.send({ type: 'start' });
    const errSolo = await a.wait('error');
    ok(/almeno 2/.test(errSolo.message), 'la partita non parte con un solo giocatore');

    // ------------------------------------------------------- 4. ingresso B
    const b = client('figlio');
    await b.open();
    b.send({ type: 'join', code: joinedA.code, name: 'Figlio' });
    const joinedB = await b.wait('joined');
    ok(joinedB.room.players.length === 2, 'il secondo giocatore entra col codice');

    const stateA = await a.wait((m) => m.type === 'state' && m.room.players.length === 2);
    ok(stateA.room.hostId === joinedA.playerId, 'chi ha creato la stanza e` host');

    // --------------------------------------------- 5. permessi non-host
    b.drain();
    b.send({ type: 'start' });
    const errHost = await b.wait('error');
    ok(/Solo chi ha creato/.test(errHost.message), 'il non-host non puo` avviare la partita');

    // ----------------------------------------------- 6. impostazioni host
    a.send({ type: 'settings', scope: 'europa' });
    const st2 = await a.wait((m) => m.type === 'state' && m.room.scope === 'europa');
    ok(st2.room.scope === 'europa', 'l`host puo` cambiare la zona dalla lobby');
    a.send({ type: 'settings', scope: 'italia' });
    await a.wait((m) => m.type === 'state' && m.room.scope === 'italia');

    // ------------------------------------------------------ 7. round 1
    a.drain(); b.drain();
    a.send({ type: 'start' });
    const r1a = await a.wait('round');
    const r1b = await b.wait('round');
    ok(r1a.imageId === r1b.imageId, 'entrambi i giocatori ricevono la stessa immagine');
    ok(r1a.roundIndex === 0 && r1a.rounds === 3, 'il round 1 di 3 e` partito');

    // un solo giocatore risponde: la partita non deve rivelare nulla
    a.drain();
    a.send({ type: 'guess', lat: 45.0, lng: 9.0 });
    const partial = await a.wait((m) => m.type === 'state' && m.room.players.some((p) => p.hasGuessed));
    ok(
      partial.room.players.filter((p) => p.hasGuessed).length === 1,
      'con una sola risposta il round resta aperto'
    );

    // risponde anche il secondo -> reveal
    b.send({ type: 'guess', lat: 41.9, lng: 12.5 });
    const rev = await a.wait('reveal');
    ok(rev.results.length === 2, 'il risultato arriva quando hanno risposto tutti');
    ok(rev.results.every((r) => r.points >= 0 && r.points <= 5000), 'i punti stanno fra 0 e 5000');

    // verifica indipendente del punteggio dell`host
    const mine = rev.results.find((r) => r.playerId === joinedA.playerId);
    const expDist = haversineKm(rev.truth, { lat: 45.0, lng: 9.0 });
    const expPts = scoreFor(expDist, 'italia');
    ok(Math.abs(mine.distanceKm - expDist) < 1e-6, 'la distanza calcolata dal server e` corretta');
    ok(mine.points === expPts, `il punteggio segue la formula (${expPts} punti)`);

    // ---------------------------------------- 8. doppia risposta ignorata
    a.drain();
    a.send({ type: 'guess', lat: 0, lng: 0 });
    await sleep(150);
    ok(!a.inbox.some((m) => m.type === 'reveal'), 'una seconda risposta nello stesso round viene ignorata');

    // -------------------------------------------------- 9. round 2 e 3
    a.drain(); b.drain();
    a.send({ type: 'next' });
    const r2 = await a.wait('round');
    ok(r2.roundIndex === 1, 'si passa al round 2');
    a.send({ type: 'guess', lat: 44, lng: 11 });
    b.send({ type: 'guess', lat: 44, lng: 11 });
    const rev2 = await a.wait('reveal');
    ok(rev2.results[0].points === rev2.results[1].points, 'risposte identiche danno punti identici');

    a.drain(); b.drain();
    a.send({ type: 'next' });
    const r3 = await a.wait('round');
    ok(r3.roundIndex === 2 && rev2.isLast === false, 'si arriva al terzo e ultimo round');
    a.send({ type: 'guess', lat: 43, lng: 12 });
    b.send({ type: 'guess', lat: 38, lng: 15 });
    const rev3 = await a.wait('reveal');
    ok(rev3.isLast === true, 'l`ultimo round e` segnalato come tale');

    // ------------------------------------------------------ 10. classifica
    a.drain(); b.drain();
    a.send({ type: 'next' });
    const fin = await a.wait('final');
    ok(fin.standings.length === 2, 'arriva la classifica finale');
    ok(fin.standings[0].score >= fin.standings[1].score, 'la classifica e` ordinata');
    ok(fin.history.length === 3, 'lo storico contiene i 3 round');

    const stateFin = await a.wait((m) => m.type === 'state' && m.room.phase === 'finished');
    const sumA = fin.history.reduce(
      (s, h) => s + h.results.find((r) => r.playerId === joinedA.playerId).points, 0);
    const totA = stateFin.room.players.find((p) => p.id === joinedA.playerId).score;
    ok(sumA === totA, 'il totale in classifica e` la somma dei round');

    // ------------------------------------------------------ 11. rivincita
    a.drain(); b.drain();
    a.send({ type: 'lobby' });
    const back = await a.wait((m) => m.type === 'state' && m.room.phase === 'lobby');
    ok(back.room.players.every((p) => p.score === 0), 'la rivincita azzera i punteggi');

    // ----------------------------------------- 12. riconnessione a partita
    a.drain(); b.drain();
    a.send({ type: 'start' });
    await a.wait('round');
    await b.wait('round');
    b.close();
    await sleep(250);
    const b2 = client('figlio-2');
    await b2.open();
    b2.send({ type: 'join', code: joinedA.code, name: 'Figlio', playerId: joinedB.playerId });
    const rejoin = await b2.wait('round');
    ok(!!rejoin.imageId, 'chi si riconnette riceve di nuovo il round in corso');
    const stRe = await b2.wait((m) => m.type === 'state');
    ok(stRe.room.players.length === 2, 'la riconnessione non crea un giocatore doppione');

    // ---------------------------------------------- 13. codice inesistente
    const c = client('estraneo');
    await c.open();
    c.send({ type: 'join', code: 'ZZZZ', name: 'X' });
    const errRoom = await c.wait('error');
    ok(/inesistente/.test(errRoom.message), 'un codice inesistente viene rifiutato');
    c.close();

    // ----------------------------------------------- 14. timer automatico
    const d = client('t1');
    const e = client('t2');
    await d.open(); await e.open();
    d.send({ type: 'create', name: 'T1', scope: 'italia', rounds: 1, timer: 60 });
    const jd = await d.wait('joined');
    e.send({ type: 'join', code: jd.code, name: 'T2' });
    await e.wait('joined');
    d.send({ type: 'start' });
    const rt = await d.wait('round');
    ok(typeof rt.deadline === 'number' && typeof rt.now === 'number',
      'il round a tempo porta scadenza e orologio del server');
    ok(rt.deadline - rt.now > 55000, 'la scadenza e` coerente col tempo scelto');
    d.close(); e.close();

    // --------------------------- 15. round chiuso se l`altro si disconnette
    const f = client('x1');
    const g = client('x2');
    await f.open(); await g.open();
    f.send({ type: 'create', name: 'X1', scope: 'italia', rounds: 1, timer: 0 });
    const jf = await f.wait('joined');
    g.send({ type: 'join', code: jf.code, name: 'X2' });
    await g.wait('joined');
    f.drain();
    f.send({ type: 'start' });
    await f.wait('round');
    await g.wait('round');
    f.send({ type: 'guess', lat: 45, lng: 9 });
    await sleep(120);
    g.close(); // l`altro se ne va senza rispondere
    // Ora c'e` una finestra di grazia per il rientro: il round non si chiude
    // sul momento, ma quando quella scade (accorciata a 800 ms nei test).
    await sleep(300);
    ok(f.inbox.every((m) => m.type !== 'reveal'),
      'chi cade non fa chiudere subito il round: ha tempo per rientrare');
    const revX = await f.wait('reveal', 8000);
    ok(revX.results.some((r) => r.guess === null && r.points === 0),
      'chi non risponde prende 0 e il round si chiude lo stesso');
    f.close();

    a.close(); b2.close();
  } catch (err) {
    console.error('\n  ERRORE:', err.message);
    failures++;
  } finally {
    srv.kill();
    try {
      const fs = await import('node:fs');
      fs.rmSync(ALBO_TMP, { force: true });
      fs.rmSync(`${ALBO_TMP}-storico`, { recursive: true, force: true });
    } catch { /* niente da pulire */ }
  }

  console.log(failures === 0 ? '\nTutti i controlli passati.\n' : `\n${failures} controlli falliti.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

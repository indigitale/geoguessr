import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { indizio } from './locations.js';

// Albo d'oro: l'unica cosa che il gioco scrive su disco. Un file JSON, niente
// database, niente servizi da tenere in piedi. I giocatori sono riconosciuti
// dal nome (non ci sono account): per una famiglia e' piu' che sufficiente.

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// ALBO_PATH permette ai test di usare un file usa e getta invece dell'albo vero.
const FILE = process.env.ALBO_PATH || path.join(ROOT, 'data', 'albo.json');
const DIR = path.dirname(FILE);
// Copie di sicurezza: l'albo e' l'unica cosa del gioco che non si puo'
// rigenerare. Se ne tiene una al giorno, piu' un riassunto leggibile.
const STORICO = process.env.ALBO_BACKUP_DIR || path.join(DIR, 'storico');
const COPIE_DA_TENERE = 14;

const VUOTO = { versione: 1, giocatori: {}, sfide: {}, partite: 0 };

let albo = null;
let salvataggio = null;
let soloMemoria = false; // i test non devono scrivere sul disco

function chiave(nome) {
  return String(nome || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .slice(0, 20);
}

export function carica() {
  if (albo) return albo;
  try {
    albo = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (!albo || typeof albo !== 'object' || !albo.giocatori) albo = { ...VUOTO };
    albo.sfide = albo.sfide || {};
  } catch {
    albo = JSON.parse(JSON.stringify(VUOTO));
  }
  return albo;
}

/**
 * Scrittura atomica e ritardata: si scrive su un file temporaneo e lo si
 * rinomina, cosi' un'interruzione non lascia mai un albo mezzo scritto.
 */
function salva() {
  if (soloMemoria) return;
  clearTimeout(salvataggio);
  salvataggio = setTimeout(async () => {
    try {
      await fsp.mkdir(DIR, { recursive: true });
      const tmp = `${FILE}.${process.pid}.tmp`;
      await fsp.writeFile(tmp, JSON.stringify(albo, null, 2), 'utf8');
      await fsp.rename(tmp, FILE);
      await copiaDiSicurezza();
    } catch (e) {
      console.warn('  Albo non salvato:', e.message);
    }
  }, 400);
  salvataggio.unref?.();
}

/**
 * Una copia al giorno nello storico, piu' un riassunto in testo leggibile.
 * Se un giorno il JSON si corrompe o sparisce, la storia resta comunque
 * leggibile da un essere umano.
 */
async function copiaDiSicurezza() {
  try {
    await fsp.mkdir(STORICO, { recursive: true });
    const oggi = new Date().toISOString().slice(0, 10);
    await fsp.writeFile(
      path.join(STORICO, `albo-${oggi}.json`),
      JSON.stringify(albo, null, 2),
      'utf8'
    );
    await fsp.writeFile(path.join(DIR, 'albo.txt'), riassuntoLeggibile(), 'utf8');

    // si tengono le ultime due settimane, il resto va via
    const vecchie = (await fsp.readdir(STORICO))
      .filter((f) => /^albo-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort();
    for (const f of vecchie.slice(0, Math.max(0, vecchie.length - COPIE_DA_TENERE))) {
      await fsp.rm(path.join(STORICO, f), { force: true });
    }
  } catch (e) {
    console.warn('  Copia di sicurezza dell`albo non riuscita:', e.message);
  }
}

/** L'albo in forma di testo, da leggere anche senza il gioco davanti. */
export function riassuntoLeggibile() {
  const a = carica();
  const righe = [
    'ALBO D’ORO GEODUELLO',
    `aggiornato il ${new Date().toLocaleString('it-IT')}`,
    `partite giocate in tutto: ${a.partite}`,
    '',
  ];

  const giocatori = Object.values(a.giocatori)
    .sort((x, y) => y.vittorie - x.vittorie);
  for (const g of giocatori) {
    righe.push(`${g.nome}`);
    righe.push(`  partite ${g.partite}, vittorie ${g.vittorie}`);
    righe.push(`  media punti ${g.partite ? Math.round(g.puntiTotali / g.partite) : 0}` +
      `, record in una partita ${g.migliorPartita}`);
    if (g.migliorTiro) {
      const km = g.migliorTiro.distanzaKm;
      righe.push('  tiro più vicino di sempre: ' +
        (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`) +
        ` a ${g.migliorTiro.luogo}`);
    }
    if (g.strisciaMigliore > 1) righe.push(`  striscia record: ${g.strisciaMigliore} vittorie di fila`);
    const zone = Object.entries(g.zone || {})
      .filter(([, z]) => z.round >= 3)
      .map(([n, z]) => `${n} ${Math.round(z.punti / z.round)}`)
      .join(', ');
    if (zone) righe.push(`  media per zona: ${zone}`);
    righe.push('');
  }

  for (const [id, sf] of Object.entries(a.sfide || {})) {
    const punteggio = Object.entries(sf.vittorie || {})
      .map(([k, v]) => `${a.giocatori[k] ? a.giocatori[k].nome : k} ${v}`)
      .join(' - ');
    righe.push(`Testa a testa ${id}: ${sf.partite} partite, ${punteggio}`);
  }

  return righe.join('\n') + '\n';
}

function schedaVuota(nome) {
  return {
    nome,
    partite: 0,
    vittorie: 0,
    pareggi: 0,
    puntiTotali: 0,
    round: 0,
    migliorPartita: 0,
    migliorRound: null, // { punti, distanzaKm, luogo, quando }
    migliorTiro: null,  // { distanzaKm, luogo, quando }
    strisciaAttuale: 0,
    strisciaMigliore: 0,
    // punti e round per zona del mondo: serve a dire dove uno va forte
    zone: {},
  };
}

/** Registra una partita conclusa. `quando` arriva da fuori per testabilita'. */
export function registraPartita({ standings, history, scope, quando }) {
  const a = carica();
  if (!Array.isArray(standings) || standings.length < 2) return null;

  a.partite += 1;
  const data = quando || new Date().toISOString();
  const massimo = Math.max(...standings.map((s) => s.score));
  const vincitori = standings.filter((s) => s.score === massimo);
  const pareggio = vincitori.length > 1;

  const novita = [];

  for (const s of standings) {
    const k = chiave(s.name);
    if (!k) continue;
    const g = (a.giocatori[k] = a.giocatori[k] || schedaVuota(s.name));
    g.nome = s.name; // tiene la maiuscolatura piu' recente
    g.partite += 1;
    g.puntiTotali += s.score;

    if (s.score > g.migliorPartita) {
      if (g.partite > 1) novita.push(`${s.name}: record di punti in una partita (${s.score})`);
      g.migliorPartita = s.score;
    }

    const vinta = s.score === massimo && !pareggio;
    if (vinta) {
      g.vittorie += 1;
      g.strisciaAttuale += 1;
      if (g.strisciaAttuale > g.strisciaMigliore) g.strisciaMigliore = g.strisciaAttuale;
      if (g.strisciaAttuale >= 3) novita.push(`${s.name}: ${g.strisciaAttuale} vittorie di fila`);
    } else {
      if (pareggio && s.score === massimo) g.pareggi += 1;
      g.strisciaAttuale = 0;
    }

    // record sui singoli round
    for (const h of history || []) {
      const r = (h.results || []).find((x) => x.playerId === s.playerId);
      if (!r || !r.guess) continue;
      g.round += 1;
      const luogo = h.area ? `${h.area.name} (${h.area.country})` : '';
      if (!g.migliorRound || r.points > g.migliorRound.punti) {
        g.migliorRound = { punti: r.points, distanzaKm: r.distanceKm, luogo, quando: data };
      }
      // dove si e` giocato, per capire i punti deboli di ciascuno
      const paese = h.area ? h.area.country : null;
      if (paese && h.truth) {
        const zona = indizio(
          { lat: h.truth.lat, lng: h.truth.lng, country: paese },
          paese === 'Italia' ? 'italia' : 'mondo'
        );
        g.zone = g.zone || {};
        const z = (g.zone[zona] = g.zone[zona] || { round: 0, punti: 0 });
        z.round += 1;
        z.punti += r.points;
      }

      if (!g.migliorTiro || r.distanceKm < g.migliorTiro.distanzaKm) {
        if (g.migliorTiro) novita.push(`${s.name}: nuovo tiro più vicino di sempre`);
        g.migliorTiro = { distanzaKm: r.distanceKm, luogo, quando: data };
      }
    }
  }

  // testa a testa, solo per le sfide a due
  if (standings.length === 2) {
    const nomi = standings.map((s) => chiave(s.name)).sort();
    const id = nomi.join(' vs ');
    const sf = (a.sfide[id] = a.sfide[id] || { partite: 0, vittorie: {} });
    sf.partite += 1;
    if (!pareggio) {
      const k = chiave(vincitori[0].name);
      sf.vittorie[k] = (sf.vittorie[k] || 0) + 1;
    }
    sf.ultima = data;
    sf.ultimoAmbito = scope;
  }

  salva();
  return { novita, pareggio };
}

/**
 * Dove uno va forte e dove crolla. Si considerano solo le zone giocate
 * almeno tre volte: sotto, una singola botta di fortuna falserebbe tutto.
 */
function forteDebole(g) {
  const zone = Object.entries(g.zone || {})
    .filter(([, z]) => z.round >= 3)
    .map(([nome, z]) => ({ zona: nome, media: Math.round(z.punti / z.round), round: z.round }))
    .sort((a, b) => b.media - a.media);
  if (zone.length < 2) return { forte: null, debole: null, zone: zone };
  return { forte: zone[0], debole: zone[zone.length - 1], zone };
}

/** Riassunto leggibile, per la lobby e la schermata finale. */
export function riassunto(nomi = []) {
  const a = carica();
  const chiavi = nomi.map(chiave).filter(Boolean);

  const scelte = chiavi.length
    ? chiavi.map((k) => a.giocatori[k]).filter(Boolean)
    : Object.values(a.giocatori);

  const giocatori = scelte
    .map((g) => ({
      nome: g.nome,
      partite: g.partite,
      vittorie: g.vittorie,
      migliorPartita: g.migliorPartita,
      migliorTiroKm: g.migliorTiro ? g.migliorTiro.distanzaKm : null,
      migliorTiroLuogo: g.migliorTiro ? g.migliorTiro.luogo : null,
      strisciaAttuale: g.strisciaAttuale,
      mediaPunti: g.partite ? Math.round(g.puntiTotali / g.partite) : 0,
      ...forteDebole(g),
    }))
    .sort((x, y) => y.vittorie - x.vittorie || y.mediaPunti - x.mediaPunti);

  let sfida = null;
  if (chiavi.length === 2) {
    const id = [...chiavi].sort().join(' vs ');
    const sf = a.sfide[id];
    if (sf) {
      sfida = {
        partite: sf.partite,
        punteggio: [...chiavi].sort().map((k) => ({
          nome: a.giocatori[k]?.nome || k,
          vittorie: sf.vittorie[k] || 0,
        })),
      };
    }
  }

  return { partiteTotali: a.partite, giocatori, sfida };
}

/** Solo per i test: albo vuoto e nessuna scrittura su disco. */
export function _azzera() {
  soloMemoria = true;
  albo = JSON.parse(JSON.stringify(VUOTO));
}

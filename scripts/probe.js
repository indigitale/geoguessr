// Sonda diagnostica: capisce come si comporta davvero l'API Mapillary
// con questo token, provando molte combinazioni e riprovando sui 500.
//
//   node scripts/probe.js
//
// Serve a decidere quale strategia di ricerca usare nel gioco.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch { /* niente .env */ }

const TOKEN = process.env.MAPILLARY_TOKEN || '';
if (!TOKEN) { console.error('MAPILLARY_TOKEN mancante nel .env'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Una richiesta, con 2 ritentativi sui 500 per distinguere il transitorio. */
async function req(url, tries = 3) {
  let last = '';
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `OAuth ${TOKEN}` } });
      const body = await res.text();
      if (res.ok) {
        let n = -1;
        try { n = (JSON.parse(body).data || []).length; } catch { /* non JSON */ }
        return { ok: true, n, attempt: i + 1 };
      }
      last = `${res.status}${/reduce the amount of data/i.test(body) ? ' TROPPI-DATI' : ''}`;
      if (res.status !== 500) return { ok: false, err: last, attempt: i + 1 };
    } catch (e) {
      last = e.message.slice(0, 40);
    }
    await sleep(900);
  }
  return { ok: false, err: last, attempt: tries };
}

const box = (lat, lng, s) =>
  [lng - s / 2, lat - s / 2, lng + s / 2, lat + s / 2].map((v) => v.toFixed(6)).join(',');

const cell = (r) => (r.ok ? `${r.n}${r.attempt > 1 ? `(t${r.attempt})` : ''}` : r.err);

const LUOGHI = [
  ['Milano Duomo', 45.4642, 9.1900],
  ['Roma Centro', 41.8955, 12.4823],
  ['Berlino Mitte', 52.5200, 13.4050],
  ['Campagna PV', 45.1200, 8.9500],
];
const SIZES = [0.002, 0.005, 0.01, 0.02, 0.04, 0.06, 0.09];

console.log('\nA) bbox di varie dimensioni, campo id soltanto, limit=10');
console.log('   ' + 'zona'.padEnd(15) + SIZES.map((s) => String(s).padStart(11)).join(''));
for (const [nome, lat, lng] of LUOGHI) {
  const out = [];
  for (const s of SIZES) {
    out.push(cell(await req(`https://graph.mapillary.com/images?fields=id&bbox=${box(lat, lng, s)}&limit=10`)));
  }
  console.log('   ' + nome.padEnd(15) + out.map((c) => String(c).padStart(11)).join(''));
}

console.log('\nB) effetto di limit e dei campi richiesti (Milano, bbox 0.02)');
const B = [
  ['id, limit=1', 'fields=id&limit=1'],
  ['id, limit=10', 'fields=id&limit=10'],
  ['id, limit=100', 'fields=id&limit=100'],
  ['id, senza limit', 'fields=id'],
  ['id+geom, limit=10', 'fields=id,computed_geometry&limit=10'],
  ['5 campi, limit=10', 'fields=id,computed_geometry,geometry,is_pano,captured_at&limit=10'],
];
for (const [nome, q] of B) {
  const r = await req(`https://graph.mapillary.com/images?${q}&bbox=${box(45.4642, 9.19, 0.02)}`);
  console.log('   ' + nome.padEnd(22) + cell(r));
}

console.log('\nC) una singola immagine per ID (endpoint entity, senza ricerca)');
const one = await req('https://graph.mapillary.com/images?fields=id&bbox=' + box(52.52, 13.405, 0.01) + '&limit=1');
console.log('   ricerca minima Berlino: ' + cell(one));

console.log('\nD) tile di copertura (strada alternativa, niente ricerca bbox)');
for (const [nome, z, x, y] of [['Milano z14', 14, 8579, 5859], ['Roma z14', 14, 8748, 6018]]) {
  try {
    const u = `https://tiles.mapillary.com/maps/vtp/mly1_public/2/${z}/${x}/${y}?access_token=${TOKEN}`;
    const res = await fetch(u);
    const buf = Buffer.from(await res.arrayBuffer());
    console.log(`   ${nome.padEnd(12)} HTTP ${res.status}  ${buf.length} byte`);
  } catch (e) {
    console.log(`   ${nome.padEnd(12)} errore ${e.message.slice(0, 50)}`);
  }
}

console.log('\nFine. Incolla tutto questo output.\n');

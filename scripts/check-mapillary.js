// Verifica il token Mapillary, sonda la copertura e prova a pescare una
// localita' vera in ogni ambito.
//
//   node scripts/check-mapillary.js
//
// Se questo script arriva in fondo senza errori, funziona anche il gioco.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkToken, pickLocation, tileImages, tileOf } from '../server/mapillary.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch { /* niente .env */ }

const token = process.env.MAPILLARY_TOKEN || '';

console.log('\n1) Token');
const res = await checkToken(token);
if (!res.ok) {
  console.error(`   NON funziona: ${res.error}\n`);
  console.error('   Cosa fare:');
  console.error('    - vai su https://www.mapillary.com/dashboard/developers');
  console.error('    - "Register application", poi apri l`app e copia il "Client token"');
  console.error('    - mettilo in .env come  MAPILLARY_TOKEN=MLY|...\n');
  process.exit(1);
}
console.log('   Valido.');

console.log('\n2) Copertura (campione estratto dalla tile di zona)');
const PROBES = [
  ['Milano', 45.4642, 9.1900],
  ['Roma', 41.8955, 12.4823],
  ['Parigi', 48.8566, 2.3522],
  ['Tokyo', 35.6595, 139.7005],
  ['New York', 40.7580, -73.9855],
];
for (const [nome, lat, lng] of PROBES) {
  const t0 = Date.now();
  try {
    const imgs = await tileImages(token, tileOf(lat, lng));
    const pano = imgs.filter((i) => i.isPano).length;
    console.log(`   ${nome.padEnd(10)} ${String(imgs.length).padStart(4)} immagini nel campione` +
      `, ${String(pano).padStart(4)} a 360 gradi   ${Date.now() - t0} ms`);
  } catch (e) {
    console.log(`   ${nome.padEnd(10)} errore: ${e.message}`);
  }
}

console.log('\n3) Estrazione di una localita` per ogni ambito');
let bad = 0;
for (const scope of ['italia', 'europa', 'mondo']) {
  try {
    const t0 = Date.now();
    const loc = await pickLocation({ token, scope });
    console.log(`   ${scope.padEnd(7)} OK  ${loc.area.name} (${loc.area.country})  ` +
      `${loc.isPano ? '360 gradi' : 'frontale'}  ${Date.now() - t0} ms`);
    console.log(`           https://www.mapillary.com/app/?pKey=${loc.imageId}&focus=photo`);
  } catch (e) {
    console.error(`   ${scope.padEnd(7)} FALLITO: ${e.message}`);
    bad++;
  }
}

if (bad) {
  console.error('\nQualcosa non torna: incolla tutto questo output.\n');
  process.exit(1);
}
console.log('\nTutto a posto. Avvia il gioco con  npm start\n');

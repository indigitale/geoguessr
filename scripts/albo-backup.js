// Copia l'albo d'oro dove vuoi tu, per esempio su un disco esterno o in una
// cartella sincronizzata.
//
//   node scripts/albo-backup.js ~/Documents/GeoDuello
//
// Senza argomenti stampa a schermo il riassunto leggibile.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carica, riassuntoLeggibile } from '../server/albo.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const destinazione = process.argv[2];

const albo = carica();
if (!albo.partite) {
  console.log('\nL’albo è ancora vuoto: giocate una partita e riprova.\n');
  process.exit(0);
}

if (!destinazione) {
  console.log('\n' + riassuntoLeggibile());
  console.log(`Per salvarne una copia:  node scripts/albo-backup.js ~/Documents/GeoDuello\n`);
  process.exit(0);
}

const dir = destinazione.replace(/^~/, process.env.HOME || '~');
fs.mkdirSync(dir, { recursive: true });
const oggi = new Date().toISOString().slice(0, 10);
const j = path.join(dir, `albo-geoduello-${oggi}.json`);
const t = path.join(dir, `albo-geoduello-${oggi}.txt`);
fs.writeFileSync(j, JSON.stringify(albo, null, 2), 'utf8');
fs.writeFileSync(t, riassuntoLeggibile(), 'utf8');
console.log(`\nCopiato:\n  ${j}\n  ${t}\n`);
console.log(`Partite nell'albo: ${albo.partite}\n`);

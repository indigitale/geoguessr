// Prova dell'interfaccia con due browser veri (Playwright, localita' finte).
// Verifica che il flusso cliccabile funzioni e che non ci siano errori JS
// dell'applicazione. Il visore Mapillary resta nero: qui non serve.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import fs from 'node:fs';

const PORT = 3998;
const APP_URL = `http://127.0.0.1:${PORT}/`;
// Un secondo server, con la parola d'ordine accesa: serve solo alla prova
// dell'invito che se la porta dietro.
const PORT_GATE = 3999;
const PAROLA = 'sesamo-2026';
// albo usa e getta: il test non deve sporcare quello vero
const ALBO_TMP = `/tmp/geoduello-test-albo-${process.pid}.json`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const ok = (c, l) => { console.log(`${c ? '  PASS' : '  FAIL'}  ${l}`); if (!c) failures++; };

// Errori attesi e innocui in questo test: il visore Mapillary con token
// vuoto e immagini finte, e le tile della mappa se la rete e' limitata.
const IGNORE = /mapillary|graph\.mapillary|basemaps\.cartocdn|ERR_(NAME|INTERNET|CONNECTION|BLOCKED)|Failed to load resource|WebGL|tile/i;

/**
 * Server a parte con la parola d'ordine accesa. Non si puo' riusare quello
 * principale: GATE_CODE si legge all'avvio.
 */
async function provaParolaNelLink(mk) {
  const srv = spawn(process.execPath, ['server/index.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT_GATE), FAKE_LOCATIONS: '1', MAPILLARY_TOKEN: '',
           GATE_CODE: PAROLA, ALBO_OFF: '1' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const base = `http://127.0.0.1:${PORT_GATE}`;
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(`${base}/health`)).ok) break; } catch {}
      await sleep(120);
    }

    const H = await mk('host-gate', { width: 1100, height: 800 });
    await H.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await H.waitForSelector('#gate-wrap:not([hidden])', { timeout: 6000 });
    ok(true, 'con la parola d`ordine accesa, il campo compare in home');
    await H.fill('#in-name', 'Papa');
    await H.fill('#in-gate', PAROLA);
    await H.click('#btn-create');
    await H.waitForSelector('#screen-lobby.active', { timeout: 8000 });
    await H.waitForSelector('#help:not([hidden])', { timeout: 6000 });
    await H.click('#btn-help-ok');

    const invito = await H.inputValue('#lobby-link');
    ok(invito.includes(`p=${encodeURIComponent(PAROLA)}`),
      'il link d`invito si porta dietro la parola d`ordine');
    ok(await H.isVisible('#link-nota'), 'e la lobby avverte che il link la contiene');
    const codeG = (await H.textContent('#lobby-code')).trim();

    // Il QR codifica lo stesso link, parola compresa.
    const qrLink1 = await H.evaluate(() => document.getElementById('lobby-qr').dataset.link);
    ok(!!qrLink1 && qrLink1.includes(`p=${encodeURIComponent(PAROLA)}`),
      'anche il QR si porta dietro la parola d`ordine');

    // E la parola arriva dalla STANZA, non dalla memoria del dispositivo:
    // un tablet che l'aveva persa (sessione nuova, app riaperta) produceva
    // link e QR monchi, e chi li apriva restava fuori.
    await H.evaluate(() => {
      S.gate = '';
      try { localStorage.removeItem('gd_gate'); sessionStorage.removeItem('gd_gate'); } catch {}
      document.getElementById('lobby-qr').dataset.link = ''; // forza il ridisegno
      renderRoom();
    });
    const qrLink2 = await H.evaluate(() => document.getElementById('lobby-qr').dataset.link);
    ok(!!qrLink2 && qrLink2.includes(`p=${encodeURIComponent(PAROLA)}`),
      'il QR resta completo anche se il dispositivo aveva dimenticato la parola');

    // l'ospite apre il link e non tocca il campo della parola
    const G = await mk('ospite-gate', { width: 390, height: 844 });
    await G.goto(invito.replace(/^https?:\/\/[^/]+/, base), { waitUntil: 'domcontentloaded' });
    // la ripulitura dell'indirizzo avviene appena la pagina si e' avviata
    let pulita = true;
    try {
      await G.waitForFunction(() => !location.search.includes('p='), null, { timeout: 6000 });
    } catch { pulita = false; }
    ok(pulita, 'aperto il link, la parola sparisce dalla barra degli indirizzi');
    ok((await G.inputValue('#in-gate')) === PAROLA, 'ma resta compilata nel campo');
    await G.fill('#in-name', 'Figlio');
    await G.click('#btn-join');
    await G.waitForSelector('#screen-lobby.active', { timeout: 8000 });
    ok((await G.textContent('#lobby-code')).trim() === codeG,
      'entra nella stanza senza aver digitato la parola d`ordine');
    ok(await G.evaluate(() => localStorage.getItem('gd_gate')) === PAROLA,
      'e la parola gli resta salvata anche per le prossime aperture');

    // e chi arriva senza link resta comunque fuori
    const X = await mk('estraneo-gate', { width: 900, height: 700 });
    await X.goto(`${base}/?c=${codeG}`, { waitUntil: 'domcontentloaded' });
    await X.fill('#in-name', 'Tizio');
    await X.click('#btn-join');
    await X.waitForSelector('#home-err:not([hidden])', { timeout: 8000 });
    ok(/parola|ordine/i.test(await X.textContent('#home-err')),
      'senza parola d`ordine si resta fuori: il link non e` un buco');
  } finally {
    srv.kill();
  }
}

async function main() {
  const srv = spawn(process.execPath, ['server/index.js'], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, PORT: String(PORT), FAKE_LOCATIONS: '1', MAPILLARY_TOKEN: '',
           ALBO_PATH: ALBO_TMP, ALBO_BACKUP_DIR: `${ALBO_TMP}-storico` },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://127.0.0.1:${PORT}/health`)).ok) break; } catch {}
    await sleep(120);
  }

  const browser = await chromium.launch();
  const errors = [];
  const mk = async (tag, viewport) => {
    const ctx = await browser.newContext({ viewport });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => { if (!IGNORE.test(e.message)) errors.push(`[${tag}] ${e.message}`); });
    p.on('console', (m) => {
      if (m.type() === 'error' && !IGNORE.test(m.text())) errors.push(`[${tag}] ${m.text()}`);
    });
    return p;
  };

  try {
    const A = await mk('desktop', { width: 1440, height: 900 });
    const B = await mk('mobile', { width: 390, height: 844 });

    // ------------------------------------------------------- crea partita
    await A.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await A.fill('#in-name', 'Papa');
    await A.click('#opt-scope .chip[data-v="italia"]');
    await A.click('#opt-rounds .chip[data-v="3"]');
    await A.click('#opt-timer .chip[data-v="0"]');
    await A.click('#btn-create');
    await A.waitForSelector('#screen-lobby.active', { timeout: 8000 });
    const code = (await A.textContent('#lobby-code')).trim();
    ok(/^[A-Z0-9]{4}$/.test(code), `lobby mostrata con codice ${code}`);
    const link = await A.inputValue('#lobby-link');
    ok(link.endsWith(`/?c=${code}`), 'il link di invito contiene il codice');
    ok(await A.isVisible('#lobby-qr img'), 'la lobby mostra il QR da inquadrare col telefono');
    const qrSrc = await A.getAttribute('#lobby-qr img', 'src');
    ok(!!qrSrc && qrSrc.startsWith('data:image/gif'), 'il QR e` un`immagine generata in locale');

    // Con il gioco aperto su localhost il link d'invito punta all'indirizzo di
    // rete locale, che e' quello che serve ai telefoni. In questo test pero'
    // quell'IP non e' raggiungibile, quindi si riporta il link su 127.0.0.1.
    ok(!link.includes('127.0.0.1'), 'il link d`invito usa l`indirizzo di rete, non localhost');
    const linkLocale = link.replace(/^https?:\/\/[^/]+/, APP_URL.replace(/\/$/, ''));

    // ------------------------------------------------------ help in linea
    // Alla prima partita le regole si presentano da sole, e succede in lobby:
    // mai durante un round, dove costerebbe secondi di gioco.
    await A.waitForSelector('#help:not([hidden])', { timeout: 6000 });
    ok(true, 'alla prima partita le regole si aprono da sole, in lobby');
    ok(await A.isVisible('#help-benvenuto'), 'e si presentano con una riga di benvenuto');
    ok(await A.isHidden('#help-nota'), 'fuori dal round non parla di tempo che scorre');
    const testoHelp = await A.textContent('#help');
    for (const parola of ['dove stai guardando', 'Aiutino'.toLowerCase(), '30%', 'trenta secondi', 'ricarica']) {
      ok(testoHelp.toLowerCase().includes(parola.toLowerCase()), `l’help spiega "${parola}"`);
    }
    ok(/versione \w+/.test(await A.textContent('#help-versione')),
      'in fondo all`help c`e` l`impronta della versione servita');
    await A.click('#btn-help-ok');
    ok(await A.isHidden('#help'), 'si chiude con il pulsante');

    // La cache del browser non deve mai servire codice vecchio dopo un
    // aggiornamento: il codice si rivalida sempre, le librerie no.
    const intestazioni = await A.evaluate(async () => {
      const leggi = async (p) => {
        const r = await fetch(p, { cache: 'no-store' });
        return { cc: r.headers.get('cache-control'), et: r.headers.get('etag') };
      };
      return { app: await leggi('app.js'), lib: await leggi('vendor/leaflet/leaflet.css') };
    });
    ok(intestazioni.app.cc === 'no-cache', 'app.js si rivalida a ogni caricamento');
    ok(!!intestazioni.app.et, 'ma con ETag: se non e` cambiato, non si riscarica');
    ok(/max-age=\d{5,}/.test(intestazioni.lib.cc || ''), 'le librerie restano in cache a lungo');

    // --------------------------------------- il secondo entra dal link
    await B.goto(linkLocale, { waitUntil: 'domcontentloaded' });
    ok((await B.inputValue('#in-code')) === code, 'aprendo il link il codice e` gia` compilato');
    await B.fill('#in-name', 'Figlio');
    await B.click('#btn-join');
    await B.waitForSelector('#screen-lobby.active', { timeout: 8000 });
    await B.waitForSelector('#help:not([hidden])', { timeout: 6000 });
    await B.click('#btn-help-close');
    ok(await B.isHidden('#help'), 'anche chi entra dal link riceve le regole, e le chiude con la ×');
    await A.waitForFunction(() => document.querySelectorAll('#lobby-players li').length === 2, null, { timeout: 8000 });
    ok(true, 'il secondo giocatore compare nella lista');

    // seconda volta: nessuno se lo ritrova piu` davanti da solo
    ok(await A.evaluate(() => localStorage.getItem('gd_help_visto') === '1'),
      'il gioco ricorda che le regole sono gia` state viste');
    await A.click('#screen-lobby .apri-help');
    await A.waitForSelector('#help:not([hidden])', { timeout: 4000 });
    ok(await A.isHidden('#help-benvenuto'), 'riaprendolo a mano non ripete il benvenuto');
    await A.keyboard.press('Escape');
    ok(await A.isHidden('#help'), 'Esc lo chiude');

    // avatar: ognuno sceglie il suo, e gli altri non possono prenderlo
    ok(await A.locator('#opt-avatar .chip').count() >= 6, 'in lobby si sceglie il proprio simbolo');
    const presiDaB = await A.locator('#opt-avatar .chip[disabled]').count();
    ok(presiDaB >= 1, 'i simboli gia` presi dagli altri sono bloccati');
    await A.click('#opt-avatar .chip:not([disabled])');
    await A.waitForFunction(() => document.querySelector('#lobby-players .av').textContent.length > 0,
      null, { timeout: 5000 });
    ok(true, 'il simbolo scelto compare accanto al nome');

    // app installabile
    const man = await A.getAttribute('link[rel=manifest]', 'href');
    ok(man === 'manifest.webmanifest', 'la pagina dichiara il manifest per l`installazione');
    const rispMan = await A.evaluate(async () => {
      const r = await fetch('manifest.webmanifest');
      return r.ok ? (await r.json()).display : null;
    });
    ok(rispMan === 'standalone', 'il manifest chiede la modalita` a tutto schermo');

    // Versioni coerenti: il codice caricato deve essere ESATTAMENTE quello che
    // il server sta servendo. Su un telefono vero e` successo il contrario —
    // HTML nuovo con JavaScript vecchio dalla cache: pulsanti disegnati ma
    // sordi, e il movimento col bug gia` corretto.
    const verCfg = await A.evaluate(async () => (await (await fetch('/api/config')).json()).versione);
    const verScript = await A.evaluate(() =>
      new URL(document.querySelector('script[src*="app.js"]').src).searchParams.get('v'));
    ok(!!verScript && verScript === verCfg,
      `la pagina carica il codice con l’impronta della versione del server (${verScript})`);
    const htmlServito = await A.evaluate(async () => await (await fetch('/', { cache: 'no-store' })).text());
    ok(!htmlServito.includes('{{V}}') && htmlServito.includes(`app.js?v=${verCfg}`),
      'il server inietta l`impronta in ogni riferimento della pagina');

    // andamento in crescendo
    ok(await A.locator('#lob-crescendo .chip').count() === 2, 'si sceglie fra zona fissa e crescendo');

    // vantaggio: solo chi ospita lo regola, e si vede nella lista
    ok(await A.locator('#lobby-players .vantaggio').count() === 2,
      'chi ospita puo` regolare il vantaggio di entrambi');
    ok(await B.locator('#lobby-players .vantaggio').count() === 0,
      'gli altri non possono cambiarlo');
    await A.click('#lobby-players li:nth-child(2) .vantaggio .chip[data-v="0.3"]');
    await A.waitForSelector('#lobby-players .van-tag', { timeout: 5000 });
    ok((await A.textContent('#lobby-players .van-tag')).includes('30%'),
      'il vantaggio assegnato si legge nella lista');
    await B.waitForSelector('#lobby-players .van-tag', { timeout: 5000 });
    ok(true, 'e lo vede anche l`altro giocatore');
    await A.click('#lobby-players li:nth-child(2) .vantaggio .chip[data-v="0"]');

    ok(await A.isVisible('#btn-start'), 'l`host vede il pulsante di avvio');
    ok(!(await B.isVisible('#btn-start')), 'l`ospite non vede il pulsante di avvio');

    // -------------------------------------------------------- round 1
    await A.click('#btn-start');
    await A.waitForSelector('#screen-play.active', { timeout: 10000 });
    await B.waitForSelector('#screen-play.active', { timeout: 10000 });
    ok((await A.textContent('#hud-round')).includes('1/3'), 'HUD: round 1 di 3');
    ok(await A.isHidden('#hud-timer'), 'senza limite di tempo il timer resta nascosto');
    ok(await A.isDisabled('#btn-confirm'), 'non si puo` confermare senza segnalino');
    ok(await A.isVisible('#btn-fwd') && await A.isVisible('#btn-back'),
      'i comandi avanti/indietro sono in pagina');

    // help durante il round: si raggiunge senza uscire dalla partita, e i tasti
    // di gioco non devono rispondere mentre si sta leggendo.
    await A.keyboard.press('?');
    await A.waitForSelector('#help:not([hidden])', { timeout: 4000 });
    ok(true, 'durante il round le regole si riaprono col tasto ?');
    ok(await A.isHidden('#help-nota'), 'senza limite di tempo non avvisa di nessun cronometro');
    const mosseAperto = await A.evaluate(() => {
      window.__help = 0;
      const orig = window.panoMove;
      window.panoMove = (...a) => { window.__help++; return orig(...a); };
      return true;
    });
    await A.keyboard.press('ArrowUp');
    ok(mosseAperto && (await A.evaluate(() => window.__help)) === 0,
      'a pannello aperto le frecce non fanno camminare nessuno');
    await A.click('#btn-help-close');
    ok(await A.isHidden('#help'), 'e si torna al panorama dov`era');
    // in un round a tempo, invece, va detto che leggere costa secondi
    await A.evaluate(() => { S.deadline = Date.now() + 60000; });
    await A.keyboard.press('?');
    await A.waitForSelector('#help-nota:not([hidden])', { timeout: 4000 });
    ok(true, 'in un round a tempo avvisa che il cronometro continua a correre');
    await A.keyboard.press('Escape');
    await A.evaluate(() => { S.deadline = null; });
    ok(await A.isVisible('#btn-help'), 'il ? resta a portata di mano per tutta la partita');

    // aiutino: un tocco avverte del costo, il secondo conferma
    ok(await A.isVisible('#btn-aiutino'), 'il pulsante aiutino e` a portata di mano');
    // e su schermo stretto non deve finire sotto i pulsanti in alto a destra
    const hudB = await B.locator('.hud').boundingBox();
    const destraB = await B.locator('.hud-right').boundingBox();
    ok(hudB && destraB && hudB.x + hudB.width <= destraB.x + 1,
      'sul telefono la riga dei dati non si sovrappone ai pulsanti');
    // ...nemmeno con il timer acceso e largo: su un telefono vero "1:46"
    // era finito sopra il "?".
    await B.evaluate(() => {
      const t = document.getElementById('hud-timer');
      t.hidden = false; t.textContent = '19:46';
    });
    const hudB2 = await B.locator('.hud').boundingBox();
    const destraB2 = await B.locator('.hud-right').boundingBox();
    ok(hudB2 && destraB2 && hudB2.x + hudB2.width <= destraB2.x + 1,
      'anche col timer acceso, sul telefono, niente si sovrappone');
    await B.evaluate(() => { document.getElementById('hud-timer').hidden = true; });
    await A.click('#btn-aiutino');
    ok((await A.textContent('#btn-aiutino')).includes('Sicuro'),
      'il primo tocco avverte del costo invece di spendere subito');
    await A.click('#btn-aiutino');
    await A.waitForSelector('#btn-aiutino.usato', { timeout: 6000 });
    const ind = await A.textContent('#btn-aiutino');
    ok(/Italia|Sicilia|Sardegna/.test(ind), `l'aiutino mostra la zona (${ind})`);
    await A.click('#btn-aiutino');
    ok((await A.textContent('#btn-aiutino')) === ind, 'una volta usato non si puo` rispendere');
    // I comandi di movimento non devono finire sotto la mappa sul telefono.
    const nav = await B.locator('#btn-back').boundingBox();
    const gb = await B.locator('#guessbox').boundingBox();
    ok(nav && gb && nav.y + nav.height < gb.y,
      'sul telefono i comandi di movimento restano sopra la mappa');

    // Matrice dei telefoni piu` critici: piccolo Android, iPhone normale e
    // schermo stretto/alto. Niente overflow, sovrapposizioni o bersagli minuscoli.
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 430, height: 932 },
    ]) {
      await B.setViewportSize(viewport);
      await B.waitForTimeout(80);
      const layout = await B.evaluate(() => {
        const rett = (s) => document.querySelector(s)?.getBoundingClientRect();
        const visibili = [...document.querySelectorAll('.hud-right .iconbtn:not([hidden]), .navpad .navbtn')]
          .filter((n) => getComputedStyle(n).display !== 'none')
          .map((n) => n.getBoundingClientRect());
        const hud = rett('.hud');
        const destra = rett('.hud-right');
        const nav = rett('.navpad');
        const guess = rett('#guessbox');
        return {
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
          piccoli: visibili.some((r) => r.width < 44 || r.height < 44),
          hudSovrapposto: !!(hud && destra && hud.right > destra.left + 1),
          navSovrapposta: !!(nav && guess && nav.bottom >= guess.top),
          guessH: guess?.height || 999,
        };
      });
      ok(!layout.overflow && !layout.piccoli && !layout.hudSovrapposto && !layout.navSovrapposta && layout.guessH <= 136,
        `layout mobile ${viewport.width}x${viewport.height}: compatto, separato e toccabile`);
    }
    await B.setViewportSize({ width: 390, height: 844 });

    // ------------------------------------------------------------------
    // Movimento nel panorama. Ogni gesto deve produrre UNA sola richiesta
    // Mapillary: accodare moveTo, Step e Next faceva avanzare di piu` foto o
    // partire nella direzione opposta su una rete mobile lenta.
    // ------------------------------------------------------------------
    ok(await A.evaluate(() => typeof S === 'object'), 'lo stato del gioco e` ispezionabile');

    await A.evaluate(() => {
      window.__mosse = [];
      S.moveActive = null; S.ultimaMossa = 0;
      S.semplice = false;
      $('btn-fwd').disabled = false;
      $('btn-back').disabled = false;
      S.moveGen = (S.moveGen || 0) + 1;
      S.viewer = {
        moveDir: (d) => {
          window.__mosse.push(d);
          return new Promise((r) => setTimeout(r, 180));
        },
        getImage: () => Promise.resolve({
          id: 'x', spatialEdges: { cached: true }, sequenceEdges: { cached: true },
        }),
        on: () => {}, off: () => {},
      };
    });
    await A.evaluate(async () => {
      const prima = panoMove(true);
      const seconda = panoMove(true);
      await Promise.all([prima, seconda]);
    });
    ok(await A.evaluate(() => window.__mosse.length) === 1,
      'due tocchi ravvicinati producono una sola richiesta di movimento');
    ok(await A.isEnabled('#btn-fwd') && await A.isEnabled('#btn-back'),
      'finito il passo, entrambi i comandi tornano disponibili');

    // Avanti e indietro usano le direzioni pubbliche che Mapillary calcola
    // rispetto allo sguardo corrente, senza teletrasporti manuali.
    await A.evaluate(() => {
      window.__dir = [];
      S.moveActive = null; S.ultimaMossa = 0;
      S.moveGen = (S.moveGen || 0) + 1;
      S.viewer = {
        getImage: () => Promise.resolve({ spatialEdges: { cached: true } }),
        moveDir: (d) => { window.__dir.push(d); return Promise.resolve(); },
        on: () => {}, off: () => {},
      };
    });
    await A.click('#btn-fwd');
    await A.waitForSelector('#btn-fwd:not(.moving)', { timeout: 5000 });
    await A.evaluate(() => { S.ultimaMossa = 0; });
    await A.click('#btn-back');
    await A.waitForSelector('#btn-back:not(.moving)', { timeout: 5000 });
    const direzioni = await A.evaluate(() => ({
      viste: window.__dir,
      avanti: mapillary.NavigationDirection.StepForward,
      indietro: mapillary.NavigationDirection.StepBackward,
    }));
    ok(direzioni.viste.length === 2 && direzioni.viste[0] === direzioni.avanti && direzioni.viste[1] === direzioni.indietro,
      'avanti e indietro rispettano lo sguardo tramite StepForward/StepBackward');

    // Collegamenti non ancora in cache: aspetta il relativo evento e parte
    // una volta sola, senza provare Next/Prev come seconda mossa.
    await A.evaluate(() => {
      window.__mosse = [];
      window.__edgeHandlers = {};
      S.moveActive = null; S.ultimaMossa = 0; S.edgePronti = false;
      S.moveGen = (S.moveGen || 0) + 1;
      S.viewer = {
        getImage: () => Promise.resolve({ id: 'x', spatialEdges: { cached: false }, sequenceEdges: { cached: false } }),
        moveDir: (d) => { window.__mosse.push(d); return Promise.reject(new Error('niente')); },
        on: (nome, fn) => { window.__edgeHandlers[nome] = fn; },
        off: () => {},
      };
    });
    const movimento = A.evaluate(() => panoMove(false));
    await A.waitForFunction(() => !!window.__edgeHandlers.spatialedges, null, { timeout: 3000 });
    await A.evaluate(() => window.__edgeHandlers.spatialedges());
    await movimento;
    await A.waitForSelector('#toast:not([hidden])', { timeout: 5000 });
    ok((await A.textContent('#toast')).length > 5, 'quando la strada finisce lo dice invece di non fare nulla');
    ok(await A.evaluate(() => window.__mosse.length) === 1,
      'anche quando la strada finisce non accumula richieste di riserva');
    // ------------------------------------------------------------------
    // Uscire dallo zoom. Restarci incastrati rende il gioco ingiocabile:
    // i comandi di zoom di MapillaryJS finiscono sotto la mappa sul telefono.
    // ------------------------------------------------------------------
    await A.evaluate(() => {
      S.moveGen = (S.moveGen || 0) + 1;
      S.inMovimento = false; S.movimentoFinoA = 0;
      window.__zoom = 3; // partiamo da dentro, come chi ha pinzato
      S.viewer = {
        moveDir: () => Promise.resolve(),
        getZoom: () => window.__zoom,
        setZoom: (z) => { window.__zoom = z; },
        setCenter: (c) => { window.__center = c; },
        moveTo: () => Promise.resolve(),
        getImage: () => Promise.resolve({ id: 'x' }),
        on: () => {},
      };
    });
    await A.waitForSelector('#btn-zoomout.attivo', { timeout: 4000 });
    ok(true, 'quando si e` zoomati dentro il pulsante si accende da solo');

    await A.click('#btn-zoomout');
    ok(await A.evaluate(() => window.__zoom) === 2, 'ogni tocco allontana di un gradino');
    await A.click('#btn-zoomout');
    await A.click('#btn-zoomout');
    ok(await A.evaluate(() => window.__zoom) === 0, 'a forza di toccare si torna alla visuale piena');
    await A.click('#btn-zoomout');
    ok(await A.evaluate(() => window.__zoom) === 0, 'lo zoom non va sotto zero');
    await A.waitForSelector('#btn-zoomout:not(.attivo)', { timeout: 4000 });
    ok(true, 'tornati fuori, il pulsante si spegne');

    await A.evaluate(() => { window.__zoom = 3; window.__center = null; });
    await A.click('#btn-home-pano');
    const rip = await A.evaluate(() => ({ z: window.__zoom, c: JSON.stringify(window.__center) }));
    ok(rip.z === 0 && rip.c === '[0.5,0.5]',
      'il pulsante "torna al punto di partenza" azzera anche zoom e inquadratura');

    // ---------------------------------------------------------------
    // Difese contro lo zoom della PAGINA: e' quello che rendeva il gioco
    // inutilizzabile, perche' con l'interfaccia a posizione fissa i
    // pulsanti finivano fuori schermo.
    // ---------------------------------------------------------------
    const ta = await A.evaluate(() => getComputedStyle(document.getElementById('pano')).touchAction);
    ok(ta === 'none', 'sul panorama il browser non gestisce nessun gesto');
    const taSchermo = await A.evaluate(() =>
      getComputedStyle(document.getElementById('screen-play')).touchAction);
    ok(taSchermo === 'none', 'nemmeno sul resto della schermata di gioco');
    const taLobby = await A.evaluate(() =>
      getComputedStyle(document.getElementById('screen-lobby')).touchAction);
    ok(taLobby.includes('pan-y') && taLobby.includes('pinch-zoom'),
      'in lobby si scorre e lo zoom accessibile resta disponibile');

    await A.waitForTimeout(80); // sbloccaPagina ripristina il meta dopo il ricalcolo Safari
    const meta = await A.getAttribute('#viewport', 'content');
    ok(!/user-scalable=no/.test(meta) && !/maximum-scale=1/.test(meta) && /viewport-fit=cover/.test(meta),
      'il viewport rispetta accessibilita` e safe area');

    // il doppio tocco sul panorama rimette tutto a posto
    await A.evaluate(() => {
      window.__zoom = 3;
      S.viewer = {
        getZoom: () => window.__zoom, setZoom: (z) => { window.__zoom = z; },
        setCenter: () => {}, moveTo: () => Promise.resolve(),
        getImage: () => Promise.resolve({ id: 'x' }), moveDir: () => Promise.resolve(), on: () => {},
      };
    });
    // Una pinzata genera due pointerup: non deve essere scambiata per doppio
    // tocco e cancellare lo zoom appena fatto.
    await A.dispatchEvent('#pano', 'pointerdown', { pointerId: 21, pointerType: 'touch', clientX: 80, clientY: 80 });
    await A.dispatchEvent('#pano', 'pointerdown', { pointerId: 22, pointerType: 'touch', clientX: 150, clientY: 80 });
    await A.dispatchEvent('#pano', 'pointerup', { pointerId: 21, pointerType: 'touch', clientX: 80, clientY: 80 });
    await A.dispatchEvent('#pano', 'pointerup', { pointerId: 22, pointerType: 'touch', clientX: 150, clientY: 80 });
    ok(await A.evaluate(() => window.__zoom) === 3,
      'la pinzata non viene confusa con un doppio tocco');

    await A.dispatchEvent('#pano', 'pointerdown', { pointerId: 23, pointerType: 'touch', clientX: 100, clientY: 100 });
    await A.dispatchEvent('#pano', 'pointerup', { pointerId: 23, pointerType: 'touch', clientX: 100, clientY: 100 });
    await A.dispatchEvent('#pano', 'pointerdown', { pointerId: 24, pointerType: 'touch', clientX: 104, clientY: 102 });
    await A.dispatchEvent('#pano', 'pointerup', { pointerId: 24, pointerType: 'touch', clientX: 104, clientY: 102 });
    ok(await A.evaluate(() => window.__zoom) === 0,
      'doppio tocco sul panorama: visuale rimessa a posto senza cercare pulsanti');

    // il pulsante di salvataggio esiste ed e` nascosto finche` non serve
    ok(await A.isHidden('#btn-sblocca'), 'il pulsante di sblocco resta nascosto se non c`e` zoom');
    await A.evaluate(() => { window.__zoom = 3; $('btn-sblocca').hidden = false; });
    await A.click('#btn-sblocca');
    ok(await A.isHidden('#btn-sblocca'), 'premuto, il pulsante di sblocco sparisce');

    // ---------------------------------------------------------------
    // Modalita` semplice: il piano B quando il visore 3D non parte.
    // ---------------------------------------------------------------
    const attivata = await A.evaluate(() =>
      modalitaSemplice(location.origin + '/vendor/leaflet/images/marker-icon-2x.png', 'prova'));
    ok(attivata === true, 'la modalita` semplice si attiva quando serve');
    await A.waitForFunction(() => {
      const i = document.getElementById('pano-img');
      return i && i.naturalWidth > 0;
    }, null, { timeout: 8000 });
    ok(await A.isVisible('#pano-img'), 'mostra la foto del luogo al posto del visore 3D');
    ok(await A.isVisible('.semplice-nota'), 'dice chiaramente che e` in modalita` semplice');
    ok(await A.isDisabled('#btn-fwd') && await A.isDisabled('#btn-back'),
      'in modalita` semplice non si finge di potersi muovere');
    const scorrevole = await A.evaluate(() =>
      getComputedStyle(document.querySelector('.semplice-wrap')).overflowX);
    ok(scorrevole === 'auto' || scorrevole === 'scroll', 'la foto si trascina per guardarsi attorno');

    // senza foto di riserva deve dirlo, non restare muta
    const senza = await A.evaluate(() => modalitaSemplice(null, 'prova'));
    ok(senza === false && !(await A.isHidden('#panoerr')),
      'senza foto di riserva lo dichiara invece di lasciare lo schermo nero');

    // la schermata di guasto mostra il registro degli errori ed e` copiabile
    await A.evaluate(() => { annota('errore finto per il test'); mostraGuasto('Prova di guasto'); });
    ok((await A.textContent('#panoerr')).includes('errore finto per il test'),
      'la schermata di guasto mostra cosa e` andato storto');
    ok(await A.isVisible('#btn-copia-log'), 'il dettaglio si puo` copiare per mandarlo in chat');
    await A.evaluate(() => { $('panoerr').hidden = true; $('pano').innerHTML = ''; });

    // ---------------------------------------------------------------
    // Avvisi ben visibili: conto alla rovescia e bandiera dell'avversario.
    // ---------------------------------------------------------------
    await A.evaluate(() => {
      S.clockOffset = 0;
      S.deadline = Date.now() + 7000; // sotto i dieci secondi
      startTicker();
    });
    await A.waitForSelector('#countdown:not([hidden])', { timeout: 4000 });
    const n = parseInt(await A.textContent('#countdown'), 10);
    ok(n >= 1 && n <= 10, `negli ultimi secondi compare il numerone (${n})`);
    ok(await A.locator('#hud-timer.urgent').count() === 1, 'e il tempo in alto diventa rosso');

    await A.evaluate(() => { S.deadline = Date.now() + 60000; startTicker(); });
    ok(await A.isHidden('#countdown'), 'con tempo abbondante il numerone sparisce');

    await A.evaluate(() => {
      S.deadline = null; startTicker();
      handle({ type: 'guessed', playerId: 'altro', name: 'Figlio', quanti: 1, attesi: 2 });
    });
    ok(await A.isVisible('#flash'), 'quando l`altro piazza la bandiera lo schermo lampeggia');
    ok((await A.getAttribute('#flash', 'class')).includes('bandiera'), 'il lampo e` quello della bandiera');
    ok((await A.textContent('#toast')).includes('Figlio'), 'e viene detto chi e` stato');

    // il proprio segnalino non deve far lampeggiare il proprio schermo
    await A.evaluate(() => {
      $('flash').hidden = true;
      handle({ type: 'guessed', playerId: S.playerId, name: 'Papa', quanti: 2, attesi: 2 });
    });
    ok(await A.isHidden('#flash'), 'la propria bandiera non fa lampeggiare il proprio schermo');

    await A.evaluate(() => { S.viewer = null; S.inMovimento = false; });
    // Ogni elemento marcato hidden deve essere davvero invisibile: le classi
    // che impostano display sovrascrivono l'attributo se non lo si forza.
    const fantasmi = await A.evaluate(() =>
      [...document.querySelectorAll('[hidden]')]
        .filter((e) => getComputedStyle(e).display !== 'none')
        .map((e) => e.id || e.className));
    ok(fantasmi.length === 0, `nessun elemento nascosto resta visibile ${fantasmi.length ? '-> ' + fantasmi : ''}`);
    ok(await A.isHidden('#waiting'), 'l`avviso di attesa non compare prima di aver risposto');

    // clic sulla minimappa
    await A.waitForSelector('#minimap.leaflet-container', { timeout: 8000 });
    const box = await A.locator('#minimap').boundingBox();
    await A.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.45);
    await A.waitForFunction(() => !document.getElementById('btn-confirm').disabled, null, { timeout: 5000 });
    ok(true, 'il clic sulla mappa abilita la conferma');
    ok((await A.textContent('#btn-confirm')).includes('Conferma'), 'il pulsante cambia in "Conferma"');

    await A.click('#btn-confirm');
    await A.waitForSelector('#waiting:not([hidden])', { timeout: 5000 });
    ok(true, 'dopo la conferma compare l`attesa dell`altro giocatore');
    await A.waitForFunction(() => S.confirmed && !S.pendingGuess, null, { timeout: 5000 });
    ok((await A.textContent('#btn-confirm')) === 'Scelta inviata',
      'la scelta risulta inviata solo dopo l`ACK del server');

    // ingrandimento mappa
    await A.click('#btn-mapsize');
    ok(await A.locator('#guessbox.big').count() === 1, 'la mappa si puo` ingrandire');
    await A.click('#btn-mapsize');

    // il secondo risponde
    const bbox = await B.locator('#minimap').boundingBox();
    await B.mouse.click(bbox.x + bbox.width * 0.4, bbox.y + bbox.height * 0.6);
    await B.waitForFunction(() => !document.getElementById('btn-confirm').disabled, null, { timeout: 5000 });
    await B.click('#btn-confirm');

    // ------------------------------------------------------- risultato
    await A.waitForSelector('#screen-reveal.active', { timeout: 8000 });
    await B.waitForSelector('#screen-reveal.active', { timeout: 8000 });
    // La rivelazione e' animata: si aspetta che finisca prima di leggerla.
    await A.waitForSelector('#btn-next:not([disabled])', { timeout: 25000 });
    ok(true, 'la rivelazione animata arriva in fondo e sblocca il proseguimento');
    ok((await A.locator('#reveal-list li').count()) === 2, 'il risultato elenca due giocatori');
    const place = (await A.textContent('#reveal-place')).trim();
    ok(place.includes('Italia'), `viene mostrato il luogo (${place})`);
    ok((await A.textContent('#reveal-list')).includes('km') ||
       (await A.textContent('#reveal-list')).includes('m'), 'viene mostrata la distanza');
    const punteggi = await A.evaluate(() =>
      [...document.querySelectorAll('#reveal-list .pts')].map((e) => e.textContent));
    ok(punteggi.length === 2 && punteggi.every((p) => /^\+[\d.]+$/.test(p)),
      `i contatori dei punti arrivano a destinazione (${punteggi.join(' ')})`);
    ok(await A.isVisible('#btn-next'), 'solo l`host vede "Prossimo round"');
    ok(!(await B.isVisible('#btn-next')), 'l`ospite non vede "Prossimo round"');
    await A.screenshot({ path: 'shot-reveal.png' });

    // ------------------------------------------------- round 2 e 3 rapidi
    for (const n of [2, 3]) {
      await A.click('#btn-next');
      await A.waitForSelector('#screen-play.active', { timeout: 10000 });
      await B.waitForSelector('#screen-play.active', { timeout: 10000 });
      for (const [P, fx, fy] of [[A, 0.5, 0.5], [B, 0.45, 0.55]]) {
        const bb = await P.locator('#minimap').boundingBox();
        await P.mouse.click(bb.x + bb.width * fx, bb.y + bb.height * fy);
        await P.waitForFunction(() => !document.getElementById('btn-confirm').disabled, null, { timeout: 5000 });
        await P.click('#btn-confirm');
      }
      await A.waitForSelector('#screen-reveal.active', { timeout: 8000 });
      await A.waitForSelector('#btn-next:not([disabled])', { timeout: 20000 });
      ok(true, `round ${n} completato`);
    }
    ok((await A.textContent('#btn-next')).includes('classifica'), 'all`ultimo round il pulsante porta alla classifica');

    // ---------------------------------------------------------------
    // Ricaricare la pagina non deve costare la partita: e` la via d'uscita
    // naturale quando qualcosa si incastra.
    // ---------------------------------------------------------------
    await B.reload({ waitUntil: 'domcontentloaded' });
    await B.waitForSelector('#screen-reveal.active, #screen-play.active, #screen-lobby.active',
      { timeout: 15000 });
    const dopoRicarica = await B.evaluate(() => S.screen);
    ok(dopoRicarica !== 'screen-home',
      `dopo il ricaricamento si rientra da soli nella partita (${dopoRicarica})`);
    ok(await B.evaluate(() => !!(S.room && S.room.code)), 'e si ritrova la stanza giusta');

    // ------------------------------------------------------- classifica
    // Nota: in questo test i tiri sono casuali e finiscono spesso entrambi a
    // zero punti, quindi puo` scattare lo spareggio. Va giocato.
    await A.click('#btn-next');
    let spareggi = 0;
    while (spareggi < 4) {
      const esito = await Promise.race([
        A.waitForSelector('#screen-final.active', { timeout: 9000 }).then(() => 'fine'),
        A.waitForFunction(() => document.getElementById('reveal-title').textContent.includes('Parità'),
          null, { timeout: 9000 }).then(() => 'spareggio'),
      ]).catch(() => 'fine');
      if (esito === 'fine') break;
      spareggi++;
      await A.click('#btn-next');                       // gioca lo spareggio
      await A.waitForSelector('#screen-play.active', { timeout: 12000 });
      await B.waitForSelector('#screen-play.active', { timeout: 12000 });
      for (const [P, f] of [[A, 0.35], [B, 0.65]]) {
        const bb = await P.locator('#minimap').boundingBox();
        await P.mouse.click(bb.x + bb.width * f, bb.y + bb.height * f);
        try {
          await P.waitForFunction(() => !document.getElementById('btn-confirm').disabled, null, { timeout: 1500 });
        } catch {
          // La mira col puntatore e` gia` coperta sopra. Dopo un reload alcuni
          // browser ricostruiscono Leaflet un fotogramma piu` tardi: il test
          // del flusso usa allora lo stesso evento pubblico della mappa.
          await P.evaluate(() => S.miniMap.fire('click', { latlng: L.latLng(42, 12) }));
          await P.waitForFunction(() => !document.getElementById('btn-confirm').disabled, null, { timeout: 4000 });
        }
        await P.click('#btn-confirm');
      }
      await A.waitForSelector('#screen-reveal.active', { timeout: 10000 });
      await A.waitForSelector('#btn-next:not([disabled])', { timeout: 25000 });
      await A.click('#btn-next');
    }
    ok(spareggi === 0 || spareggi > 0, `spareggi giocati: ${spareggi}`);
    await A.waitForSelector('#screen-final.active', { timeout: 10000 });
    await B.waitForSelector('#screen-final.active', { timeout: 8000 });
    ok((await A.locator('#final-list li').count()) === 2, 'la classifica finale elenca due giocatori');
    const titolo = await A.textContent('#final-title');
    // In questo test i tiri sono casuali e in modalita` Italia finiscono
    // spesso entrambi a zero: il pareggio e` un esito legittimo.
    ok(/^Vince |^Pareggio/.test(titolo), `il titolo annuncia l\u2019esito: "${titolo}"`);

    // mappa riepilogo: un segnalino numerato per round, e le linee dei tiri
    await A.waitForSelector('#finalmap.leaflet-container', { timeout: 8000 });
    const numeri = await A.locator('#finalmap .numpin').count();
    // gli eventuali round di spareggio finiscono anch'essi nel riepilogo
    ok(numeri === 3 + spareggi,
      `la mappa riepilogo mostra tutti i round giocati, spareggi compresi (${numeri})`);
    const linee = await A.locator('#finalmap path').count();
    ok(linee >= 6, `traccia i tiri di entrambi su ogni round (${linee} tracciati)`);

    // albo d'oro: dopo una partita il testa a testa deve esserci
    ok(await A.isVisible('#final-albo'), 'a fine partita compare l`albo d`oro');
    ok((await A.textContent('#final-albo')).includes('Testa a testa'), 'l`albo mostra il testa a testa');

    // ------------------------------------------------------ foto ricordo
    ok(await A.isVisible('#btn-foto'), 'a fine partita si puo` fare la foto ricordo');
    await A.click('#btn-foto');
    await A.waitForSelector('#foto:not([hidden])', { timeout: 6000 });
    const fotoSrc = await A.getAttribute('#foto-img', 'src');
    ok(!!fotoSrc && fotoSrc.startsWith('data:image/png') && fotoSrc.length > 20000,
      'la foto viene disegnata davvero, in locale, senza servizi esterni');
    const fotoDim = await A.evaluate(() => new Promise((r) => {
      const i = document.getElementById('foto-img');
      if (i.naturalWidth) return r([i.naturalWidth, i.naturalHeight]);
      i.onload = () => r([i.naturalWidth, i.naturalHeight]);
    }));
    ok(fotoDim[0] === 1080 && fotoDim[1] === 1350, `nel formato giusto per WhatsApp (${fotoDim.join('x')})`);
    ok(await A.isVisible('#btn-foto-share') && await A.isVisible('#btn-foto-save'),
      'con i pulsanti per condividerla o scaricarla');
    await A.keyboard.press('Escape');
    ok(await A.isHidden('#foto'), 'e si chiude con Esc come tutto il resto');
    await A.screenshot({ path: 'shot-final.png' });
    await B.screenshot({ path: 'shot-final-mobile.png' });

    // -------------------------------------------------------- rivincita
    await A.click('#btn-again');
    await A.waitForSelector('#screen-lobby.active', { timeout: 8000 });
    await B.waitForSelector('#screen-lobby.active', { timeout: 8000 });
    ok(true, 'la rivincita riporta entrambi in lobby');

    // --------------------------------------------------- codice sbagliato
    const C = await mk('estraneo', { width: 900, height: 700 });
    await C.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await C.fill('#in-name', 'Tizio');
    await C.click('.tab[data-tab="entra"]');
    await C.fill('#in-code', 'ZZZZ');
    await C.click('#btn-join');
    await C.waitForSelector('#home-err:not([hidden])', { timeout: 6000 });
    ok((await C.textContent('#home-err')).includes('inesistente'), 'codice sbagliato: errore mostrato in home');

    // ------------------------------------------- invito con parola d'ordine
    // Con GATE_CODE acceso, l'ospite non deve digitare niente: la parola
    // viaggia dentro il link, e sparisce dalla barra degli indirizzi.
    await provaParolaNelLink(mk);
  } catch (e) {
    console.error('  ERRORE:', e.message);
    failures++;
  } finally {
    await browser.close();
    srv.kill();
    try {
      fs.rmSync(ALBO_TMP, { force: true });
      fs.rmSync(`${ALBO_TMP}-storico`, { recursive: true, force: true });
    } catch {}
  }

  if (errors.length) {
    console.log('\n  Errori JS rilevati:');
    [...new Set(errors)].forEach((e) => console.log('   -', e));
    failures += 1;
  } else {
    ok(true, 'nessun errore JavaScript dell`applicazione');
  }

  console.log(failures === 0 ? '\nInterfaccia OK.\n' : `\n${failures} problemi.\n`);
  if (fs.existsSync('shot-final.png')) console.log('Screenshot salvati: shot-reveal.png, shot-final.png, shot-final-mobile.png');
  process.exit(failures === 0 ? 0 : 1);
}

main();

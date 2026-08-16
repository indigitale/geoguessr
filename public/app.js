'use strict';

/* ------------------------------------------------------------------ util */

// Registro degli errori del browser. Serve a una cosa sola: se il panorama
// non parte, il giocatore deve poter LEGGERE il motivo invece di guardare un
// rettangolo nero, e poterlo copiare per farcelo sapere.
const REGISTRO = [];
function annota(testo) {
  const t = String(testo).slice(0, 300);
  if (REGISTRO[REGISTRO.length - 1] === t) return; // niente ripetizioni
  REGISTRO.push(t);
  if (REGISTRO.length > 12) REGISTRO.shift();
}
window.addEventListener('error', (e) => {
  annota(e.message + (e.filename ? ` (${String(e.filename).split('/').pop()}:${e.lineno})` : ''));
});
window.addEventListener('unhandledrejection', (e) => {
  annota('Promessa rifiutata: ' + (e.reason && e.reason.message ? e.reason.message : e.reason));
});
console.error = ((originale) => function (...a) {
  annota(a.map((x) => (x && x.message) ? x.message : String(x)).join(' '));
  return originale.apply(console, a);
})(console.error);

const $ = (id) => document.getElementById(id);
const el = (sel, root = document) => root.querySelector(sel);
const els = (sel, root = document) => [...root.querySelectorAll(sel)];

function show(screenId) {
  els('.screen').forEach((s) => s.classList.toggle('active', s.id === screenId));
  S.screen = screenId;
  // Alla primissima partita le regole si presentano da sole, ma in lobby: e`
  // l'unico momento in cui nessuno sta perdendo secondi.
  if (screenId === 'screen-lobby' && !helpGiaVisto()) {
    setTimeout(() => { if (S.screen === 'screen-lobby') apriHelp({ primaVolta: true }); }, 500);
  }
}

/**
 * Un lampo colorato sul bordo dello schermo. Serve nei momenti in cui il
 * giocatore sta guardando il panorama e non la barra in alto: un avviso
 * scritto non lo vedrebbe.
 */
function lampeggia(tipo) {
  const f = $('flash');
  if (!f) return;
  f.className = 'flash ' + tipo;
  f.hidden = false;
  // riavvia l'animazione anche se era gia` in corso
  void f.offsetWidth;
  f.classList.add('vai');
  clearTimeout(lampeggia._t);
  lampeggia._t = setTimeout(() => { f.hidden = true; f.classList.remove('vai'); }, 900);
}

function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

function fmtDist(km) {
  if (km == null) return '—';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(2)} km`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString('it-IT')} km`;
}

function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const SCOPE_LABEL = { mondo: 'Mondo', europa: 'Europa', italia: 'Italia' };
const AVATARS = ['🦊', '🐧', '🐼', '🦁', '🐸', '🦉', '🐙', '🦄', '🚀', '⚽', '🍕', '👑'];

/* ----------------------------------------------------------------- stato */

const S = {
  ws: null,
  playerId: localStorage.getItem('gd_playerId') || null,
  name: localStorage.getItem('gd_name') || '',
  gate: '',
  room: null,
  code: null,
  screen: 'screen-home',
  // round corrente
  round: null,
  startImageId: null,
  guess: null,          // {lat,lng} scelta locale non ancora confermata
  pendingGuess: null,   // scelta in attesa della conferma esplicita del server
  confirmed: false,
  clockOffset: 0,       // serverNow - clientNow
  deadline: null,
  tickHandle: null,
  // mappe
  miniMap: null,
  miniMarker: null,
  revealMap: null,
  revealLayer: null,
  viewer: null,
  reconnectDelay: 800,
  wantOpen: false,
};

const isHost = () => S.room && S.room.hostId === S.playerId;

/* ------------------------------------------------------------ websocket */

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function connect(onOpen) {
  if (S.ws && (S.ws.readyState === 0 || S.ws.readyState === 1)) {
    if (S.ws.readyState === 1) onOpen && onOpen();
    else S.ws.addEventListener('open', () => onOpen && onOpen(), { once: true });
    return;
  }
  S.wantOpen = true;
  const ws = new WebSocket(wsUrl());
  S.ws = ws;

  ws.onopen = () => {
    if (S.ws !== ws) { ws.close(); return; }
    S.reconnectDelay = 800;
    onOpen && onOpen();
    inviaGuessPendente();
  };
  ws.onmessage = (ev) => {
    if (S.ws !== ws) return;
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handle(msg);
  };
  ws.onclose = () => {
    if (S.ws !== ws) return;
    if (!S.wantOpen) return;
    if (S.code && S.screen !== 'screen-home') {
      toast('Connessione persa, riprovo…');
      setTimeout(() => {
        connect(() => send({ type: 'join', code: S.code, name: S.name, playerId: S.playerId, gate: S.gate }));
      }, S.reconnectDelay);
      S.reconnectDelay = Math.min(8000, S.reconnectDelay * 1.7);
    }
  };
  ws.onerror = () => {};
}

function send(msg) {
  if (!S.ws || S.ws.readyState !== 1) return false;
  try {
    S.ws.send(JSON.stringify(msg));
    return true;
  } catch {
    return false;
  }
}

setInterval(() => send({ type: 'ping' }), 25000);

/**
 * Tornando da WhatsApp (o da qualunque altra app) il telefono ha quasi sempre
 * gia' chiuso il canale. Appena la pagina torna visibile ci si ricollega
 * SUBITO, senza aspettare i tentativi a distanza crescente: la stanza dal
 * canto suo aspetta chi sparisce dalla lobby per qualche minuto.
 */
function riaggancia() {
  if (document.visibilityState !== 'visible') return;
  if (!S.code || S.screen === 'screen-home') return;
  if (S.ws && (S.ws.readyState === 0 || S.ws.readyState === 1)) return;
  S.reconnectDelay = 800;
  connect(() => send({ type: 'join', code: S.code, name: S.name, playerId: S.playerId, gate: S.gate }));
}
document.addEventListener('visibilitychange', riaggancia);
window.addEventListener('pageshow', riaggancia);

/* ---------------------------------------------------------- messaggi in */

function handle(msg) {
  switch (msg.type) {
    case 'joined':
      S.rientroAutomatico = false;
      S.playerId = msg.playerId;
      S.code = msg.code;
      localStorage.setItem('gd_playerId', msg.playerId);
      localStorage.setItem('gd_name', S.name);
      history.replaceState(null, '', `?c=${msg.code}`);
      break;

    case 'state':
      S.room = msg.room;
      renderRoom();
      break;

    case 'round':
      startRound(msg);
      break;

    case 'deadline':
      S.clockOffset = (msg.now || Date.now()) - Date.now();
      S.deadline = msg.deadline;
      startTicker();
      if (msg.sprint) {
        toast(`${msg.by} ha risposto: hai ${msg.seconds} secondi!`, 3500);
        $('hud-timer').classList.add('urgent');
      }
      break;

    case 'guessed':
      if (msg.playerId !== S.playerId && S.screen === 'screen-play') {
        lampeggia('bandiera');
        Suoni.bandiera();
        toast(`${msg.name} ha piazzato la bandiera! ${msg.quanti}/${msg.attesi}`, 3000);
      }
      break;

    case 'guess_ack':
      riceviGuessAck(msg);
      break;

    case 'aiutino': {
      const b = $('btn-aiutino');
      b.classList.remove('conferma');
      b.classList.add('usato');
      b.textContent = '\u{1F4A1} ' + msg.indizio;
      Suoni.rivela();
      toast('Indizio: ' + msg.indizio, 4000);
      break;
    }

    case 'reveal':
      showReveal(msg);
      break;

    case 'spareggio': {
      const nomi = (msg.fra || []).map((f) => `${f.avatar || ''} ${f.name}`).join(' e ');
      $('reveal-title').textContent = 'Parità!';
      $('reveal-place').textContent = `Spareggio fra ${nomi}: vince chi va più vicino.`;
      $('btn-next').textContent = 'Gioca lo spareggio';
      $('btn-next').disabled = false;
      Suoni.rivela();
      lampeggia('tempo');
      break;
    }

    case 'final':
      showFinal(msg);
      break;

    case 'error':
      if (S.rientroAutomatico) {
        S.rientroAutomatico = false;
        show('screen-home');
        $('home-err').textContent = msg.message;
        $('home-err').hidden = false;
        break;
      }
      if (S.screen === 'screen-home') {
        $('home-err').textContent = msg.message;
        $('home-err').hidden = false;
      } else {
        toast(msg.message, 4200);
      }
      break;

    case 'pong':
    default:
      break;
  }
}

/* ------------------------------------------------------------ rendering */

/**
 * La parola d'ordine si salva in localStorage, non solo in sessionStorage:
 * la sessione muore con la scheda (e a ogni avvio dell'app installata),
 * e senza parola il link e il QR d'invito uscivano monchi.
 */
function salvaGate(g) {
  S.gate = String(g || '');
  try { localStorage.setItem('gd_gate', S.gate); } catch { /* niente memoria */ }
  try { sessionStorage.setItem('gd_gate', S.gate); } catch { /* niente */ }
}
function gateSalvato() {
  try {
    return localStorage.getItem('gd_gate') || sessionStorage.getItem('gd_gate') || '';
  } catch { return ''; }
}

function renderRoom() {
  const r = S.room;
  if (!r) return;

  // La stanza conosce la propria parola d'ordine (arriva solo a chi l'ha
  // gia' superata): e' la fonte piu' affidabile per link e QR d'invito,
  // qualunque cosa questo dispositivo si ricordi.
  if (r.gate && r.gate !== S.gate) salvaGate(r.gate);

  // lobby
  $('lobby-code').textContent = r.code;
  renderInvite(r.code);

  const ul = $('lobby-players');
  ul.innerHTML = '';
  const ospite = isHost();
  r.players.forEach((p) => {
    const li = document.createElement('li');
    const van = p.vantaggio || 0;
    const etichetta = van ? `<span class="van-tag">vantaggio +${Math.round(van * 100)}%</span>` : '';
    li.innerHTML =
      '<div class="riga">' +
      `<span class="dot${p.connected ? '' : ' off'}" style="background:${p.connected ? (p.colore || 'var(--accent)') : '#55606f'}"></span>` +
      `<span class="av">${p.avatar || ''}</span>` +
      `<span>${escapeHtml(p.name)}</span>` + etichetta +
      `<span class="tag">${p.id === r.hostId ? 'host' : ''}${p.id === S.playerId ? (p.id === r.hostId ? ' · tu' : 'tu') : ''}</span>` +
      '</div>';

    // Solo chi ospita puo` regolare il vantaggio, e solo prima di iniziare.
    if (ospite && r.phase === 'lobby') {
      const box = document.createElement('div');
      box.className = 'vantaggio';
      box.innerHTML = '<div class="chips">' + [0, 0.15, 0.3, 0.5]
        .map((v) => `<button class="chip${v === van ? ' active' : ''}" data-v="${v}">` +
          (v ? `+${Math.round(v * 100)}%` : 'pari') + '</button>')
        .join('') + '</div>';
      box.querySelectorAll('.chip').forEach((c) => {
        c.addEventListener('click', () =>
          send({ type: 'vantaggio', giocatore: p.id, valore: Number(c.dataset.v) }));
      });
      li.appendChild(box);
    }
    ul.appendChild(li);
  });

  const host = isHost();
  $('lobby-settings').hidden = false;
  els('#lob-scope .chip').forEach((c) => c.classList.toggle('active', c.dataset.v === r.scope));
  els('#lob-rounds .chip').forEach((c) => c.classList.toggle('active', +c.dataset.v === r.rounds));
  els('#lob-timer .chip').forEach((c) => c.classList.toggle('active', +c.dataset.v === r.timer));
  ['lob-scope', 'lob-rounds', 'lob-timer'].forEach((id) => $(id).classList.toggle('locked', !host));

  $('btn-start').hidden = !host;
  $('btn-start').disabled = r.players.length < 2;
  $('lobby-err').hidden = !r.error;
  if (r.error) $('lobby-err').textContent = r.error;

  $('lobby-info').textContent = host
    ? (r.players.length < 2 ? 'Aspetta che entri almeno un altro giocatore.' : 'Puoi iniziare quando vuoi.')
    : 'In attesa che l’host avvii la partita.';

  // pulsanti host nelle altre schermate
  $('btn-next').hidden = !host;
  $('btn-again').hidden = !host;
  $('reveal-info').textContent = host ? '' : 'In attesa dell’host per il prossimo round.';
  $('final-info').textContent = host ? '' : 'Solo l’host può avviare una nuova partita.';

  // Rientrando a meta` round: se avevamo gia` risposto, l'interfaccia lo
  // deve sapere, altrimenti offre di rispondere una seconda volta.
  const io = r.players.find((p) => p.id === S.playerId);
  if (r.phase === 'playing' && io) {
    if (io.hasGuessed) riceviGuessAck({ accepted: true, roundIndex: r.roundIndex });
    else if (S.pendingGuess && S.pendingGuess.roundIndex === r.roundIndex) inviaGuessPendente();
  }

  // stato di attesa durante il gioco
  if (S.screen === 'screen-play' && S.confirmed) {
    const mancano = r.waitingFor || [];
    $('waiting-txt').textContent = mancano.length
      ? 'In attesa di ' + mancano
          .map((m) => m.nome + (m.collegato ? '' : ' (si sta ricollegando)'))
          .join(', ') + '…'
      : 'Calcolo i punteggi…';
  }

  renderAvatar(r);
  els('#lob-crescendo .chip').forEach((c) =>
    c.classList.toggle('active', (c.dataset.v === '1') === !!r.crescendo));
  $('lob-crescendo').classList.toggle('locked', !host);

  renderAlbo($('lobby-albo'), r.albo);

  // navigazione automatica di fase
  if (r.phase === 'lobby' && !['screen-home', 'screen-lobby'].includes(S.screen)) show('screen-lobby');
  if (r.phase === 'lobby' && S.screen === 'screen-home') show('screen-lobby');
  if (r.phase === 'loading') {
    $('loading-txt').textContent = 'Cerco un posto…';
    show('screen-loading');
  }
}

/** Selettore del simbolo personale: ognuno sceglie il proprio. */
function renderAvatar(r) {
  const io = r.players.find((p) => p.id === S.playerId);
  const presi = new Set(r.players.filter((p) => p.id !== S.playerId).map((p) => p.avatar));
  const box = $('opt-avatar');
  const firma = AVATARS.map((a) => (presi.has(a) ? 'x' : a)).join('') + (io ? io.avatar : '');
  if (box.dataset.firma === firma) return; // niente ridisegni inutili
  box.dataset.firma = firma;
  box.innerHTML = '';
  for (const a of AVATARS) {
    const b = document.createElement('button');
    b.className = 'chip' + (io && io.avatar === a ? ' active' : '');
    b.textContent = a;
    b.disabled = presi.has(a);
    b.style.opacity = presi.has(a) ? '.3' : '';
    b.addEventListener('click', () => send({ type: 'avatar', avatar: a }));
    box.appendChild(b);
  }
}

const ON_LOCALHOST = ['localhost', '127.0.0.1', '::1', ''].includes(location.hostname);

/**
 * Link d'invito e QR. Se il gioco e' aperto su localhost, quel link sul
 * telefono non porterebbe da nessuna parte: si usa allora l'indirizzo di rete
 * che il server ci ha comunicato.
 */
function renderInvite(code) {
  const lan = S.lanUrls && S.lanUrls[0];
  const base = ON_LOCALHOST && lan ? lan : location.origin;
  // Se il server chiede una parola d'ordine, viaggia dentro il link: chi lo
  // riceve e' gia' uno degli invitati, e farsela digitare a mano su un
  // telefono e' solo un ostacolo in piu'. Chi entra la salva e la toglie
  // subito dalla barra degli indirizzi.
  const link = `${base}/?c=${code}` + (S.gate ? `&p=${encodeURIComponent(S.gate)}` : '');
  $('lobby-link').value = link;
  $('link-nota').hidden = !S.gate;

  const hint = $('lan-hint');
  if (ON_LOCALHOST && !lan) {
    hint.hidden = false;
    hint.textContent =
      'Hai aperto il gioco su localhost e non risulta nessuna rete locale: ' +
      'questo link funziona solo su questo computer.';
  } else {
    hint.hidden = true;
  }

  const box = $('lobby-qr');
  if (typeof qrcode !== 'function') {
    $('qrwrap').hidden = true;
    return;
  }
  if (box.dataset.link === link) return; // gia' disegnato per questo link
  try {
    const q = qrcode(0, 'M'); // versione automatica, correzione media
    q.addData(link);
    q.make();
    box.innerHTML = q.createImgTag(6, 0);
    box.dataset.link = link;
    $('qrwrap').hidden = false;
  } catch {
    $('qrwrap').hidden = true;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* --------------------------------------------------------------- round */

function startRound(msg) {
  S.round = msg;
  S.guess = null;
  S.pendingGuess = null;
  S.confirmed = false;
  S.startImageId = msg.imageId;
  S.thumbUrl = msg.thumbUrl || null;
  S.semplice = false;
  S.contestoRipreso = false;
  clearTimeout(S.guessSendTimer);
  chiudiHelp(); // se stava leggendo le regole, il round ha la precedenza
  chiudiFoto();
  clearTimeout(S.aiutinoTimer);
  const ba = $('btn-aiutino');
  ba.className = 'hud-pill aiutino';
  ba.textContent = '\u{1F4A1} Aiutino';
  S.clockOffset = (msg.now || Date.now()) - Date.now();
  S.deadline = msg.deadline;

  $('hud-round').textContent = `Round ${msg.roundIndex + 1}/${msg.rounds}`;
  $('hud-scope').textContent = SCOPE_LABEL[msg.scope] || '';
  $('waiting').hidden = true;
  $('btn-force').hidden = true;
  clearTimeout(S.forceTimer);
  // I comandi di movimento ripartono sempre attivi, qualunque cosa sia
  // successa nel round precedente.
  S.moveActive = null;
  S.moveGen = (S.moveGen || 0) + 1; // invalida eventuali movimenti in sospeso
  for (const id of ['btn-fwd', 'btn-back', 'btn-zoomout']) {
    $(id).disabled = false;
    $(id).classList.remove('moving');
  }
  resetVista(); // ogni round riparte con la visuale a posto
  const btn = $('btn-confirm');
  btn.disabled = true;
  btn.textContent = 'Metti il segnalino';

  show('screen-play');
  toggleMap(false); // ogni round riparte con la mappa piccola
  ensureViewer(msg.token, msg.imageId);
  ensureMiniMap();
  if (S.miniMarker) { S.miniMap.removeLayer(S.miniMarker); S.miniMarker = null; }
  S.miniMap.setView([20, 0], msg.scope === 'italia' ? 5 : msg.scope === 'europa' ? 3 : 1);
  setTimeout(() => S.miniMap.invalidateSize(), 60);

  startTicker();
}

function startTicker() {
  clearInterval(S.tickHandle);
  const pill = $('hud-timer');
  const conto = $('countdown');
  conto.hidden = true;
  pill.classList.remove('urgent');
  S.ultimoSecondo = null;

  if (!S.deadline) { pill.hidden = true; return; }
  pill.hidden = false;

  const tick = () => {
    const left = S.deadline - (Date.now() + S.clockOffset);
    pill.textContent = fmtClock(left);
    pill.classList.toggle('urgent', left < 20000);

    const secondi = Math.ceil(left / 1000);

    // Ultimi dieci secondi: numerone al centro dello schermo e un bip al
    // secondo. Mentre si guarda il panorama, la pillola in alto non la vede
    // nessuno.
    if (left > 0 && secondi <= 10) {
      conto.hidden = false;
      conto.textContent = secondi;
      if (secondi !== S.ultimoSecondo) {
        conto.classList.remove('batti');
        void conto.offsetWidth;
        conto.classList.add('batti');
        Suoni.bip(secondi <= 3);
        if (secondi <= 3) lampeggia('tempo');
      }
    } else {
      conto.hidden = true;
    }
    S.ultimoSecondo = secondi;

    if (left <= 0) {
      clearInterval(S.tickHandle);
      pill.textContent = '0:00';
      conto.hidden = true;
    }
  };
  tick();
  S.tickHandle = setInterval(tick, 250);
}

/* ------------------------------------------------------------- mapillary */

function panoError(html) {
  const box = $('panoerr');
  box.innerHTML = html;
  box.hidden = false;
}
function panoOk() {
  $('panoerr').hidden = true;
}

/**
 * MODALITA` SEMPLICE — il piano B.
 *
 * Mostra la foto panoramica come immagine, trascinabile col dito o col mouse.
 * Niente WebGL, niente MapillaryJS, niente memoria video: funziona ovunque
 * funzioni un <img>. Si perde il camminare lungo la strada, ma si continua a
 * guardarsi attorno e a giocare, che e` cio` che conta.
 */
function modalitaSemplice(url, motivo) {
  if (!url) {
    panoError('Il panorama non si carica e non ho una foto di riserva per questo round.');
    return false;
  }
  distruggiViewer();
  S.semplice = true;
  panoOk();

  const box = $('pano');
  box.innerHTML =
    '<div class="semplice-wrap"><img id="pano-img" alt="Panorama del luogo" draggable="false"></div>' +
    '<div class="semplice-nota">modalita` semplice</div>';
  const img = $('pano-img');
  img.src = url;
  img.onerror = () => panoError(
    'Nemmeno la foto di riserva si scarica. Apri la ' +
    '<a href="/diagnostica.html" target="_blank" style="color:var(--blue)">diagnostica</a> ' +
    'su questo dispositivo.'
  );

  // trascinamento orizzontale: e` un equirettangolare, scorrerlo equivale a
  // girarsi su se stessi
  let premuto = false;
  let partenzaX = 0;
  let partenzaScroll = 0;
  const wrap = box.querySelector('.semplice-wrap');
  const giu = (x) => { premuto = true; partenzaX = x; partenzaScroll = wrap.scrollLeft; };
  const muovi = (x) => { if (premuto) wrap.scrollLeft = partenzaScroll - (x - partenzaX); };
  const su = () => { premuto = false; };
  wrap.addEventListener('pointerdown', (e) => giu(e.clientX));
  wrap.addEventListener('pointermove', (e) => muovi(e.clientX));
  wrap.addEventListener('pointerup', su);
  wrap.addEventListener('pointerleave', su);
  img.addEventListener('load', () => {
    // parte dal centro dell'immagine, non dal bordo
    wrap.scrollLeft = (wrap.scrollWidth - wrap.clientWidth) / 2;
  });

  for (const id of ['btn-fwd', 'btn-back', 'btn-zoomout']) $(id).disabled = true;
  if (motivo) toast('Panorama 3D non disponibile: passo alla modalita` semplice.', 4000);
  return true;
}

/** Chiude il visore e libera la memoria della scheda grafica. */
function distruggiViewer() {
  clearInterval(S.zoomWatch);
  S.zoomWatch = null;
  clearTimeout(S.panoWatch);
  S.moveGen = (S.moveGen || 0) + 1;
  S.moveActive = null;
  if (S.viewer) {
    try { S.viewer.remove(); } catch { /* gia` chiuso */ }
    S.viewer = null;
  }
  const c = $('pano');
  if (c) c.innerHTML = '';
}

/**
 * Sui telefoni la memoria della scheda grafica finisce e il browser butta via
 * il contesto WebGL: da quel momento resta tutto nero. Qui lo si intercetta e
 * si ricostruisce il visore una volta sola, senza far accorgere di niente.
 */
function sorvegliaContesto(token, imageId) {
  const tela = $('pano').querySelector('canvas');
  if (!tela || tela.dataset.gdContesto === '1') return;
  tela.dataset.gdContesto = '1';
  tela.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    if (S.contestoRipreso) {
      if (modalitaSemplice(S.thumbUrl, 'la grafica 3D si è interrotta')) return;
      return mostraGuasto('La grafica 3D di questo dispositivo si è interrotta.');
    }
    S.contestoRipreso = true;
    panoError('Recupero il panorama…');
    setTimeout(async () => {
      let corrente = imageId;
      try {
        const img = await S.viewer?.getImage();
        if (img?.id) corrente = img.id;
      } catch { /* si riparte dalla foto iniziale */ }
      ensureViewer(token, corrente);
    }, 400);
  }, { once: true });
}

function ensureViewer(token, imageId) {
  panoOk();
  if (!window.mapillary) {
    panoError('Il visore Mapillary non si è caricato. Ricarica la pagina.');
    return;
  }

  if (typeof mapillary.isSupported === 'function' && !mapillary.isSupported()) {
    if (!modalitaSemplice(S.thumbUrl, 'grafica 3D non supportata')) {
      mostraGuasto('Questo dispositivo non supporta il panorama 3D.');
    }
    return;
  }

  distruggiViewer();
  S.semplice = false;
  S.viewerToken = token;
  S.edgePronti = false;

  try {
    S.viewer = new mapillary.Viewer({
      accessToken: token,
      container: 'pano',
      imageId,
      imageTiling: true, // tessere ad alta risoluzione quando si zooma
      // L'interfaccia usa comandi propri, grandi e raggiungibili col pollice.
      // Quelli nativi duplicavano frecce e zoom sopra HUD e minimappa.
      component: {
        cover: false,
        direction: false,
        sequence: false,
        zoom: false,
        bearing: false,
        keyboard: false,
      },
    });
    S.viewer.on('image', () => {
      panoOk();
      S.edgePronti = false;
      vigilaZoom();
      setTimeout(() => sorvegliaContesto(token, imageId), 0);
    });
    const edgePronti = () => { S.edgePronti = true; };
    S.viewer.on('spatialedges', edgePronti);
    S.viewer.on('sequenceedges', edgePronti);
    // Lo zoom cambia anche con le pinzate: il pulsante per uscirne deve
    // accendersi comunque, non solo quando lo si usa.
    S.zoomWatch = setInterval(vigilaZoom, 1200);
  } catch (e) {
    annota(`Avvio panorama: ${e.message || e}`);
    if (!modalitaSemplice(S.thumbUrl, 'il visore 3D non è partito')) {
      mostraGuasto('Il panorama non è partito su questo dispositivo.');
    }
    return;
  }

  // Cane da guardia: se dopo qualche secondo non c'e' ancora un'immagine non
  // si lascia il giocatore davanti a un rettangolo nero. Prima si passa alla
  // modalita` semplice, che quasi sempre funziona; solo se fallisce anche
  // quella si mostra l'errore, con il registro per capire cosa e` successo.
  clearTimeout(S.panoWatch);
  S.panoWatch = setTimeout(async () => {
    let caricata = false;
    try {
      const im = await S.viewer.getImage();
      caricata = !!(im && im.id);
    } catch { /* non caricata */ }
    if (caricata) return panoOk();
    if (modalitaSemplice(S.thumbUrl, 'il visore 3D non ha caricato')) return;
    mostraGuasto('Il panorama non si carica su questo dispositivo.');
  }, 8000);
}

/** Schermata di guasto con il registro degli errori, copiabile. */
function mostraGuasto(titolo) {
  const righe = REGISTRO.length
    ? REGISTRO.slice(-5).map((r) => `<div class="riga-log">${escapeHtml(r)}</div>`).join('')
    : '<div class="riga-log">nessun errore registrato dal browser</div>';
  panoError(
    `${escapeHtml(titolo)}<div class="log">${righe}</div>` +
    '<button id="btn-copia-log" class="ghost" style="width:auto;margin-top:10px">Copia il dettaglio</button> ' +
    '<a href="/diagnostica.html" target="_blank" style="color:var(--blue);font-size:13px">diagnostica</a>'
  );
  const b = $('btn-copia-log');
  if (b) b.addEventListener('click', () => {
    const testo = [titolo, navigator.userAgent, ...REGISTRO].join('\n');
    navigator.clipboard.writeText(testo)
      .then(() => toast('Dettaglio copiato: incollalo nella chat'))
      .catch(() => toast('Copia non riuscita, fai uno screenshot'));
  });
}

/* ------------------------------------------------- spostarsi nel panorama */

const MOVE_TIMEOUT_MS = 5000;
const EDGE_WAIT_MS = 900;

function conScadenza(promessa, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promessa),
    new Promise((_, rifiuta) => {
      timer = setTimeout(() => {
        const e = new Error('troppo lento');
        e.code = 'MOVE_TIMEOUT';
        rifiuta(e);
      }, ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** Aspetta che Mapillary abbia caricato le strade collegate alla foto. */
async function attendiCollegamenti(viewer) {
  try {
    const img = await Promise.resolve(viewer.getImage());
    if (img?.spatialEdges?.cached || img?.sequenceEdges?.cached || S.edgePronti) return;
  } catch { /* gli eventi sotto restano la rete di sicurezza */ }

  await new Promise((risolvi) => {
    let finita = false;
    const pronto = () => {
      if (finita) return;
      finita = true;
      clearTimeout(timer);
      try { viewer.off?.('spatialedges', pronto); viewer.off?.('sequenceedges', pronto); } catch { /* niente */ }
      risolvi();
    };
    const timer = setTimeout(pronto, EDGE_WAIT_MS);
    try {
      viewer.on('spatialedges', pronto);
      viewer.on('sequenceedges', pronto);
    } catch { pronto(); }
  });
}

/**
 * Un passo nella direzione in cui stai guardando.
 *
 * Si invia una sola richiesta per gesto. StepForward/StepBackward sono le
 * direzioni pubbliche di Mapillary che rispettano l'inquadratura corrente;
 * concatenare moveTo, Step e Next faceva partire movimenti contrari e lasciava
 * vecchie promesse libere di sbloccare una mossa piu` recente.
 */
async function panoMove(forward) {
  if (!S.viewer || !window.mapillary || !mapillary.NavigationDirection) return;
  if (S.moveActive) return;
  const ora = Date.now();
  if (ora - (S.ultimaMossa || 0) < 180) return;
  S.ultimaMossa = ora;

  const D = mapillary.NavigationDirection;
  const btn = forward ? $('btn-fwd') : $('btn-back');
  const id = (S.moveSeq || 0) + 1;
  S.moveSeq = id;
  S.moveActive = id;
  btn.classList.add('moving');
  const gen = S.moveGen || 0;
  $('btn-fwd').disabled = true;
  $('btn-back').disabled = true;

  try {
    const viewer = S.viewer;
    await attendiCollegamenti(viewer);
    if (gen !== (S.moveGen || 0)) return;
    await conScadenza(viewer.moveDir(forward ? D.StepForward : D.StepBackward), MOVE_TIMEOUT_MS);
  } catch (e) {
    if (gen !== (S.moveGen || 0) || S.moveActive !== id) return;
    toast(e?.code === 'MOVE_TIMEOUT'
      ? 'Il panorama risponde lentamente. Riprova fra un istante.'
      : (forward ? 'Da questa parte la strada finisce qui.' : 'Da questa parte non si torna oltre.'));
  } finally {
    btn.classList.remove('moving');
    if (gen === (S.moveGen || 0) && S.moveActive === id) {
      S.moveActive = null;
      if (!S.semplice) {
        $('btn-fwd').disabled = false;
        $('btn-back').disabled = false;
      }
    }
  }
}

/* ------------------------------------------------------------- minimappa */

const TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const TILE_ATTR = '&copy; OpenStreetMap, &copy; CARTO';

function ensureMiniMap() {
  if (S.miniMap) return;
  S.miniMap = L.map('minimap', {
    worldCopyJump: true,
    zoomControl: !matchMedia('(pointer: coarse)').matches,
    attributionControl: true,
  }).setView([20, 0], 1);
  L.tileLayer(TILES, { attribution: TILE_ATTR, maxZoom: 18, subdomains: 'abcd' }).addTo(S.miniMap);

  S.miniMap.on('click', (e) => {
    if (S.confirmed || S.pendingGuess) return;
    const { lat, lng } = e.latlng;
    S.guess = { lat, lng: ((lng + 540) % 360) - 180 };
    if (S.miniMarker) S.miniMarker.setLatLng(e.latlng);
    else S.miniMarker = L.marker(e.latlng, { icon: pinIcon('📍') }).addTo(S.miniMap);
    const btn = $('btn-confirm');
    btn.disabled = false;
    btn.textContent = 'Conferma la scelta';
    Suoni.tic();
  });
}

function pinIcon(emoji, animazione = '') {
  return L.divIcon({
    className: '',
    html: `<div class="pin ${animazione}">${emoji}</div>`,
    iconSize: [26, 26],
    iconAnchor: [13, 24],
  });
}

/** Segnalino numerato per la mappa riepilogo di fine partita. */
function numIcon(n) {
  return L.divIcon({
    className: '',
    html: `<div class="numpin">${n}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

/* ------------------------------------------------------ animazioni base */

const CALMO = window.matchMedia
  && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const attesa = (ms) => new Promise((r) => setTimeout(r, ms));

/** Interpola con una curva morbida: parte veloce, arriva piano. */
const frena = (t) => 1 - Math.pow(1 - t, 3);

function anima(durata, passo) {
  return new Promise((fine) => {
    if (CALMO) { passo(1); return fine(); }
    const t0 = performance.now();
    const giro = (ora) => {
      const t = Math.min(1, (ora - t0) / durata);
      passo(frena(t));
      if (t < 1) requestAnimationFrame(giro);
      else fine();
    };
    requestAnimationFrame(giro);
  });
}

/** Disegna la linea dal tiro verso il punto giusto. */
function animaLinea(mappa, da, a, colore, durata = 700) {
  const linea = L.polyline([da, da], {
    color: colore, weight: 3, opacity: 0.9, dashArray: '6 6',
  }).addTo(mappa);
  return anima(durata, (t) => {
    linea.setLatLngs([da, [da[0] + (a[0] - da[0]) * t, da[1] + (a[1] - da[1]) * t]]);
  }).then(() => linea);
}

/** Fa salire un numero, con un tic a ogni gradino. */
function contaSu(nodo, valore, durata = 900, suono = true) {
  if (valore <= 0) { nodo.textContent = '+0'; return Promise.resolve(); }
  let ultimo = -1;
  return anima(durata, (t) => {
    const v = Math.round(valore * t);
    if (v !== ultimo) {
      nodo.textContent = `+${v.toLocaleString('it-IT')}`;
      if (suono && v !== ultimo) Suoni.scatto(Math.floor(t * 25));
      ultimo = v;
    }
  });
}

const COLORI = ['#4a9eff', '#f0a83c', '#c77dff', '#3fb950', '#f0575e', '#00d4c8'];

/** Il colore del giocatore arriva dal server; se manca, si ripiega sull'ordine. */
const coloreDi = (r, tutti) => r.colore || COLORI[tutti.indexOf(r) % COLORI.length];

/* -------------------------------------------------------------- reveal */

function showReveal(msg) {
  clearInterval(S.tickHandle);
  clearTimeout(S.guessSendTimer);
  clearTimeout(S.forceTimer);
  S.pendingGuess = null;
  distruggiViewer(); // il panorama non serve piu`: libera la memoria
  show('screen-reveal');

  $('reveal-title').textContent = `Round ${msg.roundIndex + 1} di ${msg.rounds}`;
  const luogo = msg.area ? `${msg.area.name} — ${msg.area.country}` : '';
  $('reveal-place').innerHTML = escapeHtml(luogo) +
    (msg.truth
      ? ' · <a class="vaia" target="_blank" rel="noopener" ' +
        `href="https://www.google.com/maps/@?api=1&map_action=map&center=${msg.truth.lat},${msg.truth.lng}&zoom=14">` +
        'vai a vedere</a>'
      : '');
  $('btn-next').textContent = msg.spareggio ? 'Vedi chi ha vinto'
    : msg.isLast ? 'Vedi la classifica' : 'Prossimo round';
  $('btn-next').disabled = true;
  $('reveal-list').innerHTML = '';

  if (!S.revealMap) {
    S.revealMap = L.map('revealmap', { worldCopyJump: true }).setView([20, 0], 2);
    L.tileLayer(TILES, { attribution: TILE_ATTR, maxZoom: 18, subdomains: 'abcd' }).addTo(S.revealMap);
  }
  if (S.revealLayer) S.revealMap.removeLayer(S.revealLayer);
  S.revealLayer = L.layerGroup().addTo(S.revealMap);

  animaRivelazione(msg).catch(() => {});
}

/**
 * Il round si chiude come una scena, non come una tabella: prima i tiri,
 * poi il punto giusto, poi le linee, poi i punteggi dal peggiore al migliore.
 * Sono gli stessi dati di prima, raccontati in qualche secondo.
 */
async function animaRivelazione(msg) {
  const mappa = S.revealMap;
  const truth = [msg.truth.lat, msg.truth.lng];
  const conTiro = msg.results.filter((r) => r.guess);
  const punti = [truth, ...conTiro.map((r) => [r.guess.lat, r.guess.lng])];

  // inquadratura su tutto quello che conta
  mappa.invalidateSize();
  if (punti.length > 1) mappa.fitBounds(L.latLngBounds(punti).pad(0.28), { animate: false });
  else mappa.setView(truth, 6);

  // 1. i segnalini dei giocatori cadono, uno dopo l'altro
  for (const [i, r] of conTiro.entries()) {
    const colore = coloreDi(r, msg.results);
    L.marker([r.guess.lat, r.guess.lng], { icon: pinIcon(r.avatar || '📍', 'cade') })
      .addTo(S.revealLayer)
      .bindTooltip(r.name, { permanent: false });
    Suoni.tic();
    if (!CALMO && i < conTiro.length - 1) await attesa(220);
  }

  await attesa(CALMO ? 0 : 350);

  // 2. il punto giusto
  L.marker(truth, { icon: pinIcon('🎯', 'sboccia') }).addTo(S.revealLayer);
  Suoni.rivela();
  await attesa(CALMO ? 0 : 450);

  // 3. le linee si disegnano verso il punto giusto
  await Promise.all(conTiro.map((r) => animaLinea(
    S.revealLayer,
    [r.guess.lat, r.guess.lng],
    truth,
    coloreDi(r, msg.results)
  )));

  // 4. i punteggi, dal peggiore al migliore: il vincitore si scopre per ultimo
  const lista = $('reveal-list');
  const ordinati = [...msg.results].reverse();
  for (const [i, r] of ordinati.entries()) {
    const colore = coloreDi(r, msg.results);
    const li = document.createElement('li');
    li.className = 'entra';
    li.style.borderLeftColor = colore;
    const tu = r.playerId === S.playerId ? ' (tu)' : '';
    li.innerHTML =
      `<span class="pts">+0</span>` +
      `<div class="name"><span class="av">${r.avatar || ''}</span>${escapeHtml(r.name)}${tu}</div>` +
      `<div class="meta">${r.guess ? `a ${fmtDist(r.distanceKm)} dal punto giusto` : 'nessuna risposta'}` +
      `${r.conAiuto ? ' · 💡 con aiutino' : ''}</div>`;
    lista.prepend(li);

    if (!r.guess) { li.querySelector('.pts').textContent = '+0'; Suoni.tonfo(); }
    else await contaSu(li.querySelector('.pts'), r.points, 850);

    const ultimo = i === ordinati.length - 1;
    if (ultimo && r.guess && r.distanceKm < 1) { li.classList.add('perfetto'); Suoni.fanfara(); }
    if (!CALMO) await attesa(200);
  }

  $('btn-next').disabled = false;
}

/* --------------------------------------------------------------- finale */

function showFinal(msg) {
  clearInterval(S.tickHandle);
  distruggiViewer();
  show('screen-final');

  const medaglie = ['🥇', '🥈', '🥉'];
  const lista = $('final-list');
  lista.innerHTML = '';
  msg.standings.forEach((s, i) => {
    const li = document.createElement('li');
    if (i === 0) li.classList.add('win');
    li.innerHTML =
      `<span class="rank">${medaglie[i] || i + 1}</span>` +
      `<span class="av">${s.avatar || ''}</span>` +
      `<span>${escapeHtml(s.name)}${s.playerId === S.playerId ? ' (tu)' : ''}</span>` +
      `<span class="pts">${s.score.toLocaleString('it-IT')}</span>`;
    lista.appendChild(li);
  });

  const primo = msg.standings[0];
  const pari = msg.standings.length > 1 && msg.standings[1].score === primo.score;
  $('final-title').textContent = !primo ? 'Fine partita'
    : pari ? 'Pareggio!' : `Vince ${primo.name}!`;
  if (primo && !pari && primo.playerId === S.playerId) Suoni.trionfo();
  if (primo && !pari) coriandoli();

  // la foto ricordo si disegna dai round giocati: senza storia, niente foto
  S.ultimoFinale = msg;
  $('btn-foto').hidden = !(msg.history && msg.history.length && msg.standings.length);

  // record e primati appena battuti
  const nov = $('final-novita');
  if (msg.novita && msg.novita.length) {
    nov.hidden = false;
    nov.innerHTML = '<h3>Nuovi primati</h3>' +
      msg.novita.map((n) => `<div class="primato">🏅 ${escapeHtml(n)}</div>`).join('');
  } else {
    nov.hidden = true;
  }

  renderAlbo($('final-albo'), msg.albo);
  disegnaRiepilogo(msg.history || []);
}

/** Tutta la partita su una mappa sola: dove eravate e dove avete tirato. */
function disegnaRiepilogo(storia) {
  if (!S.finalMap) {
    S.finalMap = L.map('finalmap', { worldCopyJump: true }).setView([20, 0], 2);
    L.tileLayer(TILES, { attribution: TILE_ATTR, maxZoom: 18, subdomains: 'abcd' }).addTo(S.finalMap);
  }
  if (S.finalLayer) S.finalMap.removeLayer(S.finalLayer);
  S.finalLayer = L.layerGroup().addTo(S.finalMap);

  const tutti = [];
  let migliore = null;

  storia.forEach((h, i) => {
    const truth = [h.truth.lat, h.truth.lng];
    tutti.push(truth);
    L.marker(truth, { icon: numIcon(i + 1) })
      .addTo(S.finalLayer)
      .bindTooltip(h.area ? `${h.area.name} (${h.area.country})` : `Round ${i + 1}`);

    (h.results || []).forEach((r, j) => {
      if (!r.guess) return;
      const g = [r.guess.lat, r.guess.lng];
      const col = r.colore || COLORI[j % COLORI.length];
      tutti.push(g);
      L.polyline([g, truth], {
        color: col, weight: 2, opacity: 0.55, dashArray: '4 6',
      }).addTo(S.finalLayer);
      L.circleMarker(g, {
        radius: 4, color: col, fillOpacity: 0.9, weight: 1,
      }).addTo(S.finalLayer).bindTooltip(`${r.avatar || ''} ${r.name} — ${fmtDist(r.distanceKm)}`);
      if (!migliore || r.distanceKm < migliore.distanzaKm) {
        migliore = { distanzaKm: r.distanceKm, punto: g, nome: r.name, round: i + 1 };
      }
    });
  });

  if (migliore) {
    L.circleMarker(migliore.punto, {
      radius: 13, color: '#ffd479', weight: 3, fill: false,
    }).addTo(S.finalLayer).bindTooltip(
      `Colpo migliore: ${migliore.nome}, ${fmtDist(migliore.distanzaKm)} al round ${migliore.round}`,
      { permanent: false }
    );
  }

  setTimeout(() => {
    S.finalMap.invalidateSize();
    if (tutti.length > 1) S.finalMap.fitBounds(L.latLngBounds(tutti).pad(0.2));
    else if (tutti.length) S.finalMap.setView(tutti[0], 5);
  }, 90);
}

/* ----------------------------------------------------------- foto ricordo
 *
 * Un'immagine da mandare su WhatsApp a fine partita: classifica, mappa
 * stilizzata dei round e colpo migliore. Si disegna tutta in locale su un
 * canvas — nessun servizio esterno, funziona anche senza rete — e si
 * condivide col foglio di condivisione del telefono quando c'e'.
 */

function arrotondato(x, px, py, w, h, r) {
  x.beginPath();
  x.moveTo(px + r, py);
  x.arcTo(px + w, py, px + w, py + h, r);
  x.arcTo(px + w, py + h, px, py + h, r);
  x.arcTo(px, py + h, px, py, r);
  x.arcTo(px, py, px + w, py, r);
  x.closePath();
}

function disegnaFoto(fin) {
  const W = 1080, H = 1350;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const F = (peso, px) => `${peso} ${px}px system-ui, -apple-system, "Segoe UI", sans-serif`;

  // sfondo: lo stesso buio del gioco, con l'alone verde in alto
  x.fillStyle = '#0b0e13';
  x.fillRect(0, 0, W, H);
  const alone = x.createRadialGradient(W / 2, 0, 60, W / 2, 0, 720);
  alone.addColorStop(0, 'rgba(63,185,80,.16)');
  alone.addColorStop(1, 'rgba(63,185,80,0)');
  x.fillStyle = alone;
  x.fillRect(0, 0, W, 720);

  // intestazione
  const storia = fin.history || [];
  x.textAlign = 'center';
  x.font = F(800, 62);
  x.fillStyle = '#e9eef5';
  x.fillText('\u{1F30D} GeoDuello', W / 2, 108);
  const quando = new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' });
  x.font = F(500, 29);
  x.fillStyle = '#8d9bb0';
  x.fillText(`${quando} · ${storia.length} round`, W / 2, 156);

  const primo = fin.standings[0];
  const pari = fin.standings.length > 1 && fin.standings[1].score === primo.score;
  x.font = F(800, 54);
  x.fillStyle = '#ffd479';
  x.fillText(pari ? 'Pareggio!' : `Vince ${primo.name}!`, W / 2, 236);

  // classifica
  const righe = fin.standings.slice(0, 6);
  const y0 = 288, rh = 76;
  righe.forEach((s, i) => {
    const y = y0 + i * rh;
    const vince = i === 0 && !pari;
    x.fillStyle = vince ? 'rgba(255,212,121,.10)' : 'rgba(255,255,255,.045)';
    arrotondato(x, 90, y, W - 180, 62, 14);
    x.fill();
    if (vince) {
      x.strokeStyle = 'rgba(255,212,121,.5)';
      x.lineWidth = 2;
      x.stroke();
    }
    x.textAlign = 'left';
    x.font = F(650, 33);
    x.fillStyle = '#e9eef5';
    x.fillText(['\u{1F947}', '\u{1F948}', '\u{1F949}'][i] || `${i + 1}.`, 112, y + 43);
    x.fillText(`${s.avatar || ''} ${s.name}`.trim(), 186, y + 43);
    x.textAlign = 'right';
    x.font = F(800, 35);
    x.fillStyle = vince ? '#ffd479' : '#3fb950';
    x.fillText(s.score.toLocaleString('it-IT'), W - 112, y + 44);
  });

  // mappa stilizzata dei round
  const mx = 90, my = y0 + righe.length * rh + 30;
  const mw = W - 180, mh = H - my - 170;
  x.fillStyle = '#10151c';
  arrotondato(x, mx, my, mw, mh, 18);
  x.fill();
  x.strokeStyle = '#2a3340';
  x.lineWidth = 2;
  x.stroke();

  const punti = [];
  storia.forEach((h) => {
    punti.push([h.truth.lat, h.truth.lng]);
    (h.results || []).forEach((r) => { if (r.guess) punti.push([r.guess.lat, r.guess.lng]); });
  });

  let migliore = null;
  if (punti.length) {
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
    for (const [la, lo] of punti) {
      minLat = Math.min(minLat, la); maxLat = Math.max(maxLat, la);
      minLng = Math.min(minLng, lo); maxLng = Math.max(maxLng, lo);
    }
    // un po' d'aria, e mai un'area degenere
    const pl = Math.max((maxLat - minLat) * 0.18, 1.2);
    const pg = Math.max((maxLng - minLng) * 0.18, 1.2);
    minLat -= pl; maxLat += pl; minLng -= pg; maxLng += pg;
    // stessa scala su entrambi gli assi, centrata nel riquadro
    const scala = Math.min(mw / (maxLng - minLng), mh / (maxLat - minLat));
    const ox = mx + (mw - (maxLng - minLng) * scala) / 2;
    const oy = my + (mh - (maxLat - minLat) * scala) / 2;
    const px = ([la, lo]) => [ox + (lo - minLng) * scala, oy + (maxLat - la) * scala];

    // graticola discreta
    const passo = (maxLng - minLng) > 90 ? 30 : (maxLng - minLng) > 20 ? 10 : 2;
    x.save();
    arrotondato(x, mx, my, mw, mh, 18);
    x.clip();
    x.strokeStyle = 'rgba(141,155,176,.12)';
    x.lineWidth = 1;
    for (let lo = Math.ceil(minLng / passo) * passo; lo < maxLng; lo += passo) {
      const [gx] = px([0, lo]);
      x.beginPath(); x.moveTo(gx, my); x.lineTo(gx, my + mh); x.stroke();
    }
    for (let la = Math.ceil(minLat / passo) * passo; la < maxLat; la += passo) {
      const [, gy] = px([la, 0]);
      x.beginPath(); x.moveTo(mx, gy); x.lineTo(mx + mw, gy); x.stroke();
    }

    // tiri: linea tratteggiata dal tiro al punto vero, nel colore del giocatore
    storia.forEach((h, i) => {
      const t = px([h.truth.lat, h.truth.lng]);
      (h.results || []).forEach((r, j) => {
        if (!r.guess) return;
        const g = px([r.guess.lat, r.guess.lng]);
        const col = r.colore || COLORI[j % COLORI.length];
        x.strokeStyle = col;
        x.globalAlpha = 0.55;
        x.lineWidth = 3;
        x.setLineDash([7, 9]);
        x.beginPath(); x.moveTo(g[0], g[1]); x.lineTo(t[0], t[1]); x.stroke();
        x.setLineDash([]);
        x.globalAlpha = 1;
        x.fillStyle = col;
        x.beginPath(); x.arc(g[0], g[1], 7, 0, Math.PI * 2); x.fill();
        if (!migliore || r.distanceKm < migliore.km) {
          migliore = { km: r.distanceKm, nome: r.name, round: i + 1, punto: g };
        }
      });
    });

    // punti veri: cerchio dorato numerato
    storia.forEach((h, i) => {
      const [tx, ty] = px([h.truth.lat, h.truth.lng]);
      x.fillStyle = '#ffd479';
      x.beginPath(); x.arc(tx, ty, 15, 0, Math.PI * 2); x.fill();
      x.fillStyle = '#06210c';
      x.textAlign = 'center';
      x.font = F(800, 20);
      x.fillText(String(i + 1), tx, ty + 7);
    });

    if (migliore) {
      x.strokeStyle = '#ffd479';
      x.lineWidth = 4;
      x.beginPath(); x.arc(migliore.punto[0], migliore.punto[1], 24, 0, Math.PI * 2); x.stroke();
    }
    x.restore();
  }

  // piede
  x.textAlign = 'center';
  if (migliore) {
    x.font = F(650, 31);
    x.fillStyle = '#e9eef5';
    x.fillText(`\u{1F3AF} Colpo migliore: ${migliore.nome}, ${fmtDist(migliore.km)} al round ${migliore.round}`,
      W / 2, H - 96);
  }
  x.font = F(500, 25);
  x.fillStyle = '#8d9bb0';
  x.fillText('La rivincita quando volete.', W / 2, H - 46);

  return c;
}

function apriFoto() {
  if (!S.ultimoFinale) return;
  let c;
  try { c = disegnaFoto(S.ultimoFinale); } catch (e) {
    annota('foto: ' + (e && e.message));
    toast('Non sono riuscito a disegnare la foto.');
    return;
  }
  S.fotoUrl = c.toDataURL('image/png');
  S.fotoBlob = null;
  c.toBlob((b) => { S.fotoBlob = b; }, 'image/png');
  $('foto-img').src = S.fotoUrl;
  $('foto').hidden = false;
}

function chiudiFoto() { $('foto').hidden = true; }

$('btn-foto').addEventListener('click', apriFoto);
$('btn-foto-close').addEventListener('click', chiudiFoto);
$('foto').addEventListener('click', (e) => { if (e.target === $('foto')) chiudiFoto(); });

$('btn-foto-save').addEventListener('click', () => {
  if (!S.fotoUrl) return;
  const a = document.createElement('a');
  a.href = S.fotoUrl;
  a.download = `geoduello-${new Date().toISOString().slice(0, 10)}.png`;
  a.click();
});

$('btn-foto-share').addEventListener('click', async () => {
  // Il foglio di condivisione con un file allegato c'e' solo su HTTPS e non
  // su tutti i browser: dove manca, si ripiega sullo scaricamento.
  try {
    if (S.fotoBlob && navigator.canShare) {
      const file = new File([S.fotoBlob], 'geoduello.png', { type: 'image/png' });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: 'GeoDuello' });
        return;
      }
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return; // ha chiuso lui il foglio
  }
  $('btn-foto-save').click();
  toast('Qui la condivisione diretta non c’è: la foto è stata scaricata.');
});

/* ------------------------------------------------------------- coriandoli */

/** Festa per chi vince: leggera, sopra tutto, e si pulisce da sola. */
function coriandoli() {
  if (CALMO) return; // chi chiede meno animazioni non vuole nemmeno questa
  const c = document.createElement('canvas');
  c.className = 'coriandoli';
  const dpr = Math.min(devicePixelRatio || 1, 2);
  c.width = innerWidth * dpr;
  c.height = innerHeight * dpr;
  document.body.appendChild(c);
  const x = c.getContext('2d');
  const COL = [...COLORI, '#ffd479', '#ffffff'];
  const pezzi = Array.from({ length: 130 }, () => ({
    px: Math.random() * c.width,
    py: -30 * dpr - Math.random() * c.height * 0.35,
    vx: (Math.random() - 0.5) * 2.4 * dpr,
    vy: (2.2 + Math.random() * 3.2) * dpr,
    r: (3 + Math.random() * 4.5) * dpr,
    a: Math.random() * Math.PI,
    va: (Math.random() - 0.5) * 0.25,
    col: COL[Math.floor(Math.random() * COL.length)],
  }));
  const inizio = performance.now();
  (function passo(t) {
    const vita = (t - inizio) / 2800;
    if (vita >= 1 || !c.isConnected) { c.remove(); return; }
    x.clearRect(0, 0, c.width, c.height);
    x.globalAlpha = Math.min(1, 3 * (1 - vita));
    for (const p of pezzi) {
      p.px += p.vx; p.py += p.vy; p.a += p.va;
      x.save();
      x.translate(p.px, p.py);
      x.rotate(p.a);
      x.fillStyle = p.col;
      x.fillRect(-p.r, -p.r / 2, p.r * 2, p.r);
      x.restore();
    }
    requestAnimationFrame(passo);
  })(inizio);
}

/* ------------------------------------------------------------ albo d'oro */

function renderAlbo(nodo, albo) {
  if (!nodo) return;
  if (!albo || !albo.giocatori || !albo.giocatori.length || !albo.partiteTotali) {
    nodo.hidden = true;
    return;
  }
  nodo.hidden = false;

  let html = '<h3>Testa a testa</h3>';

  if (albo.sfida && albo.sfida.partite) {
    const p = albo.sfida.punteggio;
    html += '<div class="sfida">' +
      p.map((x) => `<div class="lato"><b>${x.vittorie}</b><span>${escapeHtml(x.nome)}</span></div>`)
        .join('<div class="trattino">–</div>') +
      `</div><p class="sub sfida-sub">${albo.sfida.partite} partite giocate insieme</p>`;
  }

  html += '<div class="schede">';
  for (const g of albo.giocatori) {
    const righe = [
      `${g.vittorie} vittorie su ${g.partite}`,
      `media ${g.mediaPunti.toLocaleString('it-IT')} punti`,
    ];
    if (g.migliorTiroKm != null) righe.push(`miglior tiro ${fmtDist(g.migliorTiroKm)}`);
    if (g.strisciaAttuale >= 2) righe.push(`${g.strisciaAttuale} vittorie di fila`);
    if (g.forte) righe.push(`forte in <b>${escapeHtml(g.forte.zona)}</b> (${g.forte.media})`);
    if (g.debole) righe.push(`debole in <b>${escapeHtml(g.debole.zona)}</b> (${g.debole.media})`);
    html += `<div class="scheda"><b>${escapeHtml(g.nome)}</b>` +
      righe.map((r) => `<span>${r}</span>`).join('') + '</div>';
  }
  html += '</div>';

  nodo.innerHTML = html;
}

/* ------------------------------------------------------------- home UI */

let optScope = 'mondo';
let optRounds = 5;
let optTimer = 120;

function bindChips(containerId, onPick) {
  els(`#${containerId} .chip`).forEach((chip) => {
    chip.addEventListener('click', () => {
      const box = $(containerId);
      if (box.classList.contains('locked')) return;
      els(`#${containerId} .chip`).forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      onPick(chip.dataset.v);
    });
  });
}

bindChips('opt-scope', (v) => (optScope = v));
bindChips('opt-rounds', (v) => (optRounds = +v));
bindChips('opt-timer', (v) => (optTimer = +v));
bindChips('lob-scope', (v) => send({ type: 'settings', scope: v }));
bindChips('lob-rounds', (v) => send({ type: 'settings', rounds: +v }));
bindChips('lob-timer', (v) => send({ type: 'settings', timer: +v }));
bindChips('lob-crescendo', (v) => send({ type: 'settings', crescendo: v === '1' }));

els('.tab').forEach((t) => {
  t.addEventListener('click', () => {
    els('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    els('.tabpanel').forEach((p) => p.classList.remove('active'));
    $(`tab-${t.dataset.tab}`).classList.add('active');
  });
});

function readName() {
  const n = $('in-name').value.trim();
  if (!n) {
    $('home-err').textContent = 'Scrivi il tuo nome.';
    $('home-err').hidden = false;
    $('in-name').focus();
    return null;
  }
  $('home-err').hidden = true;
  S.name = n;
  salvaGate($('in-gate').value);
  localStorage.setItem('gd_name', n);
  return n;
}

$('btn-create').addEventListener('click', () => {
  if (!readName()) return;
  connect(() => send({
    type: 'create', name: S.name, gate: S.gate,
    scope: optScope, rounds: optRounds, timer: optTimer,
  }));
});

$('btn-join').addEventListener('click', () => {
  if (!readName()) return;
  const code = $('in-code').value.trim().toUpperCase();
  if (code.length !== 4) {
    $('home-err').textContent = 'Il codice ha 4 caratteri.';
    $('home-err').hidden = false;
    return;
  }
  S.code = code;
  connect(() => send({ type: 'join', code, name: S.name, playerId: S.playerId, gate: S.gate }));
});

$('in-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-join').click(); });
$('in-name').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  ($('tab-entra').classList.contains('active') ? $('btn-join') : $('btn-create')).click();
});

/* ------------------------------------------------------------ lobby UI */

$('btn-copy').addEventListener('click', async () => {
  const link = $('lobby-link').value;
  try {
    await navigator.clipboard.writeText(link);
    toast('Link copiato');
  } catch {
    $('lobby-link').select();
    toast('Premi Ctrl+C per copiare');
  }
});

$('btn-start').addEventListener('click', () => send({ type: 'start' }));
$('btn-next').addEventListener('click', () => send({ type: 'next' }));
$('btn-again').addEventListener('click', () => send({ type: 'lobby' }));

function leave() {
  // L'uscita col pulsante e' esplicita: lo si dice al server, che toglie
  // subito dalla stanza. Un collegamento che cade e basta, invece, viene
  // aspettato: e' la differenza fra "esco" e "torno tra un attimo".
  send({ type: 'leave' });
  S.wantOpen = false;
  if (S.ws) S.ws.close();
  S.ws = null; S.room = null; S.code = null;
  clearInterval(S.tickHandle);
  history.replaceState(null, '', '/');
  show('screen-home');
}
$('btn-leave').addEventListener('click', leave);
$('btn-leave2').addEventListener('click', leave);

/* ------------------------------------------------------------- gioco UI */

/**
 * Invia (o reinvia dopo una riconnessione) la bandierina finche` il server non
 * la conferma. La stessa scelta e` idempotente lato server: una rete mobile
 * che cade nel momento del tocco non puo` piu` trasformare una risposta in 0.
 */
function inviaGuessPendente() {
  const p = S.pendingGuess;
  if (!p || S.confirmed || S.screen !== 'screen-play') return;
  if (S.round && p.roundIndex !== S.round.roundIndex) return;

  const partita = send({
    type: 'guess',
    lat: p.lat,
    lng: p.lng,
    roundIndex: p.roundIndex,
    guessId: p.guessId,
  });
  $('btn-confirm').disabled = true;
  $('btn-confirm').textContent = partita ? 'Invio…' : 'Riconnessione…';
  $('waiting').hidden = false;
  $('waiting-txt').textContent = partita
    ? 'Confermo la scelta col server…'
    : 'Connessione assente: tengo la scelta e riprovo…';
  $('countdown').hidden = true;

  clearTimeout(S.guessSendTimer);
  S.guessSendTimer = setTimeout(() => {
    if (!S.pendingGuess || S.confirmed) return;
    riaggancia();
    inviaGuessPendente();
  }, 1800);
}

function riceviGuessAck(msg) {
  const roundIndex = Number(msg.roundIndex);
  const corrente = S.round ? Number(S.round.roundIndex) : roundIndex;
  if (Number.isFinite(roundIndex) && Number.isFinite(corrente) && roundIndex !== corrente) return;
  if (!S.pendingGuess && S.screen !== 'screen-play') return;
  if (msg.accepted && S.confirmed && !S.pendingGuess) return;

  if (!msg.accepted) {
    clearTimeout(S.guessSendTimer);
    S.pendingGuess = null;
    S.confirmed = false;
    $('waiting').hidden = true;
    $('btn-confirm').disabled = !S.guess;
    $('btn-confirm').textContent = S.guess ? 'Riprova la conferma' : 'Metti il segnalino';
    toast('Il server non ha accettato la scelta: riprova.');
    return;
  }

  const eraPendente = !!S.pendingGuess;
  clearTimeout(S.guessSendTimer);
  S.pendingGuess = null;
  S.confirmed = true;
  $('btn-confirm').disabled = true;
  $('btn-confirm').textContent = 'Scelta inviata';
  $('waiting').hidden = false;
  $('countdown').hidden = true;
  if (eraPendente && S.screen === 'screen-play') Suoni.conferma();

  clearTimeout(S.forceTimer);
  $('btn-force').hidden = true;
  S.forceTimer = setTimeout(() => {
    if (S.screen === 'screen-play' && S.confirmed) $('btn-force').hidden = false;
  }, 12000);
}

$('btn-confirm').addEventListener('click', () => {
  if (S.confirmed || S.pendingGuess || !S.guess) return;
  const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  S.pendingGuess = {
    lat: S.guess.lat,
    lng: S.guess.lng,
    roundIndex: S.round?.roundIndex,
    guessId: id,
  };
  inviaGuessPendente();
});

$('btn-force').addEventListener('click', () => {
  $('btn-force').hidden = true;
  send({ type: 'force' });
});

function toggleMap(force) {
  const box = $('guessbox');
  const big = force === undefined ? !box.classList.contains('big') : force;
  box.classList.toggle('big', big);
  $('btn-mapsize').textContent = big ? 'Riduci' : 'Ingrandisci';
  // Leaflet ridisegna solo se gli si dice che il contenitore e' cambiato,
  // e va fatto a transizione finita.
  setTimeout(() => S.miniMap && S.miniMap.invalidateSize(), 220);
}

$('btn-mapsize').addEventListener('click', () => toggleMap());

function aggiornaSuoni() {
  const on = Suoni.acceso;
  $('btn-sound').textContent = on ? '\u{1F50A}' : '\u{1F507}';
  $('btn-sound2').textContent = on ? '\u{1F50A} Suoni attivi' : '\u{1F507} Suoni spenti';
}
for (const id of ['btn-sound', 'btn-sound2']) {
  $(id).addEventListener('click', () => { Suoni.accendi(!Suoni.acceso); aggiornaSuoni(); });
}
// I browser creano l'audio solo dopo un gesto dell'utente: il primo clic
// qualunque esso sia serve a svegliarlo.
document.addEventListener('pointerdown', () => Suoni.sveglia(), { once: true });
aggiornaSuoni();

/**
 * Aiutino. Costa il 30% dei punti del round, quindi non deve poter partire
 * per sbaglio: il primo tocco avverte, il secondo conferma.
 */
$('btn-aiutino').addEventListener('click', () => {
  const b = $('btn-aiutino');
  if (b.classList.contains('usato')) return;
  if (!b.classList.contains('conferma')) {
    b.classList.add('conferma');
    b.textContent = 'Sicuro? costa il 30%';
    clearTimeout(S.aiutinoTimer);
    S.aiutinoTimer = setTimeout(() => {
      b.classList.remove('conferma');
      b.textContent = '\u{1F4A1} Aiutino';
    }, 5000);
    return;
  }
  clearTimeout(S.aiutinoTimer);
  send({ type: 'aiutino' });
});

/* ------------------------------------------------------------ help in linea
 *
 * Le regole del gioco stanno tutte qui dentro, raggiungibili da ogni schermata
 * senza uscire dalla partita. Si apre da solo la prima volta che si arriva in
 * lobby — quando non c'e' nessun cronometro che corre — e mai piu' dopo:
 * chi ha gia' giocato non deve trovarselo davanti a ogni partita.
 */

const HELP_VISTO = 'gd_help_visto';

function helpGiaVisto() {
  try { return localStorage.getItem(HELP_VISTO) === '1'; } catch { return false; }
}

function apriHelp({ primaVolta = false } = {}) {
  const h = $('help');
  if (!h) return;
  $('help-benvenuto').hidden = !primaVolta;
  // Aprirlo durante un round non mette la partita in pausa: meglio dirlo.
  $('help-nota').hidden = !(S.screen === 'screen-play' && S.deadline && !S.confirmed);
  $('btn-help-ok').textContent = primaVolta ? 'Giochiamo' : 'Ho capito';
  h.hidden = false;
  el('.help-card', h).scrollTop = 0;
  try { localStorage.setItem(HELP_VISTO, '1'); } catch { /* niente memoria: pazienza */ }
}

function chiudiHelp() {
  const h = $('help');
  if (h) h.hidden = true;
}

els('.apri-help').forEach((b) => b.addEventListener('click', () => apriHelp()));
$('btn-help-close').addEventListener('click', chiudiHelp);
$('btn-help-ok').addEventListener('click', chiudiHelp);
// clic fuori dal riquadro: chiude, come ci si aspetta da un pannello sovrapposto
$('help').addEventListener('click', (e) => { if (e.target === $('help')) chiudiHelp(); });

/**
 * Questo ascolto deve stare PRIMA di quello dei comandi di gioco: a pannello
 * aperto ferma la propagazione, cosi` le frecce non fanno camminare qualcuno
 * mentre sta leggendo.
 */
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (!$('foto').hidden) {
    e.stopImmediatePropagation();
    if (e.key === 'Escape') chiudiFoto();
    return;
  }
  if (!$('help').hidden) {
    e.stopImmediatePropagation();
    if (['Escape', '?', 'h', 'H'].includes(e.key)) chiudiHelp();
    return;
  }
  if (e.key === '?' || e.key === 'h' || e.key === 'H') apriHelp();
});

$('btn-fwd').addEventListener('click', () => panoMove(true));
$('btn-back').addEventListener('click', () => panoMove(false));

/**
 * Safari su iOS espone anche gesture proprie. Durante il round vanno fermate
 * perche` la pinzata appartiene al panorama o alla mappa; fuori dal gioco lo
 * zoom della pagina resta invece disponibile per l'accessibilita`.
 *
 * Gli eventi gesture* sono la sola leva che Safari offre per impedirlo. Non
 * toccano i touchmove, quindi la pinzata continua a zoomare il panorama e la
 * mappa, che e' quello che serve.
 */
// In FASE DI CATTURA, non in bolla: MapillaryJS e Leaflet fermano la
// propagazione dei gesti, quindi un ascolto normale non li vedeva mai
// arrivare. E` probabilmente il motivo per cui questa difesa non funzionava.
for (const tipo of ['gesturestart', 'gesturechange', 'gestureend']) {
  document.addEventListener(tipo, (e) => {
    if (S.screen === 'screen-play') e.preventDefault();
  }, { passive: false, capture: true });
}
// Col mouse il doppio clic equivale al doppio tocco e ripristina il panorama.
document.addEventListener('dblclick', (e) => {
  if (S.screen !== 'screen-play' || !e.target.closest?.('#pano')) return;
  e.preventDefault();
  resetVista();
  toast('Visuale rimessa a posto');
}, { passive: false, capture: true });

/**
 * Rete di sicurezza per i browser che ignorano tutto il resto: se due dita si
 * appoggiano fuori dalle zone che gestiscono i gesti da sole (il panorama e le
 * mappe), la pinzata viene annullata sul nascere.
 */
document.addEventListener('touchmove', (e) => {
  if (S.screen !== 'screen-play') return;
  if (e.touches.length < 2) return;
  if (e.target.closest && e.target.closest('#pano, .leaflet-container')) return;
  e.preventDefault();
}, { passive: false, capture: true });

/**
 * Rimette la pagina alla scala giusta. Non esiste un'API per azzerare lo zoom
 * del browser, ma riscrivere il meta viewport costringe Safari a rifare i
 * conti: e' la via d'uscita per chi si e' gia' incastrato.
 */
function sbloccaPagina() {
  const vp = $('viewport');
  if (!vp) return;
  // Una breve variante forza Safari a rifare i conti; subito dopo si ripristina
  // il viewport accessibile usato nel resto dell'app.
  const libero = 'width=device-width, initial-scale=1, viewport-fit=cover';
  vp.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, minimum-scale=1');
  setTimeout(() => vp.setAttribute('content', libero), 60);
  window.scrollTo(0, 0);
  document.documentElement.scrollLeft = 0;
  document.documentElement.scrollTop = 0;
}

/** Riporta tutto a com'era: zoom della pagina, zoom del panorama, inquadratura. */
async function resetVista({ tornaAlPunto = false } = {}) {
  sbloccaPagina();
  if (!S.viewer) return;
  try { S.viewer.setZoom(0); } catch { /* niente zoom da azzerare */ }
  try { S.viewer.setCenter([0.5, 0.5]); } catch { /* gia` centrata */ }
  if (tornaAlPunto && S.startImageId) {
    try { await S.viewer.moveTo(S.startImageId); } catch { /* immagine sparita */ }
  }
  vigilaZoom();
}

/**
 * Sorveglia lo zoom della pagina. Se nonostante tutto qualcuno ci finisce
 * dentro, compare un pulsante che riporta tutto a posto — e si riposiziona da
 * solo per restare dentro la porzione di schermo effettivamente visibile,
 * altrimenti sarebbe fuori portata proprio quando serve.
 */
(function sorvegliaZoomPagina() {
  const vv = window.visualViewport;
  const btn = $('btn-sblocca');
  if (!vv || !btn) return;

  const controlla = () => {
    const zoomata = vv.scale > 1.05;
    btn.hidden = !zoomata;
    if (!zoomata) return;
    // compensa scala e spostamento della finestra visibile
    btn.style.transform =
      `translate(calc(-50% + ${vv.offsetLeft}px), ${vv.offsetTop - (vv.height * (vv.scale - 1)) / vv.scale}px) ` +
      `scale(${1 / vv.scale})`;
  };

  const ridisegnaMappe = () => {
    for (const m of [S.miniMap, S.revealMap, S.finalMap]) {
      try { m && m.invalidateSize(); } catch { /* non ancora pronta */ }
    }
  };
  vv.addEventListener('resize', () => { controlla(); setTimeout(ridisegnaMappe, 120); });
  vv.addEventListener('scroll', controlla);
  window.addEventListener('orientationchange', () => setTimeout(ridisegnaMappe, 250));
  window.addEventListener('pageshow', () => setTimeout(ridisegnaMappe, 120));
  btn.addEventListener('click', () => {
    sbloccaPagina();
    btn.hidden = true;
    setTimeout(() => {
      controlla();
      if (!btn.hidden) toast('Se resta bloccato ricarica la pagina: rientri nella partita da solo.', 6000);
    }, 500);
  });
  controlla();
})();

/**
 * Doppio tocco sul panorama: rimette tutto a posto senza cercare pulsanti.
 * Una pinzata produce due pointerup quasi simultanei: il vecchio contatore la
 * scambiava per un doppio tocco e azzerava proprio lo zoom appena richiesto.
 */
(function doppioTocco() {
  const pano = $('pano');
  const attivi = new Set();
  let gesto = null;
  let ultimo = null;

  pano.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    if (!attivi.size) gesto = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), multiplo: false, mosso: false };
    attivi.add(e.pointerId);
    if (attivi.size > 1 && gesto) gesto.multiplo = true;
  });
  pano.addEventListener('pointermove', (e) => {
    if (!gesto || e.pointerId !== gesto.id) return;
    if (Math.hypot(e.clientX - gesto.x, e.clientY - gesto.y) > 14) gesto.mosso = true;
  });
  const fine = (e) => {
    if (e.pointerType === 'mouse') return;
    const eraPrimo = gesto && e.pointerId === gesto.id;
    const singolo = e.type === 'pointerup' && eraPrimo && attivi.size === 1
      && !gesto.multiplo && !gesto.mosso && Date.now() - gesto.t < 300;
    attivi.delete(e.pointerId);

    if (singolo) {
      const tap = { x: e.clientX, y: e.clientY, t: Date.now() };
      if (ultimo && tap.t - ultimo.t < 340 && Math.hypot(tap.x - ultimo.x, tap.y - ultimo.y) < 34) {
        ultimo = null;
        resetVista();
        toast('Visuale rimessa a posto');
      } else {
        ultimo = tap;
      }
    } else if (gesto?.multiplo) {
      ultimo = null;
    }
    if (!attivi.size) gesto = null;
  };
  pano.addEventListener('pointerup', fine);
  pano.addEventListener('pointercancel', fine);
})();

$('btn-zoomout').addEventListener('click', async () => {
  if (!S.viewer) return;
  let z = 0;
  try { z = await Promise.resolve(S.viewer.getZoom()); } catch { /* si azzera e basta */ }
  // Un gradino per volta, cosi` non si perde l'orientamento di colpo.
  try { S.viewer.setZoom(Math.max(0, (typeof z === 'number' ? z : 1) - 1)); } catch { /* ignora */ }
  vigilaZoom();
});

/** Accende il pulsante dello zoom quando serve davvero. */
async function vigilaZoom() {
  if (!S.viewer) return;
  try {
    const z = await Promise.resolve(S.viewer.getZoom());
    $('btn-zoomout').classList.toggle('attivo', typeof z === 'number' && z > 0.05);
  } catch { /* nessuna informazione: si lascia com'e` */ }
}

document.addEventListener('keydown', (e) => {
  if (S.screen !== 'screen-play') return;
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'm' || e.key === 'M') toggleMap();
  if (e.key === 'Escape') toggleMap(false);
  if (e.key === 'Enter' && !$('btn-confirm').disabled) $('btn-confirm').click();
  if (e.key === 'ArrowUp' || e.key === 'w') { e.preventDefault(); panoMove(true); }
  if (e.key === 'ArrowDown' || e.key === 's') { e.preventDefault(); panoMove(false); }
  if (e.key === '-' || e.key === '_') $('btn-zoomout').click();
  if (e.key === '0') resetVista();
});

$('btn-home-pano').addEventListener('click', () => resetVista({ tornaAlPunto: true }));

const chiediFullscreen = document.documentElement.requestFullscreen
  || document.documentElement.webkitRequestFullscreen;
const esciFullscreen = document.exitFullscreen || document.webkitExitFullscreen;
if (!chiediFullscreen || matchMedia('(display-mode: standalone)').matches) {
  $('btn-fs').hidden = true;
} else {
  $('btn-fs').addEventListener('click', () => {
    const attivo = document.fullscreenElement || document.webkitFullscreenElement;
    const operazione = attivo ? esciFullscreen?.call(document) : chiediFullscreen.call(document.documentElement);
    Promise.resolve(operazione).catch(() => toast('Schermo intero non disponibile.'));
  });
}

// su touch la minimappa e' opaca finche' non la tocchi
$('guessbox').addEventListener('touchstart', () => $('guessbox').classList.add('touched'), { passive: true });

/* ------------------------------------------------ app sulla schermata home */

// Il service worker serve anche solo a rendere il gioco installabile.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const src = document.querySelector('script[src*="app.js"]')?.src;
    const versione = src ? new URL(src).searchParams.get('v') : '';
    navigator.serviceWorker.register(`sw.js${versione ? `?v=${encodeURIComponent(versione)}` : ''}`)
      .catch(() => { /* pazienza */ });
  });
}

// Android e desktop: il browser ci avvisa quando l'installazione e` possibile,
// e va offerta con un gesto nostro.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  S.invitoInstalla = e;
  $('btn-installa').hidden = false;
});
window.addEventListener('appinstalled', () => { $('btn-installa').hidden = true; });

$('btn-installa').addEventListener('click', async () => {
  const p = S.invitoInstalla;
  if (!p) return;
  $('btn-installa').hidden = true;
  S.invitoInstalla = null;
  try { await p.prompt(); } catch { /* rifiutato */ }
});

/* ---------------------------------------------------------------- avvio */

(async function init() {
  $('in-name').value = S.name;

  try {
    const cfg = await (await fetch('/api/config')).json();
    S.lanUrls = Array.isArray(cfg.lanUrls) ? cfg.lanUrls : [];
    // L'impronta della versione servita: se dopo un aggiornamento resta
    // quella di prima, il problema e` la cache del browser, non il server.
    if (cfg.versione) $('help-versione').textContent = `versione ${cfg.versione}`;

    // Auto-guarigione: se questo script NON e` la versione che il server sta
    // servendo, qualche cache ha trattenuto il codice vecchio — grafica nuova
    // con logica vecchia, pulsanti disegnati ma sordi. Un ricaricamento
    // risolve (la pagina fresca punta agli indirizzi nuovi); il segnalibro in
    // sessionStorage evita di girare in tondo se il guaio persiste.
    try {
      const mia = new URL(document.querySelector('script[src*="app.js"]').src, location.href)
        .searchParams.get('v');
      if (cfg.versione && mia && mia !== cfg.versione
          && sessionStorage.getItem('gd_ricarica') !== cfg.versione) {
        sessionStorage.setItem('gd_ricarica', cfg.versione);
        location.reload();
        return;
      }
    } catch { /* niente confronto possibile: si va avanti */ }
    if (cfg.gated) $('gate-wrap').hidden = false;
    if (!cfg.hasToken) {
      $('home-warn').hidden = false;
      $('home-warn').textContent =
        'Il server non ha ancora un token Mapillary: le partite non possono partire. ' +
        'Metti MAPILLARY_TOKEN nel file .env e riavvia.';
    }
  } catch { /* offline: pazienza */ }

  const par = new URLSearchParams(location.search);

  // Parola d'ordine arrivata col link d'invito: si mette da parte e si toglie
  // subito dall'indirizzo, cosi` non resta in bella vista nella barra del
  // browser ne' nella cronologia condivisa. Il ricaricamento la ritrova.
  const p = par.get('p');
  if (p) {
    salvaGate(p);
    $('in-gate').value = p;
    par.delete('p');
    const pulito = location.pathname + (par.toString() ? `?${par}` : '') + location.hash;
    try { history.replaceState(null, '', pulito); } catch { /* pazienza */ }
  } else {
    S.gate = gateSalvato() || S.gate;
    if (S.gate) $('in-gate').value = S.gate;
  }

  const c = par.get('c');
  if (!c || !/^[A-Za-z0-9]{4}$/.test(c)) return;

  const codice = c.toUpperCase();
  els('.tab').forEach((x) => x.classList.remove('active'));
  el('.tab[data-tab=entra]').classList.add('active');
  els('.tabpanel').forEach((p) => p.classList.remove('active'));
  $('tab-entra').classList.add('active');
  $('in-code').value = codice;

  // Se sappiamo gia` chi sei e in che stanza eri, si rientra da soli: e`
  // quello che serve quando ricaricare la pagina e` l'unico modo per uscire da
  // un guaio. Ricaricare non deve mai costare la partita.
  if (S.name && S.playerId) {
    S.gate = S.gate || gateSalvato();
    S.code = codice;
    S.rientroAutomatico = true;
    $('loading-txt').textContent = 'Rientro nella partita…';
    show('screen-loading');
    connect(() => send({
      type: 'join', code: codice, name: S.name, playerId: S.playerId, gate: S.gate,
    }));
    // se il server non risponde, si torna alla schermata iniziale
    setTimeout(() => {
      if (S.rientroAutomatico && !S.room) { S.rientroAutomatico = false; show('screen-home'); }
    }, 6000);
    return;
  }

  if (!S.name) $('in-name').focus();
})();

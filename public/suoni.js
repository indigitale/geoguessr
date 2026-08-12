'use strict';

/**
 * Suoni generati dal browser: nessun file da scaricare, nessuna dipendenza.
 * L'AudioContext nasce al primo tocco dell'utente, come impongono i browser.
 */
const Suoni = (() => {
  let ctx = null;
  let acceso = localStorage.getItem('gd_audio') !== '0';

  function contesto() {
    if (!acceso) return null;
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }

  /** Una nota semplice: forma d'onda, frequenza, durata, volume. */
  function nota(freq, dur = 0.12, tipo = 'sine', vol = 0.18, ritardo = 0) {
    const c = contesto();
    if (!c) return;
    const t0 = c.currentTime + ritardo;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = tipo;
    osc.frequency.setValueAtTime(freq, t0);
    // attacco e rilascio morbidi: senza, si sentono i "clic" agli estremi
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function vibra(ms) {
    try { navigator.vibrate && navigator.vibrate(ms); } catch { /* non supportata */ }
  }

  return {
    get acceso() { return acceso; },
    accendi(v) {
      acceso = !!v;
      localStorage.setItem('gd_audio', acceso ? '1' : '0');
      if (acceso) nota(660, 0.09, 'sine', 0.14);
    },
    sveglia() { contesto(); },

    /** Segnalino piazzato sulla mappa. */
    tic() { nota(880, 0.05, 'triangle', 0.12); },

    /** Scelta confermata. */
    conferma() { nota(523, 0.09, 'sine', 0.15); nota(784, 0.12, 'sine', 0.13, 0.08); vibra(18); },

    /** Un gradino del contatore dei punti. */
    scatto(i) { nota(420 + Math.min(i, 24) * 22, 0.035, 'square', 0.045); },

    /** Il punto giusto compare sulla mappa. */
    rivela() { nota(300, 0.16, 'sine', 0.16); nota(450, 0.2, 'sine', 0.12, 0.06); },

    /** Tiro molto vicino. */
    fanfara() {
      [523, 659, 784, 1047].forEach((f, i) => nota(f, 0.22, 'triangle', 0.16, i * 0.09));
      vibra([25, 40, 25]);
    },

    /** L'avversario ha piazzato la bandiera. */
    bandiera() { nota(700, 0.07, 'triangle', 0.16); nota(980, 0.1, 'triangle', 0.14, 0.07); vibra(30); },

    /** Battito del conto alla rovescia: piu` acuto e insistente sul finale. */
    bip(finale) {
      nota(finale ? 1100 : 760, finale ? 0.13 : 0.07, 'square', finale ? 0.17 : 0.1);
      if (finale) vibra(35);
    },

    /** Nessuna risposta, o tiro pessimo. */
    tonfo() { nota(150, 0.25, 'sawtooth', 0.1); },

    /** Vittoria finale. */
    trionfo() {
      [523, 659, 784, 1047, 1319].forEach((f, i) => nota(f, 0.3, 'triangle', 0.15, i * 0.11));
      vibra([30, 50, 30, 50, 60]);
    },
  };
})();

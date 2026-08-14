# GeoDuello

Un GeoGuessr di famiglia, da due a otto giocatori, senza registrazione: chi crea
la partita ottiene un codice di quattro lettere e un QR, gli altri inquadrano
col telefono ed entrano. Le immagini vengono da **Mapillary**, la copertura
stradale collaborativa: nessuna chiave Google, nessun costo a consumo.

Funziona da telefono e da computer, si può aggiungere alla schermata home come
un'app, e tiene il conto delle vostre partite nel tempo.

---

## Indice

1. [Preparazione](#1-preparazione)
2. [Avvio e come raggiungerlo](#2-avvio-e-come-raggiungerlo)
3. [Come si gioca](#3-come-si-gioca)
4. [L'albo d'oro](#4-lalbo-doro)
5. [Metterlo online](#5-metterlo-online)
6. [Quando qualcosa non va](#6-quando-qualcosa-non-va)
7. [Com'è fatto dentro](#7-comè-fatto-dentro)

---

## 1. Preparazione

Serve Node 18 o più recente (`node -v` per controllare; se manca, `brew install
node` oppure l'installer da nodejs.org).

### Il token Mapillary

Si fa una volta sola e senza carta di credito.

1. Registrati su <https://www.mapillary.com>.
2. Vai su <https://www.mapillary.com/dashboard/developers>, **Register
   application**, nome a piacere.
3. Apri l'applicazione e copia il **Client token**: comincia con `MLY|`.

Attenzione: la dashboard mostra più di un token e **non sono equivalenti**.
Serve quello che può leggere anche le singole immagini, non solo le mappe. Se
sbagli, il gioco trova le località ma il panorama resta nero — e il controllo
qui sotto te lo dice esplicitamente.

Copia `.env.example` in `.env` e incolla il token:

```
MAPILLARY_TOKEN=MLY|...
```

Poi:

```bash
npm install
node scripts/check-mapillary.js
```

Il controllo verifica il token su entrambe le strade che il gioco usa (le mappe
di copertura e la lettura delle foto), sonda cinque città e pesca una località
per ogni ambito, stampando il link per andarla a vedere. Se arriva in fondo,
funziona anche il gioco.

## 2. Avvio e come raggiungerlo

```bash
npm start
```

All'avvio il server stampa da solo dove trovarlo:

```
  GeoDuello è in ascolto.
    su questo computer   http://localhost:3000
    dai telefoni in wifi http://192.168.1.42:3000
```

**Apri il gioco dall'indirizzo wifi**, non da `localhost`: la lobby mostrerà un
QR che gli altri inquadrano con la fotocamera, entrando senza digitare niente.
Se apri comunque `localhost`, il link d'invito e il QR usano automaticamente
l'indirizzo di rete, perché `localhost` sul telefono non porterebbe da nessuna
parte.

La prima volta macOS chiede se consentire connessioni in entrata a `node`:
rispondi di sì, altrimenti i telefoni non arrivano.

**Aggiungilo alla schermata home**: dal menu del browser sul telefono, "Aggiungi
a Home". Si apre a tutto schermo, senza barra degli indirizzi, e si guadagna
spazio prezioso. Su Android compare direttamente un pulsante in lobby.

Il terminale con `npm start` deve restare aperto: è lui il server.

## 3. Come si gioca

Chi crea la stanza decide zona, numero di round, tempo e andamento. Ogni
giocatore sceglie il proprio simbolo, che diventa il suo segnalino sulla mappa.

Ogni round mostra un punto a caso della copertura Mapillary. Ci si guarda
attorno trascinando col dito o col mouse, e si cammina con i pulsanti **↑ ↓** a
sinistra (o con le frecce della tastiera): **↑ va sempre dove stai guardando**,
quindi se ti giri, "avanti" cambia significato insieme a te. Se da quella parte
non c'è nessuna foto il gioco te lo dice, invece di portarti da un'altra parte.
Il **−** allontana la visuale se ci si è zoomati dentro e il **⌂** riporta al
punto di partenza; poi si mette il segnalino sulla mappa in basso. Da tastiera:
**M** ingrandisce la mappa, **Invio** conferma, **0** rimette la visuale a
posto.

**Le regole stanno dentro il gioco.** Il **?** in alto a destra — e "Come si
gioca" in home e in lobby — apre un pannello con i comandi, il punteggio,
l'aiutino e le vie d'uscita quando qualcosa si inceppa. Alla primissima partita
si apre da solo, ma in lobby: mai durante un round, dove costerebbe secondi.
Poi non si fa più vedere, a meno di chiamarlo.

Il round si chiude quando hanno risposto tutti. Appena il primo piazza la
bandiera, agli altri restano **trenta secondi** — negli ultimi dieci compare un
numerone al centro dello schermo con un bip a ogni secondo. Se qualcuno perde il
collegamento, il gioco lo aspetta venticinque secondi prima di proseguire senza
di lui; e se resta piantato, chi ha già risposto può chiudere il round a mano.

**Punteggio**: 5000 punti se ci si azzecca in pieno, poi calo esponenziale con la
distanza, come su GeoGuessr. La scala segue l'ambito del round, quindi in Italia
sbagliare di 300 km costa molto più che nel Mondo.

**Equilibrio.** In lobby si può dare un vantaggio a chi è più in difficoltà —
pari, +15%, +30%, +50% — che allarga la sua scala di punteggio. Si vede solo in
lobby, mai durante la partita. Durante il round c'è poi l'**aiutino**: rivela il
continente (o l'area d'Europa, o la zona d'Italia) in cambio del 30% dei punti
di quel round. Un tocco avverte, il secondo conferma.

**Andamento in crescendo**: i primi round in Italia, quelli di mezzo in Europa,
l'ultimo nel mondo. E se finite a pari punti scatta uno **spareggio**: un round
secco fra chi è in testa, vince chi va più vicino.

Alla fine, una mappa con tutti i round giocati, i vostri tiri collegati al punto
giusto e un cerchio dorato sul colpo migliore della partita. Da lì il pulsante
**📸 Foto ricordo** disegna un'immagine con classifica, mappa dei round e colpo
migliore, pronta per WhatsApp: si genera tutta sul dispositivo, senza servizi
esterni. E per chi vince, coriandoli (rispettando chi ha chiesto al sistema
meno animazioni).

## 4. L'albo d'oro

È l'unica cosa che il gioco scrive su disco, e l'unica che non si può
ricostruire: `data/albo.json`. Contiene vittorie, medie, record personali, il
tiro più vicino di sempre di ciascuno, le strisce di vittorie e le statistiche
per zona del mondo — che dopo qualche partita dicono in che continente sei forte
e dove crolli.

Le copie di sicurezza sono automatiche: a ogni fine partita una copia datata
finisce in `data/storico/` (si tengono le ultime due settimane) e un riassunto
leggibile in `data/albo.txt`, che si apre con qualsiasi editor anche senza il
gioco.

Per portarne via una copia dove vuoi tu:

```bash
npm run albo                              # stampa il riassunto a schermo
node scripts/albo-backup.js ~/Documents/GeoDuello   # ne salva una copia lì
```

Dal browser: `/api/albo` scarica il JSON, `/api/albo.txt` il riassunto. Se hai
impostato una parola d'ordine, aggiungi `?gate=laTuaParola`.

**Consiglio**: una volta ogni tanto lancia il comando di copia verso una cartella
sincronizzata o un disco esterno. Il resto del progetto si riscarica, la vostra
storia no.

## 5. Metterlo online

Serve solo se volete giocare anche fuori casa. In casa, sul wifi, non serve
niente.

- Hai un **server tuo** (Proxmox, NAS, una macchina sempre accesa)?
  → **[PROXMOX.md](PROXMOX.md)**: container LXC, servizio systemd e le
  configurazioni pronte per Nginx, Caddy, Traefik e Nginx Proxy Manager. È la
  strada migliore: l'albo d'oro sopravvive, niente attese al risveglio, e
  dietro HTTPS il gioco si installa davvero come app sui telefoni.
- Non hai niente e vuoi qualcosa di gratuito?
  → **[DEPLOY.md](DEPLOY.md)**: Render, piano gratuito.

Due avvertenze importanti.

Se lo esponi su internet **metti `GATE_CODE`** nelle variabili d'ambiente: senza,
chiunque trovi l'indirizzo può giocare e consumare la tua quota Mapillary.

La parola d'ordine la digita solo chi crea la partita: il link d'invito (e il
QR) se la portano dietro, e chi li apre entra scrivendo solo il proprio nome —
la parola viene messa da parte e tolta subito dalla barra degli indirizzi. Il
rovescio della medaglia è che **il link vale quanto la parola d'ordine**: chi lo
riceve può entrare, quindi mandalo agli invitati e non in un gruppo pubblico.

E attenzione al **WebSocket**: il gioco vive tutto lì sopra. Se il reverse proxy
non passa l'upgrade del protocollo, la lobby si vede ma la partita non parte
mai. Le configurazioni in `deploy/` lo gestiscono già.

Solo su Render, dove il disco viene azzerato a ogni riavvio, conviene avviare
con `ALBO_OFF=1`: spegne il campionato permanente invece di far finta di
tenerlo. Su un server tuo non serve, e l'albo resta acceso.

## 6. Quando qualcosa non va

**Il panorama resta nero.** Dopo otto secondi il gioco passa da solo alla
*modalità semplice*: mostra la foto panoramica come immagine trascinabile, senza
grafica 3D. Si perde il camminare, ma il round si gioca. Se non parte nemmeno
quella, compare un riquadro con gli errori veri del browser e un pulsante per
copiarli.

**Ho aggiornato ma vedo ancora la versione vecchia.** Non dovrebbe più
succedere: ogni versione del codice ha un indirizzo diverso
(`app.js?v=impronta`), che nessuna cache — browser, telefono o proxy — può
avere già visto; e se una pagina rimasta aperta si accorge di eseguire una
versione diversa da quella servita, si ricarica da sola. Per controllare: in
fondo al pannello "Come si gioca" c'è l'impronta della versione. Se dopo un
aggiornamento non cambia nemmeno ricaricando, l'aggiornamento non è arrivato al
server: nel container, `cd /opt/geoduello && git log --oneline -1`.

**Diagnostica.** Sul dispositivo che fa i capricci apri
`http://INDIRIZZO:3000/diagnostica.html`: in dieci secondi prova la grafica 3D,
il collegamento a Mapillary, il download di una foto vera e il collegamento al
gioco, e dice quale pezzo manca. Se blocca sulle foto, il colpevole è quasi
sempre un filtro di rete: le immagini Mapillary arrivano dai server di Meta, e
vanno sbloccati i domini `mapillary.com` e `fbcdn.net`.

**Lo schermo si è zoomato e non torna indietro.** Doppio tocco sul panorama
rimette tutto a posto; se la pagina è zoomata compare un pulsante dorato che la
riporta alla scala giusta.

**Le immagini sono sgranate.** Il server scarta i panorami sotto i 4000 pixel,
ma la copertura Mapillary è collaborativa e la qualità varia. Se una città vi dà
sempre immagini brutte, togli la sua riga da `server/locations.js`: è un elenco
piatto, una riga per posto.

**Controlli automatici.**

```bash
npm test          # logica di gioco, punteggi, albo, riconnessioni (in-process + WebSocket)
npm run test:ui   # flusso completo su due browser veri (richiede playwright)
npm run check     # token e connessione a Mapillary
```

I primi due usano località finte e un albo usa e getta: non toccano né Mapillary
né il vostro campionato.

## 7. Com'è fatto dentro

```
server/
  index.js       HTTP, file statici, WebSocket, .env, indirizzi di rete, diagnostica
  game.js        stanze, turni, punteggi, riconnessioni, spareggi, aiutini
  mapillary.js   scelta della località dalle tile di copertura
  locations.js   ~215 aree candidate, continenti e zone per gli aiutini
  scoring.js     distanza haversine, formula del punteggio, vantaggi
  albo.js        campionato permanente e copie di sicurezza
public/          interfaccia: nessun build step, JavaScript semplice
public/vendor/   Leaflet, MapillaryJS e generatore di QR inclusi: nessun CDN esterno
public/sw.js     service worker, per l'installazione sulla schermata home
scripts/         test, diagnostica, copia dell'albo, repository e pubblicazione
deploy/          servizio systemd, script di installazione LXC, configurazioni proxy
data/            albo d'oro e copie di sicurezza (non finisce mai su git)
```

Il server non ha database e non ha login. Le stanze vivono in memoria e scadono
da sole dopo sei ore.

### Perché le tile e non la ricerca

L'endpoint di ricerca di Mapillary (`/images?bbox=...`) si è rivelato
inutilizzabile: cinque-venti secondi di attesa, liste vuote anche in pieno
centro città e errori 500 che il parametro `limit` non evita. Le tile vettoriali
di copertura rispondono in circa un secondo e contengono già tutto il
necessario. Il dettaglio sta nei commenti in cima a `server/mapillary.js`.

### Variabili d'ambiente

| variabile | a cosa serve |
|---|---|
| `MAPILLARY_TOKEN` | obbligatorio, il client token che legge anche le immagini |
| `PORT` | porta del server, 3000 di default |
| `GATE_CODE` | parola d'ordine per entrare; consigliata se esposto su internet |
| `ALBO_OFF=1` | spegne il campionato permanente (per hosting senza disco stabile) |
| `ALBO_PATH` | percorso alternativo del file dell'albo |
| `ALBO_BACKUP_DIR` | dove finiscono le copie datate |
| `FAKE_LOCATIONS=1` | località finte, per provare l'interfaccia senza token |

Le mappe usano tile CARTO su dati OpenStreetMap. Le immagini sono di Mapillary e
dei suoi collaboratori.

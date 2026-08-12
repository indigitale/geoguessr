# GeoDuello su Proxmox, dietro il tuo reverse proxy

Sì, un LXC va benissimo — anzi è la soluzione migliore fra tutte quelle che
abbiamo valutato, per tre motivi concreti.

**L'albo d'oro sopravvive.** Il disco del container è persistente e finisce nei
backup di Proxmox: qui il campionato permanente resta acceso, niente `ALBO_OFF`.

**Niente letargo.** Nessun risveglio da un minuto come sul piano gratuito di
Render: il gioco risponde sempre.

**Diventa un'app vera.** Dietro il tuo proxy con HTTPS, il service worker si
attiva davvero e il gioco si installa sulla schermata home dei telefoni. In HTTP
sul wifi di casa questo funziona solo a metà, perché i browser pretendono una
connessione sicura.

---

## 1. Il container

Sull'host Proxmox, template Debian 12 o 13. Va bene **unprivileged**, non serve
nessuna feature particolare: né nesting, né FUSE, né keyctl.

Risorse abbondanti così:

| | |
|---|---|
| CPU | 1 core |
| RAM | 512 MB (1 GB se vuoi stare comodo) |
| Disco | 8 GB |
| Rete | IP statico o riservazione DHCP — il proxy deve sapere dove trovarlo |

Il gioco è un processo Node che serve file statici e tiene aperti pochi
WebSocket: consuma pochissimo. La memoria serve soprattutto alla cache delle
tile Mapillary, che tiene solo un campione di ogni zona, non le immagini.

Da riga di comando sull'host, se preferisci:

```bash
pct create 150 local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst \
  --hostname geoduello \
  --cores 1 --memory 1024 --swap 512 \
  --rootfs local-lvm:8 \
  --net0 name=eth0,bridge=vmbr0,ip=192.168.1.50/24,gw=192.168.1.1 \
  --unprivileged 1 --features nesting=0 \
  --onboot 1 --start 1
```

## 2. Portare dentro il gioco — con GitHub

È il modo migliore, perché lo stesso canale che usi per installare lo usi poi
per ogni modifica: niente scp, niente file trascinati a mano.

### Una volta sola: il repository

Dal Mac:

```bash
cd ~/Downloads/geoduello
bash scripts/prepara-git.sh
```

Lo script crea il repository, fa il commit e ti elenca esattamente i file che
verranno caricati — dopo essersi assicurato che `.env` sia escluso. **Il token
non finisce mai su GitHub**, e `data/` con l'albo nemmeno.

Poi crea un repository vuoto su <https://github.com/new> e rilancia lo script
con il suo indirizzo:

```bash
bash scripts/prepara-git.sh https://github.com/TUONOME/geoduello.git
```

**Pubblico o privato?** Nel repository non ci sono segreti: il token sta nel
`.env`, che resta sul tuo Mac e nel container. Se lo tieni **pubblico**, il
container scarica senza autenticarsi e non devi configurare niente. Se lo vuoi
**privato**, servono le credenziali nel container: la strada pulita è una
*deploy key* di sola lettura, sotto trovi i comandi.

### Installazione nel container

Dentro il container, come root:

```bash
apt-get update && apt-get install -y curl git
curl -fsSL https://raw.githubusercontent.com/TUONOME/geoduello/main/deploy/installa-lxc.sh -o /tmp/installa.sh
bash /tmp/installa.sh https://github.com/TUONOME/geoduello.git
```

Lo script clona, installa Node se serve, crea l'utente di servizio, le
dipendenze e il servizio systemd. Poi compili il `.env` e riavvii:

```bash
nano /opt/geoduello/.env      # MAPILLARY_TOKEN e GATE_CODE
systemctl restart geoduello
```

### Se il repository è privato

Nel container, come root:

```bash
ssh-keygen -t ed25519 -C "geoduello-lxc" -f /root/.ssh/id_ed25519 -N ""
cat /root/.ssh/id_ed25519.pub
```

Copia la chiave che stampa e incollala su GitHub, nel **repository** (non nel
profilo): Settings → Deploy keys → Add deploy key, **senza** spuntare "Allow
write access". Poi usa l'indirizzo SSH al posto di quello HTTPS:

```bash
bash /tmp/installa.sh git@github.com:TUONOME/geoduello.git
```

Una deploy key di sola lettura vale per quel repository soltanto: se un giorno
il container venisse compromesso, non dà accesso al resto del tuo account.

## 3. Cosa fa l'installazione, e senza GitHub

Lo script installa Node 22 se manca o è troppo vecchio, crea l'utente di
servizio `geoduello`, installa le dipendenze, registra il servizio systemd e lo
avvia, stampandoti l'indirizzo su cui risponde.

Il servizio parte da solo al boot del container e si riavvia se cade. Gira come
utente non privilegiato, e l'unica cartella in cui può scrivere è `data/`,
quella dell'albo.

Se preferisci non passare da GitHub, copia i file e lancia lo script senza
indirizzo:

```bash
# dal Mac
scp -r ~/Downloads/geoduello root@192.168.1.50:/opt/
# nel container
cd /opt/geoduello && bash deploy/installa-lxc.sh
```

Funziona uguale, ma poi ogni aggiornamento te lo dovrai ricopiare a mano.

Comandi utili:

```bash
systemctl status geoduello        # sta girando?
journalctl -u geoduello -f        # log dal vivo
systemctl restart geoduello       # riavvio
```

## 4. Il reverse proxy

Qui c'è **l'unica cosa che si può sbagliare in modo fatale**: il gioco vive
interamente su WebSocket. Se il proxy non passa l'upgrade del protocollo, la
pagina si apre, la lobby si vede, e poi non succede più niente — un guasto
particolarmente ingannevole perché sembra che il gioco sia rotto.

Nella cartella `deploy/` trovi le configurazioni pronte per **Nginx**
(`nginx-geoduello.conf`), **Caddy** (`Caddyfile`) e **Traefik**
(`traefik-geoduello.yml`). Sostituisci dominio e IP del container.

Con **Nginx** le righe che contano sono queste:

```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade    $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_read_timeout 3600s;
```

Il timeout lungo serve perché fra un round e l'altro la partita può restare
ferma qualche minuto: con i 60 secondi di default il canale cadrebbe di
continuo, e i giocatori vedrebbero "connessione persa" a ripetizione.

Con **Caddy** e **Traefik** non devi fare niente di speciale: gestiscono i
WebSocket da soli.

Se usi **Nginx Proxy Manager**, che su Proxmox è la scelta più diffusa: crea un
Proxy Host verso `192.168.1.50` porta `3000`, e **attiva l'interruttore
"Websockets Support"**. È quello il passaggio che salta a tutti. Nella scheda
Advanced puoi aggiungere `proxy_read_timeout 3600s;`.

## 5. Prima di aprirlo al mondo

Se il dominio è raggiungibile da internet, **metti `GATE_CODE`** nel `.env`.
Senza, chiunque trovi l'indirizzo può giocare e consumare la tua quota
Mapillary. È una parola sola, da dire a voce ai vostri.

Tieni presente una cosa sul token: il visore panoramico gira nel browser dei
giocatori, quindi il token Mapillary viene inviato al client. È un *client
token* di sola lettura sulle foto pubbliche, pensato per questo uso, ma è
esattamente il motivo per cui la parola d'ordine ha senso.

Il gioco non ha login, non ha database e non scrive nulla fuori da `data/`. Le
stanze vivono in memoria e scadono da sole dopo sei ore.

## 6. Backup dell'albo

Il backup di Proxmox del container copre già tutto, ed è la rete di sicurezza
principale. In più il gioco tiene per conto suo una copia datata al giorno in
`/opt/geoduello/data/storico/` e un riassunto leggibile in `data/albo.txt`.

Se vuoi una copia fuori dal container, dal tuo Mac:

```bash
scp root@192.168.1.50:/opt/geoduello/data/albo.json ~/Documents/GeoDuello/
```

oppure, con il gioco raggiungibile, direttamente dal browser:
`https://geoduello.tuodominio.it/api/albo?gate=LA_TUA_PAROLA`

Se un giorno migri il gioco altrove, quel file è l'unica cosa da portarsi
dietro: tutto il resto si riscarica.

## 7. Aggiornare

Due comandi, uno per parte.

Dal **Mac**, quando hai modifiche da pubblicare:

```bash
cd ~/Downloads/geoduello
bash scripts/pubblica.sh "cosa hai cambiato"
```

Dal **container**:

```bash
/opt/geoduello/deploy/aggiorna.sh
```

L'aggiornamento scarica le modifiche, reinstalla le dipendenze se il
`package.json` è cambiato, aggiorna anche il servizio systemd se serve e
riavvia, stampandoti l'elenco di cosa è cambiato. Se il servizio non riparte, ti
mette sotto il naso il log invece di lasciarti indovinare.

**Non tocca mai `.env` né `data/`**: token e albo d'oro restano dove sono. L'ho
verificato simulando il giro completo — repository, clone, modifica, push,
aggiornamento — e controllando che dall'altra parte il token fosse intatto e le
partite dell'albo tutte lì.

Se un giorno vuoi tornare indietro a una versione precedente:

```bash
cd /opt/geoduello
git log --oneline -10        # scegli il commit
git reset --hard <commit>
systemctl restart geoduello
```

### Aggiornamento automatico, se lo vuoi

Se preferisci che il container si aggiorni da solo, un timer ogni notte:

```bash
cat > /etc/systemd/system/geoduello-aggiorna.service <<'FINE'
[Unit]
Description=Aggiorna GeoDuello da GitHub
[Service]
Type=oneshot
ExecStart=/opt/geoduello/deploy/aggiorna.sh
FINE

cat > /etc/systemd/system/geoduello-aggiorna.timer <<'FINE'
[Unit]
Description=Aggiornamento notturno di GeoDuello
[Timer]
OnCalendar=*-*-* 04:30:00
Persistent=true
[Install]
WantedBy=timers.target
FINE

systemctl daemon-reload && systemctl enable --now geoduello-aggiorna.timer
```

Personalmente lo lascerei manuale: un aggiornamento che parte da solo alle
quattro e mezza può rompere il gioco proprio la sera che volevate giocarci, e
tu non sapresti perché.

## 8. Se qualcosa non va

**La lobby si vede ma la partita non parte mai.** È il WebSocket bloccato dal
proxy. Controlla l'upgrade del protocollo, o l'interruttore Websockets in NPM.
Prova a saltare il proxy: `http://192.168.1.50:3000` direttamente dalla LAN. Se
lì funziona, il colpevole è il proxy.

**"Connessione persa" ogni minuto.** È il `proxy_read_timeout` troppo basso.

**Il servizio non parte.** `journalctl -u geoduello -n 40 --no-pager`. Quasi
sempre è il `.env` mancante o il token sbagliato — il messaggio all'avvio te lo
dice esplicitamente.

**Il panorama resta nero.** Non c'entra il proxy: apri
`https://geoduello.tuodominio.it/diagnostica.html` sul dispositivo che fa i
capricci, come descritto nel README.

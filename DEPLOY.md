# Mettere GeoDuello online (Render, piano gratuito)

Obiettivo: un indirizzo `https://...` stabile che funziona dai cellulari anche
in rete cellulare, con il Mac spento.

## Due decisioni da prendere prima

### 1. L'albo d'oro non sopravvive su Render

Sul piano gratuito il disco viene azzerato a ogni riavvio, e il servizio si
riavvia spesso: il campionato permanente dell'istanza online sparirebbe di
continuo. Meglio non far finta di tenerlo.

Nelle variabili d'ambiente di Render metti quindi anche:

```
ALBO_OFF=1
```

Le partite online si giocano normalmente, ma senza registrare record. Il
campionato vero resta quello di casa, sul tuo Mac, dove le copie di sicurezza
automatiche lo proteggono. Se un giorno vorrai un albo anche online servira` un
disco a pagamento (7 GB, pochi euro al mese) e allora basta togliere `ALBO_OFF`.

### 2. La parola d'ordine

Una volta online l'indirizzo e' raggiungibile da chiunque lo indovini, e ogni
partita consuma la tua quota Mapillary. `GATE_CODE` risolve il problema: senza
quella parola non si entra in nessuna stanza. Sceglila adesso, la userai fra
poco nel pannello di Render — qualcosa di semplice da dire a voce a tuo figlio.

## 3. Il repository

Su Render il codice arriva da un repository Git. Serve un account GitHub
(gratuito) e un repository **vuoto**, anche privato.

```bash
cd ~/Downloads/geoduello
bash scripts/prepara-git.sh
```

Lo script crea il repository locale, fa il commit e ti elenca esattamente i file
che verranno caricati. Prima di procedere si assicura che `.env` sia escluso:
il token resta sul tuo Mac e non finisce mai su GitHub.

Poi crea il repository vuoto su <https://github.com/new> e rilancia lo script
passandogli l'indirizzo:

```bash
bash scripts/prepara-git.sh https://github.com/TUONOME/geoduello.git
```

Se GitHub ti chiede la password, non e' piu' quella dell'account: serve un
*personal access token* da <https://github.com/settings/tokens> (permesso
`repo`), da incollare al posto della password. In alternativa `brew install gh`
e poi `gh auth login`, che sistema tutto da solo.

## 4. Render

1. Registrati su <https://render.com> e collega l'account GitHub.
2. **New → Blueprint**, scegli il repository. Render legge `render.yaml` e
   configura tutto da solo: servizio web, build Docker, regione Francoforte,
   controllo di salute su `/health`.
3. Ti chiede i due valori che non stanno nel repository:
   - `MAPILLARY_TOKEN` → il token che legge anche le immagini, non quello che
     legge solo le mappe;
   - `GATE_CODE` → la parola d'ordine scelta prima;
   - `ALBO_OFF` → `1`, per i motivi spiegati sopra.
4. **Apply**. La prima build richiede qualche minuto.

Alla fine ottieni un indirizzo tipo `https://geoduello.onrender.com`. Quello e'
il link da salvare nei preferiti dei vostri telefoni.

## 5. Come si aggiorna

Ogni modifica ai file, poi:

```bash
bash scripts/prepara-git.sh
git push
```

Render se ne accorge e ricostruisce da solo.

## Cosa aspettarsi dal piano gratuito

Il servizio **va in letargo dopo 15 minuti senza traffico**. Alla prima apertura
dopo una pausa vedrete una pagina di caricamento per circa un minuto, poi tutto
funziona normalmente. Non e' un guasto: e' come funziona il piano gratuito.

Il modo piu' semplice per conviverci e' aprire il link un minuto prima di
cominciare a giocare, mentre vi mettete comodi. Da li' in avanti la partita
scorre liscia, e finche' giocate il servizio resta sveglio.

Il piano gratuito da' 750 ore di servizio attivo al mese per l'intero account,
piu' che sufficienti per giocarci la sera. Il servizio non ha database e non
salva niente: le stanze vivono in memoria e spariscono da sole.

## Se preferisci evitare il letargo

Il piano a pagamento piu' basso di Render elimina lo spegnimento automatico.
Prima di spendere, pero', tieni presente che con il Mac acceso hai gia' due
alternative gratuite e senza attese: il wifi di casa (`http://IP-DEL-MAC:3000`)
e Cloudflare Tunnel per giocare fuori casa.

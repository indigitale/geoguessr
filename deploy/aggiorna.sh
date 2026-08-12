#!/usr/bin/env bash
#
# Aggiorna GeoDuello nel container tirando giu' le modifiche da GitHub.
# Da lanciare COME ROOT dentro il container:
#
#   /opt/geoduello/deploy/aggiorna.sh
#
# Non tocca mai il file .env ne' la cartella data/: token e albo d'oro
# restano dove sono.

set -euo pipefail

APP_DIR=${APP_DIR:-/opt/geoduello}
UTENTE=${UTENTE:-geoduello}

cd "$APP_DIR"

if [ ! -d .git ]; then
  echo "In $APP_DIR non c'e' un repository git."
  echo "Se hai installato copiando i file a mano, passa a git cosi':"
  echo "  cd $APP_DIR && git init && git remote add origin URL && git fetch && git reset --hard origin/main"
  exit 1
fi

echo "==> Metto al sicuro quello che non deve essere toccato"
# .env e data/ sono in .gitignore, quindi git non li tocca. Questo e' solo
# un controllo di sanita': se un giorno finissero tracciati, meglio saperlo.
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "    ATTENZIONE: .env risulta tracciato da git. Mi fermo."; exit 1
fi

PRIMA=$(git rev-parse --short HEAD)
echo "==> Scarico le modifiche"
git fetch --quiet origin
RAMO=$(git rev-parse --abbrev-ref HEAD)
git reset --hard --quiet "origin/${RAMO}"
DOPO=$(git rev-parse --short HEAD)

if [ "$PRIMA" = "$DOPO" ]; then
  echo "    Niente di nuovo ($DOPO). Riavvio comunque per sicurezza."
else
  echo "    Da $PRIMA a $DOPO:"
  git --no-pager log --oneline "${PRIMA}..${DOPO}" | sed 's/^/      /'
fi

echo "==> Dipendenze"
npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --omit=dev --no-audit --no-fund >/dev/null

# il servizio systemd potrebbe essere cambiato
if ! cmp -s deploy/geoduello.service /etc/systemd/system/geoduello.service 2>/dev/null; then
  echo "==> Aggiorno anche il servizio systemd"
  cp deploy/geoduello.service /etc/systemd/system/geoduello.service
  systemctl daemon-reload
fi

mkdir -p "$APP_DIR/data"
chown -R "$UTENTE:$UTENTE" "$APP_DIR"
chmod 600 "$APP_DIR/.env" 2>/dev/null || true

echo "==> Riavvio"
systemctl restart geoduello
sleep 2

if systemctl is-active --quiet geoduello; then
  echo
  echo "Aggiornato e ripartito. Versione $DOPO."
else
  echo
  echo "Il servizio NON e' ripartito. Cosa dice il log:"
  journalctl -u geoduello -n 25 --no-pager
  exit 1
fi

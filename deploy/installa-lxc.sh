#!/usr/bin/env bash
#
# Installa GeoDuello dentro un container LXC Debian/Ubuntu.
# Da lanciare COME ROOT DENTRO IL CONTAINER, in uno dei due modi:
#
#   bash deploy/installa-lxc.sh                                  # file gia' copiati qui
#   bash installa-lxc.sh https://github.com/TUONOME/geoduello.git  # scarica da GitHub
#
# Fa tutto: Node se manca, utente di servizio, dipendenze, servizio systemd.

set -euo pipefail

APP_DIR=/opt/geoduello
UTENTE=geoduello

if [ "$(id -u)" -ne 0 ]; then
  echo "Va lanciato come root dentro il container."; exit 1
fi

echo "==> Aggiorno i pacchetti di base"
apt-get update -qq
apt-get install -y -qq curl ca-certificates git >/dev/null

echo "==> Controllo Node"
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  MAJ=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
  [ "$MAJ" -ge 18 ] && NODE_OK=1
fi
if [ "$NODE_OK" -eq 0 ]; then
  echo "    Node assente o troppo vecchio: installo la 22 da NodeSource"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
echo "    Node $(node -v)"

echo "==> Utente di servizio '$UTENTE'"
id -u "$UTENTE" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$UTENTE"

REPO=${1:-}

if [ -n "$REPO" ]; then
  echo "==> Scarico da $REPO"
  if [ -d "$APP_DIR/.git" ]; then
    git -C "$APP_DIR" fetch --quiet origin
    git -C "$APP_DIR" reset --hard --quiet "origin/$(git -C "$APP_DIR" rev-parse --abbrev-ref HEAD)"
  else
    mkdir -p "$APP_DIR"
    # se la cartella non e' vuota si clona a parte e si sposta il contenuto
    if [ -z "$(ls -A "$APP_DIR" 2>/dev/null)" ]; then
      git clone --quiet "$REPO" "$APP_DIR"
    else
      TMP=$(mktemp -d)
      git clone --quiet "$REPO" "$TMP/g"
      cp -a "$TMP/g/." "$APP_DIR/"
      rm -rf "$TMP"
    fi
  fi
  SORGENTE="$APP_DIR"
else
  SORGENTE="$(cd "$(dirname "$0")/.." && pwd)"
fi

echo "==> Preparo $APP_DIR"
mkdir -p "$APP_DIR"
if [ "$SORGENTE" != "$APP_DIR" ]; then
  # copia dai file locali (senza git)
  # --update non sovrascrive l'albo d'oro con una versione piu' vecchia
  cp -a "$SORGENTE"/{server,public,scripts,package.json,package-lock.json,README.md} "$APP_DIR"/ 2>/dev/null || true
  [ -f "$SORGENTE/.env" ] && [ ! -f "$APP_DIR/.env" ] && cp "$SORGENTE/.env" "$APP_DIR/.env"
  [ -f "$SORGENTE/.env.example" ] && cp "$SORGENTE/.env.example" "$APP_DIR/.env.example"
fi
mkdir -p "$APP_DIR/data"

echo "==> Dipendenze"
cd "$APP_DIR"
npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --omit=dev --no-audit --no-fund >/dev/null

if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env" 2>/dev/null || touch "$APP_DIR/.env"
  echo
  echo "  ATTENZIONE: manca il token. Apri $APP_DIR/.env e metti"
  echo "              MAPILLARY_TOKEN=MLY|... e una GATE_CODE"
  echo
fi
chmod 600 "$APP_DIR/.env"
chown -R "$UTENTE:$UTENTE" "$APP_DIR"

echo "==> Servizio systemd"
cp "$APP_DIR/deploy/geoduello.service" /etc/systemd/system/geoduello.service 2>/dev/null \
  || cp "$SORGENTE/deploy/geoduello.service" /etc/systemd/system/geoduello.service
chmod +x "$APP_DIR"/deploy/*.sh "$APP_DIR"/scripts/*.sh 2>/dev/null || true
systemctl daemon-reload
systemctl enable --now geoduello >/dev/null

sleep 2
echo
if systemctl is-active --quiet geoduello; then
  IP=$(hostname -I | awk '{print $1}')
  PORTA=$(grep -E '^PORT=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2)
  echo "GeoDuello è attivo su http://${IP}:${PORTA:-3000}"
  echo
  echo "  stato:       systemctl status geoduello"
  echo "  log:         journalctl -u geoduello -f"
  echo "  riavvio:     systemctl restart geoduello"
  if [ -d "$APP_DIR/.git" ]; then
    echo "  aggiornare:  $APP_DIR/deploy/aggiorna.sh"
  fi
else
  echo "Il servizio non è partito. Guarda il perché con:"
  echo "  journalctl -u geoduello -n 40 --no-pager"
  exit 1
fi

#!/usr/bin/env bash
#
# Dal Mac: manda le modifiche su GitHub in un comando solo.
#
#   bash scripts/pubblica.sh                       # messaggio automatico
#   bash scripts/pubblica.sh "avatar piu' grandi"  # con un messaggio tuo
#
# Il file .env non parte mai: e' in .gitignore, e qui lo si ricontrolla.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d .git ]; then
  echo "Qui non c'e' ancora un repository. Lancia prima:"
  echo "  bash scripts/prepara-git.sh"
  exit 1
fi

# controllo di sicurezza: il token non deve finire su GitHub
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "FERMO: il file .env risulta tracciato da git e contiene il token."
  echo "Toglilo con:  git rm --cached .env"
  exit 1
fi

git add -A
if git diff --cached --quiet; then
  echo "Nessuna modifica da mandare."
else
  MSG=${1:-"aggiornamento $(date '+%d/%m/%Y %H:%M')"}
  git commit -q -m "$MSG"
  echo "Salvato: $MSG"
fi

RAMO=$(git rev-parse --abbrev-ref HEAD)
git push -q origin "$RAMO"
echo "Mandato su GitHub (ramo $RAMO)."
echo
echo "Ora, dentro il container:"
echo "  /opt/geoduello/deploy/aggiorna.sh"

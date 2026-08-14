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

# Gli script devono restare eseguibili anche dall'altra parte. Il permesso si
# perde ogni volta che un file viene riscritto da un editor o copiato da un
# sistema che non lo conserva, e nel container diventa un "Permission denied":
# qui lo si riscrive direttamente nell'indice di git, che e' quello che conta.
git ls-files -z 'deploy/*.sh' 'scripts/*.sh' | xargs -0 -r git update-index --chmod=+x 2>/dev/null || true
git config core.fileMode false   # e da qui in avanti git ignora i cambi di permesso locali

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

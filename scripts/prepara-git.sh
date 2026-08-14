#!/bin/bash
# Prepara il repository locale per il deploy su Render.
#
#   bash scripts/prepara-git.sh                      # solo commit locale
#   bash scripts/prepara-git.sh URL-DEL-REPO-GITHUB  # commit e push
#
# Il file .env NON viene mai incluso: e' in .gitignore.

set -e
cd "$(dirname "$0")/.."

if [ ! -d .git ]; then
  git init -q
  git branch -M main
  echo "Repository git creato."
fi

# Controllo di sicurezza: il token non deve finire nel repository.
if git check-ignore -q .env 2>/dev/null; then
  echo "OK: .env e' ignorato, il token resta sul tuo Mac."
else
  echo "ATTENZIONE: .env non risulta ignorato. Fermo qui."
  exit 1
fi

git add -A
# Gli script vanno registrati come eseguibili: nel container si lanciano per
# nome, e senza questo permesso rispondono "Permission denied".
git ls-files -z 'deploy/*.sh' 'scripts/*.sh' | xargs -0 -r git update-index --chmod=+x 2>/dev/null || true
git config core.fileMode false

if git diff --cached --quiet; then
  echo "Nessuna modifica da salvare."
else
  git commit -q -m "GeoDuello"
  echo "Commit fatto."
fi

echo
echo "File che finiranno su GitHub:"
git ls-files | sed 's/^/  /'
echo

if [ -n "$1" ]; then
  git remote remove origin 2>/dev/null || true
  git remote add origin "$1"
  git push -u origin main
  echo
  echo "Fatto. Da qui in avanti, per pubblicare le modifiche:"
  echo "  bash scripts/pubblica.sh \"cosa hai cambiato\""
  echo
  echo "E per applicarle sul server, dentro il container:"
  echo "  /opt/geoduello/deploy/aggiorna.sh"
else
  echo "Ora crea un repository vuoto su https://github.com/new (privato va benissimo),"
  echo "poi rilancia questo script passandogli l'indirizzo, per esempio:"
  echo "  bash scripts/prepara-git.sh https://github.com/TUONOME/geoduello.git"
fi

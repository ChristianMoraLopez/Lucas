#!/usr/bin/env bash
# ============================================================================
# Actualiza Luks en el servidor: si hay algo nuevo en main, lo baja y vuelve a
# armar el connector y el worker. Sin cambios, no hace nada.
#
#   bash deploy/actualizar.sh             # una vez (lo que corre cron)
#   bash deploy/actualizar.sh --ya        # reconstruir aunque no haya cambios
#   bash deploy/actualizar.sh --instalar  # actualizar ya y dejarlo solo cada 10 min
#
# Lo que va en los .env (llaves, tokens) no se toca: git no los conoce.
# ============================================================================
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:$PATH

AQUI=$(cd "$(dirname "$0")" && pwd)
RAIZ=$(cd "$AQUI/.." && pwd)
LOG="$HOME/luks-actualizar.log"
# La última versión que quedó corriendo bien (si algo falla, la próxima vez se reintenta)
DESPLEGADO="$HOME/.luks-desplegado"

if [ "${1:-}" = "--instalar" ]; then
  if ! command -v crontab >/dev/null; then
    echo "Falta cron. En Oracle Linux: sudo dnf -y install cronie && sudo systemctl enable --now crond"
    echo "En Ubuntu: sudo apt-get -y install cron. Después corre otra vez este comando."
    exit 1
  fi
  LINEA="*/10 * * * * bash $AQUI/actualizar.sh >> $LOG 2>&1"
  { crontab -l 2>/dev/null | grep -v 'deploy/actualizar.sh' || true; echo "$LINEA"; } | crontab -
  echo "Listo: el servidor revisa main cada 10 minutos y se actualiza solo (registro en $LOG)."
  set -- --ya
fi

# Una sola actualización a la vez (cron no la repite si la anterior sigue armando)
exec 9>"/tmp/luks-actualizar.lock"
flock -n 9 || exit 0

cd "$RAIZ"
git fetch --quiet origin main
NUEVO=$(git rev-parse origin/main)
if [ "$(cat "$DESPLEGADO" 2>/dev/null)" = "$NUEVO" ] && [ "${1:-}" != "--ya" ]; then
  exit 0
fi

echo "$(date -Is) actualizando de $(git rev-parse --short HEAD) a $(git rev-parse --short origin/main)…"
git checkout --quiet main
git merge --ff-only --quiet origin/main
cd "$AQUI"
docker compose up -d --build
docker image prune -f >/dev/null
echo "$NUEVO" >"$DESPLEGADO"
echo "$(date -Is) listo en $(git rev-parse --short HEAD)"
docker compose ps --format 'table {{.Service}}\t{{.Status}}'

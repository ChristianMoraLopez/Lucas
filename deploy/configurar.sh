#!/usr/bin/env bash
# ============================================================================
# Luks · configura los secretos del servidor sin mostrarlos en pantalla.
#
#   cd deploy && ./configurar.sh
#
# Escribe services/worker/.env y services/connector/.env (a partir de sus
# .env.example si no existen). La llave secreta de Supabase se pide una vez
# y va a los dos. La llave de cifrado de WhatsApp se genera sola la primera
# vez y no se vuelve a tocar (cambiarla obliga a vincular de nuevo los números).
# Se puede correr otra vez: Enter deja lo que ya había.
# ============================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
WORKER=services/worker/.env
CONNECTOR=services/connector/.env
[ -f "$WORKER" ] || cp services/worker/.env.example "$WORKER"
[ -f "$CONNECTOR" ] || cp services/connector/.env.example "$CONNECTOR"
chmod 600 "$WORKER" "$CONNECTOR"

# leer ARCHIVO CLAVE → el valor actual (vacío si no hay)
leer() { python3 - "$1" "$2" <<'PY'
import sys
path, key = sys.argv[1:]
for line in open(path):
    if line.startswith(key + "="):
        print(line.split("=", 1)[1].strip())
        break
PY
}

# poner ARCHIVO CLAVE (el valor llega por la entrada estándar, no queda en la lista de procesos)
poner() { python3 -c '
import sys
path, key = sys.argv[1:]
val = sys.stdin.read().strip()
lines = open(path).read().splitlines()
out, hit = [], False
for l in lines:
    if l.startswith(key + "="):
        out.append(key + "=" + val)
        hit = True
    else:
        out.append(l)
if not hit:
    out.append(key + "=" + val)
open(path, "w").write("\n".join(out) + "\n")
' "$1" "$2"; }

# Al pegar no se ve nada y es fácil pegar dos veces: si quedó repetido, una sola copia
una_vez() {
  local v="$1" n=${#1} h
  h=$((n / 2))
  if [ $((n % 2)) -eq 0 ] && [ "$n" -gt 0 ] && [ "${v:0:h}" = "${v:h}" ]; then v="${v:0:h}"; fi
  printf %s "$v"
}

echo "Luks · configuración del servidor (lo secreto no se ve al pegar: pega una vez y Enter)"
echo

# 1. Supabase (los dos servicios)
URL_ACTUAL=$(leer "$WORKER" SUPABASE_URL)
case "$URL_ACTUAL" in *tu-proyecto*|"") URL_ACTUAL="" ;; esac
read -rp "1/5  URL de Supabase [${URL_ACTUAL:-https://xxxx.supabase.co}]: " URL
URL=${URL:-$URL_ACTUAL}
if [ -z "$URL" ]; then echo "     Falta la URL (Project Settings → Data API)."; exit 1; fi
printf %s "$URL" | poner "$WORKER" SUPABASE_URL
printf %s "$URL" | poner "$CONNECTOR" SUPABASE_URL

while true; do
  read -rsp "2/5  Secret key de Supabase (sb_secret_…; Enter para dejar la que hay): " SB
  echo
  SB=$(una_vez "$SB")
  if [ -z "$SB" ]; then
    case "$(leer "$WORKER" SUPABASE_SERVICE_ROLE_KEY)" in sb_secret_x*|"") echo "     Todavía no hay una guardada: pégala."; continue ;; esac
    echo "     Se deja la que había."
    break
  fi
  case "$SB" in
    sb_secret_* | eyJ*)
      echo "     Recibida: ${#SB} caracteres"
      printf %s "$SB" | poner "$WORKER" SUPABASE_SERVICE_ROLE_KEY
      printf %s "$SB" | poner "$CONNECTOR" SUPABASE_SERVICE_ROLE_KEY
      break
      ;;
    *) echo "     Debe empezar por sb_secret_ (o eyJ). Intenta otra vez." ;;
  esac
done
unset SB

# 3. Llave de cifrado de las sesiones de WhatsApp (se genera una sola vez)
if [ -z "$(leer "$CONNECTOR" SESSION_ENCRYPTION_KEY)" ]; then
  openssl rand -base64 32 | poner "$CONNECTOR" SESSION_ENCRYPTION_KEY
  echo "3/5  Llave de cifrado de WhatsApp: generada (guárdala en un lugar seguro: está en $CONNECTOR)."
else
  echo "3/5  Llave de cifrado de WhatsApp: ya existe, no se toca."
fi

# 4. Laya en Hugging Face (opcional)
read -rp "4/5  Usuario de Hugging Face para Laya (Enter para dejarlo como está): " HFU
HFU=$(printf %s "$HFU" | tr -d '[:space:]')
if [ -n "$HFU" ]; then
  printf %s "$HFU/lucas-laya" | poner "$WORKER" HF_REPO
  read -rsp "     Token de LECTURA de Hugging Face (hf_…): " HFT
  echo
  HFT=$(una_vez "$HFT")
  printf %s "$HFT" | poner "$WORKER" HF_TOKEN
  echo "     Recibido: ${#HFT} caracteres"
  unset HFT
fi

# 5. Sentry (opcional; el mismo DSN o uno por servicio)
read -rp "5/5  DSN de Sentry (Enter para dejarlo como está): " DSN
if [ -n "$DSN" ]; then
  printf %s "$DSN" | poner "$WORKER" SENTRY_DSN
  printf %s "$DSN" | poner "$CONNECTOR" SENTRY_DSN
fi

echo
echo "Listo. Ahora: cd deploy && docker compose up -d --build"

#!/usr/bin/env bash
# Deploy da nova casca Express+Vite no lugar do portal-nr1 Next na Americana.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE_HOST="${REMOTE_HOST:-Americana}"
REMOTE_DIR="${REMOTE_DIR:-~/arara-platform-src}"
REMOTE_APP="${REMOTE_DIR}/apps/portal-nr1"
LEGACY_APP="${REMOTE_DIR}/apps/portal-nr1-next-legacy"

echo "==> backup do Next antigo (se ainda estiver no lugar)"
ssh "${REMOTE_HOST}" "REMOTE_DIR='${REMOTE_DIR}' LEGACY_APP='${LEGACY_APP}' REMOTE_APP='${REMOTE_APP}' bash -s" <<'REMOTE'
set -euo pipefail
expand() { echo "${1/#\~/$HOME}"; }
RD="$(expand "$REMOTE_DIR")"
APP="$(expand "$REMOTE_APP")"
LEG="$(expand "$LEGACY_APP")"
mkdir -p "$RD/apps" "$RD/deploy"
if [ -f "$APP/next.config.ts" ] || [ -f "$APP/next.config.js" ]; then
  if [ ! -d "$LEG" ]; then
    echo "Movendo Next legado → $LEG"
    mv "$APP" "$LEG"
  else
    echo "Legado já existe em $LEG — sobrescrevendo app atual"
    rm -rf "$APP"
  fi
fi
mkdir -p "$APP"
REMOTE

echo "==> rsync nova árvore + compose"
rsync -az --delete \
  --exclude node_modules --exclude .git --exclude dist --exclude coverage \
  --exclude '*.log' --exclude uploads --exclude .env --exclude 'server/.env' \
  --exclude client/dist --exclude server/dist \
  "${ROOT}/" "${REMOTE_HOST}:${REMOTE_APP}/"
scp -q "${ROOT}/deploy/nr1.americana.compose.yml" \
  "${REMOTE_HOST}:${REMOTE_DIR}/deploy/nr1.americana.compose.yml"

echo "==> preparar DB portal_nr1 + env + compose up"
ssh "${REMOTE_HOST}" "REMOTE_DIR='${REMOTE_DIR}' bash -s" <<'REMOTE'
set -euo pipefail
cd "${REMOTE_DIR/#\~/$HOME}"
ENV_FILE=deploy/nr1.americana.env
if [ ! -f "$ENV_FILE" ]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
# shellcheck disable=SC1091
source "$ENV_FILE"
set +a

OLD_URL="${NR1_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$OLD_URL" ]; then
  echo "NR1_DATABASE_URL ausente em $ENV_FILE" >&2
  exit 1
fi

# Mesmas credenciais/host; banco novo para não destruir o schema Next (nr1_db).
NEW_URL="$(python3 - <<'PY' "$OLD_URL"
import sys, urllib.parse
u = urllib.parse.urlparse(sys.argv[1])
# path era /nr1_db → /portal_nr1
parts = list(u)
parts[2] = "/portal_nr1"
print(urllib.parse.urlunparse(parts))
PY
)"

echo "==> criar database portal_nr1 se não existir"
docker exec sgc-postgres-primary psql -U postgres -tc \
  "SELECT 1 FROM pg_database WHERE datname='portal_nr1'" | grep -q 1 \
  || docker exec sgc-postgres-primary psql -U postgres -c \
    "CREATE DATABASE portal_nr1 OWNER nr1;"

# Atualiza env: aponta NR1_DATABASE_URL para portal_nr1 (preserva AUTH_SECRET etc.)
TMP="$(mktemp)"
grep -vE '^(NR1_DATABASE_URL|DATABASE_URL)=' "$ENV_FILE" > "$TMP" || true
printf 'NR1_DATABASE_URL=%s\n' "$NEW_URL" >> "$TMP"
mv "$TMP" "$ENV_FILE"
chmod 600 "$ENV_FILE"

# Compose prioriza variáveis do shell sobre --env-file — exportar o valor novo.
export NR1_DATABASE_URL="$NEW_URL"
unset DATABASE_URL || true

echo "==> docker compose up --build"
docker compose --env-file "$ENV_FILE" -f deploy/nr1.americana.compose.yml up -d --build

echo "==> aguardando health"
ok=0
for i in $(seq 1 36); do
  if curl -sf http://127.0.0.1:10000/api/health >/dev/null; then
    ok=1
    break
  fi
  sleep 5
done
if [ "$ok" != 1 ]; then
  echo "health falhou — logs:" >&2
  docker logs --tail 80 arara-front-portal-nr1 >&2 || true
  exit 1
fi
curl -sf http://127.0.0.1:10000/api/health
echo

# Seed se ainda não houver usuários
USER_COUNT="$(docker exec arara-front-portal-nr1 \
  node -e "
const {PrismaClient}=require('@prisma/client');
const p=new PrismaClient();
p.user.count().then(c=>{console.log(c);return p.\$disconnect()}).catch(e=>{console.error(e);process.exit(1)})
" 2>/dev/null || echo 0)"
if [ "${USER_COUNT:-0}" = "0" ]; then
  echo "==> seed inicial"
  docker exec -e DATABASE_URL="$NEW_URL" -w /app arara-front-portal-nr1 \
    npx tsx prisma/seed.ts
fi

docker ps --filter name=arara-front-portal-nr1 --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
REMOTE

echo "==> ok — https://colaborador.shoppingutilamericana.arara-tech.com (host :10000)"

<p align="center">
  <img src="docs/portal-nr1-header.png" alt="Portal NR-1" width="100%" />
</p>

# Portal NR-1

Portal do colaborador para **SST** (NR-1), **GRO** e rotinas de RH: inventário de riscos, PGR, denúncia, avisos, holerites, atestados e mais — API Express + SPA React, empacotados numa imagem Docker única.

Imagem pública no Docker Hub: [`dockerflip747/portal-nr1`](https://hub.docker.com/r/dockerflip747/portal-nr1).

---

## Rodar com Docker

### 1. Pré-requisitos

- Docker + Docker Compose
- PostgreSQL acessível (ex.: na mesma rede Docker do SGC)
- Rede Docker externa (padrão `sgc-network`) — ajuste se a sua for outra

Crie a rede se ainda não existir:

```bash
docker network create sgc-network
```

### 2. Arquivo de ambiente

Na pasta do compose (ou use `deploy/portal-nr1.compose.yml` deste repo):

```bash
cat > portal-nr1.env <<'EOF'
NR1_IMAGE=dockerflip747/portal-nr1:latest
NR1_DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/portal_nr1
NR1_AUTH_SECRET=troque-por-uma-string-longa-e-aleatoria
NR1_PUBLIC_URL=https://seu-dominio.exemplo.com
NR1_HOST_PORT=10000
DOCKER_NETWORK=sgc-network
EOF
chmod 600 portal-nr1.env
```

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `NR1_IMAGE` | sim | Tag da imagem (`:latest` ou `A.B.C.D`) |
| `NR1_DATABASE_URL` | sim | Connection string Postgres (`portal_nr1`) |
| `NR1_AUTH_SECRET` | sim | Segredo JWT (`TOKEN_SECRET` no container) |
| `NR1_PUBLIC_URL` | sim | URL pública (origem CORS / `CLIENT_ORIGIN`) |
| `NR1_HOST_PORT` | não | Porta no host (padrão `10000`) |
| `DOCKER_NETWORK` | não | Rede Docker externa (padrão `sgc-network`) |

O banco precisa existir antes do primeiro start (o container roda `prisma migrate deploy` na subida).

### 3. Subir o container

Com o compose deste repositório:

```bash
docker compose --env-file portal-nr1.env -f deploy/portal-nr1.compose.yml pull
docker compose --env-file portal-nr1.env -f deploy/portal-nr1.compose.yml up -d
```

Ou só com `docker run` (sem o arquivo compose):

```bash
docker pull dockerflip747/portal-nr1:latest

docker run -d \
  --name arara-front-portal-nr1 \
  --restart unless-stopped \
  --network sgc-network \
  -p 10000:8080 \
  -e DATABASE_URL='postgresql://USER:PASSWORD@HOST:5432/portal_nr1' \
  -e TOKEN_SECRET='troque-por-uma-string-longa-e-aleatoria' \
  -e CLIENT_ORIGIN='https://seu-dominio.exemplo.com' \
  -e CLIENT_DIST=/app/client/dist \
  -e UPLOADS_DIR=/app/uploads \
  -v nr1_uploads:/app/uploads \
  dockerflip747/portal-nr1:latest
```

### 4. Conferir

```bash
curl -sf http://127.0.0.1:10000/api/health
```

A app escuta em **`:8080`** dentro do container; no host, a porta é a de `NR1_HOST_PORT` (padrão **10000**).

---

## Desenvolvimento local (opcional)

```bash
npm run setup
cp .env.example .env
cp server/.env.example server/.env
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm run local:dev
```

- API: http://localhost:8080  
- Client: http://localhost:5173  

Seed: `master` / `admin123` (MASTER) · `admin` / `admin123` (OWNER).

---

## Papéis e matriz de módulos

Acesso por módulo usa L / L/E / X (ver [`server/config/module-access.json`](./server/config/module-access.json)):

| Nível | Significado |
|-------|-------------|
| `write` (L/E) | Lê e cria/edita no módulo |
| `read` (L) | Só leitura (menu visível) |
| `none` (X) | Sem acesso — módulo oculto no menu e bloqueado na API |

Papéis de organização (`Role`): `MASTER`, `ADMIN` (legado→gerente), `SST` (técnico), `RH`, `GERENTE`, `ADM_LOJA`, `SUPERVISOR`, `COLABORADOR`.

Papéis de conta (`AccountRole`): `OWNER` (matriz = Master), `ADMIN` (matriz = ADM loja), `USER`.

A sessão inclui `user.modules` (`moduleId` → `read`|`write`). Rotas de domínio usam `verifyModule(moduleId, "read"|"write")`.

Exceções self-service (fora da célula literal do sheet): pedido de férias e lançamento de ponto em `read`; denúncia anônima permanece pública; comitê exige módulo `comite`.

---

## Licença

Uso próprio permitido; **uso comercial não autorizado**. Ver [LICENSE](./LICENSE).

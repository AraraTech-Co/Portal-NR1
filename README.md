# Portal NR1

Nova versão do portal NR-1 (SST): React + Express, estrutura OOP inspirada no [portal-araratech](https://github.com/hengueier/portal-araratech).

Este repositório começa como **esqueleto vazio**. O domínio de negócio será migrado por partes, **backend first**.

## Estrutura

```text
portal-nr1/
  prisma/          # schema Prisma (sem modelos de domínio ainda)
  server/          # Express + model/controller/api
  client/          # React (Vite)
```

Camada de dados no server:

- `server/src/model/schema/Model.ts` — classe base OOP (`create` / `read` / `update` / `delete`)
- Entidades futuras em `server/src/model/schema/<Entity>/`
- Controllers em `server/src/controller/`
- Rotas em `server/src/api/`

## Pré-requisitos

- Node.js 20+
- PostgreSQL (quando houver modelos)

## Setup

```bash
# raiz
npm install
npm run setup

# env
cp .env.example .env
cp server/.env.example server/.env

# banco
docker compose up -d postgres
npm run db:migrate
npm run db:seed
```

## Desenvolvimento

```bash
# sobe API + frontend
npm run local:dev

# só API
npm run server

# só frontend
npm run client
```

- API: http://localhost:8080 — `GET /api/health`
- Client: http://localhost:5173

## Autenticação

Hierarquia:

```text
Organization (empresa)
  └── Account (várias)
        └── User (vários) via AccountMembership
```

| Nível | Onde | Poder |
|-------|------|--------|
| **MASTER** | `Membership` na empresa | Controla **todas** as contas da org |
| **OWNER** | `AccountMembership` | Responsável / acesso total **naquela** conta |
| **ADMIN** / **USER** | `AccountMembership` | Acesso limitado à conta |

`master` > `owner` > `admin` > `user` em `server/config/permissions.json`  
(OWNER **não** tem `master: true`.)

MASTER entra em qualquer conta da empresa (mesmo sem membership nela).

```bash
docker compose up -d postgres
npm run db:migrate
npm run db:seed
npm test
npm run local:dev
```

Seed:

- `master` / `admin123` — MASTER (Conta Matriz + Conta Filial)
- `admin` / `admin123` — OWNER só da Conta Matriz

## Prisma

```bash
npm run db:generate
```

Modelos de domínio serão adicionados em `prisma/schema.prisma` conforme a migração por módulos.

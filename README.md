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

O **schema Prisma** já inclui o domínio completo (SST/GRO, RH, saúde, engajamento).  
O **módulo GRO** já tem API (estrutura operacional + perigo/risco/avaliação/controle/ação).  
Classes OOP de RH/engajamento entram depois.

```bash
docker compose up -d postgres
npx prisma db push   # ou migrate deploy
npm run db:seed
npm test
npm run local:dev
```

Seed:

- `master` / `admin123` — MASTER (Conta Matriz + Conta Filial)
- `admin` / `admin123` — OWNER só da Conta Matriz
- GRO demo: Planta → Produção → Usinagem → perigo/risco + matriz 5×5

### API GRO (auth Bearer; escrita exige `sst`)

| Recurso | Rotas |
|---------|--------|
| Estabelecimentos | `GET/POST /api/establishments`, `PATCH/DELETE …/:id` |
| Setores | `/api/sectors` |
| Funções (JobRole) | `/api/job-roles` |
| Atividades | `/api/activities` |
| Metodologias | `GET /api/methodologies` |
| Perigos | `/api/hazards` |
| Riscos | `/api/risks` |
| Avaliações | `POST /api/assessments`, `POST …/:id/validate` |
| Controles | `/api/controls` |
| Ações | `/api/actions`, `POST …/:id/complete`, `POST …/:id/review` |
| Evidências | `GET/POST /api/evidences` |
| Inventário (vivo) | `GET /api/inventory` |
| Documentos PGR | `GET/POST /api/pgr-documents` (INVENTORY, ACTION_PLAN, CRITERIA) |
| Mudanças | `GET/POST /api/change-events` |
| AEP | `GET/POST /api/aeps`, `GET/PATCH …/:id`, `POST …/conclude`, `…/hazards`, `…/evidences` |
| Fatores psicossociais | `GET /api/psychosocial-factors` (catálogo orientativo) |
| Levantamento preliminar | `GET/POST /api/preliminary-surveys`, `GET …/:id`, `POST …/:id/items` |
| Ocorrências | `GET/POST /api/occurrences`, `GET/PATCH …/:id`, `POST …/analyze`, `…/actions`, `…/evidences` |
| Emergências | `GET/POST /api/emergency-procedures`, `GET/PATCH/DELETE …/:id`, `POST …/drills`, `GET …/drills/:drillId`, `POST …/drills/:drillId/evidences` |

`organizationId` sempre vem da sessão (nunca do body).  
Completar ação exige ≥1 evidência; quem executou não valida; aprovar marca controle como implementado.  
Documentos PGR são append-only (versão++) com responsável e declaração de assinatura.  
AEP: questionário exige anonimato; concluir sem fator exige `findings`; `needs_aet` exige motivo; fator vira Hazard PSYCHOSOCIAL no inventário.  
Preliminar (1.5.4.2): `IMMEDIATE_MEASURE` exige `measure_taken`; `DEFERRED_TO_ACTION_PLAN` cria Hazard + Action; `ESCALATED_TO_ASSESSMENT` cria Hazard.  
Ocorrência (1.5.5.5): análise exige os 3 campos da norma; se houver `risk_id`, marca reassessment; ações nascem com `sourceType=OCCURRENCE`.  
Emergência (1.5.6): procedimento exige meios/responsáveis/evacuação; drill grava exercício; evidência do simulado em `…/drills/:id/evidences` (1.5.6.3.1).

Constantes de domínio (enums, limites de upload, PGR obrigatório) ficam em `server/src/constants.ts`.

## Prisma

```bash
npm run db:generate
```

Modelos de domínio serão adicionados em `prisma/schema.prisma` conforme a migração por módulos.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Todos os campos da denúncia são obrigatórios. [C1-4]
 *
 * A categoria vinha pré-escolhida ("Assédio moral"), "anônima" vinha
 * marcada e "comitê envolvido" vinha desmarcada: quem não mexia mandava o
 * que não escolheu. Agora a tela começa sem resposta e o servidor também
 * cobra, dizendo qual campo faltou. No canal público a identificação não é
 * pedida — ele é sempre anônimo. [S4-L]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const EST_ID = "aaaaaaaa-0001-4000-8000-000000000011";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let colaborador: { token: string };
const relatos: string[] = [];

const completo = {
  category: "MISCONDUCT",
  establishment_id: EST_ID,
  description: `Relato completo de teste ${SUFIXO}, com mais de vinte caracteres.`,
  is_anonymous: true,
  committee_involved: false,
};

beforeAll(async () => {
  app = createApp();
  const res = await request(app).post("/api/auth").send({ login: "teste.colaborador", password: SENHA });
  expect(res.status).toBe(200);
  colaborador = res.body;
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: relatos } } });
  await prisma.ethicsReport.deleteMany({ where: { id: { in: relatos } } });
});

function sem(campo: keyof typeof completo) {
  const { [campo]: _fora, ...resto } = completo;
  return resto;
}

describe("dentro do portal, cada campo que falta é recusado com o nome dele [C1-4]", () => {
  for (const campo of [
    "category",
    "establishment_id",
    "description",
    "is_anonymous",
    "committee_involved",
  ] as const) {
    it(`sem ${campo}: 400`, async () => {
      const res = await request(app)
        .post("/api/ethics-reports")
        .set(as(colaborador.token))
        .send(sem(campo));
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.field).toBe(campo);
    });
  }

  it("resposta que não é Sim/Não não vale como resposta", async () => {
    for (const [campo, valor] of [
      ["committee_involved", "false"],
      ["is_anonymous", null],
    ] as const) {
      const res = await request(app)
        .post("/api/ethics-reports")
        .set(as(colaborador.token))
        .send({ ...completo, [campo]: valor });
      expect(res.status, `${campo}=${String(valor)}`).toBe(400);
      expect(res.body.field).toBe(campo);
    }
  });

  it("com tudo respondido, entra — e a resposta \"Sim\" ao comitê vale", async () => {
    const res = await request(app)
      .post("/api/ethics-reports")
      .set(as(colaborador.token))
      .send({ ...completo, committee_involved: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    relatos.push(res.body.report.id);
    const lido = await prisma.ethicsReport.findUniqueOrThrow({
      where: { id: res.body.report.id },
      select: { committeeInvolved: true, isAnonymous: true },
    });
    expect(lido).toEqual({ committeeInvolved: true, isAnonymous: true });
  });
});

describe("no canal público, a identificação não é pedida [C1-4] [S4-L]", () => {
  it("sem is_anonymous, entra anônima", async () => {
    const res = await request(app)
      .post("/api/ethics-reports")
      .send({ ...sem("is_anonymous"), organization_id: ORG_ID });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    relatos.push(res.body.report.id);
    expect(res.body.report.isAnonymous).toBe(true);
  });

  it("sem a resposta sobre o comitê, é recusada", async () => {
    const res = await request(app)
      .post("/api/ethics-reports")
      .send({ ...sem("committee_involved"), organization_id: ORG_ID });
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("committee_involved");
  });
});

describe("a tela começa sem resposta marcada [C1-4]", () => {
  const tela = readFileSync(
    join(__dirname, "../../../client/src/pages/EthicsReportPage.tsx"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  it("a categoria não é pré-escolhida", () => {
    expect(tela).not.toMatch(/setCategory\(ids\[0\]\)/);
    expect(tela).toContain('<option value="">Selecione…</option>');
  });

  it("as perguntas Sim/Não começam sem resposta", () => {
    expect(tela).toMatch(/const \[isAnonymous, setIsAnonymous\] = useState<boolean \| null>\(null\)/);
    expect(tela).toMatch(/const \[envolveComite, setEnvolveComite\] = useState<boolean \| null>\(null\)/);
    expect(tela).not.toMatch(/type="checkbox"/);
  });
});

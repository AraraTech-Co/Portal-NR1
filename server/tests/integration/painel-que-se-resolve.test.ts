import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O seletor de unidade e os cartões que a tela consegue resolver.
 *
 * Escolher um estabelecimento no Painel da fiscalização fazia o seletor
 * sumir: a lista vinha filtrada pela unidade escolhida, e a tela só mostra o
 * seletor quando há mais de uma [B2-1-B]. E quatro cartões dependiam de
 * cadastros sem tela — a empresa fazia tudo o que o portal permitia e a
 * pendência continuava lá [B2-4-C].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst: string;
let unidadeA = "";
let unidadeB = "";
let setorB = "";
const criados: { aeps: string[]; funcoes: string[]; exigencias: string[]; exames: string[] } = {
  aeps: [],
  funcoes: [],
  exigencias: [],
  exames: [],
};

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

async function painel(qs = "") {
  const res = await request(app).get(`/api/fiscalizacao${qs}`).set(as(sst));
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  return res.body as {
    establishments: { id: string; name: string }[];
    establishment_id: string | null;
    checks: { id: string; status: string; items: { label: string; ok: boolean }[] }[];
  };
}

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");

  const unidades = await prisma.establishment.findMany({
    where: { organizationId: ORG_ID, archivedAt: null },
    orderBy: { name: "asc" },
    select: { id: true },
    take: 2,
  });
  expect(unidades.length, "duas unidades no banco local").toBeGreaterThan(1);
  unidadeA = unidades[0]!.id;
  unidadeB = unidades[1]!.id;

  const setor = await prisma.sector.findFirst({
    where: { organizationId: ORG_ID },
    select: { id: true },
  });
  setorB = setor!.id;
});

afterAll(async () => {
  await prisma.jobRoleRequirement.deleteMany({ where: { id: { in: criados.exigencias } } });
  await prisma.occupationalExam.deleteMany({ where: { id: { in: criados.exames } } });
  await prisma.jobRole.deleteMany({ where: { id: { in: criados.funcoes } } });
  await prisma.aep.deleteMany({ where: { id: { in: criados.aeps } } });
});

describe("o seletor de unidade não some [B2-1-B]", () => {
  it("escolher uma unidade não encolhe a lista do seletor", async () => {
    const todas = await painel();
    expect(todas.establishments.length).toBeGreaterThan(1);
    expect(todas.establishment_id).toBeNull();

    const umaSo = await painel(`?establishment_id=${unidadeA}`);
    expect(umaSo.establishment_id).toBe(unidadeA);
    /*
      É este o defeito: a lista vinha com uma unidade só e a tela escondia o
      seletor, então não dava para trocar de unidade nem voltar a "Todas"
      sem recarregar.
    */
    expect(umaSo.establishments.length).toBe(todas.establishments.length);
    expect(umaSo.establishments.map((e) => e.id)).toContain(unidadeB);
  });

  it("as verificações, essas sim, ficam só da unidade escolhida", async () => {
    const todas = await painel();
    const umaSo = await painel(`?establishment_id=${unidadeA}`);

    const emergenciaTodas = todas.checks.find((c) => c.id === "emergencia");
    const emergenciaUma = umaSo.checks.find((c) => c.id === "emergencia");
    expect(emergenciaTodas, "o cartão de emergência").toBeTruthy();
    expect(emergenciaUma!.items.length).toBe(1);
    expect(emergenciaTodas!.items.length).toBe(todas.establishments.length);
  });
});

describe("os cartões se resolvem pela tela [B2-4-C]", () => {
  it("a avaliação ergonômica concluída pela rota resolve o cartão", async () => {
    const antes = await painel(`?establishment_id=${unidadeB}`);
    const cartaoAntes = antes.checks.find((c) => c.id === "aep");
    expect(cartaoAntes!.items[0]!.ok, "a unidade começa sem AEP concluída").toBe(false);

    const criada = await request(app)
      .post("/api/aeps")
      .set(as(sst))
      .send({
        establishment_id: unidadeB,
        scope_description: `Posto avaliado ${SUFIXO}`,
      });
    expect(criada.status, JSON.stringify(criada.body)).toBe(201);
    criados.aeps.push(criada.body.aep.id);

    // Rascunho ainda não resolve: o painel pede a concluída.
    const comRascunho = await painel(`?establishment_id=${unidadeB}`);
    expect(comRascunho.checks.find((c) => c.id === "aep")!.items[0]!.ok).toBe(false);

    const fechada = await request(app)
      .post(`/api/aeps/${criada.body.aep.id}/conclude`)
      .set(as(sst))
      .send({ findings: `Constatações ${SUFIXO}`, needs_aet: false });
    expect(fechada.status, JSON.stringify(fechada.body)).toBe(200);

    const depois = await painel(`?establishment_id=${unidadeB}`);
    expect(depois.checks.find((c) => c.id === "aep")!.items[0]!.ok).toBe(true);
  });

  it("a exigência por função entra pela rota que a tela usa", async () => {
    const funcao = await prisma.jobRole.create({
      data: {
        organizationId: ORG_ID,
        sectorId: setorB,
        name: `Função exigente ${SUFIXO}`,
      },
      select: { id: true },
    });
    criados.funcoes.push(funcao.id);

    const res = await request(app)
      .post("/api/job-role-requirements")
      .set(as(sst))
      .send({
        job_role_id: funcao.id,
        name: `NR-35 trabalho em altura ${SUFIXO}`,
        kind: "TRAINING",
        validity_months: 24,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    criados.exigencias.push(res.body.requirement.id);

    const lista = await request(app)
      .get("/api/job-role-requirements")
      .set(as(sst));
    expect(
      lista.body.requirements.map((r: { id: string }) => r.id),
    ).toContain(res.body.requirement.id);
  });

  it("o exame ocupacional entra pela rota que a tela usa", async () => {
    const colaborador = await request(app)
      .post("/api/auth")
      .send({ login: "teste.colaborador", password: SENHA });
    const res = await request(app)
      .post("/api/occupational-exams")
      .set(as(sst))
      .send({
        user_id: colaborador.body.user.id,
        kind: "PERIODIC",
        performed_at: "2026-10-01",
        due_at: "2027-10-01",
        fit: true,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    criados.exames.push(res.body.exam.id);
  });
});

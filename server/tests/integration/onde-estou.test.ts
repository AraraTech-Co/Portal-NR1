import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * A ordem das funções e a conta em que estou.
 *
 * A lista de funções era a ordem de criação, sem como mudá-la: a função nova
 * ia para o fim e a parecida ficava longe [S1-I]. E a conta ativa só se via
 * no Início e dentro de Conta e usuários, onde também morava a única forma
 * de trocar de conta [S1-K].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst = "";
let colaborador = "";
let setor = "";
let outroSetor = "";
const funcoesCriadas: string[] = [];
const setoresCriados: string[] = [];
const contasCriadas: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

async function criarSetor(establishmentId: string, nome: string) {
  const res = await request(app)
    .post("/api/sectors")
    .set(as(sst))
    .send({ establishment_id: establishmentId, name: nome });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  setoresCriados.push(res.body.sector.id);
  return res.body.sector.id as string;
}

async function criarFuncao(sectorId: string, nome: string) {
  const res = await request(app)
    .post("/api/job-roles")
    .set(as(sst))
    .send({ sector_id: sectorId, name: nome });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  funcoesCriadas.push(res.body.job_role.id);
  return res.body.job_role as { id: string; name: string; position: number };
}

/*
  Os nomes na ordem em que a tela os recebe. O setor é criado aqui, então a
  lista é inteira deste teste — sem filtrar nada, é a ponta de verdade que a
  tela vê.
*/
async function nomesDoSetor(sectorId: string) {
  const res = await request(app)
    .get(`/api/job-roles?sector_id=${sectorId}`)
    .set(as(sst));
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  return (res.body.job_roles as { name: string }[]).map((j) => j.name);
}

async function mover(id: string, para: string, token = sst) {
  return request(app).patch(`/api/job-roles/${id}/ordem`).set(as(token)).send({ para });
}

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  colaborador = await entrar("teste.colaborador");

  const unidade = await prisma.establishment.findFirstOrThrow({
    where: { organizationId: ORG_ID, archivedAt: null },
    select: { id: true },
  });
  setor = await criarSetor(unidade.id, `Setor da ordem ${SUFIXO}`);
  outroSetor = await criarSetor(unidade.id, `Setor vizinho ${SUFIXO}`);
});

afterAll(async () => {
  await prisma.jobRole.deleteMany({ where: { id: { in: funcoesCriadas } } });
  await prisma.sector.deleteMany({ where: { id: { in: setoresCriados } } });
  await prisma.account.deleteMany({ where: { id: { in: contasCriadas } } });
});

describe("a ordem das funções é da empresa [S1-I]", () => {
  it("a função nova entra no fim, com o lugar seguinte", async () => {
    const a = await criarFuncao(setor, `Torneiro A ${SUFIXO}`);
    const b = await criarFuncao(setor, `Soldador B ${SUFIXO}`);
    const c = await criarFuncao(setor, `Torneiro C ${SUFIXO}`);

    expect(a.position).toBe(0);
    expect(b.position).toBe(1);
    expect(c.position).toBe(2);
    expect(await nomesDoSetor(setor)).toEqual([a.name, b.name, c.name]);
  });

  it("subir a última junta as parecidas, e a lista guarda isso", async () => {
    const [, , terceira] = await nomesDoSetor(setor);
    const c = await prisma.jobRole.findFirstOrThrow({
      where: { sectorId: setor, name: terceira },
      select: { id: true },
    });

    const res = await mover(c.id, "cima");
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    /*
      É o defeito do achado: antes daqui "Torneiro C" não tinha como sair do
      fim, e ficava separado de "Torneiro A".
    */
    const depois = await nomesDoSetor(setor);
    expect(depois[1]).toBe(terceira);
    expect(depois[0]).toContain("Torneiro A");
    expect(depois[1]).toContain("Torneiro C");
    expect(depois[2]).toContain("Soldador B");
  });

  it("duas trocas seguidas continuam valendo — a sequência é regravada inteira", async () => {
    const antes = await nomesDoSetor(setor);
    const primeira = await prisma.jobRole.findFirstOrThrow({
      where: { sectorId: setor, name: antes[0]! },
      select: { id: true },
    });

    expect((await mover(primeira.id, "baixo")).status).toBe(200);
    expect(await nomesDoSetor(setor)).toEqual([antes[1]!, antes[0]!, antes[2]!]);

    expect((await mover(primeira.id, "baixo")).status).toBe(200);
    expect(await nomesDoSetor(setor)).toEqual([antes[1]!, antes[2]!, antes[0]!]);
  });

  it("na ponta não há o que trocar, e isso não é erro", async () => {
    const antes = await nomesDoSetor(setor);
    const primeira = await prisma.jobRole.findFirstOrThrow({
      where: { sectorId: setor, name: antes[0]! },
      select: { id: true },
    });
    const res = await mover(primeira.id, "cima");
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await nomesDoSetor(setor)).toEqual(antes);
  });

  it("a ordem é de cada setor: mexer num não mexe no outro", async () => {
    const x = await criarFuncao(outroSetor, `Conferente X ${SUFIXO}`);
    const y = await criarFuncao(outroSetor, `Conferente Y ${SUFIXO}`);
    const antesAqui = await nomesDoSetor(setor);

    expect((await mover(y.id, "cima")).status).toBe(200);

    expect(await nomesDoSetor(outroSetor)).toEqual([y.name, x.name]);
    expect(await nomesDoSetor(setor)).toEqual(antesAqui);
  });

  it("para onde? só cima ou baixo", async () => {
    const alguma = funcoesCriadas[0]!;
    const res = await mover(alguma, "para o lado");
    expect(res.status).toBe(400);
  });

  it("quem só lê a operação não reordena nada", async () => {
    const antes = await nomesDoSetor(setor);
    const alguma = await prisma.jobRole.findFirstOrThrow({
      where: { sectorId: setor, name: antes[0]! },
      select: { id: true },
    });
    const res = await mover(alguma.id, "baixo", colaborador);
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(await nomesDoSetor(setor)).toEqual(antes);
  });
});

describe("em que conta eu estou [S1-K]", () => {
  it("a sessão diz quais contas a pessoa alcança", async () => {
    const master = await entrar("teste.master");
    const res = await request(app).get("/api/auth").set(as(master));
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    expect(Array.isArray(res.body.accounts)).toBe(true);
    expect(res.body.accounts.length).toBeGreaterThan(0);
    expect(res.body.accounts.map((a: { id: string }) => a.id)).toContain(
      res.body.user.account.id,
    );
  });

  it("trocar de conta devolve a lista junto, para o menu não ficar atrasado", async () => {
    const segunda = await prisma.account.create({
      data: { organizationId: ORG_ID, name: `Conta Vizinha ${SUFIXO}` },
      select: { id: true, name: true },
    });
    contasCriadas.push(segunda.id);

    const master = await entrar("teste.master");
    const antes = await request(app).get("/api/auth").set(as(master));
    expect(antes.body.accounts.length).toBeGreaterThan(1);

    const troca = await request(app)
      .post("/api/auth/switch")
      .set(as(master))
      .send({ account_id: segunda.id });
    expect(troca.status, JSON.stringify(troca.body).slice(0, 200)).toBe(200);
    expect(troca.body.user.account.id).toBe(segunda.id);
    /*
      É isto que faltava: a troca saiu de dentro de Conta e usuários e passou
      para o rodapé do menu, que precisa da lista nova sem outra ida ao
      servidor.
    */
    expect(Array.isArray(troca.body.accounts)).toBe(true);
    expect(troca.body.accounts.map((a: { id: string }) => a.id)).toContain(segunda.id);
    expect(troca.body.accounts.length).toBe(antes.body.accounts.length);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import type { Express } from "express";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { canonicalRegistration } from "../../src/helper/auth-attempts";

/**
 * Filial na ficha e matrícula única por filial. [C3-2]
 *
 * Duas filiais (A e B) da organização de teste, com uma função em cada. A
 * ficha guarda a filial; com função, é sempre a da função (o banco grava).
 * A mesma matrícula pode existir em A e em B; dentro da mesma filial, "74" e
 * "074" são a mesma e não podem ser de duas pessoas.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const ACCOUNT_ID = "aaaaaaaa-0001-4000-8000-000000000002";
const SENHA = ["filial", "na", "ficha"].join("-");
const SUFIXO = Date.now().toString(36);
/** Matrícula numérica inédita a cada execução (curta: nunca forma CPF). */
const NUM = String(2_000_000 + (Date.now() % 7_000_000));

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

/** CPF válido e inédito a cada execução. */
function cpfFicticio(semente: number): string {
  const base = String(100000000 + (semente % 800000000));
  const digitos = base.split("").map(Number);
  const verificador = (tamanho: number) => {
    const soma = digitos.slice(0, tamanho).reduce((t, d, i) => t + d * (tamanho + 1 - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  digitos.push(verificador(9));
  digitos.push(verificador(10));
  return digitos.join("");
}

let app: Express;
let rh: { token: string };
const usuarios: string[] = [];
const unidades: string[] = [];

type Filial = { id: string; jobRoleId: string };
let filialA: Filial;
let filialB: Filial;
let admA: { id: string; token: string };

async function filial(nome: string): Promise<Filial> {
  const est = await prisma.establishment.create({
    data: { organizationId: ORG_ID, name: `C32 ${nome} ${SUFIXO}` },
  });
  unidades.push(est.id);
  const setor = await prisma.sector.create({
    data: { organizationId: ORG_ID, establishmentId: est.id, name: `Setor ${nome}` },
  });
  const funcao = await prisma.jobRole.create({
    data: { organizationId: ORG_ID, sectorId: setor.id, name: `Função ${nome}` },
  });
  return { id: est.id, jobRoleId: funcao.id };
}

async function entrar(login: string, password = SENHA) {
  const res = await request(app).post("/api/auth").send({ login, password });
  expect(res.status, `${login}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

/** Pessoa com vínculo na empresa e sem ficha. */
async function membro(nome: string, role: Role = Role.COLABORADOR) {
  const login = `c32.${nome}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: { login, name: `C32 ${nome}`, passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  usuarios.push(user.id);
  await prisma.accountMembership.create({
    data: { accountId: ACCOUNT_ID, userId: user.id, role: AccountRole.USER },
  });
  await prisma.membership.create({ data: { userId: user.id, organizationId: ORG_ID, role } });
  return { id: user.id, login };
}

const criarFicha = (body: Record<string, unknown>) =>
  request(app).post("/api/employee-profiles").set(as(rh.token)).send(body);

const editarFicha = (id: string, body: Record<string, unknown>) =>
  request(app).patch(`/api/employee-profiles/${id}`).set(as(rh.token)).send(body);

const ficha = (userId: string) =>
  prisma.employeeProfile.findFirstOrThrow({
    where: { organizationId: ORG_ID, userId },
    select: { id: true, establishmentId: true, registrationKey: true, jobRoleId: true },
  });

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh", ["teste", "1234"].join(""));
  filialA = await filial("A");
  filialB = await filial("B");
  const adm = await membro("adm-a", Role.ADM_LOJA);
  admA = { id: adm.id, token: (await entrar(adm.login)).token };
  const atribuir = await request(app)
    .put(`/api/pessoas-acessos/${adm.id}/unidades`)
    .set(as(rh.token))
    .send({ establishment_ids: [filialA.id] });
  expect(atribuir.status, JSON.stringify(atribuir.body)).toBe(200);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.user.deleteMany({ where: { name: { startsWith: `C32 Planilha ${SUFIXO}` } } });
  await prisma.jobRole.deleteMany({ where: { sector: { establishmentId: { in: unidades } } } });
  await prisma.sector.deleteMany({ where: { establishmentId: { in: unidades } } });
  await prisma.establishment.deleteMany({ where: { id: { in: unidades } } });
});

describe("o banco grava a filial e a chave da matrícula [C3-2]", () => {
  it("com função, a filial é a da função; a chave é a matrícula canônica", async () => {
    const p = await membro("gatilho");
    const criada = await prisma.employeeProfile.create({
      data: { organizationId: ORG_ID, userId: p.id, jobRoleId: filialA.jobRoleId, registration: ` 000${NUM} ` },
      select: { id: true, establishmentId: true, registrationKey: true },
    });
    expect(criada.establishmentId).toBe(filialA.id);
    expect(criada.registrationKey).toBe(NUM);

    // Escrita direta tentando outra filial: a função manda.
    const forcada = await prisma.employeeProfile.update({
      where: { id: criada.id },
      data: { establishmentId: filialB.id, registration: "col-01" },
      select: { establishmentId: true, registrationKey: true },
    });
    expect(forcada.establishmentId, "ficha e função não divergem").toBe(filialA.id);
    expect(forcada.registrationKey).toBe("COL-01");

    // Trocar a função leva a filial junto.
    const trocada = await prisma.employeeProfile.update({
      where: { id: criada.id },
      data: { jobRoleId: filialB.jobRoleId },
      select: { establishmentId: true },
    });
    expect(trocada.establishmentId).toBe(filialB.id);
  });
});

describe("a chave da matrícula apara como o servidor [C3-2]", () => {
  it("banco e servidor aparam as pontas do mesmo jeito, caractere a caractere", async () => {
    /*
      Cada caractere do plano básico, nas duas pontas de "074": o banco
      apara exatamente o que o `trim` do JavaScript apara. Pega o espaço
      duro do Excel e qualquer outro que um lado apare e o outro não.
    */
    const entradas: string[] = [];
    for (let c = 1; c <= 0xffff; c++) {
      if (c >= 0xd800 && c <= 0xdfff) continue;
      const ch = String.fromCharCode(c);
      entradas.push(`${ch}074${ch}`);
    }
    const linhas = await prisma.$queryRaw<{ i: bigint; aparada: string }[]>`
      SELECT i, nr1_trim_like_js(x) AS aparada
        FROM unnest(${entradas}::text[]) WITH ORDINALITY AS t(x, i)`;
    const divergentes = linhas
      .filter((l) => l.aparada !== entradas[Number(l.i) - 1].trim())
      .map((l) => entradas[Number(l.i) - 1].codePointAt(0)!.toString(16));
    expect(linhas).toHaveLength(entradas.length);
    expect(divergentes, "caracteres que banco e servidor aparam diferente").toEqual([]);

    // E a chave inteira coincide para todo caractere que o trim tira.
    const brancos = entradas.filter((e) => e.trim() === "074");
    expect(brancos.length).toBeGreaterThan(20);
    const chaves = await prisma.$queryRaw<{ chave: string }[]>`
      SELECT nr1_registration_key(x) AS chave FROM unnest(${brancos}::text[]) AS t(x)`;
    expect(new Set(chaves.map((c) => c.chave))).toEqual(new Set([canonicalRegistration("074")]));
  });

  it("matrícula colada com espaço duro entra pelo número e não duplica na filial", async () => {
    const NBSP = "\u00a0";
    const importar = (linhas: Record<string, unknown>[]) =>
      request(app).post("/api/pessoas-acessos/importar").set(as(rh.token)).send({ people: linhas });
    const res = await importar([
      { name: `C32 Planilha ${SUFIXO} nbsp`, registration: `${NBSP}05${NUM}`, job_role_id: filialA.jobRoleId },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.results[0].status).toBe("created");
    const login = res.body.results[0].login as string;
    await prisma.user.update({
      where: { login },
      data: { passwordHash: await bcrypt.hash(SENHA, 4), activatedAt: new Date() },
    });
    const porNumero = await request(app).post("/api/auth").send({ login: `5${NUM}`, password: SENHA });
    expect(porNumero.status, "entra pelo número sem o espaço").toBe(200);
    expect(porNumero.body.user.login).toBe(login);

    // Escrita direta no banco, sem o trim da aplicação: o gatilho apara igual.
    const outro = await membro("nbsp-dup");
    await expect(
      prisma.employeeProfile.create({
        data: {
          organizationId: ORG_ID,
          userId: outro.id,
          jobRoleId: filialA.jobRoleId,
          registration: `${NBSP}5${NUM}${NBSP}`,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});

describe("a filial na criação e na edição da ficha [C3-2]", () => {
  it("cria com a filial da função, ou com a escolhida quando não há função", async () => {
    const comFuncao = await membro("cria-funcao");
    const r1 = await criarFicha({ user_id: comFuncao.id, job_role_id: filialB.jobRoleId });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    expect((await ficha(comFuncao.id)).establishmentId).toBe(filialB.id);

    const semFuncao = await membro("cria-filial");
    const r2 = await criarFicha({ user_id: semFuncao.id, establishment_id: filialA.id });
    expect(r2.status, JSON.stringify(r2.body)).toBe(201);
    const f2 = await ficha(semFuncao.id);
    expect(f2.establishmentId).toBe(filialA.id);
    expect(f2.jobRoleId).toBeNull();
  });

  it("recusa a função de uma filial com outra filial escolhida, e ficha sem filial", async () => {
    const p = await membro("cria-recusa");
    const divergente = await criarFicha({
      user_id: p.id,
      job_role_id: filialA.jobRoleId,
      establishment_id: filialB.id,
    });
    expect(divergente.status).toBe(400);
    expect(divergente.body.field).toBe("establishment_id");

    // A organização de teste tem várias filiais: sem função, escolher é obrigatório.
    const semNada = await criarFicha({ user_id: p.id });
    expect(semNada.status).toBe(400);
    expect(semNada.body.message).toBe("Escolha a filial.");
    expect(await prisma.employeeProfile.count({ where: { userId: p.id } })).toBe(0);
  });

  it("troca de função leva a filial; trocar só a filial com função de outra é recusado", async () => {
    const p = await membro("edita");
    expect((await criarFicha({ user_id: p.id, job_role_id: filialA.jobRoleId })).status).toBe(201);
    const { id } = await ficha(p.id);

    const novaFuncao = await editarFicha(id, { job_role_id: filialB.jobRoleId });
    expect(novaFuncao.status, JSON.stringify(novaFuncao.body)).toBe(200);
    expect((await ficha(p.id)).establishmentId).toBe(filialB.id);

    const soFilial = await editarFicha(id, { establishment_id: filialA.id });
    expect(soFilial.status).toBe(400);
    expect(soFilial.body.message).toBe("A função escolhida é de outra filial.");
    expect((await ficha(p.id)).establishmentId).toBe(filialB.id);

    // Tirando a função, a filial escolhida vale.
    const semFuncao = await editarFicha(id, { job_role_id: null, establishment_id: filialA.id });
    expect(semFuncao.status, JSON.stringify(semFuncao.body)).toBe(200);
    const depois = await ficha(p.id);
    expect(depois.jobRoleId).toBeNull();
    expect(depois.establishmentId).toBe(filialA.id);
  });
});

describe("matrícula única por filial [C3-2]", () => {
  it("a mesma matrícula em duas filiais é de duas pessoas; na mesma filial, não", async () => {
    const emA = await membro("mat-a");
    const emB = await membro("mat-b");
    const dupla = await membro("mat-a2");
    expect(
      (await criarFicha({ user_id: emA.id, job_role_id: filialA.jobRoleId, registration: `9${NUM}` })).status,
    ).toBe(201);
    const naOutra = await criarFicha({ user_id: emB.id, job_role_id: filialB.jobRoleId, registration: `9${NUM}` });
    expect(naOutra.status, JSON.stringify(naOutra.body)).toBe(201);

    // "09…" é a mesma matrícula que "9…" na filial A.
    const repetida = await criarFicha({ user_id: dupla.id, job_role_id: filialA.jobRoleId, registration: `09${NUM}` });
    expect(repetida.status).toBe(409);
    expect(await prisma.employeeProfile.count({ where: { userId: dupla.id } })).toBe(0);
  });

  it("a planilha põe a ficha na filial da função e casa a matrícula dentro dela", async () => {
    const importar = (linhas: Record<string, unknown>[]) =>
      request(app).post("/api/pessoas-acessos/importar").set(as(rh.token)).send({ people: linhas });
    const nome = (s: string) => `C32 Planilha ${SUFIXO} ${s}`;

    const res = await importar([
      { name: nome("A"), registration: `8${NUM}`, job_role_id: filialA.jobRoleId },
      { name: nome("B"), registration: `08${NUM}`, job_role_id: filialB.jobRoleId },
      { name: nome("sem função"), registration: `7${NUM}`, establishment_id: filialB.id },
      { name: nome("divergente"), registration: `6${NUM}`, job_role_id: filialA.jobRoleId, establishment_id: filialB.id },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [a, b, semFuncao, divergente] = res.body.results as { status: string; message?: string }[];
    expect(a.status).toBe("created");
    expect(b.status, "mesma matrícula, outra filial: outra pessoa").toBe("created");
    expect(semFuncao.status).toBe("created");
    expect(divergente.status).toBe("error");
    expect(divergente.message).toBe("A função escolhida é de outra filial.");

    const fichas = await prisma.employeeProfile.findMany({
      where: { organizationId: ORG_ID, user: { name: { startsWith: `C32 Planilha ${SUFIXO}` } } },
      select: { establishmentId: true, registrationKey: true, user: { select: { name: true } } },
    });
    const porNome = Object.fromEntries(fichas.map((f) => [f.user.name, f]));
    expect(porNome[nome("A")].establishmentId).toBe(filialA.id);
    expect(porNome[nome("B")].establishmentId).toBe(filialB.id);
    expect(porNome[nome("B")].registrationKey).toBe(`8${NUM}`);
    expect(porNome[nome("sem função")].establishmentId).toBe(filialB.id);

    /*
      Reimportar a pessoa de B com outra grafia da matrícula: é ela, não
      outra — a planilha completa o CPF que faltava na ficha dela. Se não
      a achasse, tentaria criar outra e cairia na unicidade ("pulada").
    */
    const cpf = cpfFicticio(Date.now());
    const de_novo = await importar([
      { name: nome("B"), registration: `0008${NUM}`, job_role_id: filialB.jobRoleId, tax_id: cpf },
    ]);
    expect(de_novo.status).toBe(201);
    expect(de_novo.body.results[0].status, JSON.stringify(de_novo.body.results[0])).toBe("completed");
    expect(de_novo.body.results[0].filled).toContain("CPF");
    const deB = await prisma.employeeProfile.findFirstOrThrow({
      where: { organizationId: ORG_ID, establishmentId: filialB.id, registrationKey: `8${NUM}` },
      select: { taxId: true },
    });
    expect(deB.taxId).toBe(cpf);
  });
});

describe("o recorte lê a filial da ficha [C3-2]", () => {
  it("o ADM da filial A vê a ficha sem função que é da filial A, e não a da B", async () => {
    const pA = await membro("recorte-a");
    const pB = await membro("recorte-b");
    expect((await criarFicha({ user_id: pA.id, establishment_id: filialA.id })).status).toBe(201);
    expect((await criarFicha({ user_id: pB.id, establishment_id: filialB.id })).status).toBe(201);

    const lista = await request(app).get("/api/employee-profiles").set(as(admA.token));
    expect(lista.status).toBe(200);
    const ids = (lista.body.profiles as { userId: string }[]).map((p) => p.userId);
    expect(ids).toContain(pA.id);
    expect(ids).not.toContain(pB.id);

    // A ficha devolve a filial para a tela.
    const minha = (lista.body.profiles as { userId: string; establishment: { id: string } | null }[]).find(
      (p) => p.userId === pA.id,
    );
    expect(minha?.establishment?.id).toBe(filialA.id);
  });

  it("a lista do RH filtra as fichas sem filial", async () => {
    const p = await membro("sem-filial");
    // Ficha antiga, sem função e sem filial (como sai da migração).
    await prisma.employeeProfile.create({ data: { organizationId: ORG_ID, userId: p.id } });
    const sem = await request(app).get("/api/employee-profiles?establishment_id=sem").set(as(rh.token));
    expect(sem.status).toBe(200);
    const ids = (sem.body.profiles as { userId: string; establishmentId: string | null }[]);
    expect(ids.map((x) => x.userId)).toContain(p.id);
    expect(ids.every((x) => x.establishmentId === null)).toBe(true);
  });
});

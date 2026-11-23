import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { FALTA_CPF, FALTA_MATRICULA, FALTA_NASCIMENTO } from "../../src/helper/identidade";

/**
 * Matrícula, CPF e nascimento obrigatórios em todo cadastro com ficha, e
 * filial sem duplicar. Decisões do Léo em 23/11/2026.
 *
 * Usa a organização do `scripts/seed-teste-org.ts`. Tudo o que é criado aqui
 * é apagado no fim.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const JOB_ID = "aaaaaaaa-0001-4000-8000-000000000013";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

let app: Express;
const token: Record<string, string> = {};
const usuarios: string[] = [];

function cpfFicticio(semente: number): string {
  const base = String(100000000 + (semente % 800000000));
  const d = base.split("").map(Number);
  const dv = (n: number) => {
    const r = (d.slice(0, n).reduce((t, x, i) => t + x * (n + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dv(9));
  d.push(dv(10));
  return d.join("");
}

function cnpjFicticio(semente: number): string {
  const d = String(10000000 + (semente % 89999999)).padStart(8, "0").split("").map(Number);
  d.push(0, 0, 0, 1);
  const dv = (pesos: number[]) => {
    const r = d.slice(0, pesos.length).reduce((t, x, i) => t + x * pesos[i]!, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  d.push(dv([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  d.push(dv([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  return d.join("");
}

const nova = (n: number, extra: Record<string, unknown> = {}) => ({
  name: `Identidade ${n} ${SUFIXO}`,
  tax_id: cpfFicticio(Date.now() + n * 104729),
  registration: `ID${n}${SUFIXO}`.slice(0, 12),
  birth_date: "1990-05-10",
  job_role_id: JOB_ID,
  ...extra,
});
const importar = (people: Record<string, unknown>[], dry_run = false) =>
  request(app).post("/api/pessoas-acessos/importar").set(as(token.rh!)).send({ people, dry_run });

beforeAll(async () => {
  app = createApp();
  for (const quem of ["rh", "master", "gerente"]) {
    const res = await request(app).post("/api/auth").send({ login: `teste.${quem}`, password: SENHA });
    expect(res.status, `login de ${quem}`).toBe(200);
    token[quem] = res.body.token;
  }
});

afterAll(async () => {
  const pessoas = await prisma.user.findMany({ where: { name: { endsWith: SUFIXO } }, select: { id: true } });
  const ids = [...new Set([...usuarios, ...pessoas.map((u) => u.id)])];
  const fichas = await prisma.employeeProfile.findMany({ where: { userId: { in: ids } }, select: { id: true } });
  const filiais = await prisma.establishment.findMany({ where: { name: { contains: SUFIXO } }, select: { id: true } });
  await prisma.auditEvent.deleteMany({
    where: { entityId: { in: [...ids, ...fichas.map((f) => f.id), ...filiais.map((f) => f.id)] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.establishment.deleteMany({ where: { id: { in: filiais.map((f) => f.id) } } });
});

describe("a planilha: a pessoa nova entra com matrícula, CPF e nascimento", () => {
  it("sem cada um, ou com texto só de espaço, a linha é erro, com e sem conferir, e nada é gravado", async () => {
    const casos: [Record<string, unknown>, string][] = [
      [{ birth_date: undefined }, FALTA_NASCIMENTO],
      [{ birth_date: "   " }, FALTA_NASCIMENTO],
      [{ tax_id: undefined }, FALTA_CPF],
      [{ tax_id: "  " }, FALTA_CPF],
      [{ registration: undefined }, FALTA_MATRICULA],
      [{ registration: " " }, FALTA_MATRICULA],
    ];
    for (const dry_run of [true, false]) {
      for (const [i, [falta, mensagem]] of casos.entries()) {
        const res = await importar([nova(10 + i, falta)], dry_run);
        expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
        expect(res.body.results[0], `${JSON.stringify(falta)} dry_run=${dry_run}`).toMatchObject({
          status: "error",
          message: mensagem,
        });
      }
    }
    expect(await prisma.user.count({ where: { name: { startsWith: "Identidade 1", endsWith: SUFIXO } } })).toBe(0);
  });

  it("com os três, entra; a linha que completa a ficha de quem já existe não precisa dos três", async () => {
    const p = nova(1);
    const entrou = await importar([p]);
    expect(entrou.body.results[0].status, JSON.stringify(entrou.body.results[0])).toBe("created");
    /* A mesma pessoa, pelo CPF, só com a admissão: completa a ficha. */
    const completa = await importar([{ name: p.name, tax_id: p.tax_id, admitted_at: "2024-02-01", job_role_id: JOB_ID }]);
    expect(completa.body.results[0].status, JSON.stringify(completa.body.results[0])).toBe("completed");
  });
});

describe("a ficha", () => {
  async function semFicha(n: number) {
    const user = await prisma.user.create({
      data: { login: `ident.${n}.${SUFIXO}`, name: `Sem ficha ${n} ${SUFIXO}`, passwordHash: "x" },
    });
    usuarios.push(user.id);
    await prisma.membership.create({ data: { userId: user.id, organizationId: ORG_ID, role: "COLABORADOR" } });
    return user.id;
  }
  const criar = (corpo: Record<string, unknown>) =>
    request(app).post("/api/employee-profiles").set(as(token.rh!)).send(corpo);

  it("criar a ficha pede os três", async () => {
    const userId = await semFicha(1);
    const completo = { user_id: userId, job_role_id: JOB_ID, ...nova(20) };
    for (const [chave, mensagem] of [["birth_date", FALTA_NASCIMENTO], ["tax_id", FALTA_CPF], ["registration", FALTA_MATRICULA]] as const) {
      const res = await criar({ ...completo, [chave]: "" });
      expect(res.status, chave).toBe(400);
      expect(res.body.message).toBe(mensagem);
    }
    expect(await prisma.employeeProfile.count({ where: { userId } })).toBe(0);
    const ok = await criar(completo);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const ficha = await prisma.employeeProfile.findFirstOrThrow({ where: { userId } });
    expect(ficha.birthDate?.toISOString().slice(0, 10)).toBe("1990-05-10");
  });

  it("editar: apagar o que a ficha tem dá 400 (vazio, espaço ou null), e nada muda", async () => {
    const userId = await semFicha(2);
    const ficha = await prisma.employeeProfile.create({
      data: {
        organizationId: ORG_ID,
        userId,
        taxId: cpfFicticio(Date.now() + 77),
        registration: `IDV${SUFIXO}`.slice(0, 12),
        birthDate: new Date("1990-05-10T00:00:00.000Z"),
        jobRoleId: JOB_ID,
      },
    });
    const editar = (corpo: Record<string, unknown>) =>
      request(app).patch(`/api/employee-profiles/${ficha.id}`).set(as(token.rh!)).send(corpo);
    for (const valor of ["", "   ", null]) {
      for (const [chave, mensagem] of [["birth_date", FALTA_NASCIMENTO], ["tax_id", FALTA_CPF], ["registration", FALTA_MATRICULA]] as const) {
        const res = await editar({ [chave]: valor });
        expect(res.status, `${chave}=${JSON.stringify(valor)}`).toBe(400);
        expect(res.body.message).toBe(mensagem);
      }
    }
    const depois = await prisma.employeeProfile.findUniqueOrThrow({ where: { id: ficha.id } });
    expect(depois.taxId).toBe(ficha.taxId);
    expect(depois.registration).toBe(ficha.registration);
    expect(depois.birthDate?.toISOString()).toBe(ficha.birthDate?.toISOString());
  });

  it("editar a ficha antiga sem nascimento com o corpo que a tela manda: 200, e o nascimento segue vazio", async () => {
    const userId = await semFicha(3);
    const ficha = await prisma.employeeProfile.create({
      data: { organizationId: ORG_ID, userId, taxId: cpfFicticio(Date.now() + 91), registration: `IDW${SUFIXO}`.slice(0, 12), jobRoleId: JOB_ID },
    });
    /* EmployeeFilePage.salvar: com cuidaDoQuadro, manda os três sempre, e o nascimento vazio como null. */
    const tela = await request(app).patch(`/api/employee-profiles/${ficha.id}`).set(as(token.rh!)).send({
      registration: ficha.registration,
      tax_id: ficha.taxId,
      birth_date: null,
      phone: "19 99999-0000",
      job_role_id: JOB_ID,
      admitted_at: null,
    });
    expect(tela.status, JSON.stringify(tela.body)).toBe(200);
    const depois = await prisma.employeeProfile.findUniqueOrThrow({ where: { id: ficha.id } });
    expect(depois.phone).toBe("19 99999-0000");
    expect(depois.birthDate).toBeNull();
    expect(depois.taxId).toBe(ficha.taxId);
  });
});

describe("a filial sem duplicar", () => {
  const criar = (quem: string, corpo: Record<string, unknown>) =>
    request(app).post("/api/establishments").set(as(token[quem]!)).send(corpo);
  const editar = (quem: string, id: string, corpo: Record<string, unknown>) =>
    request(app).patch(`/api/establishments/${id}`).set(as(token[quem]!)).send(corpo);

  it("o mesmo nome em outra grafia dá 409; o nome de uma arquivada fica livre", async () => {
    const primeira = await criar("master", { name: `Filial Única ${SUFIXO}` });
    expect(primeira.status, JSON.stringify(primeira.body)).toBe(201);
    const repetida = await criar("master", { name: `  filial   UNICA ${SUFIXO.toUpperCase()} ` });
    expect(repetida.status).toBe(409);
    expect(repetida.body.message).toBe(`Já existe a filial Filial Única ${SUFIXO}. Use outro nome.`);

    const fechada = await criar("master", { name: `Fechada ${SUFIXO}` });
    await prisma.establishment.update({ where: { id: fechada.body.establishment.id }, data: { archivedAt: new Date() } });
    expect((await criar("master", { name: `Fechada ${SUFIXO}` })).status).toBe(201);
  });

  it("o mesmo CNPJ dá 409, inclusive o de uma filial arquivada", async () => {
    const cnpj = cnpjFicticio(Date.now());
    const dona = await criar("master", { name: `Com CNPJ ${SUFIXO}`, tax_id: cnpj });
    expect(dona.status, JSON.stringify(dona.body)).toBe(201);
    const outra = await criar("master", { name: `Outra CNPJ ${SUFIXO}`, tax_id: cnpj });
    expect(outra.status).toBe(409);
    expect(outra.body.message).toBe(`O CNPJ informado já é da filial Com CNPJ ${SUFIXO}.`);
    await prisma.establishment.update({ where: { id: dona.body.establishment.id }, data: { archivedAt: new Date() } });
    const depois = await criar("master", { name: `Terceira CNPJ ${SUFIXO}`, tax_id: cnpj });
    expect(depois.status).toBe(409);
    expect(depois.body.message).toBe(`O CNPJ informado já é da filial Com CNPJ ${SUFIXO} (arquivada).`);
  });

  it("trocar o CNPJ para o de outra filial dá 409, ativa ou arquivada; o próprio em outra formatação passa", async () => {
    const cnpjA = cnpjFicticio(Date.now() + 11);
    const cnpjB = cnpjFicticio(Date.now() + 22);
    const cnpjC = cnpjFicticio(Date.now() + 33);
    const a = (await criar("master", { name: `Troca A ${SUFIXO}`, tax_id: cnpjA })).body.establishment.id as string;
    await criar("master", { name: `Troca B ${SUFIXO}`, tax_id: cnpjB });
    const c = (await criar("master", { name: `Troca C ${SUFIXO}`, tax_id: cnpjC })).body.establishment.id as string;
    await prisma.establishment.update({ where: { id: c }, data: { archivedAt: new Date() } });

    const paraAtiva = await editar("master", a, { tax_id: cnpjB });
    expect(paraAtiva.status).toBe(409);
    expect(paraAtiva.body.message).toBe(`O CNPJ informado já é da filial Troca B ${SUFIXO}.`);
    const paraArquivada = await editar("master", a, { tax_id: cnpjC });
    expect(paraArquivada.status).toBe(409);
    expect(paraArquivada.body.message).toBe(`O CNPJ informado já é da filial Troca C ${SUFIXO} (arquivada).`);
    const formatado = cnpjA.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
    const proprio = await editar("master", a, { tax_id: formatado });
    expect(proprio.status, JSON.stringify(proprio.body)).toBe(200);
    expect((await prisma.establishment.findUniqueOrThrow({ where: { id: a } })).taxId).toBe(cnpjA);
  });

  it("renomear para o nome de outra dá 409, também para o Gerente; a própria em outra grafia passa", async () => {
    const a = (await criar("master", { name: `Renomear A ${SUFIXO}` })).body.establishment.id as string;
    await criar("master", { name: `Renomear B ${SUFIXO}` });
    const doMaster = await editar("master", a, { name: `renomear b ${SUFIXO}` });
    expect(doMaster.status).toBe(409);
    const doGerente = await editar("gerente", a, { name: `RENOMEAR B ${SUFIXO}` });
    expect(doGerente.status).toBe(409);
    const propria = await editar("master", a, { name: `RENOMEAR A ${SUFIXO}` });
    expect(propria.status, JSON.stringify(propria.body)).toBe(200);
  });
});

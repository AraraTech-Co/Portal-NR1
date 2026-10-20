import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * A linha que não é uma pessoa não entra.
 *
 * Linha copiada do Excel que perde as tabulações vira uma coluna só: o nome
 * passava a ser a linha inteira — "Paulo Ribeiro 10 444.444.444-44
 * paulo@… Torneiro 15/10/2019" — e o cadastro era aceito, sem matrícula,
 * sem CPF e sem função. A prévia da tela recusa; esta é a mesma regra no
 * lugar em que o registro nasce. [B2-1-L]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let master: string;
const criados: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

async function importar(people: Record<string, unknown>[], apply = true) {
  const res = await request(app)
    .post("/api/pessoas-acessos/importar")
    .set(as(master))
    .send({ people, apply });
  // 200 na prévia, 201 quando grava.
  expect([200, 201], JSON.stringify(res.body)).toContain(res.status);
  return res.body as {
    created: number;
    errors: number;
    results: { line: number; status: string; message?: string; login?: string }[];
  };
}

beforeAll(async () => {
  app = createApp();
  master = await entrar("teste.master");
});

afterAll(async () => {
  const users = await prisma.user.findMany({
    where: { name: { contains: SUFIXO } },
    select: { id: true },
  });
  const ids = users.map((u) => u.id);
  await prisma.accountMembership.deleteMany({ where: { userId: { in: ids } } });
  await prisma.employeeProfile.deleteMany({ where: { userId: { in: ids } } });
  await prisma.membership.deleteMany({ where: { userId: { in: ids } } });
  await prisma.auditEvent.deleteMany({ where: { actorId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: criados } } });
});

describe("a linha que não é uma pessoa não entra [B2-1-L]", () => {
  it("linha inteira caída no nome é recusada", async () => {
    const linhaInteira = `Paulo Ribeiro ${SUFIXO} 10 444.444.444-44 paulo@exemplo.local Torneiro 15/10/2019`;
    const r = await importar([{ name: linhaInteira }]);
    expect(r.created).toBe(0);
    expect(r.errors).toBe(1);
    expect(r.results[0]!.status).toBe("error");
    expect(r.results[0]!.message).toContain("nome");

    // E nada foi gravado.
    const gravado = await prisma.user.findFirst({
      where: { name: linhaInteira },
      select: { id: true },
    });
    expect(gravado).toBeNull();
  });

  it("nome com CPF dentro é recusado", async () => {
    const r = await importar([{ name: `Fulano 444.444.444-44 ${SUFIXO}` }]);
    expect(r.errors).toBe(1);
    expect(r.created).toBe(0);
  });

  it("nome com data dentro é recusado", async () => {
    const r = await importar([{ name: `Fulano 15/10/2019 ${SUFIXO}` }]);
    expect(r.errors).toBe(1);
    expect(r.created).toBe(0);
  });

  it("nome com arroba é recusado", async () => {
    const r = await importar([{ name: `fulano@exemplo.local ${SUFIXO}` }]);
    expect(r.errors).toBe(1);
    expect(r.created).toBe(0);
  });

  it("nome de gente entra, inclusive com um número no fim", async () => {
    /*
      A regra não pode recusar nome de verdade: sem este caso, bastaria
      recusar tudo para os outros passarem. E há quem se chame "Maria de
      Souza 2" na folha — dígito solto não é motivo de recusa.
    */
    const nome = `Maria de Souza Teste ${SUFIXO.toUpperCase()} 2`;
    const r = await importar([{ name: nome }]);
    expect(r.errors, JSON.stringify(r.results)).toBe(0);
    expect(r.created).toBe(1);

    const gravado = await prisma.user.findFirst({
      where: { name: nome },
      select: { id: true },
    });
    expect(gravado, "a pessoa cadastrada").toBeTruthy();
    if (gravado) criados.push(gravado.id);
  });

  it("fiscal não entra por planilha: o acesso dele tem prazo", async () => {
    /*
      A planilha não tem coluna de prazo, e o acesso do fiscal cai sozinho na
      data marcada. Importar um fiscal criava acesso de consulta sem prazo
      nenhum — achado ao documentar a coluna "papel". [S7-A] [B2-1-D]
    */
    const r = await importar([
      { name: `Fiscal de Planilha ${SUFIXO.toUpperCase()}`, org_role: "FISCAL" },
    ]);
    expect(r.created).toBe(0);
    expect(r.errors).toBe(1);
    expect(r.results[0]!.message).toContain("prazo");

    const gravado = await prisma.user.findFirst({
      where: { name: { contains: "Fiscal de Planilha" } },
      select: { id: true },
    });
    expect(gravado).toBeNull();
  });

  it("papel que a planilha aceita entra com o papel pedido", async () => {
    const nome = `Supervisor de Planilha ${SUFIXO.toUpperCase()}`;
    const r = await importar([{ name: nome, org_role: "SUPERVISOR" }]);
    expect(r.errors, JSON.stringify(r.results)).toBe(0);
    const user = await prisma.user.findFirst({
      where: { name: nome },
      select: { id: true, memberships: { select: { role: true } } },
    });
    expect(user?.memberships[0]?.role).toBe("SUPERVISOR");
    if (user) criados.push(user.id);
  });

  it("uma linha ruim no meio não derruba as boas", async () => {
    const boa = `Ana Pereira Teste ${SUFIXO.toUpperCase()}`;
    const r = await importar([
      { name: boa },
      { name: `Ruim ruim@exemplo.local ${SUFIXO}` },
    ]);
    expect(r.created).toBe(1);
    expect(r.errors).toBe(1);

    const gravado = await prisma.user.findFirst({
      where: { name: boa },
      select: { id: true },
    });
    expect(gravado).toBeTruthy();
    if (gravado) criados.push(gravado.id);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Cadastrar primeiro, as funções depois (decisão do Léo, 13/11).
 *
 * A pessoa cujo cargo ainda não é função na filial entra sem função — a
 * leitura da planilha manda a linha sem `job_role_id`. Depois que o SST
 * cadastra a função, reenviar a mesma linha preenche a função de quem está
 * sem, e não mexe no resto nem muda a filial.
 *
 * Empresa própria do teste com a Loja e a AG; apagada no fim.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["sem", "funcao", "depois"].join("-");
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let orgId = "";
let contaId = "";
const usuarios: string[] = [];
let rhToken = "";
let loja = "";

function cpf(base9: string): string {
  const d = base9.split("").map(Number);
  const dv = (n: number) => {
    const r = (d.slice(0, n).reduce((t, x, i) => t + x * (n + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  d.push(dv(9));
  d.push(dv(10));
  return d.join("");
}
const BIA = cpf("135792468");

const linhaDaBia = (extra: Record<string, unknown> = {}) => ({
  name: "BIA SEM FUNCAO",
  registration: "000077",
  tax_id: BIA,
  birth_date: "1990-04-02",
  admitted_at: "2024-02-01",
  establishment_id: loja,
  bond: "EMPLOYEE",
  ...extra,
});

const importar = (people: Record<string, unknown>[], dry_run: boolean) =>
  request(app).post("/api/pessoas-acessos/importar").set(as(rhToken)).send({ people, dry_run });

beforeAll(async () => {
  app = createApp();
  orgId = (await prisma.organization.create({ data: { name: `SEMF ${SUFIXO}` } })).id;
  contaId = (await prisma.account.create({ data: { organizationId: orgId, name: `Conta SEMF ${SUFIXO}` } })).id;
  loja = (await prisma.establishment.create({ data: { organizationId: orgId, name: `Loja ${SUFIXO}` } })).id;
  await prisma.establishment.create({ data: { organizationId: orgId, name: `AG ${SUFIXO}` } });
  const rh = await prisma.user.create({
    data: { login: `semf.rh.${SUFIXO}`, name: "Rita RH", passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  usuarios.push(rh.id);
  await prisma.membership.create({ data: { userId: rh.id, organizationId: orgId, role: Role.RH } });
  await prisma.accountMembership.create({ data: { accountId: contaId, userId: rh.id, role: AccountRole.USER } });
  const res = await request(app).post("/api/auth").send({ login: `semf.rh.${SUFIXO}`, password: SENHA });
  expect(res.status).toBe(200);
  rhToken = res.body.token;
});

afterAll(async () => {
  if (!orgId) return;
  const fichas = await prisma.employeeProfile.findMany({ where: { organizationId: orgId }, select: { userId: true } });
  const ids = [...usuarios, ...fichas.map((f) => f.userId)];
  await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
  await prisma.employeePayrollData.deleteMany({ where: { organizationId: orgId } });
  await prisma.employeeProfile.deleteMany({ where: { organizationId: orgId } });
  await prisma.accountMembership.deleteMany({ where: { accountId: contaId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.token.deleteMany({ where: { userId: { in: ids } } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.jobRole.deleteMany({ where: { organizationId: orgId } });
  await prisma.sector.deleteMany({ where: { organizationId: orgId } });
  await prisma.establishment.deleteMany({ where: { organizationId: orgId } });
  await prisma.account.deleteMany({ where: { id: contaId } });
  await prisma.organization.deleteMany({ where: { id: orgId } });
});

describe("cadastrar primeiro, as funções depois", () => {
  it("sem a função, a pessoa entra na filial da linha, sem função", async () => {
    const res = await importar([linhaDaBia()], false);
    expect(res.body.results[0].status, JSON.stringify(res.body)).toBe("created");
    const ficha = await prisma.employeeProfile.findFirstOrThrow({ where: { organizationId: orgId, taxId: BIA } });
    expect([ficha.jobRoleId, ficha.establishmentId]).toEqual([null, loja]);
  });

  it("cadastrada a função, reenviar a mesma linha preenche a função e não mexe no resto", async () => {
    const setor = await prisma.sector.create({ data: { organizationId: orgId, establishmentId: loja, name: "Loja" } });
    const repositora = (
      await prisma.jobRole.create({ data: { organizationId: orgId, sectorId: setor.id, name: "REPOSITORA" } })
    ).id;

    const previa = await importar([linhaDaBia({ job_role_id: repositora })], true);
    expect(previa.body.results[0]).toMatchObject({ status: "completed" });
    expect(previa.body.results[0].filled).toEqual(["função"]);
    expect((await prisma.employeeProfile.findFirstOrThrow({ where: { organizationId: orgId, taxId: BIA } })).jobRoleId).toBeNull();

    const res = await importar([linhaDaBia({ job_role_id: repositora })], false);
    expect(res.body.results[0]).toMatchObject({ status: "completed" });
    const ficha = await prisma.employeeProfile.findFirstOrThrow({
      where: { organizationId: orgId, taxId: BIA },
      select: { jobRoleId: true, establishmentId: true, registration: true, user: { select: { name: true } } },
    });
    expect(ficha).toEqual({
      jobRoleId: repositora,
      establishmentId: loja,
      registration: "000077",
      user: { name: "BIA SEM FUNCAO" },
    });
  });
});

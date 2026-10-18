import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Um papel só: o da empresa decide o acesso, e o da conta o acompanha.
 * [OB-3] [S1-C] [B2-1-A]
 *
 * E o que veio junto da decisão: "Admin (legado)" sai da lista [OB-2];
 * desligar e mexer em CPF/matrícula são do RH [OB-8]; o supervisor escreve em
 * Operação, não em Colaboradores [P3].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const ACCOUNT_ID = "aaaaaaaa-0001-4000-8000-000000000002";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * CPF válido e inédito a cada execução: os CPFs fixos conhecidos já estão no
 * seed e em outros testes, e o teste passaria a depender da ordem.
 */
function cpfFicticio(semente: number): string {
  const base = String(100000000 + (semente % 800000000));
  const digitos = base.split("").map(Number);
  const verificador = (tamanho: number) => {
    const soma = digitos
      .slice(0, tamanho)
      .reduce((total, d, i) => total + d * (tamanho + 1 - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  const d1 = verificador(9);
  digitos.push(d1);
  const d2 = verificador(10);
  return `${base}${d1}${d2}`;
}

const CPF_GERENTE = cpfFicticio(Date.now());
const CPF_RH = cpfFicticio(Date.now() + 7919);


let app: Express;
let master: { token: string; user: { id: string } };
let rh: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };
let gerente: { token: string; user: { id: string } };
const criados: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string; permission: string } };
}

/** Pessoa com papel na empresa e papel na conta escolhidos à mão. */
async function pessoa(nome: string, orgRole: Role, accountRole: AccountRole) {
  const login = `papel.${nome}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: {
      login,
      email: `${login}@teste.local`,
      name: `Pessoa ${nome} ${SUFIXO}`,
      passwordHash: await bcrypt.hash(SENHA, 10),
      mustChangePassword: false,
    },
  });
  criados.push(user.id);
  await prisma.accountMembership.create({
    data: { accountId: ACCOUNT_ID, userId: user.id, role: accountRole },
  });
  await prisma.membership.create({
    data: { userId: user.id, organizationId: ORG_ID, role: orgRole },
  });
  const profile = await prisma.employeeProfile.create({
    data: { organizationId: ORG_ID, userId: user.id },
  });
  return { login, userId: user.id, profileId: profile.id };
}

beforeAll(async () => {
  app = createApp();
  master = await entrar("teste.master");
  rh = await entrar("teste.rh");
  supervisor = await entrar("teste.supervisor");
  gerente = await entrar("teste.gerente");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: criados } } });
});

describe("o papel da empresa é o que vale [OB-3] [S1-C]", () => {
  it("ADMIN na conta não sobrepõe mais o SST da empresa", async () => {
    const p = await pessoa("roberto", Role.SST, AccountRole.ADMIN);
    const sessao = await entrar(p.login);
    expect(sessao.user.permission, "era adm_loja pelo papel de conta").toBe("sst");
  });

  it("OWNER na conta não sobrepõe mais o colaborador da empresa", async () => {
    const p = await pessoa("olivia", Role.COLABORADOR, AccountRole.OWNER);
    const sessao = await entrar(p.login);
    expect(sessao.user.permission, "era owner pelo papel de conta").toBe(
      "colaborador",
    );
  });

  it("mudar o papel na empresa arrasta o papel na conta junto", async () => {
    const p = await pessoa("clara", Role.COLABORADOR, AccountRole.USER);

    const res = await request(app)
      .patch(`/api/pessoas-acessos/${p.userId}/papel`)
      .set(as(master.token))
      .send({ org_role: Role.RH });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.person.permission).toBe("rh");

    const link = await prisma.accountMembership.findFirstOrThrow({
      where: { accountId: ACCOUNT_ID, userId: p.userId },
      select: { role: true },
    });
    expect(link.role, "RH na empresa → ADMIN na conta").toBe(AccountRole.ADMIN);
  });

  it("o papel na conta não entra mais pelo corpo da requisição", async () => {
    const p = await pessoa("daniel", Role.COLABORADOR, AccountRole.USER);

    const res = await request(app)
      .patch(`/api/pessoas-acessos/${p.userId}/papel`)
      .set(as(master.token))
      .send({ org_role: Role.COLABORADOR, account_role: AccountRole.OWNER });
    expect(res.status).toBe(200);

    const link = await prisma.accountMembership.findFirstOrThrow({
      where: { accountId: ACCOUNT_ID, userId: p.userId },
      select: { role: true },
    });
    expect(link.role, "o OWNER pedido foi ignorado").toBe(AccountRole.USER);
    const sessao = await entrar(p.login);
    expect(sessao.user.permission).toBe("colaborador");
  });

  it("a tela de acessos oferece um papel só", async () => {
    const res = await request(app)
      .get("/api/pessoas-acessos")
      .set(as(master.token));
    expect(res.status).toBe(200);
    expect(res.body.assignable.account_roles, "não há mais papel de conta").toBeUndefined();
    expect(Array.isArray(res.body.assignable.org_roles)).toBe(true);
    const alguem = (res.body.people as Record<string, unknown>[])[0]!;
    expect(alguem.account_role).toBeUndefined();
    expect(alguem.org_role).toBeTruthy();
  });
});

describe("Admin (legado) sai da lista [OB-2]", () => {
  it("não é oferecido, e quem já tem continua valendo como gerente", async () => {
    const res = await request(app)
      .get("/api/pessoas-acessos")
      .set(as(master.token));
    expect(res.body.assignable.org_roles).not.toContain(Role.ADMIN);

    const p = await pessoa("legado", Role.ADMIN, AccountRole.USER);
    const sessao = await entrar(p.login);
    expect(sessao.user.permission, "quem já tem não perde acesso").toBe("gerente");
  });
});

describe("desligar e mexer na identidade são do RH [OB-8]", () => {
  it("o gerente escreve em Colaboradores, mas não desliga", async () => {
    const p = await pessoa("marta", Role.COLABORADOR, AccountRole.USER);

    // Ele escreve: o telefone passa.
    const telefone = await request(app)
      .patch(`/api/employee-profiles/${p.profileId}`)
      .set(as(gerente.token))
      .send({ phone: "19988887777" });
    expect(telefone.status, JSON.stringify(telefone.body)).toBe(200);

    const cpf = await request(app)
      .patch(`/api/employee-profiles/${p.profileId}`)
      .set(as(gerente.token))
      .send({ tax_id: CPF_GERENTE });
    expect(cpf.status).toBe(403);
    expect(cpf.body.code).toBe("PERSONNEL_RECORD_ONLY");

    const matricula = await request(app)
      .patch(`/api/employee-profiles/${p.profileId}`)
      .set(as(gerente.token))
      .send({ registration: "GER-0001" });
    expect(matricula.status).toBe(403);

    const desligar = await request(app)
      .post(`/api/employee-profiles/${p.profileId}/desligamento`)
      .set(as(gerente.token))
      .send({ dismissed_at: "2026-10-01", reason: "Pedido de demissão" });
    expect(desligar.status).toBe(403);
    expect(desligar.body.code).toBe("PERSONNEL_RECORD_ONLY");

    const guardado = await prisma.employeeProfile.findFirstOrThrow({
      where: { id: p.profileId },
      select: { taxId: true, registration: true, dismissedAt: true, phone: true },
    });
    expect(guardado.taxId).toBeNull();
    expect(guardado.registration).toBeNull();
    expect(guardado.dismissedAt).toBeNull();
    expect(guardado.phone, "o que ele pode mudar, mudou").toBe("19988887777");
  });

  it("o RH desliga e preenche CPF e matrícula", async () => {
    const p = await pessoa("nina", Role.COLABORADOR, AccountRole.USER);

    const ficha = await request(app)
      .patch(`/api/employee-profiles/${p.profileId}`)
      .set(as(rh.token))
      .send({ tax_id: CPF_RH, registration: `RH-${SUFIXO}`.slice(0, 20) });
    expect(ficha.status, JSON.stringify(ficha.body)).toBe(200);

    const desligar = await request(app)
      .post(`/api/employee-profiles/${p.profileId}/desligamento`)
      .set(as(rh.token))
      .send({ dismissed_at: "2026-10-01", reason: "Pedido de demissão" });
    expect(desligar.status, JSON.stringify(desligar.body)).toBe(200);
  });
});

describe("o supervisor cuida de Operação, não de Colaboradores [P3]", () => {
  it("escreve em Operação e só lê Colaboradores", async () => {
    const sessao = await entrar("teste.supervisor");
    expect(sessao.user.permission).toBe("supervisor");

    const modulos = (sessao.user as unknown as { modules: Record<string, string> })
      .modules;
    expect(modulos.operacao).toBe("write");
    expect(modulos.colaboradores).toBe("read");

    // Ler, pode.
    const lista = await request(app)
      .get("/api/employee-profiles")
      .set(as(supervisor.token));
    expect(lista.status).toBe(200);

    // Criar ficha, não.
    const criar = await request(app)
      .post("/api/employee-profiles")
      .set(as(supervisor.token))
      .send({ user_id: rh.user.id });
    expect(criar.status).toBe(403);
  });

  it("continua vendo a ficha da equipe, sem poder editá-la", async () => {
    const p = await pessoa("equipe", Role.COLABORADOR, AccountRole.USER);

    /*
      Tirar a escrita não pode tirar a leitura da ficha de outra pessoa: o
      supervisor é quem conhece o chão e precisa ver função, treinamento e
      ordem de serviço de quem está sob ele.
    */
    const ficha = await request(app)
      .get(`/api/employee-profiles/${p.profileId}/ficha`)
      .set(as(supervisor.token));
    expect(ficha.status, JSON.stringify(ficha.body)).toBe(200);
    expect(ficha.body.profile.user.name).toContain("Pessoa equipe");

    const editar = await request(app)
      .patch(`/api/employee-profiles/${p.profileId}`)
      .set(as(supervisor.token))
      .send({ phone: "19900000000" });
    expect(editar.status, "ver sim, editar não").toBe(403);
  });
});

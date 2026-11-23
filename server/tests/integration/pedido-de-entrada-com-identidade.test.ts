import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { cpfFicticio } from "../helpers/identidade-do-pedido";

/**
 * Pedido de entrada com CPF e nascimento (23/11/2026, fatia 2).
 *
 * Quem pede informa CPF e nascimento, e a ficha nasce completa na aprovação:
 * quem ganha ficha (não é externo nem fiscal) só entra com matrícula, CPF e
 * nascimento. O envio público não diz se o CPF já está na empresa; quem
 * aprova vê o CPF mascarado; e o pedido decidido não guarda os dois.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const SENHA_DO_PEDIDO = "q".repeat(5) + "-" + "8".repeat(5);
const NASCIMENTO = "1988-03-21";

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let master: string;
let token: string;
let semente = Date.now() * 13;
const links: string[] = [];
const pedidos: string[] = [];

const novoCpf = () => cpfFicticio((semente += 104729));
const formatado = (cpf: string) => `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
const mascarado = (cpf: string) => `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;

function enviar(corpo: Record<string, unknown>) {
  return request(app)
    .post(`/api/invites/${token}`)
    .send({ password: SENHA_DO_PEDIDO, ...corpo });
}

async function pedir(nome: string, cpf: string, nascimento: string = NASCIMENTO) {
  const res = await enviar({ name: nome, tax_id: cpf, birth_date: nascimento });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  pedidos.push(res.body.request_id);
  return res.body.request_id as string;
}

function decidir(id: string, corpo: Record<string, unknown>) {
  return request(app).post(`/api/join-requests/${id}/decide`).set(as(master)).send(corpo);
}

const fichaDe = (nome: string) =>
  prisma.employeeProfile.findFirst({
    where: { organizationId: ORG_ID, user: { name: nome } },
    select: { taxId: true, birthDate: true, registration: true },
  });

beforeAll(async () => {
  app = createApp();
  const login = await request(app).post("/api/auth").send({ login: "teste.master", password: SENHA });
  expect(login.status).toBe(200);
  master = login.body.token;
  const link = await request(app)
    .post("/api/invite-links")
    .set(as(master))
    .send({ label: `Identidade ${SUFIXO}` });
  expect(link.status, JSON.stringify(link.body)).toBe(201);
  links.push(link.body.link.id);
  token = link.body.link.token;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { name: { endsWith: SUFIXO } } });
  await prisma.accountJoinRequest.deleteMany({
    where: { OR: [{ id: { in: pedidos } }, { name: { endsWith: SUFIXO } }] },
  });
  await prisma.accountInviteLink.deleteMany({ where: { id: { in: links } } });
});

describe("o formulário público pede CPF e nascimento", () => {
  it("sem CPF, sem nascimento ou com CPF inválido: 400, e nada é gravado", async () => {
    const nome = `Sem Dados ${SUFIXO}`;
    const semCpf = await enviar({ name: nome, birth_date: NASCIMENTO });
    expect(semCpf.status).toBe(400);
    expect(semCpf.body.message).toBe("Informe o seu CPF.");

    const soEspaco = await enviar({ name: nome, tax_id: "   ", birth_date: NASCIMENTO });
    expect(soEspaco.status).toBe(400);
    expect(soEspaco.body.message).toBe("Informe o seu CPF.");

    const semNascimento = await enviar({ name: nome, tax_id: novoCpf() });
    expect(semNascimento.status).toBe(400);
    expect(semNascimento.body.message).toBe("Informe a sua data de nascimento.");

    const cpfInvalido = await enviar({ name: nome, tax_id: "123.456.789-00", birth_date: NASCIMENTO });
    expect(cpfInvalido.status).toBe(400);
    expect(cpfInvalido.body.message).toBe("CPF inválido — confira os números.");

    const futuro = await enviar({ name: nome, tax_id: novoCpf(), birth_date: "2999-01-01" });
    expect(futuro.status).toBe(400);
    expect(futuro.body.message).toBe("Data de nascimento precisa ser no passado.");

    expect(await prisma.accountJoinRequest.count({ where: { name: nome } })).toBe(0);
  });

  it("grava o CPF só com os dígitos e o nascimento, e a resposta não devolve o CPF", async () => {
    const cpf = novoCpf();
    const res = await enviar({ name: `Com Dados ${SUFIXO}`, tax_id: formatado(cpf), birth_date: "21/03/1988" });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    pedidos.push(res.body.request_id);
    expect(JSON.stringify(res.body)).not.toContain(cpf.slice(3, 9));

    const gravado = await prisma.accountJoinRequest.findUniqueOrThrow({ where: { id: res.body.request_id } });
    expect(gravado.taxId).toBe(cpf);
    expect(gravado.birthDate?.toISOString().slice(0, 10)).toBe(NASCIMENTO);
  });
});

describe("quem aprova vê o CPF mascarado", () => {
  it("a lista traz o CPF mascarado e só diz se há nascimento", async () => {
    const cpf = novoCpf();
    const id = await pedir(`Na Lista ${SUFIXO}`, cpf);
    const lista = await request(app).get("/api/join-requests").set(as(master));
    expect(lista.status).toBe(200);
    const linha = lista.body.requests.find((r: { id: string }) => r.id === id);
    expect(linha.tax_id).toBe(mascarado(cpf));
    expect(linha.has_birth_date).toBe(true);
    const texto = JSON.stringify(lista.body);
    expect(texto).not.toContain(cpf);
    expect(texto).not.toContain(NASCIMENTO);
  });
});

describe("a aprovação com ficha exige matrícula, CPF e nascimento", () => {
  it("sem matrícula: 400, e o pedido continua pendente", async () => {
    const id = await pedir(`Sem Matricula ${SUFIXO}`, novoCpf());
    const res = await decidir(id, { action: "approve", org_role: Role.COLABORADOR });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe(
      "Informe a matrícula: quem entra com ficha precisa de matrícula, CPF e data de nascimento.",
    );
    const pedido = await prisma.accountJoinRequest.findUniqueOrThrow({ where: { id } });
    expect(pedido.status).toBe("PENDING");
    expect(await prisma.user.count({ where: { name: `Sem Matricula ${SUFIXO}` } })).toBe(0);
  });

  it("aprovado: a ficha nasce com os três, o pedido não guarda CPF nem nascimento, e a resposta mascara", async () => {
    const cpf = novoCpf();
    const nome = `Aprovado ${SUFIXO}`;
    const id = await pedir(nome, cpf);
    const matricula = `I${SUFIXO}`.slice(0, 12);
    const res = await decidir(id, { action: "approve", org_role: Role.COLABORADOR, registration: matricula });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.tax_id).toBe(mascarado(cpf));
    expect(JSON.stringify(res.body)).not.toContain(cpf);

    const ficha = await fichaDe(nome);
    expect(ficha?.taxId).toBe(cpf);
    expect(ficha?.birthDate?.toISOString().slice(0, 10)).toBe(NASCIMENTO);
    expect(ficha?.registration).toBe(matricula);

    const pedido = await prisma.accountJoinRequest.findUniqueOrThrow({ where: { id } });
    expect(pedido.status).toBe("APPROVED");
    expect(pedido.taxId).toBeNull();
    expect(pedido.birthDate).toBeNull();
  });

  it("o envio não revela CPF repetido; a aprovação recusa sem dizer de quem é", async () => {
    const cpf = novoCpf();
    const primeiro = `Primeiro ${SUFIXO}`;
    const id1 = await pedir(primeiro, cpf);
    const ok = await decidir(id1, { action: "approve", org_role: Role.COLABORADOR, registration: `P${SUFIXO}`.slice(0, 12) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    // O mesmo CPF no formulário público: aceito como qualquer outro.
    const id2 = await pedir(`Segundo ${SUFIXO}`, cpf);
    const recusa = await decidir(id2, { action: "approve", org_role: Role.COLABORADOR, registration: `S${SUFIXO}`.slice(0, 12) });
    expect(recusa.status).toBe(409);
    expect(recusa.body.code).toBe("TAX_ID_TAKEN");
    expect(recusa.body.message).not.toContain(primeiro);
    expect(await prisma.user.count({ where: { name: `Segundo ${SUFIXO}` } })).toBe(0);
    expect((await prisma.accountJoinRequest.findUniqueOrThrow({ where: { id: id2 } })).status).toBe("PENDING");
  });
});

describe("quem entra sem ficha não precisa dos três", () => {
  it("externo: aprovado sem matrícula, e o pedido não guarda CPF nem nascimento", async () => {
    const nome = `Externo ${SUFIXO}`;
    const id = await pedir(nome, novoCpf());
    const res = await decidir(id, { action: "approve", org_role: Role.COLABORADOR, is_external: true });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.tax_id).toBeNull();
    const pedido = await prisma.accountJoinRequest.findUniqueOrThrow({ where: { id } });
    expect(pedido.taxId).toBeNull();
    expect(pedido.birthDate).toBeNull();
  });

  it("fiscal: aprovado sem matrícula e sem ficha", async () => {
    const nome = `Fiscal ${SUFIXO}`;
    const id = await pedir(nome, novoCpf());
    const res = await decidir(id, { action: "approve", org_role: Role.FISCAL });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(await fichaDe(nome)).toBeNull();
  });
});

describe("o pedido antigo, que chegou sem CPF e sem nascimento", () => {
  async function pedidoAntigo(nome: string) {
    const conta = await prisma.accountInviteLink.findUniqueOrThrow({ where: { id: links[0] }, select: { accountId: true } });
    const antigo = await prisma.accountJoinRequest.create({
      data: {
        accountId: conta.accountId,
        inviteLinkId: links[0],
        name: nome,
        passwordHash: "x".repeat(20),
        status: "PENDING",
      },
    });
    pedidos.push(antigo.id);
    return antigo.id;
  }

  it("aparece sem CPF na lista e só é aprovado quando quem aprova informa os dois, com a mesma validação", async () => {
    const nome = `Antigo ${SUFIXO}`;
    const id = await pedidoAntigo(nome);
    const lista = await request(app).get("/api/join-requests").set(as(master));
    const linha = lista.body.requests.find((r: { id: string }) => r.id === id);
    expect(linha.tax_id).toBeNull();
    expect(linha.has_birth_date).toBe(false);

    const matricula = `N${SUFIXO}`.slice(0, 12);
    const semNada = await decidir(id, { action: "approve", org_role: Role.COLABORADOR, registration: matricula });
    expect(semNada.status).toBe(400);
    expect(semNada.body.message).toBe(
      "Informe a data de nascimento de quem pediu: quem entra com ficha precisa de matrícula, CPF e data de nascimento.",
    );

    const semCpf = await decidir(id, {
      action: "approve",
      org_role: Role.COLABORADOR,
      registration: matricula,
      birth_date: NASCIMENTO,
    });
    expect(semCpf.status).toBe(400);
    expect(semCpf.body.message).toBe(
      "Informe o CPF de quem pediu: quem entra com ficha precisa de matrícula, CPF e data de nascimento.",
    );

    const invalido = await decidir(id, {
      action: "approve",
      org_role: Role.COLABORADOR,
      registration: matricula,
      birth_date: NASCIMENTO,
      tax_id: "111.111.111-11",
    });
    expect(invalido.status).toBe(400);
    expect(invalido.body.message).toBe("CPF inválido — confira os números.");

    const cpf = novoCpf();
    const ok = await decidir(id, {
      action: "approve",
      org_role: Role.COLABORADOR,
      registration: matricula,
      birth_date: NASCIMENTO,
      tax_id: formatado(cpf),
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const ficha = await fichaDe(nome);
    expect(ficha?.taxId).toBe(cpf);
    expect(ficha?.birthDate?.toISOString().slice(0, 10)).toBe(NASCIMENTO);
  });
});

describe("o pedido recusado não guarda CPF nem nascimento", () => {
  it("a recusa apaga os dois", async () => {
    const id = await pedir(`Recusado ${SUFIXO}`, novoCpf());
    const res = await decidir(id, { action: "reject", note: "Não é da empresa" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const pedido = await prisma.accountJoinRequest.findUniqueOrThrow({ where: { id } });
    expect(pedido.status).toBe("REJECTED");
    expect(pedido.taxId).toBeNull();
    expect(pedido.birthDate).toBeNull();
  });
});

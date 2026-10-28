import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * A recusa da aprovação aparece onde quem aprova está olhando.
 *
 * Ao aceitar um pedido de entrada com matrícula já usada, a mensagem ia
 * para o topo da página, acima de "Contas acessíveis", e não dizia que o
 * problema era a matrícula. Quem aprovava clicava de novo. Agora a recusa
 * fica na linha do pedido e diz de quem é a matrícula. [B3-1-A]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");
const MATRICULA = `M-${SUFIXO}`;
const DONO_DA_MATRICULA = `Carlos Matrícula ${SUFIXO}`;

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const plano = (t: string) => t.replace(/\s+/g, " ");

let app: Express;
let owner: { token: string };
let linkToken = "";
let linkId = "";
const usuarios: string[] = [];
const pedidos: string[] = [];

async function pedir(nome: string) {
  const res = await request(app)
    .post(`/api/invites/${linkToken}`)
    .send({ name: nome, email: `${nome.replace(/\W+/g, ".").toLowerCase()}@teste.local`, password: "umaSenhaQualquer1" });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  pedidos.push(res.body.request_id);
  return res.body.request_id as string;
}

beforeAll(async () => {
  app = createApp();
  const login = await request(app).post("/api/auth").send({ login: "teste.owner", password: SENHA });
  expect(login.status).toBe(200);
  owner = login.body;

  const dono = await prisma.user.create({
    data: {
      login: `matricula.${SUFIXO}`,
      email: `matricula.${SUFIXO}@teste.local`,
      name: DONO_DA_MATRICULA,
      passwordHash: "x",
    },
  });
  usuarios.push(dono.id);
  await prisma.membership.create({
    data: { userId: dono.id, organizationId: ORG_ID, role: Role.COLABORADOR },
  });
  await prisma.employeeProfile.create({
    data: { organizationId: ORG_ID, userId: dono.id, registration: MATRICULA },
  });

  const link = await request(app)
    .post("/api/invite-links")
    .set(as(owner.token))
    .send({ label: `Recusa ${SUFIXO}`, role_mode: "ON_APPROVE" });
  expect(link.status).toBe(201);
  linkToken = link.body.link.token;
  linkId = link.body.link.id;
});

afterAll(async () => {
  const aprovados = await prisma.accountJoinRequest.findMany({
    where: { id: { in: pedidos } },
    select: { email: true },
  });
  const emails = aprovados.map((p) => p.email).filter((e): e is string => !!e);
  await prisma.user.deleteMany({ where: { OR: [{ id: { in: usuarios } }, { email: { in: emails } }] } });
  await prisma.accountJoinRequest.deleteMany({ where: { id: { in: pedidos } } });
  if (linkId) await prisma.accountInviteLink.deleteMany({ where: { id: linkId } });
});

describe("a recusa diz o que corrigir [B3-1-A]", () => {
  it("matrícula já usada: diz de quem é, e nada é criado", async () => {
    const id = await pedir(`Sergio Lima ${SUFIXO}`);
    const res = await request(app)
      .post(`/api/join-requests/${id}/decide`)
      .set(as(owner.token))
      .send({ action: "approve", org_role: "COLABORADOR", registration: MATRICULA });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("REGISTRATION_TAKEN");
    expect(res.body.message).toContain(`A matrícula ${MATRICULA} já é de ${DONO_DA_MATRICULA}`);

    const pedido = await prisma.accountJoinRequest.findUniqueOrThrow({
      where: { id },
      select: { status: true, email: true },
    });
    expect(pedido.status).toBe("PENDING");
    expect(await prisma.user.findFirst({ where: { email: pedido.email } })).toBeNull();
  });

  it("com matrícula livre, o mesmo pedido é aceito", async () => {
    const id = await pedir(`Sergio Livre ${SUFIXO}`);
    const recusa = await request(app)
      .post(`/api/join-requests/${id}/decide`)
      .set(as(owner.token))
      .send({ action: "approve", org_role: "COLABORADOR", registration: MATRICULA });
    expect(recusa.status).toBe(409);

    const aceito = await request(app)
      .post(`/api/join-requests/${id}/decide`)
      .set(as(owner.token))
      .send({ action: "approve", org_role: "COLABORADOR", registration: `${MATRICULA}-livre` });
    expect(aceito.status, JSON.stringify(aceito.body)).toBe(200);
    expect(aceito.body.status).toBe("APPROVED");
  });

  it("outras recusas continuam sem código de matrícula", async () => {
    const id = await pedir(`Sergio Papel ${SUFIXO}`);
    const res = await request(app)
      .post(`/api/join-requests/${id}/decide`)
      .set(as(owner.token))
      .send({ action: "approve", org_role: "OWNER" });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.code).not.toBe("REGISTRATION_TAKEN");
  });
});

describe("a tela mostra a recusa na linha do pedido [B3-1-A]", () => {
  const tela = plano(semComentarios(readFileSync(join(CLIENTE, "pages", "AccountPage.tsx"), "utf8")));
  const decidir = tela.slice(tela.indexOf("async function onDecide"), tela.indexOf("return (", tela.indexOf("async function onDecide")));

  it("a falha de decidir não vai para o aviso do topo", () => {
    expect(decidir.length).toBeGreaterThan(50);
    expect(decidir).not.toMatch(/setError\(/);
    expect(decidir).toMatch(/setRecusaDoPedido\(/);
    expect(decidir).toMatch(/limparRecusa\(id\)/);
  });

  it("a recusa aparece na linha, como alerta, junto dos botões", () => {
    const linha = tela.slice(tela.indexOf('onClick={() => onDecide(r.id, "approve")}'));
    expect(linha).toMatch(
      /onDecide\(r\.id, "reject"\)\} > Recusar <\/Button> <\/div> \{recusaDoPedido\[r\.id\] && \( <p id=\{`recusa-\$\{r\.id\}`\} className="form-error" role="alert"/,
    );
  });

  it("a matrícula recusada fica marcada, e editar apaga a recusa", () => {
    expect(tela).toContain('aria-invalid={ recusaDoPedido[r.id]?.code === "REGISTRATION_TAKEN" || undefined }');
    expect(tela).toMatch(/onChange=\{\(e\) => \{ limparRecusa\(r\.id\); setDecideRoles/);
  });

  it("o botão diz que está aceitando, enquanto espera", () => {
    expect(tela).toContain('{busyId === r.id ? "Aceitando…" : "Aceitar"}');
  });
});

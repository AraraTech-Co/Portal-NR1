import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { uploadsRoot } from "../../src/helper/uploads";

/**
 * Gestor e ADM da loja limitados à unidade — módulos de pessoas. [C2-13]
 *
 * Dados sintéticos: duas unidades (Rio Claro e Barueri), um colaborador em
 * cada, um ADM loja para cada uma (o de Rio Claro trabalha em Barueri, para
 * provar que trabalhar lá não dá poder de gestor lá), um supervisor com as
 * duas, um gerente sem unidade, Master sem ficha e RH.
 *
 * Fora do escopo responde igual a inexistente (status e corpo).
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const ACCOUNT_ID = "aaaaaaaa-0001-4000-8000-000000000002";
const SENHA = ["recorte", "unidade", "teste"].join("-");
const SUFIXO = Date.now().toString(36);
const PASTA = `teste-c2-13-${SUFIXO}`;
const PDF = Buffer.from("%PDF-1.4\n% atestado sintetico\n").toString("base64");

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string; user: { id: string } };
let master: { token: string; user: { id: string } };
const usuarios: string[] = [];
const unidades: string[] = [];
let outraEmpresa = "";

type Unidade = { id: string; jobRoleId: string };
type Pessoa = { id: string; login: string; token: string; membershipId: string };

let rioClaro: Unidade;
let barueri: Unidade;
let arquivada: Unidade;
let unidadeDeOutraEmpresa = "";

let colabRC: Pessoa;
let colabB: Pessoa;
let admRC: Pessoa;
let admB: Pessoa;
let supDuas: Pessoa;
let gerenteSem: Pessoa;

async function unidade(nome: string, orgId = ORG_ID): Promise<Unidade> {
  const est = await prisma.establishment.create({ data: { organizationId: orgId, name: `${nome} ${SUFIXO}` } });
  unidades.push(est.id);
  const setor = await prisma.sector.create({
    data: { organizationId: orgId, establishmentId: est.id, name: `Loja ${nome}` },
  });
  const funcao = await prisma.jobRole.create({
    data: { organizationId: orgId, sectorId: setor.id, name: `Vendedor ${nome}` },
  });
  return { id: est.id, jobRoleId: funcao.id };
}

async function entrar(login: string, password = SENHA) {
  const res = await request(app).post("/api/auth").send({ login, password });
  expect(res.status, `${login}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

async function pessoa(nome: string, role: Role, trabalhaEm: Unidade | null): Promise<Pessoa> {
  const login = `c213.${nome}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: { login, name: `C213 ${nome}`, passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  usuarios.push(user.id);
  await prisma.accountMembership.create({ data: { accountId: ACCOUNT_ID, userId: user.id, role: AccountRole.USER } });
  const vinculo = await prisma.membership.create({ data: { userId: user.id, organizationId: ORG_ID, role } });
  if (trabalhaEm) {
    await prisma.employeeProfile.create({
      data: {
        organizationId: ORG_ID,
        userId: user.id,
        jobRoleId: trabalhaEm.jobRoleId,
        registration: `C213-${nome}-${SUFIXO}`.toUpperCase(),
      },
    });
  }
  const sessao = await entrar(login);
  return { id: user.id, login, token: sessao.token, membershipId: vinculo.id };
}

const definirUnidades = (token: string, userId: string, ids: string[]) =>
  request(app).put(`/api/pessoas-acessos/${userId}/unidades`).set(as(token)).send({ establishment_ids: ids });

function arquivo(nome: string): string {
  const rel = `${PASTA}/${nome}`;
  const abs = path.join(uploadsRoot(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `conteudo ${nome}`);
  return rel;
}

/** Registros individuais de uma pessoa, criados pelos caminhos normais quando dá. */
async function registrosDe(p: Pessoa, unidadeDoHolerite: string) {
  // Férias pelo próprio pedido, mandando a unidade da OUTRA loja (deve ser ignorada).
  const ferias = await request(app)
    .post("/api/leaves")
    .set(as(p.token))
    .send({ start_date: "2027-02-01", end_date: "2027-02-05", establishment_id: unidadeDeOutraEmpresa });
  expect(ferias.status, JSON.stringify(ferias.body)).toBe(201);
  const atestado = await request(app)
    .post("/api/medical-certificates")
    .set(as(p.token))
    .send({ start_date: "2026-10-05", days: 1, file_name: "a.pdf", mime_type: "application/pdf", content_base64: PDF });
  expect(atestado.status, JSON.stringify(atestado.body)).toBe(201);
  const holerite = await prisma.payslip.create({
    data: {
      organizationId: ORG_ID,
      userId: p.id,
      establishmentId: unidadeDoHolerite,
      referenceMonth: 9,
      referenceYear: 2026,
      storagePath: arquivo(`holerite-${p.id}.pdf`),
      fileName: "holerite.pdf",
      publishedById: rh.user.id,
    },
  });
  return { feriasId: ferias.body.leave.id as string, atestadoId: atestado.body.certificate.id as string, holeriteId: holerite.id };
}

let regRC: Awaited<ReturnType<typeof registrosDe>>;
let regB: Awaited<ReturnType<typeof registrosDe>>;

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh", "teste1234");
  master = await entrar("teste.master", "teste1234");
  rioClaro = await unidade("Rio Claro");
  barueri = await unidade("Barueri");
  arquivada = await unidade("Arquivada");
  await prisma.establishment.update({ where: { id: arquivada.id }, data: { archivedAt: new Date() } });
  outraEmpresa = (await prisma.organization.create({ data: { name: `Outra ${SUFIXO}` } })).id;
  unidadeDeOutraEmpresa = (await unidade("Fora", outraEmpresa)).id;

  colabRC = await pessoa("colab-rc", Role.COLABORADOR, rioClaro);
  colabB = await pessoa("colab-b", Role.COLABORADOR, barueri);
  admRC = await pessoa("adm-rc", Role.ADM_LOJA, barueri); // gere Rio Claro, trabalha em Barueri
  admB = await pessoa("adm-b", Role.ADM_LOJA, barueri);
  supDuas = await pessoa("sup-duas", Role.SUPERVISOR, null);
  gerenteSem = await pessoa("gerente-sem", Role.GERENTE, null);

  expect((await definirUnidades(rh.token, admRC.id, [rioClaro.id])).status).toBe(200);
  expect((await definirUnidades(rh.token, admB.id, [barueri.id])).status).toBe(200);
  expect((await definirUnidades(rh.token, supDuas.id, [rioClaro.id, barueri.id])).status).toBe(200);

  regRC = await registrosDe(colabRC, rioClaro.id);
  regB = await registrosDe(colabB, barueri.id);
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.jobRole.deleteMany({ where: { sector: { establishmentId: { in: unidades } } } });
  await prisma.sector.deleteMany({ where: { establishmentId: { in: unidades } } });
  await prisma.establishment.deleteMany({ where: { id: { in: unidades } } });
  await prisma.auditEvent.deleteMany({ where: { organizationId: outraEmpresa } });
  await prisma.organization.deleteMany({ where: { id: outraEmpresa } });
  fs.rmSync(path.join(uploadsRoot(), PASTA), { recursive: true, force: true });
});

const ids = (rows: { userId?: string; id?: string }[], campo: "userId" | "id" = "userId") =>
  rows.map((r) => r[campo]);

describe("a unidade gravada no registro [C2-13]", () => {
  it("vem da ficha no servidor; a do pedido é ignorada", async () => {
    const ferias = await prisma.leaveRequest.findUniqueOrThrow({ where: { id: regRC.feriasId } });
    expect(ferias.establishmentId).toBe(rioClaro.id);
    const atestado = await prisma.medicalCertificate.findUniqueOrThrow({ where: { id: regB.atestadoId } });
    expect(atestado.establishmentId).toBe(barueri.id);
  });
});

describe("Rio Claro não alcança Barueri, e vice-versa [C2-13]", () => {
  it("listas de férias, atestados, holerites e fichas", async () => {
    for (const [nome, gestor, dentro, fora] of [
      ["ADM Rio Claro", admRC, colabRC, colabB],
      ["ADM Barueri", admB, colabB, colabRC],
    ] as const) {
      const ferias = await request(app).get("/api/leaves").set(as(gestor.token));
      expect(ids(ferias.body.leaves), nome).toContain(dentro.id);
      expect(ids(ferias.body.leaves), nome).not.toContain(fora.id);
      const atestados = await request(app).get("/api/medical-certificates").set(as(gestor.token));
      expect(ids(atestados.body.certificates), nome).toContain(dentro.id);
      expect(ids(atestados.body.certificates), nome).not.toContain(fora.id);
      const holerites = await request(app).get("/api/payslips").set(as(gestor.token));
      expect(ids(holerites.body.payslips), nome).toContain(dentro.id);
      expect(ids(holerites.body.payslips), nome).not.toContain(fora.id);
      const fichas = await request(app).get("/api/employee-profiles").set(as(gestor.token));
      expect(ids(fichas.body.profiles), nome).toContain(dentro.id);
      expect(ids(fichas.body.profiles), nome).not.toContain(fora.id);
    }
  });

  it("trabalhar em Barueri não dá ao ADM de Rio Claro os registros de Barueri", async () => {
    const atestados = await request(app).get("/api/medical-certificates").set(as(admRC.token));
    expect(ids(atestados.body.certificates)).not.toContain(colabB.id);
  });

  it("seletores de pessoa: só quem está nas unidades geridas", async () => {
    const membros = await request(app).get("/api/org-members").set(as(admRC.token));
    expect(ids(membros.body.members, "id")).toContain(colabRC.id);
    expect(ids(membros.body.members, "id")).not.toContain(colabB.id);
    const destinatarios = await request(app).get("/api/payslips/recipients").set(as(admRC.token));
    expect(ids(destinatarios.body.recipients, "id")).toContain(colabRC.id);
    expect(ids(destinatarios.body.recipients, "id")).not.toContain(colabB.id);
  });

  it("contagens do Início não contam a unidade negada", async () => {
    const pendentesB = await prisma.medicalCertificate.count({
      where: { organizationId: ORG_ID, status: "PENDING", establishmentId: rioClaro.id },
    });
    const inicio = await request(app).get("/api/inicio").set(as(admRC.token));
    const cartao = JSON.stringify(inicio.body).match(/"id":"atestados_pendentes"[^}]*"count":(\d+)/);
    expect(Number(cartao?.[1] ?? 0)).toBe(pendentesB);
  });
});

describe("IDOR: por id, fora do escopo responde igual a inexistente [C2-13]", () => {
  async function igualAInexistente(montar: (id: string) => request.Test, idFora: string) {
    const fora = await montar(idFora);
    const inexistente = await montar(randomUUID());
    expect(fora.status).toBe(inexistente.status);
    expect(fora.text).toBe(inexistente.text);
    return fora;
  }

  it("decidir férias, analisar e baixar atestado, ver ficha de Barueri", async () => {
    const decidir = await igualAInexistente(
      (id) => request(app).post(`/api/leaves/${id}/decide`).set(as(admRC.token)).send({ status: "APPROVED" }),
      regB.feriasId,
    );
    expect(decidir.status).toBe(404);
    const analisar = await igualAInexistente(
      (id) => request(app).post(`/api/medical-certificates/${id}/review`).set(as(admRC.token)).send({ status: "ACCEPTED" }),
      regB.atestadoId,
    );
    expect(analisar.status).toBe(404);
    const arquivoB = await igualAInexistente(
      (id) => request(app).get(`/api/medical-certificates/${id}/file`).set(as(admRC.token)),
      regB.atestadoId,
    );
    expect(arquivoB.status).toBe(404);
    const fichaB = await prisma.employeeProfile.findFirstOrThrow({ where: { organizationId: ORG_ID, userId: colabB.id } });
    await igualAInexistente((id) => request(app).get(`/api/employee-profiles/${id}/ficha`).set(as(admRC.token)), fichaB.id);
    await igualAInexistente((id) => request(app).get(`/api/employee-profiles/${id}`).set(as(admRC.token)), fichaB.id);
    await igualAInexistente(
      (id) => request(app).patch(`/api/employee-profiles/${id}`).set(as(admRC.token)).send({ phone: "19911112222" }),
      fichaB.id,
    );
    // O mesmo na própria unidade passa (canário).
    expect((await request(app).get(`/api/medical-certificates/${regRC.atestadoId}/file`).set(as(admRC.token))).status).toBe(200);
  });

  it("criar para pessoa de Barueri responde igual a pessoa inexistente", async () => {
    const lancar = (uid: string) =>
      request(app).post("/api/time-entries").set(as(admRC.token)).send({ user_id: uid, day: "2026-10-10", balance_minutes: 30 });
    const fora = await lancar(colabB.id);
    const inexistente = await lancar(randomUUID());
    expect(fora.status).toBe(400);
    expect(fora.text).toBe(inexistente.text);
    const dentro = await lancar(colabRC.id);
    expect(dentro.status, JSON.stringify(dentro.body)).toBe(201);
    const lancamento = await prisma.timeEntry.findFirstOrThrow({ where: { userId: colabRC.id } });
    expect(lancamento.establishmentId).toBe(rioClaro.id);
  });
});

describe("quem tem mais de uma unidade, nenhuma, ou é central [C2-13]", () => {
  it("supervisor com duas unidades vê as fichas das duas", async () => {
    const fichas = await request(app).get("/api/employee-profiles").set(as(supDuas.token));
    expect(ids(fichas.body.profiles)).toEqual(expect.arrayContaining([colabRC.id, colabB.id]));
  });

  it("gerente sem unidade: aviso na sessão, nenhuma ficha de terceiro, consulta própria intacta", async () => {
    const sessao = await request(app).get("/api/auth").set(as(gerenteSem.token));
    expect(sessao.body.user.needs_units).toBe(true);
    const fichas = await request(app).get("/api/employee-profiles").set(as(gerenteSem.token));
    expect(ids(fichas.body.profiles).filter((u) => u !== gerenteSem.id)).toEqual([]);
    expect((await request(app).get("/api/leaves").set(as(gerenteSem.token))).status).toBe(200);
  });

  it("Master sem ficha vê as duas lojas da empresa; RH também", async () => {
    for (const central of [master, rh]) {
      const atestados = await request(app).get("/api/medical-certificates").set(as(central.token));
      expect(ids(atestados.body.certificates)).toEqual(expect.arrayContaining([colabRC.id, colabB.id]));
    }
  });
});

describe("o vínculo de unidade [C2-13]", () => {
  it("ninguém define as próprias unidades", async () => {
    const res = await definirUnidades(rh.token, rh.user.id, [rioClaro.id]);
    expect(res.status).toBe(403);
  });

  it("unidade de outra empresa ou arquivada responde igual a inexistente", async () => {
    const fora = await definirUnidades(rh.token, admRC.id, [unidadeDeOutraEmpresa]);
    const arquiv = await definirUnidades(rh.token, admRC.id, [arquivada.id]);
    const inexistente = await definirUnidades(rh.token, admRC.id, [randomUUID()]);
    expect(fora.status).toBe(404);
    expect(fora.text).toBe(inexistente.text);
    expect(arquiv.text).toBe(inexistente.text);
  });

  it("só gerente, supervisor e ADM loja recebem unidades; gestor não define", async () => {
    expect((await definirUnidades(rh.token, colabRC.id, [rioClaro.id])).status).toBe(400);
    expect((await definirUnidades(admB.token, admRC.id, [barueri.id])).status).toBe(403);
  });

  it("linha que sobrou depois de mudar o papel não dá nada", async () => {
    await prisma.membership.update({ where: { id: admRC.membershipId }, data: { role: Role.COLABORADOR } });
    try {
      const ferias = await request(app).get("/api/leaves").set(as(admRC.token));
      expect(ids(ferias.body.leaves).filter((u) => u !== admRC.id)).toEqual([]);
      const membros = await request(app).get("/api/org-members").set(as(admRC.token));
      expect(ids(membros.body.members, "id")).not.toContain(colabRC.id);
    } finally {
      await prisma.membership.update({ where: { id: admRC.membershipId }, data: { role: Role.ADM_LOJA } });
    }
  });

  it("unidade arquivada depois de atribuída não amplia nada", async () => {
    await prisma.establishment.update({ where: { id: rioClaro.id }, data: { archivedAt: new Date() } });
    try {
      const atestados = await request(app).get("/api/medical-certificates").set(as(admRC.token));
      expect(ids(atestados.body.certificates)).not.toContain(colabRC.id);
    } finally {
      await prisma.establishment.update({ where: { id: rioClaro.id }, data: { archivedAt: null } });
    }
  });

  it("tirar a unidade corta o acesso na sessão aberta, na requisição seguinte", async () => {
    // Supervisor: a ficha de Rio Claro abre, e deixa de abrir na mesma sessão.
    const fichaRC = await prisma.employeeProfile.findFirstOrThrow({ where: { organizationId: ORG_ID, userId: colabRC.id } });
    const ficha = () => request(app).get(`/api/employee-profiles/${fichaRC.id}/ficha`).set(as(supDuas.token));
    expect((await ficha()).status).toBe(200);
    expect((await definirUnidades(rh.token, supDuas.id, [barueri.id])).status).toBe(200);
    try {
      expect((await ficha()).status).toBe(404);
    } finally {
      await definirUnidades(rh.token, supDuas.id, [rioClaro.id, barueri.id]);
    }
    // Revogação do ADM: download e ação na mesma sessão.
    expect((await definirUnidades(rh.token, admRC.id, [])).status).toBe(200);
    try {
      expect((await request(app).get(`/api/medical-certificates/${regRC.atestadoId}/file`).set(as(admRC.token))).status).toBe(404);
      expect(
        (await request(app).post(`/api/leaves/${regRC.feriasId}/decide`).set(as(admRC.token)).send({ status: "APPROVED" })).status,
      ).toBe(404);
    } finally {
      await definirUnidades(rh.token, admRC.id, [rioClaro.id]);
    }
  });
});

describe("transferência não leva o histórico [C2-13]", () => {
  it("o atestado de Rio Claro fica em Rio Claro depois que a pessoa vai para Barueri", async () => {
    const ficha = await prisma.employeeProfile.findFirstOrThrow({ where: { organizationId: ORG_ID, userId: colabRC.id } });
    await prisma.employeeProfile.update({ where: { id: ficha.id }, data: { jobRoleId: barueri.jobRoleId } });
    try {
      const doB = await request(app).get("/api/medical-certificates").set(as(admB.token));
      expect(
        doB.body.certificates.map((c: { id: string }) => c.id),
        "o ADM de Barueri não herda o atestado antigo",
      ).not.toContain(regRC.atestadoId);
      expect(
        (await request(app).get(`/api/medical-certificates/${regRC.atestadoId}/file`).set(as(admB.token))).status,
      ).toBe(404);
      // A própria pessoa continua com o seu histórico.
      expect((await request(app).get(`/api/medical-certificates/${regRC.atestadoId}/file`).set(as(colabRC.token))).status).toBe(200);
    } finally {
      await prisma.employeeProfile.update({ where: { id: ficha.id }, data: { jobRoleId: rioClaro.jobRoleId } });
    }
  });
});

describe("registro antigo, sem unidade, fica com a gestão central [C2-13]", () => {
  it("o ADM loja não decide, não analisa, não baixa nem abre; o RH alcança", async () => {
    const ferias = await prisma.leaveRequest.create({
      data: {
        organizationId: ORG_ID,
        userId: colabRC.id,
        establishmentId: null,
        startDate: new Date("2026-03-02"),
        endDate: new Date("2026-03-06"),
        days: 5,
      },
    });
    const atestado = await prisma.medicalCertificate.create({
      data: {
        organizationId: ORG_ID,
        userId: colabRC.id,
        establishmentId: null,
        startDate: new Date("2026-03-10"),
        days: 1,
        storagePath: arquivo(`atestado-antigo-${colabRC.id}.pdf`),
        fileName: "antigo.pdf",
      },
    });
    const doc = await prisma.hrDocument.create({
      data: {
        organizationId: ORG_ID,
        title: `Advertência antiga ${SUFIXO}`,
        storagePath: arquivo(`doc-antigo-${colabRC.id}.pdf`),
        fileName: "doc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 10,
        targetUserId: colabRC.id,
        establishmentId: null,
        publishedById: rh.user.id,
      },
    });

    async function igualAInexistente(montar: (id: string) => request.Test, id: string) {
      const antigo = await montar(id);
      const inexistente = await montar(randomUUID());
      expect(antigo.status).toBe(404);
      expect(antigo.text).toBe(inexistente.text);
    }
    await igualAInexistente(
      (id) => request(app).post(`/api/leaves/${id}/decide`).set(as(admRC.token)).send({ status: "APPROVED" }),
      ferias.id,
    );
    await igualAInexistente(
      (id) => request(app).post(`/api/medical-certificates/${id}/review`).set(as(admRC.token)).send({ status: "ACCEPTED" }),
      atestado.id,
    );
    await igualAInexistente((id) => request(app).get(`/api/medical-certificates/${id}/file`).set(as(admRC.token)), atestado.id);
    await igualAInexistente((id) => request(app).get(`/api/hr-documents/${id}`).set(as(admRC.token)), doc.id);
    const lista = await request(app).get("/api/leaves").set(as(admRC.token));
    expect(lista.body.leaves.map((l: { id: string }) => l.id)).not.toContain(ferias.id);

    // A gestão central continua alcançando.
    expect((await request(app).get(`/api/medical-certificates/${atestado.id}/file`).set(as(rh.token))).status).toBe(200);
    expect((await request(app).get(`/api/hr-documents/${doc.id}`).set(as(rh.token))).status).toBe(200);
    const decidida = await request(app).post(`/api/leaves/${ferias.id}/decide`).set(as(rh.token)).send({ status: "APPROVED" });
    expect(decidida.status, JSON.stringify(decidida.body)).toBe(200);

    await prisma.hrDocument.delete({ where: { id: doc.id } });
  });
});

describe("o caminho interno do arquivo não sai do servidor [C2-13]", () => {
  it("detalhe do holerite; envio, lista e detalhe do documento do RH", async () => {
    const holerite = await request(app).get(`/api/payslips/${regRC.holeriteId}`).set(as(colabRC.token));
    expect(holerite.status, holerite.text).toBe(200);
    expect(holerite.body.payslip.fileName, "o holerite vem").toBe("holerite.pdf");
    expect(holerite.text).not.toContain("storagePath");

    const envio = await request(app).post("/api/hr-documents").set(as(rh.token)).send({
      title: `Comunicado ${SUFIXO}`,
      target_user_id: colabRC.id,
      file_name: "comunicado.pdf",
      mime_type: "application/pdf",
      content_base64: PDF,
    });
    expect(envio.status, envio.text).toBe(201);
    const docId = envio.body.document.id as string;
    try {
      expect(envio.text).not.toContain("storagePath");
      const lista = await request(app).get("/api/hr-documents").set(as(colabRC.token));
      expect(lista.status).toBe(200);
      expect(lista.body.documents.map((d: { id: string }) => d.id), "o documento vem").toContain(docId);
      expect(lista.text).not.toContain("storagePath");
      const detalhe = await request(app).get(`/api/hr-documents/${docId}`).set(as(rh.token));
      expect(detalhe.status).toBe(200);
      expect(detalhe.body.document.fileName).toBe("comunicado.pdf");
      expect(detalhe.text).not.toContain("storagePath");
    } finally {
      const doc = await prisma.hrDocument.findUnique({ where: { id: docId }, select: { storagePath: true } });
      if (doc) fs.rmSync(path.join(uploadsRoot(), doc.storagePath), { force: true });
      await prisma.hrDocumentAck.deleteMany({ where: { documentId: docId } });
      await prisma.hrDocument.deleteMany({ where: { id: docId } });
    }
  });
});

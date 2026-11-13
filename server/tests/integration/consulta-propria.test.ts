import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import type { Express } from "express";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { uploadsRoot } from "../../src/helper/uploads";

/**
 * Cada funcionário consulta o que é seu, qualquer que seja o papel. [C2-1]
 *
 * Gerente, supervisor e SST, que a matriz deixa sem holerite (e o SST sem
 * férias e atestados), veem e baixam os PRÓPRIOS registros. Não veem o de
 * colega, não ganham escrita (pedir férias, enviar atestado, perguntar sobre
 * o holerite continuam pela matriz), e sem ficha ativa nada muda. O fiscal
 * continua sem autoatendimento.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const ACCOUNT_ID = "aaaaaaaa-0001-4000-8000-000000000002";
const SENHA = ["consulta", "propria", "teste"].join("-");
const SUFIXO = Date.now().toString(36);
const PASTA = `teste-c2-1-${SUFIXO}`;

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string; user: { id: string } };
const criados: string[] = [];

type Pessoa = {
  id: string;
  token: string;
  payslipId: string;
  leaveId: string;
  certId: string;
};

function arquivo(nome: string, conteudo: string): string {
  const rel = `${PASTA}/${nome}`;
  const abs = path.join(uploadsRoot(), rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, conteudo);
  return rel;
}

/**
 * Uma pessoa com o papel dado, ficha (ativa, desligada ou nenhuma) e um
 * holerite, um pedido de férias e um atestado seus, com arquivo.
 */
async function pessoa(
  nome: string,
  role: Role,
  ficha: "ativa" | "desligada" | "nenhuma",
): Promise<Pessoa> {
  const login = `c21.${nome}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: { login, name: `C21 ${nome}`, passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  criados.push(user.id);
  await prisma.accountMembership.create({
    data: { accountId: ACCOUNT_ID, userId: user.id, role: AccountRole.USER },
  });
  await prisma.membership.create({ data: { userId: user.id, organizationId: ORG_ID, role } });
  if (ficha !== "nenhuma") {
    await prisma.employeeProfile.create({
      data: {
        organizationId: ORG_ID,
        userId: user.id,
        dismissedAt: ficha === "desligada" ? new Date(Date.now() - 86_400_000) : null,
      },
    });
  }
  const payslip = await prisma.payslip.create({
    data: {
      organizationId: ORG_ID,
      userId: user.id,
      referenceMonth: 10,
      referenceYear: 2026,
      storagePath: arquivo(`holerite-${nome}.pdf`, `holerite de ${nome}`),
      fileName: `holerite-${nome}.pdf`,
      publishedById: rh.user.id,
    },
  });
  const leave = await prisma.leaveRequest.create({
    data: {
      organizationId: ORG_ID,
      userId: user.id,
      startDate: new Date("2026-12-01"),
      endDate: new Date("2026-12-10"),
      days: 10,
    },
  });
  const cert = await prisma.medicalCertificate.create({
    data: {
      organizationId: ORG_ID,
      userId: user.id,
      startDate: new Date("2026-10-05"),
      days: 1,
      storagePath: arquivo(`atestado-${nome}.pdf`, `atestado de ${nome}`),
      fileName: `atestado-${nome}.pdf`,
    },
  });
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `${nome}: ${JSON.stringify(res.body)}`).toBe(200);
  return {
    id: user.id,
    token: res.body.token,
    payslipId: payslip.id,
    leaveId: leave.id,
    certId: cert.id,
  };
}

let colega: Pessoa;
let gerente: Pessoa;
let supervisor: Pessoa;
let sst: Pessoa;
let gerenteSemFicha: Pessoa;
let sstDesligado: Pessoa;
let fiscal: Pessoa;

beforeAll(async () => {
  app = createApp();
  rh = (await request(app).post("/api/auth").send({ login: "teste.rh", password: "teste1234" })).body;
  colega = await pessoa("colega", Role.COLABORADOR, "ativa");
  gerente = await pessoa("gerente", Role.GERENTE, "ativa");
  supervisor = await pessoa("supervisor", Role.SUPERVISOR, "ativa");
  sst = await pessoa("sst", Role.SST, "ativa");
  gerenteSemFicha = await pessoa("gerente-sem-ficha", Role.GERENTE, "nenhuma");
  sstDesligado = await pessoa("sst-desligado", Role.SST, "desligada");
  fiscal = await pessoa("fiscal", Role.FISCAL, "ativa");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: criados } } });
  fs.rmSync(path.join(uploadsRoot(), PASTA), { recursive: true, force: true });
});

const ROTAS = [
  ["holerites", "/api/payslips", "payslips"],
  ["férias", "/api/leaves", "leaves"],
  ["atestados", "/api/medical-certificates", "certificates"],
] as const;

describe("gerente, supervisor e SST consultam o que é seu [C2-1]", () => {
  it("a lista traz só os próprios registros, nos três módulos", async () => {
    for (const [nome, p] of [
      ["gerente", gerente],
      ["supervisor", supervisor],
      ["sst", sst],
    ] as const) {
      for (const [modulo, rota, campo] of ROTAS) {
        const res = await request(app).get(rota).set(as(p.token));
        expect(res.status, `${nome} ${modulo}: ${JSON.stringify(res.body)}`).toBe(200);
        const linhas = res.body[campo] as { userId: string }[];
        expect(linhas.length, `${nome} ${modulo}`).toBeGreaterThan(0);
        expect(
          linhas.every((l) => l.userId === p.id),
          `${nome} ${modulo} só o próprio`,
        ).toBe(true);
      }
    }
  });

  it("abre e baixa o próprio holerite e o próprio atestado", async () => {
    for (const [nome, p] of [
      ["gerente", gerente],
      ["supervisor", supervisor],
      ["sst", sst],
    ] as const) {
      expect((await request(app).get(`/api/payslips/${p.payslipId}`).set(as(p.token))).status, nome).toBe(200);
      const holerite = await request(app).get(`/api/payslips/${p.payslipId}/file`).set(as(p.token));
      expect(holerite.status, `${nome} holerite`).toBe(200);
      expect(Buffer.from(holerite.body ?? "").toString() || holerite.text).toContain(`holerite de ${nome}`);
      const atestado = await request(app).get(`/api/medical-certificates/${p.certId}/file`).set(as(p.token));
      expect(atestado.status, `${nome} atestado`).toBe(200);
    }
  });

  it("não abre o holerite nem o atestado do colega", async () => {
    for (const [nome, p] of [
      ["gerente", gerente],
      ["supervisor", supervisor],
      ["sst", sst],
    ] as const) {
      // Holerite de outra pessoa responde como inexistente. [C2-13]
      expect((await request(app).get(`/api/payslips/${colega.payslipId}`).set(as(p.token))).status, nome).toBe(404);
      expect((await request(app).get(`/api/payslips/${colega.payslipId}/file`).set(as(p.token))).status, nome).toBe(404);
      const atestado = await request(app).get(`/api/medical-certificates/${colega.certId}/file`).set(as(p.token));
      expect(atestado.status, nome).toBe(404);
      expect(atestado.text, nome).not.toContain("atestado de colega");
    }
  });

  it("a consulta não vira escrita: pedir férias e perguntar continuam pela matriz", async () => {
    // SST não tem férias na matriz: não pede.
    const pedido = await request(app)
      .post("/api/leaves")
      .set(as(sst.token))
      .send({ start_date: "2027-01-10", end_date: "2027-01-12", kind: "VACATION" });
    expect(pedido.status).toBe(403);
    /*
      Atestado é a exceção decidida na Correção 4: o próprio atestado se envia
      pela consulta própria, e o teste dele está no bloco [C4-4] abaixo.
    */
    // Gerente não tem holerites na matriz: não pergunta.
    const duvida = await request(app)
      .post(`/api/payslips/${gerente.payslipId}/questions`)
      .set(as(gerente.token))
      .send({ question: "Por que veio menor?" });
    expect(duvida.status).toBe(403);
  });
});

describe("o próprio atestado, qualquer papel com ficha ativa [C4-4]", () => {
  const enviar = (token: string) =>
    request(app).post("/api/medical-certificates").set(as(token)).send({ start_date: "2026-10-05", days: 1 });

  it("supervisor, gerente e SST enviam o próprio atestado, gravado em nome de quem envia", async () => {
    for (const [nome, p] of [["supervisor", supervisor], ["gerente", gerente], ["sst", sst]] as const) {
      const res = await enviar(p.token);
      expect(res.status, nome).toBe(201);
      const gravado = await prisma.medicalCertificate.findUniqueOrThrow({ where: { id: res.body.certificate.id } });
      expect(gravado.userId, nome).toBe(p.id);
      expect(gravado.status, nome).toBe("PENDING");
    }
  });

  it("sem ficha, desligado ou fiscal não enviam", async () => {
    for (const [nome, p] of [["sst desligado", sstDesligado], ["fiscal com ficha", fiscal]] as const) {
      expect((await enviar(p.token)).status, nome).toBe(403);
    }
  });

  it("enviar não é decidir: quem só envia não aceita nem recusa", async () => {
    const res = await request(app)
      .post(`/api/medical-certificates/${colega.certId}/review`)
      .set(as(sst.token))
      .send({ status: "APPROVED" });
    expect(res.status).toBe(403);
  });
});

describe("sem ficha ativa, ou fiscal, nada muda [C2-1]", () => {
  it("sem ficha, desligado ou fiscal: 403 nos módulos sem acesso na matriz", async () => {
    for (const [nome, p, rotas] of [
      ["gerente sem ficha", gerenteSemFicha, ["/api/payslips"]],
      ["sst desligado", sstDesligado, ["/api/payslips", "/api/leaves", "/api/medical-certificates"]],
      ["fiscal com ficha", fiscal, ["/api/payslips", "/api/leaves", "/api/medical-certificates"]],
    ] as const) {
      for (const rota of rotas) {
        expect((await request(app).get(rota).set(as(p.token))).status, `${nome} ${rota}`).toBe(403);
      }
      expect(
        (await request(app).get(`/api/payslips/${p.payslipId}/file`).set(as(p.token))).status,
        `${nome} arquivo`,
      ).toBe(403);
    }
  });
});

describe("a sessão diz ao menu o que abre só pela consulta própria [C2-1]", () => {
  it("own_modules segue o papel e a ficha", async () => {
    const esperado: [string, Pessoa, string[]][] = [
      ["gerente", gerente, ["holerites"]],
      ["supervisor", supervisor, ["holerites", "atestados"]],
      ["sst", sst, ["holerites", "ferias", "atestados"]],
      ["colaborador", colega, []],
      ["gerente sem ficha", gerenteSemFicha, []],
      ["sst desligado", sstDesligado, []],
      ["fiscal", fiscal, []],
    ];
    for (const [nome, p, modulos] of esperado) {
      const res = await request(app).get("/api/auth").set(as(p.token));
      expect(res.status, nome).toBe(200);
      expect([...res.body.user.own_modules].sort(), nome).toEqual([...modulos].sort());
    }
  });
});

describe("a sessão diz à tela onde se envia o próprio atestado [C4-4]", () => {
  /*
    A tela mostrava o formulário pela consulta própria, que deixa de fora
    quem já LÊ o módulo: o gerente passava na rota e não via o formulário.
    A sessão e a porta da rota agora seguem a mesma regra — e este teste
    confere as duas juntas, pessoa a pessoa.
  */
  it("send_own_modules traz o atestado exatamente para quem a rota aceita", async () => {
    const esperado: [string, Pessoa, boolean][] = [
      ["gerente", gerente, true],
      ["supervisor", supervisor, true],
      ["sst", sst, true],
      ["colaborador", colega, true],
      ["gerente sem ficha", gerenteSemFicha, false],
      ["sst desligado", sstDesligado, false],
      ["fiscal", fiscal, false],
    ];
    for (const [nome, p, envia] of esperado) {
      const sessao = await request(app).get("/api/auth").set(as(p.token));
      expect(sessao.status, nome).toBe(200);
      expect(sessao.body.user.send_own_modules, nome).toEqual(envia ? ["atestados"] : []);
      const res = await request(app)
        .post("/api/medical-certificates")
        .set(as(p.token))
        .send({ start_date: "2026-10-06", days: 1 });
      expect(res.status, `${nome}: ${JSON.stringify(res.body)}`).toBe(envia ? 201 : 403);
    }
  });
});

describe("quem administra o módulo continua vendo a equipe [C2-1]", () => {
  it("o RH lista o holerite e o atestado do colega", async () => {
    const holerites = await request(app).get("/api/payslips").set(as(rh.token));
    expect(holerites.status).toBe(200);
    expect(holerites.body.payslips.some((p: { userId: string }) => p.userId === colega.id)).toBe(true);
    const atestados = await request(app).get("/api/medical-certificates").set(as(rh.token));
    expect(atestados.body.certificates.some((c: { userId: string }) => c.userId === colega.id)).toBe(true);
  });
});

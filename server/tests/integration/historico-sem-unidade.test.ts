import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import bcrypt from "bcryptjs";
import { AccountRole, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Histórico sem unidade: a central classifica, a partir da ficha. [C3-7]
 *
 * Decisão 6 da devolutiva da C2 (10/11): os registros individuais sem
 * unidade gravada recebem uma proposta pela ficha atual da pessoa, e o RH
 * confirma ou corrige. Até lá, só a central os vê.
 *
 * Empresa própria do teste: a Loja, a AG e uma unidade arquivada.
 */
const SUFIXO = Date.now().toString(36);
const SENHA = ["c37", "historico", "unidade"].join("-");

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
const empresa = { orgId: "", contaId: "", usuarios: [] as string[] };
const outra = { orgId: "", unidade: "", holerite: "" };
let loja = "";
let ag = "";
let velha = "";
const id: Record<string, string> = {};
const token: Record<string, string> = {};
/** Registros criados: tipo → nome da pessoa → id. */
const reg: Record<string, Record<string, string>> = {};

const TIPOS = ["holerite", "ferias", "ponto", "atestado", "documento_rh", "exame", "certificado"] as const;
type Tipo = (typeof TIPOS)[number];

async function pessoa(
  nome: string,
  role: Role,
  ficha: { filial: string | null; desligada?: boolean } | "sem-ficha",
) {
  const login = `c37.${nome.toLowerCase()}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: { login, name: `${nome} C37`, passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  empresa.usuarios.push(user.id);
  const membership = await prisma.membership.create({
    data: { userId: user.id, organizationId: empresa.orgId, role },
  });
  await prisma.accountMembership.create({
    data: { accountId: empresa.contaId, userId: user.id, role: AccountRole.USER },
  });
  if (ficha !== "sem-ficha") {
    await prisma.employeeProfile.create({
      data: {
        organizationId: empresa.orgId,
        userId: user.id,
        registration: `${nome}-${SUFIXO}`.slice(0, 20),
        establishmentId: ficha.filial,
        dismissedAt: ficha.desligada ? new Date() : null,
      },
    });
  }
  id[nome] = user.id;
  return { login, membershipId: membership.id };
}

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

/** Um registro de cada tipo para a pessoa, sem unidade (ou com a dada). */
async function registros(nome: string, unidade: string | null = null, mes = 3) {
  const orgId = empresa.orgId;
  const userId = id[nome];
  const base = { organizationId: orgId, userId, establishmentId: unidade };
  const dia = new Date(Date.UTC(2026, 2, 10));
  const criados: Record<Tipo, string> = {
    holerite: (
      await prisma.payslip.create({
        data: { ...base, referenceMonth: mes, referenceYear: 2026, storagePath: "x", fileName: "h.pdf", publishedById: id.Rita },
      })
    ).id,
    ferias: (
      await prisma.leaveRequest.create({
        data: { ...base, startDate: dia, endDate: new Date(Date.UTC(2026, 2, 19)), days: 10, note: "Viagem à praia" },
      })
    ).id,
    ponto: (await prisma.timeEntry.create({ data: { ...base, day: dia, note: "Saiu cedo" } })).id,
    atestado: (
      await prisma.medicalCertificate.create({
        data: { ...base, startDate: dia, days: 2, cid: "J11", reason: "Gripe forte" },
      })
    ).id,
    documento_rh: (
      await prisma.hrDocument.create({
        data: {
          organizationId: orgId,
          establishmentId: unidade,
          kind: "WARNING",
          title: `Advertência de ${nome}`,
          storagePath: "x",
          fileName: "d.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1,
          targetUserId: userId,
          publishedById: id.Rita,
          createdAt: dia,
        },
      })
    ).id,
    exame: (await prisma.occupationalExam.create({ data: { ...base, kind: "PERIODIC", performedAt: dia } })).id,
    certificado: (await prisma.workerCertificate.create({ data: { ...base, name: "NR-35", issuedAt: dia } })).id,
  };
  return criados;
}

const listar = (t: string, tipo: string, extra = "") =>
  request(app).get(`/api/historico-sem-unidade?tipo=${tipo}${extra}`).set(as(t));
const classificar = (t: string, tipo: string, itens: { id: string; establishment_id: string }[]) =>
  request(app).post("/api/historico-sem-unidade/classificar").set(as(t)).send({ tipo, itens });

async function unidadeDe(tipo: Tipo, registro: string): Promise<string | null> {
  const where = { where: { id: registro }, select: { establishmentId: true } } as const;
  const linha =
    tipo === "holerite"
      ? await prisma.payslip.findUnique(where)
      : tipo === "ferias"
        ? await prisma.leaveRequest.findUnique(where)
        : tipo === "ponto"
          ? await prisma.timeEntry.findUnique(where)
          : tipo === "atestado"
            ? await prisma.medicalCertificate.findUnique(where)
            : tipo === "documento_rh"
              ? await prisma.hrDocument.findUnique(where)
              : tipo === "exame"
                ? await prisma.occupationalExam.findUnique(where)
                : await prisma.workerCertificate.findUnique(where);
  return linha!.establishmentId;
}

beforeAll(async () => {
  app = createApp();
  const org = await prisma.organization.create({ data: { name: `C37 ${SUFIXO}` } });
  empresa.orgId = org.id;
  empresa.contaId = (
    await prisma.account.create({ data: { organizationId: org.id, name: `Conta C37 ${SUFIXO}` } })
  ).id;
  loja = (await prisma.establishment.create({ data: { organizationId: org.id, name: `Loja ${SUFIXO}` } })).id;
  ag = (await prisma.establishment.create({ data: { organizationId: org.id, name: `AG ${SUFIXO}` } })).id;
  velha = (
    await prisma.establishment.create({
      data: { organizationId: org.id, name: `Velha ${SUFIXO}`, archivedAt: new Date() },
    })
  ).id;

  const rh = await pessoa("Rita", Role.RH, "sem-ficha");
  const adm = await pessoa("Lia", Role.ADM_LOJA, { filial: loja });
  const gerente = await pessoa("Gil", Role.GERENTE, { filial: loja });
  const sst = await pessoa("Sara", Role.SST, { filial: ag });
  await pessoa("Ana", Role.COLABORADOR, { filial: loja });
  await pessoa("Caio", Role.COLABORADOR, { filial: ag });
  await pessoa("Davi", Role.COLABORADOR, { filial: null });
  await pessoa("Edu", Role.COLABORADOR, { filial: loja, desligada: true });
  await pessoa("Fe", Role.COLABORADOR, { filial: velha });
  await pessoa("Ivo", Role.COLABORADOR, "sem-ficha");

  for (const m of [adm, gerente]) {
    await prisma.managedEstablishment.create({
      data: { organizationId: empresa.orgId, membershipId: m.membershipId, establishmentId: loja, createdById: id.Rita },
    });
  }

  for (const nome of ["Ana", "Caio", "Davi", "Edu", "Fe", "Ivo"]) {
    const criados = await registros(nome);
    for (const tipo of TIPOS) (reg[tipo] ??= {})[nome] = criados[tipo];
  }
  /* Já com unidade: não entra na lista. */
  const jaTem = await registros("Ana", loja, 4);
  for (const tipo of TIPOS) reg[tipo]["Ana-com-unidade"] = jaTem[tipo];
  /* Documento geral do RH: é da empresa inteira, não tem unidade. */
  reg.geral = {
    rh: (
      await prisma.hrDocument.create({
        data: {
          organizationId: empresa.orgId,
          title: `Regulamento ${SUFIXO}`,
          storagePath: "x",
          fileName: "r.pdf",
          mimeType: "application/pdf",
          sizeBytes: 1,
          publishedById: id.Rita,
        },
      })
    ).id,
  };

  /* Outra empresa, com um holerite sem unidade e uma unidade própria. */
  const org2 = await prisma.organization.create({ data: { name: `C37 outra ${SUFIXO}` } });
  outra.orgId = org2.id;
  outra.unidade = (
    await prisma.establishment.create({ data: { organizationId: org2.id, name: `Fora ${SUFIXO}` } })
  ).id;
  /* O Ivo não tem ficha nesta empresa, mas tem na outra: a ficha de lá não propõe nada aqui. */
  await prisma.employeeProfile.create({
    data: { organizationId: org2.id, userId: id.Ivo, registration: `Ivo-${SUFIXO}`.slice(0, 20), establishmentId: outra.unidade },
  });
  outra.holerite = (
    await prisma.payslip.create({
      data: {
        organizationId: org2.id,
        userId: id.Ivo,
        referenceMonth: 3,
        referenceYear: 2026,
        storagePath: "x",
        fileName: "o.pdf",
        publishedById: id.Rita,
      },
    })
  ).id;

  token.rh = await entrar(rh.login);
  token.lia = await entrar(adm.login);
  token.gil = await entrar(gerente.login);
  token.sara = await entrar(sst.login);
});

afterAll(async () => {
  for (const orgId of [empresa.orgId, outra.orgId].filter(Boolean)) {
    await prisma.auditEvent.deleteMany({ where: { organizationId: orgId } });
    await prisma.payslip.deleteMany({ where: { organizationId: orgId } });
    await prisma.leaveRequest.deleteMany({ where: { organizationId: orgId } });
    await prisma.timeEntry.deleteMany({ where: { organizationId: orgId } });
    await prisma.medicalCertificate.deleteMany({ where: { organizationId: orgId } });
    await prisma.hrDocument.deleteMany({ where: { organizationId: orgId } });
    await prisma.occupationalExam.deleteMany({ where: { organizationId: orgId } });
    await prisma.workerCertificate.deleteMany({ where: { organizationId: orgId } });
    await prisma.employeeProfile.deleteMany({ where: { organizationId: orgId } });
    await prisma.managedEstablishment.deleteMany({ where: { organizationId: orgId } });
  }
  if (!empresa.orgId) return;
  await prisma.accountMembership.deleteMany({ where: { accountId: empresa.contaId } });
  await prisma.membership.deleteMany({ where: { organizationId: empresa.orgId } });
  await prisma.token.deleteMany({ where: { userId: { in: empresa.usuarios } } });
  await prisma.authAttempt.deleteMany({ where: { userId: { in: empresa.usuarios } } });
  await prisma.user.deleteMany({ where: { id: { in: empresa.usuarios } } });
  await prisma.establishment.deleteMany({ where: { organizationId: { in: [empresa.orgId, outra.orgId] } } });
  await prisma.account.deleteMany({ where: { id: empresa.contaId } });
  await prisma.organization.deleteMany({ where: { id: { in: [empresa.orgId, outra.orgId] } } });
});

type Item = { id: string; pessoa: { id: string; nome: string }; descricao: string; proposta: { id: string } | null };

describe("a lista do histórico sem unidade [C3-7]", () => {
  it("o RH vê os sete tipos, só os sem unidade da empresa, com a proposta da ficha", async () => {
    const res = await listar(token.rh, "holerite");
    expect(res.status, JSON.stringify(res.body).slice(0, 300)).toBe(200);
    expect(res.body.totais).toEqual({
      holerite: 6,
      ferias: 6,
      ponto: 6,
      atestado: 6,
      documento_rh: 6,
      exame: 6,
      certificado: 6,
    });
    const itens = res.body.itens as Item[];
    const porPessoa = Object.fromEntries(itens.map((i) => [i.pessoa.id, i]));
    expect(itens.map((i) => i.id).sort(), "nem o já classificado nem o da outra empresa").toEqual(
      ["Ana", "Caio", "Davi", "Edu", "Fe", "Ivo"].map((n) => reg.holerite[n]).sort(),
    );
    expect(porPessoa[id.Ana].proposta?.id, "a filial da ficha").toBe(loja);
    expect(porPessoa[id.Caio].proposta?.id).toBe(ag);
    expect(porPessoa[id.Davi].proposta, "ficha sem filial").toBeNull();
    expect(porPessoa[id.Edu].proposta, "desligada").toBeNull();
    expect(porPessoa[id.Fe].proposta, "filial arquivada").toBeNull();
    expect(porPessoa[id.Ivo].proposta, "sem ficha aqui; a da outra empresa não conta").toBeNull();
    expect(porPessoa[id.Ana].descricao).toBe("Holerite mensal de 03/2026");
    const unidades = (res.body.unidades as { id: string }[]).map((u) => u.id).sort();
    expect(unidades, "só as ativas da empresa").toEqual([loja, ag].sort());
  });

  it("o documento do RH: só o pessoal; o geral é da empresa inteira", async () => {
    const res = await listar(token.rh, "documento_rh");
    expect(res.status).toBe(200);
    const ids = (res.body.itens as Item[]).map((i) => i.id);
    expect(ids).not.toContain(reg.geral.rh);
    expect(ids.sort()).toEqual(["Ana", "Caio", "Davi", "Edu", "Fe", "Ivo"].map((n) => reg.documento_rh[n]).sort());
  });

  it("o atestado e as férias não levam CID, motivo nem nota", async () => {
    for (const tipo of ["atestado", "ferias", "ponto"]) {
      const res = await listar(token.rh, tipo);
      expect(res.status).toBe(200);
      const corpo = JSON.stringify(res.body);
      for (const sensivel of ["J11", "Gripe", "praia", "Saiu cedo"]) {
        expect(corpo, `${tipo} vazou "${sensivel}"`).not.toContain(sensivel);
      }
    }
    const atestado = (await listar(token.rh, "atestado")).body.itens as Item[];
    expect(atestado.find((i) => i.id === reg.atestado.Ana)!.descricao).toBe("Atestado de 10/03/2026");
  });

  it("cada tipo tem a sua descrição", async () => {
    const esperado: Record<Tipo, string> = {
      holerite: "Holerite mensal de 03/2026",
      ferias: "Férias de 10/03/2026 a 19/03/2026",
      ponto: "Ponto de 10/03/2026",
      atestado: "Atestado de 10/03/2026",
      documento_rh: "Advertência: Advertência de Ana, de 10/03/2026",
      exame: "Exame periódico de 10/03/2026",
      certificado: "Certificado: NR-35, emitido em 10/03/2026",
    };
    for (const tipo of TIPOS) {
      const res = await listar(token.rh, tipo);
      const ana = (res.body.itens as Item[]).find((i) => i.id === reg[tipo].Ana);
      expect(ana?.descricao, tipo).toBe(esperado[tipo]);
    }
  });

  it("o certificado sem data de emissão leva a data do envio", async () => {
    const enviado = await prisma.workerCertificate.create({
      data: {
        organizationId: empresa.orgId,
        userId: id.Davi,
        name: "CNH D",
        createdAt: new Date(Date.UTC(2026, 0, 5, 12)),
      },
    });
    try {
      const res = await listar(token.rh, "certificado");
      const item = (res.body.itens as Item[]).find((i) => i.id === enviado.id);
      expect(item?.descricao).toBe("Certificado: CNH D, enviado em 05/01/2026");
    } finally {
      await prisma.workerCertificate.delete({ where: { id: enviado.id } });
    }
  });

  it("tipo desconhecido: 400", async () => {
    const res = await listar(token.rh, "salario");
    expect(res.status).toBe(400);
  });

  it("ADM loja, gerente e SST não abrem a lista nem classificam", async () => {
    for (const t of [token.lia, token.gil, token.sara]) {
      expect((await listar(t, "holerite")).status).toBe(403);
      const res = await classificar(t, "holerite", [{ id: reg.holerite.Ana, establishment_id: loja }]);
      expect(res.status).toBe(403);
    }
    expect(await unidadeDe("holerite", reg.holerite.Ana)).toBeNull();
  });
});

describe("classificar [C3-7]", () => {
  it("unidade arquivada ou de outra empresa: 400, e nada do lote é gravado", async () => {
    for (const ruim of [velha, outra.unidade, "00000000-0000-4000-8000-00000000dead"]) {
      const res = await classificar(token.rh, "ponto", [
        { id: reg.ponto.Ana, establishment_id: loja },
        { id: reg.ponto.Caio, establishment_id: ruim },
      ]);
      expect(res.status, ruim).toBe(400);
      expect(res.body.message).toBe("Unidade inválida.");
    }
    expect(await unidadeDe("ponto", reg.ponto.Ana)).toBeNull();
    expect(await unidadeDe("ponto", reg.ponto.Caio)).toBeNull();
  });

  it("lote vazio, acima de 200 ou com item repetido: 400", async () => {
    expect((await classificar(token.rh, "ponto", [])).status).toBe(400);
    const muitos = Array.from({ length: 201 }, (_, i) => ({ id: `id-${i}`, establishment_id: loja }));
    expect((await classificar(token.rh, "ponto", muitos)).status).toBe(400);
    const repetido = [
      { id: reg.ponto.Ana, establishment_id: loja },
      { id: reg.ponto.Ana, establishment_id: ag },
    ];
    expect((await classificar(token.rh, "ponto", repetido)).status).toBe(400);
    expect(await unidadeDe("ponto", reg.ponto.Ana)).toBeNull();
  });

  it("o ADM loja passa a ver o holerite depois da classificação, com trilha", async () => {
    const antes = await request(app).get("/api/payslips").set(as(token.lia));
    expect(antes.status).toBe(200);
    const viaAntes = (antes.body.payslips as { id: string }[]).map((p) => p.id);
    expect(viaAntes).not.toContain(reg.holerite.Ana);
    expect(viaAntes).not.toContain(reg.holerite.Caio);

    /* Ana pela proposta; Caio (ficha na AG) corrigido para a Loja. */
    const res = await classificar(token.rh, "holerite", [
      { id: reg.holerite.Ana, establishment_id: loja },
      { id: reg.holerite.Caio, establishment_id: loja },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ classificados: 2, ignorados: [] });
    expect(await unidadeDe("holerite", reg.holerite.Ana)).toBe(loja);
    expect(await unidadeDe("holerite", reg.holerite.Caio)).toBe(loja);

    const depois = await request(app).get("/api/payslips").set(as(token.lia));
    const viaDepois = (depois.body.payslips as { id: string }[]).map((p) => p.id);
    expect(viaDepois).toContain(reg.holerite.Ana);
    expect(viaDepois).toContain(reg.holerite.Caio);

    const trilha = await prisma.auditEvent.findMany({
      where: { organizationId: empresa.orgId, action: "history.classify" },
      select: { entityId: true, entityType: true, actorId: true, before: true, after: true, context: true },
    });
    const daAna = trilha.find((t) => t.entityId === reg.holerite.Ana)!;
    const doCaio = trilha.find((t) => t.entityId === reg.holerite.Caio)!;
    expect(daAna).toMatchObject({
      entityType: "Payslip",
      actorId: id.Rita,
      before: { establishmentId: null },
      after: { establishmentId: loja },
      context: { tipo: "holerite", proposta: loja, conforme_proposta: true },
    });
    expect(doCaio.context).toMatchObject({ proposta: ag, conforme_proposta: false });

    /* Some da lista. */
    const lista = await listar(token.rh, "holerite");
    expect(lista.body.totais.holerite).toBe(4);
  });

  it("o já classificado e o de outra empresa são ignorados e não mudam", async () => {
    const res = await classificar(token.rh, "holerite", [
      { id: reg.holerite.Ana, establishment_id: ag },
      { id: reg.holerite["Ana-com-unidade"], establishment_id: ag },
      { id: outra.holerite, establishment_id: ag },
      { id: reg.holerite.Davi, establishment_id: ag },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.classificados).toBe(1);
    expect([...res.body.ignorados].sort()).toEqual(
      [reg.holerite.Ana, reg.holerite["Ana-com-unidade"], outra.holerite].sort(),
    );
    expect(await unidadeDe("holerite", reg.holerite.Ana)).toBe(loja);
    expect(await unidadeDe("holerite", reg.holerite["Ana-com-unidade"])).toBe(loja);
    expect((await prisma.payslip.findUnique({ where: { id: outra.holerite } }))!.establishmentId).toBeNull();
    expect(await unidadeDe("holerite", reg.holerite.Davi)).toBe(ag);
    const davi = await prisma.auditEvent.findFirst({
      where: { organizationId: empresa.orgId, action: "history.classify", entityId: reg.holerite.Davi },
    });
    expect(davi!.context).toMatchObject({ proposta: null, conforme_proposta: false });
  });

  it("o documento geral do RH não é classificado", async () => {
    const res = await classificar(token.rh, "documento_rh", [{ id: reg.geral.rh, establishment_id: loja }]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ classificados: 0, ignorados: [reg.geral.rh] });
    expect((await prisma.hrDocument.findUnique({ where: { id: reg.geral.rh } }))!.establishmentId).toBeNull();
  });

  it("o registro de outro tipo com o mesmo id não muda: o tipo escolhe a tabela", async () => {
    const res = await classificar(token.rh, "exame", [{ id: reg.certificado.Edu, establishment_id: loja }]);
    expect(res.status).toBe(200);
    expect(res.body.classificados).toBe(0);
    expect(await unidadeDe("certificado", reg.certificado.Edu)).toBeNull();
  });

  it("cada tipo grava a unidade na própria tabela", async () => {
    for (const tipo of TIPOS) {
      const res = await classificar(token.rh, tipo, [{ id: reg[tipo].Fe, establishment_id: ag }]);
      expect(res.status, tipo).toBe(200);
      expect(res.body.classificados, tipo).toBe(1);
      expect(await unidadeDe(tipo, reg[tipo].Fe), tipo).toBe(ag);
    }
  });

  it("duas classificações ao mesmo tempo: uma grava, a outra é ignorada", async () => {
    const [a, b] = await Promise.all([
      classificar(token.rh, "exame", [{ id: reg.exame.Ivo, establishment_id: loja }]),
      classificar(token.rh, "exame", [{ id: reg.exame.Ivo, establishment_id: ag }]),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.body.classificados + b.body.classificados).toBe(1);
    const final = await unidadeDe("exame", reg.exame.Ivo);
    expect(final).toBe(a.body.classificados === 1 ? loja : ag);
    const trilha = await prisma.auditEvent.count({
      where: { organizationId: empresa.orgId, action: "history.classify", entityId: reg.exame.Ivo },
    });
    expect(trilha).toBe(1);
  });
});

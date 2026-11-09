import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import { AccountRole, ActionStatus, HazardCategory, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { uploadsRoot } from "../../src/helper/uploads";

/**
 * Gestor e ADM da loja limitados à unidade — módulos coletivos do GRO
 * (ocorrências, plano de ação, avaliação ergonômica, participação,
 * emergências) e cartões do Início. [C2-13]
 *
 * Dados sintéticos: duas unidades (Rio Claro e Barueri), um colaborador em
 * cada, um gerente só de Rio Claro (sem ficha), um ADM loja de Barueri que
 * trabalha lá, e um supervisor que gere Rio Claro e TRABALHA em Barueri —
 * em Barueri ele tem o que um colaborador teria, nada além.
 *
 * Fora do escopo responde igual a inexistente (status e corpo).
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const ACCOUNT_ID = "aaaaaaaa-0001-4000-8000-000000000002";
const SENHA = ["recorte", "gro", "teste"].join("-");
const SENHA_SEED = ["teste", "1234"].join("");
const SUFIXO = Date.now().toString(36);
const PDF = Buffer.from("%PDF-1.4\n% evidencia sintetica\n").toString("base64");
const PRAZO = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
type Sessao = { token: string; user: { id: string } };
let rh: Sessao;
let master: Sessao;
let sst: Sessao;

const usuarios: string[] = [];
const unidades: string[] = [];
let outraEmpresa = "";
let deFora = ""; // pessoa de outra empresa

type Unidade = { id: string; jobRoleId: string; activityId: string; riskId: string };
type Pessoa = { id: string; login: string; token: string };

let rioClaro: Unidade;
let barueri: Unidade;

let colabRC: Pessoa;
let colabB: Pessoa;
let gerRC: Pessoa; // gere Rio Claro, sem ficha
let admB: Pessoa; // gere Barueri e trabalha lá
let supRCemB: Pessoa; // gere Rio Claro, trabalha em Barueri

async function unidade(nome: string): Promise<Unidade> {
  const est = await prisma.establishment.create({ data: { organizationId: ORG_ID, name: `${nome} ${SUFIXO}` } });
  unidades.push(est.id);
  const setor = await prisma.sector.create({ data: { organizationId: ORG_ID, establishmentId: est.id, name: `Loja ${nome}` } });
  const funcao = await prisma.jobRole.create({ data: { organizationId: ORG_ID, sectorId: setor.id, name: `Vendedor ${nome}` } });
  const atividade = await prisma.activity.create({
    data: { organizationId: ORG_ID, establishmentId: est.id, sectorId: setor.id, name: `Repor gôndola ${nome} ${SUFIXO}` },
  });
  const perigo = await prisma.hazard.create({
    data: {
      organizationId: ORG_ID,
      activityId: atividade.id,
      description: `Caixa pesada ${nome} ${SUFIXO}`,
      category: HazardCategory.ERGONOMIC,
      createdById: sst.user.id,
    },
  });
  const risco = await prisma.risk.create({
    data: { organizationId: ORG_ID, hazardId: perigo.id, description: `Lombalgia ${nome} ${SUFIXO}` },
  });
  return { id: est.id, jobRoleId: funcao.id, activityId: atividade.id, riskId: risco.id };
}

async function entrar(login: string, password = SENHA): Promise<Sessao> {
  const res = await request(app).post("/api/auth").send({ login, password });
  expect(res.status, `${login}: ${JSON.stringify(res.body)}`).toBe(200);
  return res.body as Sessao;
}

async function pessoa(nome: string, role: Role, trabalhaEm: Unidade | null): Promise<Pessoa> {
  const login = `c213g.${nome}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: { login, name: `C213G ${nome}`, passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  usuarios.push(user.id);
  await prisma.accountMembership.create({ data: { accountId: ACCOUNT_ID, userId: user.id, role: AccountRole.USER } });
  await prisma.membership.create({ data: { userId: user.id, organizationId: ORG_ID, role } });
  if (trabalhaEm) {
    await prisma.employeeProfile.create({
      data: {
        organizationId: ORG_ID,
        userId: user.id,
        jobRoleId: trabalhaEm.jobRoleId,
        registration: `C213G-${nome}-${SUFIXO}`.toUpperCase(),
      },
    });
  }
  const sessao = await entrar(login);
  return { id: user.id, login, token: sessao.token };
}

const definirUnidades = (userId: string, ids: string[]) =>
  request(app).put(`/api/pessoas-acessos/${userId}/unidades`).set(as(rh.token)).send({ establishment_ids: ids });

const ok = (res: request.Response, status = 201) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body;
};

type Registros = {
  ocorrencia: string;
  evidenciaOcorrencia: string;
  acao: string;
  evidenciaAcao: string;
  aep: string;
  participacao: string;
  evidenciaParticipacao: string;
  emergencia: string;
  simulado: string;
  ataSimulado: string;
};

/** Os registros coletivos de uma unidade, pelos caminhos normais. */
async function registrosDe(u: Unidade, colab: Pessoa): Promise<Registros> {
  const ocorrencia = ok(
    await request(app).post("/api/occurrences").set(as(colab.token)).send({
      type: "DANGEROUS_EVENT",
      description: `Caixa caiu da prateleira ${SUFIXO}`,
      occurred_at: "2026-11-01T10:00:00.000Z",
      establishment_id: u.id,
    }),
  ).occurrence.id as string;
  const evidenciaOcorrencia = ok(
    await request(app).post(`/api/occurrences/${ocorrencia}/evidences`).set(as(colab.token)).send({
      file_name: "foto.pdf",
      mime_type: "application/pdf",
      content_base64: PDF,
    }),
  ).evidence.id as string;
  const acao = ok(
    await request(app).post("/api/actions").set(as(sst.token)).send({
      title: `Rebaixar a prateleira ${SUFIXO}`,
      risk_id: u.riskId,
      assignee_id: colab.id,
      due_date: PRAZO,
      effectiveness_criteria: "Nenhuma caixa acima do ombro",
    }),
  ).action.id as string;
  const evidenciaAcao = ok(
    await request(app).post("/api/evidences").set(as(colab.token)).send({
      action_id: acao,
      file_name: "prova.pdf",
      mime_type: "application/pdf",
      content_base64: PDF,
    }),
  ).evidence.id as string;
  const aep = ok(
    await request(app).post("/api/aeps").set(as(sst.token)).send({
      establishment_id: u.id,
      scope_description: `Reposição ${SUFIXO}`,
    }),
  ).aep.id as string;
  const participacao = ok(
    await request(app).post("/api/participations").set(as(sst.token)).send({
      type: "SAFETY_DIALOGUE",
      subject: `DDS da reposição ${SUFIXO}`,
      occurred_at: "2026-11-02T08:00:00.000Z",
      establishment_id: u.id,
    }),
  ).participation.id as string;
  const evidenciaParticipacao = ok(
    await request(app).post(`/api/participations/${participacao}/evidences`).set(as(sst.token)).send({
      file_name: "lista.pdf",
      mime_type: "application/pdf",
      content_base64: PDF,
    }),
  ).evidence.id as string;
  const emergencia = ok(
    await request(app).post("/api/emergency-procedures").set(as(sst.token)).send({
      establishment_id: u.id,
      scenario: `Incêndio no estoque ${SUFIXO}`,
      first_aid_means: "Kit na recepção",
      responsibles: "Brigada terceirizada",
      evacuation_plan: "Saída pela doca",
    }),
  ).procedure.id as string;
  const simulado = ok(
    await request(app)
      .post(`/api/emergency-procedures/${emergencia}/drills`)
      .set(as(sst.token))
      .send({ performed_at: "2026-10-20T09:00:00.000Z", participants: 5 }),
  ).drill.id as string;
  const ataSimulado = ok(
    await request(app)
      .post(`/api/emergency-procedures/${emergencia}/drills/${simulado}/evidences`)
      .set(as(sst.token))
      .send({ file_name: "ata.pdf", mime_type: "application/pdf", content_base64: PDF }),
  ).evidence.id as string;
  return {
    ocorrencia,
    evidenciaOcorrencia,
    acao,
    evidenciaAcao,
    aep,
    participacao,
    evidenciaParticipacao,
    emergencia,
    simulado,
    ataSimulado,
  };
}

let regRC: Registros;
let regB: Registros;
let ocorrenciaSemUnidade = "";
let acaoManual = "";

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh", SENHA_SEED);
  master = await entrar("teste.master", SENHA_SEED);
  sst = await entrar("teste.sst", SENHA_SEED);
  rioClaro = await unidade("Rio Claro");
  barueri = await unidade("Barueri");

  outraEmpresa = (await prisma.organization.create({ data: { name: `Outra GRO ${SUFIXO}` } })).id;
  const estranho = await prisma.user.create({
    data: { login: `c213g.fora.${SUFIXO}`, name: "C213G fora", passwordHash: await bcrypt.hash(SENHA, 4) },
  });
  usuarios.push(estranho.id);
  await prisma.membership.create({ data: { userId: estranho.id, organizationId: outraEmpresa, role: Role.COLABORADOR } });
  deFora = estranho.id;

  colabRC = await pessoa("colab-rc", Role.COLABORADOR, rioClaro);
  colabB = await pessoa("colab-b", Role.COLABORADOR, barueri);
  gerRC = await pessoa("ger-rc", Role.GERENTE, null);
  admB = await pessoa("adm-b", Role.ADM_LOJA, barueri);
  supRCemB = await pessoa("sup-rc-em-b", Role.SUPERVISOR, barueri);

  ok(await definirUnidades(gerRC.id, [rioClaro.id]), 200);
  ok(await definirUnidades(admB.id, [barueri.id]), 200);
  ok(await definirUnidades(supRCemB.id, [rioClaro.id]), 200);

  regRC = await registrosDe(rioClaro, colabRC);
  regB = await registrosDe(barueri, colabB);

  ocorrenciaSemUnidade = ok(
    await request(app).post("/api/occurrences").set(as(sst.token)).send({
      type: "ACCIDENT",
      description: `Sem unidade ${SUFIXO}`,
      occurred_at: "2026-11-03T10:00:00.000Z",
    }),
  ).occurrence.id;
  acaoManual = ok(
    await request(app).post("/api/actions").set(as(sst.token)).send({
      title: `Ação manual ${SUFIXO}`,
      assignee_id: colabRC.id,
      due_date: PRAZO,
      effectiveness_criteria: "Feito",
    }),
  ).action.id;
});

afterAll(async () => {
  const evid = await prisma.evidence.findMany({
    where: { organizationId: ORG_ID, uploadedById: { in: [...usuarios, sst.user.id] }, uploadedAt: { gte: new Date(Date.now() - 3_600_000) } },
    select: { id: true, storagePath: true, actionId: true, occurrenceId: true, participationId: true, drillId: true, aepId: true },
  });
  const nossas = evid.filter((e) =>
    [regRC, regB].some((r) =>
      [r.evidenciaAcao, r.evidenciaOcorrencia, r.evidenciaParticipacao, r.ataSimulado].includes(e.id) ||
      [r.acao].includes(e.actionId ?? "") ||
      [r.ocorrencia].includes(e.occurrenceId ?? "") ||
      [r.participacao].includes(e.participationId ?? "") ||
      [r.simulado].includes(e.drillId ?? "") ||
      [r.aep].includes(e.aepId ?? ""),
    ),
  );
  for (const e of nossas) fs.rmSync(path.join(uploadsRoot(), e.storagePath), { force: true });
  await prisma.evidence.deleteMany({ where: { id: { in: nossas.map((e) => e.id) } } });
  const riscos = [rioClaro?.riskId, barueri?.riskId].filter(Boolean) as string[];
  const ocorrencias = await prisma.occurrence.findMany({
    where: { OR: [{ establishmentId: { in: unidades } }, { reportedById: { in: usuarios } }, { id: ocorrenciaSemUnidade }] },
    select: { id: true },
  });
  const ids = ocorrencias.map((o) => o.id);
  await prisma.evidence.deleteMany({ where: { occurrenceId: { in: ids } } });
  await prisma.action.deleteMany({
    where: {
      OR: [
        { riskId: { in: riscos } },
        { occurrenceId: { in: ids } },
        { assigneeId: { in: usuarios } },
        { id: acaoManual },
      ],
    },
  });
  await prisma.occurrence.deleteMany({ where: { id: { in: ids } } });
  await prisma.participationRecord.deleteMany({ where: { establishmentId: { in: unidades } } });
  await prisma.risk.deleteMany({ where: { id: { in: riscos } } });
  await prisma.hazard.deleteMany({ where: { activity: { establishmentId: { in: unidades } } } });
  await prisma.aep.deleteMany({ where: { establishmentId: { in: unidades } } });
  await prisma.emergencyProcedure.deleteMany({ where: { establishmentId: { in: unidades } } });
  await prisma.activity.deleteMany({ where: { establishmentId: { in: unidades } } });
  await prisma.user.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.jobRole.deleteMany({ where: { sector: { establishmentId: { in: unidades } } } });
  await prisma.sector.deleteMany({ where: { establishmentId: { in: unidades } } });
  await prisma.establishment.deleteMany({ where: { id: { in: unidades } } });
  await prisma.organization.deleteMany({ where: { id: outraEmpresa } });
});

const ids = (rows: { id: string }[] | undefined) => (rows ?? []).map((r) => r.id);

async function listas(token: string) {
  const [ocorrencias, acoes, aeps, participacoes, emergencias] = await Promise.all([
    request(app).get("/api/occurrences").set(as(token)),
    request(app).get("/api/actions").set(as(token)),
    request(app).get("/api/aeps").set(as(token)),
    request(app).get("/api/participations").set(as(token)),
    request(app).get("/api/emergency-procedures").set(as(token)),
  ]);
  return {
    ocorrencias: ids(ocorrencias.body.occurrences),
    acoes: ids(acoes.body.actions),
    aeps: ids(aeps.body.aeps),
    participacoes: ids(participacoes.body.participations),
    emergencias: ids(emergencias.body.procedures),
  };
}

/** Os registros da unidade, um por lista. */
const daUnidade = (r: Registros) => ({
  ocorrencias: r.ocorrencia,
  acoes: r.acao,
  aeps: r.aep,
  participacoes: r.participacao,
  emergencias: r.emergencia,
});

function confere(visto: Awaited<ReturnType<typeof listas>>, r: Registros, deve: boolean, quem: string) {
  for (const [lista, id] of Object.entries(daUnidade(r)) as [keyof typeof visto, string][]) {
    if (deve) expect(visto[lista], `${quem} deveria ver em ${lista}`).toContain(id);
    else expect(visto[lista], `${quem} não deveria ver em ${lista}`).not.toContain(id);
  }
}

async function igualAInexistente(montar: (id: string) => request.Test, idFora: string, status = 404) {
  const fora = await montar(idFora);
  const inexistente = await montar(randomUUID());
  expect(fora.status, `fora: ${fora.text}`).toBe(inexistente.status);
  expect(fora.text).toBe(inexistente.text);
  expect(fora.status).toBe(status);
  return fora;
}

describe("Rio Claro não alcança Barueri, e vice-versa [C2-13]", () => {
  it("listas de ocorrências, ações, AEP, participação e emergências", async () => {
    const doGerRC = await listas(gerRC.token);
    confere(doGerRC, regRC, true, "gerente RC");
    confere(doGerRC, regB, false, "gerente RC");
    const doAdmB = await listas(admB.token);
    confere(doAdmB, regB, true, "ADM Barueri");
    confere(doAdmB, regRC, false, "ADM Barueri");
    expect(doGerRC.ocorrencias).not.toContain(ocorrenciaSemUnidade);
    expect(doGerRC.acoes).not.toContain(acaoManual);
  });

  it("filtrar pela unidade negada não contorna o recorte", async () => {
    const res = await request(app).get(`/api/occurrences?establishment_id=${barueri.id}`).set(as(gerRC.token));
    expect(ids(res.body.occurrences)).toEqual([]);
    const acoes = await request(app).get(`/api/actions?establishment_id=${barueri.id}`).set(as(gerRC.token));
    expect(ids(acoes.body.actions)).toEqual([]);
  });

  it("detalhe, filho e arquivo por id: igual a inexistente", async () => {
    for (const [gestor, r] of [
      [gerRC, regB],
      [admB, regRC],
    ] as const) {
      const t = gestor.token;
      await igualAInexistente((id) => request(app).get(`/api/occurrences/${id}`).set(as(t)), r.ocorrencia);
      await igualAInexistente((id) => request(app).get(`/api/aeps/${id}`).set(as(t)), r.aep);
      await igualAInexistente((id) => request(app).get(`/api/participations/${id}`).set(as(t)), r.participacao);
      await igualAInexistente((id) => request(app).get(`/api/emergency-procedures/${id}`).set(as(t)), r.emergencia);
      await igualAInexistente(
        (id) => request(app).get(`/api/emergency-procedures/${r.emergencia}/drills/${id}`).set(as(t)),
        r.simulado,
      );
      await igualAInexistente((id) => request(app).get(`/api/evidences/${id}/file`).set(as(t)), r.evidenciaAcao);
      await igualAInexistente(
        (id) => request(app).get(`/api/participations/${r.participacao}/evidences/${id}/file`).set(as(t)),
        r.evidenciaParticipacao,
      );
      await igualAInexistente(
        (id) =>
          request(app)
            .get(`/api/emergency-procedures/${r.emergencia}/drills/${r.simulado}/evidences/${id}/file`)
            .set(as(t)),
        r.ataSimulado,
      );
      await igualAInexistente((id) => request(app).get(`/api/evidences?action_id=${id}`).set(as(t)), r.acao);
    }
  });

  it("editar, arquivar, concluir e anexar por id: igual a inexistente", async () => {
    const t = gerRC.token;
    const r = regB;
    await igualAInexistente((id) => request(app).patch(`/api/occurrences/${id}`).set(as(t)).send({ description: "x" }), r.ocorrencia);
    await igualAInexistente(
      (id) => request(app).post(`/api/occurrences/${id}/evidences`).set(as(t)).send({ file_name: "a.pdf", mime_type: "application/pdf" }),
      r.ocorrencia,
    );
    await igualAInexistente(
      (id) =>
        request(app).post(`/api/occurrences/${id}/actions`).set(as(t)).send({
          title: "x",
          assignee_id: gerRC.id,
          due_date: PRAZO,
          effectiveness_criteria: "x",
        }),
      r.ocorrencia,
    );
    await igualAInexistente((id) => request(app).patch(`/api/aeps/${id}`).set(as(t)).send({ findings: "x" }), r.aep);
    await igualAInexistente((id) => request(app).post(`/api/aeps/${id}/conclude`).set(as(t)).send({ findings: "x" }), r.aep);
    await igualAInexistente(
      (id) => request(app).post(`/api/aeps/${id}/hazards`).set(as(t)).send({ description: "x", activity_id: barueri.activityId }),
      r.aep,
    );
    await igualAInexistente((id) => request(app).patch(`/api/participations/${id}`).set(as(t)).send({ subject: "x" }), r.participacao);
    await igualAInexistente(
      (id) => request(app).post(`/api/participations/${id}/evidences`).set(as(t)).send({ file_name: "a.pdf", mime_type: "application/pdf" }),
      r.participacao,
    );
    await igualAInexistente((id) => request(app).patch(`/api/emergency-procedures/${id}`).set(as(t)).send({ scenario: "x" }), r.emergencia);
    await igualAInexistente((id) => request(app).delete(`/api/emergency-procedures/${id}`).set(as(t)), r.emergencia);
    await igualAInexistente(
      (id) => request(app).post(`/api/emergency-procedures/${id}/drills`).set(as(t)).send({ performed_at: "2026-11-01" }),
      r.emergencia,
    );
    await igualAInexistente(
      (id) =>
        request(app)
          .post(`/api/emergency-procedures/${r.emergencia}/drills/${id}/evidences`)
          .set(as(t))
          .send({ file_name: "a.pdf", mime_type: "application/pdf" }),
      r.simulado,
    );
    await igualAInexistente((id) => request(app).post(`/api/actions/${id}/complete`).set(as(t)), r.acao);
    await igualAInexistente(
      (id) => request(app).patch(`/api/actions/${id}/criterio`).set(as(t)).send({ effectiveness_criteria: "x" }),
      r.acao,
    );
    await igualAInexistente(
      (id) => request(app).post("/api/evidences").set(as(t)).send({ action_id: id, file_name: "a.pdf", mime_type: "application/pdf" }),
      r.acao,
      400,
    );
    // Arquivado nada ficou.
    const em = await prisma.emergencyProcedure.findUniqueOrThrow({ where: { id: r.emergencia } });
    expect(em.archivedAt).toBeNull();
  });

  it("na própria unidade, o gestor age (canário)", async () => {
    const t = gerRC.token;
    ok(await request(app).get(`/api/occurrences/${regRC.ocorrencia}`).set(as(t)), 200);
    ok(await request(app).patch(`/api/participations/${regRC.participacao}`).set(as(t)).send({ subject: `DDS ${SUFIXO}` }), 200);
    ok(await request(app).get(`/api/evidences/${regRC.evidenciaAcao}/file`).set(as(t)), 200);
    ok(await request(app).get(`/api/evidences?action_id=${regRC.acao}`).set(as(t)), 200);
    ok(
      await request(app).get(`/api/emergency-procedures/${regRC.emergencia}/drills/${regRC.simulado}/evidences/${regRC.ataSimulado}/file`).set(as(t)),
      200,
    );
    ok(await request(app).patch(`/api/actions/${regRC.acao}/criterio`).set(as(t)).send({ effectiveness_criteria: "Nenhuma caixa acima do ombro" }), 200);
  });
});

describe("gerir Rio Claro e trabalhar em Barueri: em Barueri, só o que o colaborador teria [C2-13]", () => {
  it("vê a ocorrência e os coletivos de Barueri (lista e detalhe)", async () => {
    const visto = await listas(supRCemB.token);
    confere(visto, regRC, true, "supervisor RC em B");
    expect(visto.ocorrencias).toContain(regB.ocorrencia);
    expect(visto.aeps).toContain(regB.aep);
    expect(visto.participacoes).toContain(regB.participacao);
    expect(visto.emergencias).toContain(regB.emergencia);
    expect(visto.acoes).toContain(regB.acao);
    ok(await request(app).get(`/api/occurrences/${regB.ocorrencia}`).set(as(supRCemB.token)), 200);
    ok(await request(app).get(`/api/aeps/${regB.aep}`).set(as(supRCemB.token)), 200);
    ok(await request(app).get(`/api/emergency-procedures/${regB.emergencia}`).set(as(supRCemB.token)), 200);
  });

  it("e recebe igual a inexistente ao editar, arquivar, concluir, anexar ou baixar o de terceiro", async () => {
    const t = supRCemB.token;
    const r = regB;
    await igualAInexistente((id) => request(app).patch(`/api/occurrences/${id}`).set(as(t)).send({ description: "x" }), r.ocorrencia);
    await igualAInexistente(
      (id) => request(app).post(`/api/occurrences/${id}/evidences`).set(as(t)).send({ file_name: "a.pdf", mime_type: "application/pdf" }),
      r.ocorrencia,
    );
    await igualAInexistente(
      (id) =>
        request(app).post(`/api/occurrences/${id}/actions`).set(as(t)).send({
          title: "x",
          assignee_id: supRCemB.id,
          due_date: PRAZO,
          effectiveness_criteria: "x",
        }),
      r.ocorrencia,
    );
    await igualAInexistente((id) => request(app).patch(`/api/aeps/${id}`).set(as(t)).send({ findings: "x" }), r.aep);
    await igualAInexistente((id) => request(app).post(`/api/aeps/${id}/conclude`).set(as(t)).send({ findings: "x" }), r.aep);
    await igualAInexistente((id) => request(app).patch(`/api/participations/${id}`).set(as(t)).send({ subject: "x" }), r.participacao);
    await igualAInexistente((id) => request(app).delete(`/api/emergency-procedures/${id}`).set(as(t)), r.emergencia);
    await igualAInexistente(
      (id) => request(app).post(`/api/emergency-procedures/${id}/drills`).set(as(t)).send({ performed_at: "2026-11-01" }),
      r.emergencia,
    );
    /*
      Ler o coletivo da unidade de trabalho inclui o arquivo, como o
      colaborador já tinha (S3-L: quem lê o plano vê a prova); o recorte não
      retira leitura legítima. [C2-13]
    */
    ok(await request(app).get(`/api/evidences/${r.evidenciaAcao}/file`).set(as(t)), 200);
    ok(
      await request(app).get(`/api/participations/${r.participacao}/evidences/${r.evidenciaParticipacao}/file`).set(as(t)),
      200,
    );
    ok(
      await request(app)
        .get(`/api/emergency-procedures/${r.emergencia}/drills/${r.simulado}/evidences/${r.ataSimulado}/file`)
        .set(as(t)),
      200,
    );
    await igualAInexistente((id) => request(app).post(`/api/actions/${id}/complete`).set(as(t)), r.acao);
    await igualAInexistente(
      (id) => request(app).patch(`/api/actions/${id}/criterio`).set(as(t)).send({ effectiveness_criteria: "x" }),
      r.acao,
    );
    const em = await prisma.emergencyProcedure.findUniqueOrThrow({ where: { id: r.emergencia } });
    expect(em.archivedAt).toBeNull();
    const oc = await prisma.occurrence.findUniqueOrThrow({ where: { id: r.ocorrencia } });
    expect(oc.description).not.toBe("x");
  });

  it("registra a própria ocorrência em Barueri, como colaborador, e a edita", async () => {
    const criada = ok(
      await request(app).post("/api/occurrences").set(as(supRCemB.token)).send({
        type: "DANGEROUS_EVENT",
        description: `Piso molhado ${SUFIXO}`,
        occurred_at: "2026-11-04T10:00:00.000Z",
        establishment_id: barueri.id,
      }),
    ).occurrence;
    ok(await request(app).patch(`/api/occurrences/${criada.id}`).set(as(supRCemB.token)).send({ description: `Piso molhado na doca ${SUFIXO}` }), 200);
    // Mas não abre AEP, procedimento nem participação em Barueri.
    const aep = (id: string) =>
      request(app).post("/api/aeps").set(as(supRCemB.token)).send({ establishment_id: id, scope_description: "x" });
    await igualAInexistente(aep, barueri.id);
  });
});

describe("colaborador: o coletivo da sua unidade e o próprio [C2-13]", () => {
  it("vê Rio Claro, não Barueri; nem o registro sem unidade", async () => {
    const visto = await listas(colabRC.token);
    confere(visto, regRC, true, "colaborador RC");
    confere(visto, regB, false, "colaborador RC");
    expect(visto.ocorrencias).not.toContain(ocorrenciaSemUnidade);
    expect(visto.acoes, "a ação manual dele").toContain(acaoManual);
    await igualAInexistente((id) => request(app).get(`/api/occurrences/${id}`).set(as(colabRC.token)), regB.ocorrencia);
    await igualAInexistente((id) => request(app).get(`/api/occurrences/${id}`).set(as(colabRC.token)), ocorrenciaSemUnidade);
  });

  it("baixa a prova das ações da sua loja (leitura do plano, S3-L); a de outra loja, não", async () => {
    ok(await request(app).get(`/api/evidences/${regRC.evidenciaAcao}/file`).set(as(colabRC.token)), 200);
    const prova = ok(
      await request(app).post("/api/evidences").set(as(colabB.token)).send({
        action_id: regB.acao,
        file_name: "outra.pdf",
        mime_type: "application/pdf",
        content_base64: PDF,
      }),
    ).evidence.id;
    // Quem gere Barueri e quem trabalha lá veem a prova da ação de Barueri; o colaborador de Rio Claro, não.
    ok(await request(app).get(`/api/evidences/${prova}/file`).set(as(admB.token)), 200);
    ok(await request(app).get(`/api/evidences/${prova}/file`).set(as(supRCemB.token)), 200);
    await igualAInexistente((id) => request(app).get(`/api/evidences/${id}/file`).set(as(colabRC.token)), prova);
  });
});

describe("Master, RH e SST veem as duas lojas [C2-13]", () => {
  it("listas", async () => {
    for (const [nome, s] of [
      ["master", master],
      ["rh", rh],
      ["sst", sst],
    ] as const) {
      const visto = await listas(s.token);
      confere(visto, regRC, true, nome);
      confere(visto, regB, true, nome);
    }
    const doMaster = await listas(master.token);
    expect(doMaster.ocorrencias).toContain(ocorrenciaSemUnidade);
    expect(doMaster.acoes).toContain(acaoManual);
  });
});

describe("criação: unidade, risco e pessoa fora do escopo respondem igual a inexistentes [C2-13]", () => {
  it("unidade não gerida", async () => {
    const t = gerRC.token;
    await igualAInexistente(
      (id) => request(app).post("/api/aeps").set(as(t)).send({ establishment_id: id, scope_description: "x" }),
      barueri.id,
    );
    await igualAInexistente(
      (id) =>
        request(app).post("/api/emergency-procedures").set(as(t)).send({
          establishment_id: id,
          scenario: "x",
          first_aid_means: "x",
          responsibles: "x",
          evacuation_plan: "x",
        }),
      barueri.id,
    );
    await igualAInexistente(
      (id) =>
        request(app)
          .post("/api/participations")
          .set(as(t))
          .send({ type: "MEETING", subject: "x", occurred_at: "2026-11-01", establishment_id: id }),
      barueri.id,
      400,
    );
    await igualAInexistente(
      (id) =>
        request(app)
          .post("/api/occurrences")
          .set(as(t))
          .send({ type: "ACCIDENT", description: "x", occurred_at: "2026-11-01", establishment_id: id }),
      barueri.id,
      400,
    );
    await igualAInexistente(
      (id) =>
        request(app).post("/api/actions").set(as(t)).send({
          title: "x",
          risk_id: id,
          assignee_id: gerRC.id,
          due_date: PRAZO,
          effectiveness_criteria: "x",
        }),
      barueri.riskId,
      400,
    );
    // Na unidade gerida, cria.
    ok(await request(app).post("/api/aeps").set(as(t)).send({ establishment_id: rioClaro.id, scope_description: `Caixa ${SUFIXO}` }));
  });

  it("responsável de outra loja ou de outra empresa", async () => {
    const t = gerRC.token;
    const acao = (uid: string) =>
      request(app).post("/api/actions").set(as(t)).send({
        title: "x",
        risk_id: rioClaro.riskId,
        assignee_id: uid,
        due_date: PRAZO,
        effectiveness_criteria: "x",
      });
    await igualAInexistente(acao, colabB.id, 400);
    const plano = (uid: string) =>
      request(app).post("/api/emergency-procedures").set(as(t)).send({
        establishment_id: rioClaro.id,
        scenario: "x",
        first_aid_means: "x",
        evacuation_plan: "x",
        responsible_user_ids: [uid],
      });
    await igualAInexistente(plano, colabB.id, 400);
  });

  it("ação da ocorrência com responsável de outra empresa é recusada", async () => {
    const abrir = (uid: string) =>
      request(app).post(`/api/occurrences/${regRC.ocorrencia}/actions`).set(as(sst.token)).send({
        title: "Ação da ocorrência",
        assignee_id: uid,
        due_date: PRAZO,
        effectiveness_criteria: "x",
      });
    const fora = await igualAInexistente(abrir, deFora, 400);
    expect(fora.body.message).toBe("Responsável não é da organização.");
    expect(await prisma.action.count({ where: { assigneeId: deFora } })).toBe(0);
  });

  it("fator da AEP só em atividade da unidade da avaliação", async () => {
    await igualAInexistente(
      (id) => request(app).post(`/api/aeps/${regRC.aep}/hazards`).set(as(sst.token)).send({ description: "x", activity_id: id }),
      barueri.activityId,
    );
  });
});

describe("GET /api/evidences exige a ação e a confere [C2-13]", () => {
  it("sem action_id é recusado; ação fora do escopo, igual a inexistente", async () => {
    expect((await request(app).get("/api/evidences").set(as(gerRC.token))).status).toBe(400);
    await igualAInexistente((id) => request(app).get(`/api/evidences?action_id=${id}`).set(as(gerRC.token)), regB.acao);
    await igualAInexistente((id) => request(app).get(`/api/evidences?action_id=${id}`).set(as(colabRC.token)), regB.acao);
  });
});

describe("contagens do Início não contam a unidade negada [C2-13]", () => {
  const cartao = (corpo: unknown, id: string) => {
    const m = JSON.stringify(corpo).match(new RegExp(`"id":"${id}"[^}]*"count":(\\d+)`));
    return Number(m?.[1] ?? 0);
  };

  it("ações a validar e atrasadas, ocorrências sem análise, simulados", async () => {
    // Pendências de gestão só em Barueri.
    await prisma.action.create({
      data: {
        organizationId: ORG_ID,
        title: `Atrasada B ${SUFIXO}`,
        sourceType: "RISK",
        riskId: barueri.riskId,
        status: ActionStatus.OPEN,
        assigneeId: colabB.id,
        createdById: sst.user.id,
        dueDate: new Date(Date.now() - 5 * 86_400_000),
      },
    });
    await prisma.action.create({
      data: {
        organizationId: ORG_ID,
        title: `A validar B ${SUFIXO}`,
        sourceType: "RISK",
        riskId: barueri.riskId,
        status: ActionStatus.WAITING_VALIDATION,
        assigneeId: colabB.id,
        createdById: sst.user.id,
        dueDate: new Date(Date.now() + 5 * 86_400_000),
      },
    });
    // Procedimento de Barueri que nunca teve simulado: conta para Barueri, não para Rio Claro.
    await prisma.emergencyProcedure.create({
      data: { organizationId: ORG_ID, establishmentId: barueri.id, scenario: `Sem simulado B ${SUFIXO}`, drillFrequencyMonths: 12 },
    });
    const inicio = await request(app).get("/api/inicio").set(as(gerRC.token));
    expect(inicio.status).toBe(200);
    const emRC = { risk: { hazard: { activity: { establishmentId: rioClaro.id } } } };
    expect(cartao(inicio.body, "acoes_validar")).toBe(
      await prisma.action.count({ where: { organizationId: ORG_ID, status: "WAITING_VALIDATION", ...emRC } }),
    );
    expect(cartao(inicio.body, "acoes_atrasadas")).toBe(
      await prisma.action.count({
        where: { organizationId: ORG_ID, status: { in: ["OPEN", "IN_PROGRESS"] }, dueDate: { lt: new Date() }, ...emRC },
      }),
    );
    expect(cartao(inicio.body, "ocorrencias")).toBe(
      await prisma.occurrence.count({ where: { organizationId: ORG_ID, analyzedAt: null, establishmentId: rioClaro.id } }),
    );
    // Rio Claro tem um procedimento com simulado em dia: nada a fazer; Barueri não entra.
    expect(cartao(inicio.body, "simulados")).toBe(0);
    // O ADM de Barueri conta as de Barueri (canário).
    const deB = await request(app).get("/api/inicio").set(as(admB.token));
    expect(cartao(deB.body, "acoes_atrasadas")).toBeGreaterThanOrEqual(1);
    expect(cartao(deB.body, "acoes_validar")).toBeGreaterThanOrEqual(1);
    expect(cartao(deB.body, "simulados")).toBeGreaterThanOrEqual(1);
  });
});

describe("tirar a unidade corta o acesso na sessão aberta [C2-13]", () => {
  it("detalhe, arquivo e ação deixam de abrir na requisição seguinte", async () => {
    const t = gerRC.token;
    ok(await request(app).get(`/api/occurrences/${regRC.ocorrencia}`).set(as(t)), 200);
    ok(await request(app).get(`/api/evidences/${regRC.evidenciaAcao}/file`).set(as(t)), 200);
    ok(await definirUnidades(gerRC.id, []), 200);
    try {
      await igualAInexistente((id) => request(app).get(`/api/occurrences/${id}`).set(as(t)), regRC.ocorrencia);
      await igualAInexistente((id) => request(app).get(`/api/evidences/${id}/file`).set(as(t)), regRC.evidenciaAcao);
      await igualAInexistente(
        (id) => request(app).patch(`/api/participations/${id}`).set(as(t)).send({ subject: "x" }),
        regRC.participacao,
      );
      await igualAInexistente(
        (id) => request(app).patch(`/api/actions/${id}/criterio`).set(as(t)).send({ effectiveness_criteria: "x" }),
        regRC.acao,
      );
      const visto = await listas(t);
      confere(visto, regRC, false, "gerente sem unidade");
    } finally {
      ok(await definirUnidades(gerRC.id, [rioClaro.id]), 200);
    }
  });
});

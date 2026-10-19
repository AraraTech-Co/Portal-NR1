import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Avaliar o risco e cuidar da Operação.
 *
 * Quem viu relata e quem responde tecnicamente encerra a análise da
 * ocorrência [S3-E]; o número de expostos vem das pessoas que estão nas
 * funções da atividade, em vez de digitado, e o Inventário leva direto à
 * avaliação [CB-22]; e arquivar uma função deixa de ser silencioso quando
 * ela ainda está em uso [S2-G] [B2-1-H].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };
let master: { token: string; user: { id: string } };
const criados: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

/** Uma unidade com setor, função e atividade ligadas. */
async function unidade(nome: string) {
  const est = (
    await request(app)
      .post("/api/establishments")
      .set(as(sst.token))
      .send({ name: `${nome} ${SUFIXO}` })
  ).body.establishment;
  const setor = (
    await request(app)
      .post("/api/sectors")
      .set(as(sst.token))
      .send({ establishment_id: est.id, name: "Produção" })
  ).body.sector;
  const funcao = (
    await request(app)
      .post("/api/job-roles")
      .set(as(sst.token))
      .send({ sector_id: setor.id, name: `Torneiro ${nome} ${SUFIXO}` })
  ).body.job_role;
  const atividade = (
    await request(app).post("/api/activities").set(as(sst.token)).send({
      establishment_id: est.id,
      sector_id: setor.id,
      name: `Tornear ${nome} ${SUFIXO}`,
      description: "Opera o torno mecânico",
      job_role_ids: [funcao.id],
    })
  ).body.activity;
  return {
    establishmentId: est.id as string,
    sectorId: setor.id as string,
    jobRoleId: funcao.id as string,
    activityId: atividade.id as string,
  };
}

/** Alguém na função, para contar como exposto. */
async function pessoaNaFuncao(jobRoleId: string, nome: string) {
  const login = `exposto.${nome}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: {
      login,
      email: `${login}@teste.local`,
      name: `Exposto ${nome} ${SUFIXO}`,
      passwordHash: await bcrypt.hash(SENHA, 10),
    },
  });
  criados.push(user.id);
  await prisma.membership.create({
    data: { userId: user.id, organizationId: ORG_ID, role: Role.COLABORADOR },
  });
  await prisma.employeeProfile.create({
    data: { organizationId: ORG_ID, userId: user.id, jobRoleId },
  });
  return user.id;
}

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  supervisor = await entrar("teste.supervisor");
  master = await entrar("teste.master");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: criados } } });
});

describe("quem viu relata, quem responde encerra [S3-E]", () => {
  async function ocorrencia() {
    const res = await request(app)
      .post("/api/occurrences")
      .set(as(supervisor.token))
      .send({
        type: "DANGEROUS_EVENT",
        description: `Quase-acidente ${SUFIXO} ${Math.random()}`,
        occurred_at: "2026-10-05",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.occurrence.id as string;
  }

  const analise = {
    generating_situation: "Piso molhado sem sinalização.",
    organizational_data: "Turno com uma pessoa a menos.",
    prevention_review: "Revisar a rotina de limpeza.",
  };

  it("o supervisor registra, mas não encerra a própria análise", async () => {
    const id = await ocorrencia();

    const tentou = await request(app)
      .post(`/api/occurrences/${id}/analyze`)
      .set(as(supervisor.token))
      .send(analise);
    expect(tentou.status).toBe(403);
    expect(tentou.body.code).toBe("OCCURRENCE_ANALYSIS_SST_ONLY");

    const guardada = await prisma.occurrence.findFirstOrThrow({
      where: { id },
      select: { analyzedAt: true, analyzedById: true },
    });
    expect(guardada.analyzedAt, "nada foi encerrado").toBeNull();
    expect(guardada.analyzedById).toBeNull();
  });

  it("o técnico encerra, e fica registrado quem foi", async () => {
    const id = await ocorrencia();

    const res = await request(app)
      .post(`/api/occurrences/${id}/analyze`)
      .set(as(sst.token))
      .send(analise);
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const guardada = await prisma.occurrence.findFirstOrThrow({
      where: { id },
      select: { analyzedAt: true, analyzedById: true },
    });
    expect(guardada.analyzedAt).not.toBeNull();
    expect(guardada.analyzedById).toBe(sst.user.id);
  });

  it("quem cuida da conta também encerra, para empresa sem SST próprio", async () => {
    const id = await ocorrencia();
    const res = await request(app)
      .post(`/api/occurrences/${id}/analyze`)
      .set(as(master.token))
      .send(analise);
    expect(res.status).toBe(200);
  });
});

describe("o número de expostos vem da função [CB-22]", () => {
  it("a atividade diz quantas pessoas estão nas funções dela", async () => {
    const u = await unidade("Alfa");

    const vazia = await request(app)
      .get(`/api/activities?sector_id=${u.sectorId}`)
      .set(as(sst.token));
    expect(vazia.status).toBe(200);
    const antes = (vazia.body.activities as { id: string; people_count: number }[]).find(
      (a) => a.id === u.activityId,
    );
    expect(antes?.people_count, "ninguém na função ainda").toBe(0);

    await pessoaNaFuncao(u.jobRoleId, "um");
    await pessoaNaFuncao(u.jobRoleId, "dois");

    const cheia = await request(app)
      .get(`/api/activities?sector_id=${u.sectorId}`)
      .set(as(sst.token));
    const depois = (cheia.body.activities as { id: string; people_count: number }[]).find(
      (a) => a.id === u.activityId,
    );
    expect(depois?.people_count).toBe(2);
  });

  it("quem foi desligado não conta como exposto", async () => {
    const u = await unidade("Beta");
    const userId = await pessoaNaFuncao(u.jobRoleId, "saiu");
    await prisma.employeeProfile.updateMany({
      where: { organizationId: ORG_ID, userId },
      data: { dismissedAt: new Date() },
    });

    const res = await request(app)
      .get(`/api/activities?sector_id=${u.sectorId}`)
      .set(as(sst.token));
    const a = (res.body.activities as { id: string; people_count: number }[]).find(
      (x) => x.id === u.activityId,
    );
    expect(a?.people_count).toBe(0);
  });

  it("o inventário vivo leva o id da atividade; o documento emitido, não", async () => {
    const u = await unidade("Gama");
    const perigo = await request(app).post("/api/hazards").set(as(sst.token)).send({
      activity_id: u.activityId,
      description: `Peça girando ${SUFIXO}`,
      category: "ACCIDENT",
    });
    expect(perigo.status).toBe(201);

    const vivo = await request(app)
      .get(`/api/inventory?establishment_id=${u.establishmentId}`)
      .set(as(sst.token));
    expect(vivo.status).toBe(200);
    const item = (vivo.body.inventory.items as { hazard_id: string; activity_id: string }[]).find(
      (i) => i.hazard_id === perigo.body.hazard.id,
    );
    expect(item?.activity_id, "a tela chega direto na avaliação").toBe(u.activityId);

    // O que é assinado e arquivado continua só com fatos legíveis.
    const emitido = await request(app)
      .post("/api/pgr-documents")
      .set(as(sst.token))
      .send({
        type: "INVENTORY",
        establishment_id: u.establishmentId,
        responsible_name: `Responsável ${SUFIXO}`,
      });
    expect(emitido.status, JSON.stringify(emitido.body)).toBe(201);

    const aberto = await request(app)
      .get(`/api/pgr-documents/${emitido.body.document.id}`)
      .set(as(sst.token));
    const itens = aberto.body.document.content.items as Record<string, unknown>[];
    expect(itens.length).toBeGreaterThan(0);
    for (const i of itens) {
      expect(i, "documento sem id de banco").not.toHaveProperty("activity_id");
    }
  });
});

describe("arquivar função em uso deixa de ser silencioso [S2-G] [B2-1-H]", () => {
  it("função ligada a atividade ativa é recusada", async () => {
    const u = await unidade("Delta");

    const res = await request(app)
      .delete(`/api/job-roles/${u.jobRoleId}`)
      .set(as(sst.token));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("JOB_ROLE_IN_USE");

    const funcao = await prisma.jobRole.findFirstOrThrow({
      where: { id: u.jobRoleId },
      select: { archivedAt: true },
    });
    expect(funcao.archivedAt).toBeNull();
  });

  it("função com gente dentro é recusada, mesmo sem atividade", async () => {
    const u = await unidade("Epsilon");
    await request(app)
      .delete(`/api/activities/${u.activityId}`)
      .set(as(sst.token));
    await pessoaNaFuncao(u.jobRoleId, "fica");

    const res = await request(app)
      .delete(`/api/job-roles/${u.jobRoleId}`)
      .set(as(sst.token));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("JOB_ROLE_HAS_PEOPLE");
  });

  it("função livre arquiva", async () => {
    const u = await unidade("Zeta");
    await request(app)
      .delete(`/api/activities/${u.activityId}`)
      .set(as(sst.token));

    const res = await request(app)
      .delete(`/api/job-roles/${u.jobRoleId}`)
      .set(as(sst.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });
});

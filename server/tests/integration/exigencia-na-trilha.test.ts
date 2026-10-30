import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Criar exigência por função entra no histórico de auditoria. [CB-75]
 *
 * A exigência decide quem o Painel conta "em dia" no treinamento, e não havia
 * registro de quem a criou nem quando.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

let app: Express;
let rh: { token: string; user: { id: string } };
const criadas: string[] = [];

beforeAll(async () => {
  app = createApp();
  const res = await request(app).post("/api/auth").send({ login: "teste.rh", password: SENHA });
  expect(res.status).toBe(200);
  rh = res.body;
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { entityId: { in: criadas } } });
  await prisma.jobRoleRequirement.deleteMany({ where: { id: { in: criadas } } });
});

describe("a exigência da função na trilha [CB-75]", () => {
  it("quem criou, quando e o que a exigência pede ficam registrados", async () => {
    const funcao = await prisma.jobRole.findFirstOrThrow({
      where: { organizationId: ORG, archivedAt: null },
      select: { id: true },
    });
    const antes = new Date();
    const res = await request(app)
      .post("/api/job-role-requirements")
      .set({ Authorization: `Bearer ${rh.token}` })
      .send({
        job_role_id: funcao.id,
        kind: "CERTIFICATE",
        name: `NR-12 ${SUFIXO}`,
        validity_months: 24,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const id = res.body.requirement.id as string;
    criadas.push(id);

    const trilha = await prisma.auditEvent.findMany({
      where: { entityId: id, action: "job_role_requirement.create" },
    });
    expect(trilha).toHaveLength(1);
    expect(trilha[0]!.actorId).toBe(rh.user.id);
    expect(trilha[0]!.organizationId).toBe(ORG);
    expect(trilha[0]!.entityType).toBe("JobRoleRequirement");
    expect(trilha[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(antes.getTime() - 1000);
    expect(trilha[0]!.after).toMatchObject({
      jobRoleId: funcao.id,
      kind: "CERTIFICATE",
      name: `NR-12 ${SUFIXO}`,
      validityMonths: 24,
    });
  });

  it("a consulta da fiscalização vê a criação no Histórico", async () => {
    const fiscal = await request(app).post("/api/auth").send({ login: "teste.fiscal", password: SENHA });
    expect(fiscal.status).toBe(200);
    const res = await request(app)
      .get("/api/fiscalizacao/historico?limit=200")
      .set({ Authorization: `Bearer ${fiscal.body.token}` });
    expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
    const eventos = res.body.events as { action: string; entity_id: string }[];
    expect(
      eventos.some((e) => e.action === "job_role_requirement.create" && criadas.includes(e.entity_id)),
    ).toBe(true);
  });

  it("pedido recusado não deixa rastro de criação", async () => {
    const res = await request(app)
      .post("/api/job-role-requirements")
      .set({ Authorization: `Bearer ${rh.token}` })
      .send({ job_role_id: "nao-existe", name: `Fantasma ${SUFIXO}` });
    expect(res.status).toBe(400);
    expect(
      await prisma.auditEvent.count({
        where: { action: "job_role_requirement.create", after: { path: ["name"], equals: `Fantasma ${SUFIXO}` } },
      }),
    ).toBe(0);
  });
});

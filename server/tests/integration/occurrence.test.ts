import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../src/app";
import type { Express } from "express";

const EST_ID = "00000000-0000-4000-8000-000000000010";
const RISK_ID = "00000000-0000-4000-8000-000000000015";

async function login(app: Express, loginId: string) {
  const res = await request(app)
    .post("/api/auth")
    .send({ login: loginId, password: "admin123" });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

describe("Occurrence module (NR-1 1.5.5.5)", () => {
  let app: Express;
  let token: string;
  let occurrenceId: string;
  /* Responsável e prazo passaram a ser obrigatórios também aqui. [S2-M] */
  let responsavel: string;

  beforeAll(async () => {
    app = createApp();
    token = await login(app, "admin");
    const eu = await request(app)
      .get("/api/auth")
      .set("Authorization", `Bearer ${token}`);
    expect(eu.status).toBe(200);
    responsavel = eu.body.user.id as string;
  });

  it("rejects invalid type", async () => {
    const res = await request(app)
      .post("/api/occurrences")
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "OTHER",
        description: "Teste",
        occurred_at: "2026-09-01T10:00:00.000Z",
      });
    expect(res.status).toBe(400);
  });

  it("creates occurrence linked to risk", async () => {
    const res = await request(app)
      .post("/api/occurrences")
      .set("Authorization", `Bearer ${token}`)
      .send({
        type: "DANGEROUS_EVENT",
        description: "Quase-acidente com projeção de cavaco",
        occurred_at: "2026-09-10T14:30:00.000Z",
        establishment_id: EST_ID,
        risk_id: RISK_ID,
      });
    expect(res.status).toBe(201);
    expect(res.body.occurrence.type).toBe("DANGEROUS_EVENT");
    expect(res.body.occurrence.analyzedAt).toBeNull();
    occurrenceId = res.body.occurrence.id;
  });

  it("rejects incomplete analysis", async () => {
    const res = await request(app)
      .post(`/api/occurrences/${occurrenceId}/analyze`)
      .set("Authorization", `Bearer ${token}`)
      .send({ generating_situation: "Só o item a" });
    expect(res.status).toBe(400);
  });

  it("analyzes with NR-1 1.5.5.5.2 fields and flags risk", async () => {
    const res = await request(app)
      .post(`/api/occurrences/${occurrenceId}/analyze`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        generating_situation:
          "Operação sem protetor no torno; organização do posto sem barreira.",
        organizational_data:
          "2 operadores no turno; histórico sem CAT; relato dos trabalhadores.",
        prevention_review:
          "Revisar guarda do torno e reforçar inspeção de controles.",
      });
    expect(res.status).toBe(200);
    expect(res.body.occurrence.analyzedAt).toBeTruthy();
    expect(res.body.occurrence.analyzedById).toBeTruthy();

    const risks = await request(app)
      .get("/api/risks")
      .set("Authorization", `Bearer ${token}`);
    const risk = risks.body.risks.find((r: { id: string }) => r.id === RISK_ID);
    expect(risk.needsReassessment).toBe(true);
  });

  it("adds corrective action and evidence", async () => {
    const action = await request(app)
      .post(`/api/occurrences/${occurrenceId}/actions`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        title: "Instalar guarda no torno",
        effectiveness_criteria: "Protetor instalado e inspecionado",
        /*
          Este caso mandava a ação sem responsável e sem prazo e esperava
          201: era a rota da ocorrência passando por fora da decisão S2-M,
          que o plano de ação já cumpria. [B3-4-C] [S2-M]
        */
        assignee_id: responsavel,
        /*
          Dentro do limite do nível do risco: a ação pela ocorrência segue a
          regra do Inventário, e a prioridade não escolhida é a do nível, não
          mais sempre Alta. [CB-72]
        */
        due_date: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10),
      });
    expect(action.status, JSON.stringify(action.body)).toBe(201);
    expect(action.body.action.sourceType).toBe("OCCURRENCE");
    expect(action.body.action.occurrenceId).toBe(occurrenceId);
    expect(action.body.action.riskId).toBe(RISK_ID);
    const nivel = action.body.action.riskLevelAtOpening as string;
    expect(nivel, "a ação guarda o nível do risco na abertura").toBeTruthy();
    expect(action.body.action.priority).toBe(
      ({ INTOLERABLE: "CRITICAL", SUBSTANTIAL: "HIGH", MODERATE: "MEDIUM", TOLERABLE: "LOW", TRIVIAL: "LOW" } as Record<string, string>)[nivel],
    );

    const ev = await request(app)
      .post(`/api/occurrences/${occurrenceId}/evidences`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        file_name: "foto-posto.pdf",
        mime_type: "application/pdf",
        description: "Registro do quase-acidente",
      });
    expect(ev.status).toBe(201);
    expect(ev.body.evidence.occurrenceId).toBe(occurrenceId);

    const detail = await request(app)
      .get(`/api/occurrences/${occurrenceId}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.occurrence.actions.length).toBeGreaterThanOrEqual(1);
    expect(detail.body.occurrence.evidences.length).toBeGreaterThanOrEqual(1);
  });
});

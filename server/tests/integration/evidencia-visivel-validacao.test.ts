import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";

/**
 * Quem valida a ação vê a prova antes de decidir. [S3-L]
 *
 * Exige a organização do `scripts/seed-teste-org.ts` (um usuário por papel)
 * e o seed principal (`admin` / `admin123`) para o teste entre organizações.
 */
const SENHA = "teste1234";
const EST_ID = "aaaaaaaa-0001-4000-8000-000000000011";

// PNG 1×1 de verdade — o conteúdo tem de voltar idêntico.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function entrar(app: Express, login: string, password = SENHA) {
  const res = await request(app).post("/api/auth").send({ login, password });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst: string;
let owner: string;
let colaborador: string;
let outraOrg: string;
let actionId: string;
let evidenceId: string;

beforeAll(async () => {
  app = createApp();
  sst = await entrar(app, "teste.sst");
  owner = await entrar(app, "teste.owner");
  colaborador = await entrar(app, "teste.colaborador");
  outraOrg = await entrar(app, "admin", "admin123");

  const action = await request(app)
    .post("/api/actions")
    .set(as(sst))
    .send({ title: "Instalar corrimão na escada", priority: "HIGH" });
  expect(action.status).toBe(201);
  actionId = action.body.action.id;

  const ev = await request(app)
    .post("/api/evidences")
    .set(as(sst))
    .send({
      action_id: actionId,
      type: "PHOTO",
      file_name: "corrimao instalado.png",
      mime_type: "image/png",
      content_base64: PNG.toString("base64"),
      description: "Corrimão fixado dos dois lados",
    });
  expect(ev.status).toBe(201);
  evidenceId = ev.body.evidence.id;
  expect(ev.body.evidence.storagePath).toBeUndefined();

  const done = await request(app).post(`/api/actions/${actionId}/complete`).set(as(sst));
  expect(done.status).toBe(200);
});

describe("quem valida vê a prova [S3-L]", () => {
  it("a lista diz quem enviou e não expõe o caminho interno do arquivo", async () => {
    const res = await request(app)
      .get(`/api/evidences?action_id=${actionId}`)
      .set(as(owner));
    expect(res.status).toBe(200);
    const [ev] = res.body.evidences;
    expect(ev.id).toBe(evidenceId);
    expect(ev.uploadedBy.name).toBeTruthy();
    expect(ev.storagePath).toBeUndefined();
  });

  it("o validador abre a foto: mesmo conteúdo, tipo certo, para ver na tela", async () => {
    const res = await request(app)
      .get(`/api/evidences/${evidenceId}/file`)
      .set(as(owner))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["content-disposition"]).toMatch(/^inline;/);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(res.body as Buffer, PNG)).toBe(0);
  });

  it("depois de ver, aprova — e quem executou continua sem poder validar", async () => {
    const proprio = await request(app)
      .post(`/api/actions/${actionId}/review`)
      .set(as(sst))
      .send({ decision: "approve" });
    expect(proprio.status).toBe(403);

    const ok = await request(app)
      .post(`/api/actions/${actionId}/review`)
      .set(as(owner))
      .send({ decision: "approve", effectiveness_result: "Corrimão firme, conferido na foto" });
    expect(ok.status).toBe(200);
    expect(ok.body.action.status).toBe("VALIDATED");
  });

  it("quem só lê o plano também vê a prova (é leitura do plano)", async () => {
    const res = await request(app)
      .get(`/api/evidences/${evidenceId}/file`)
      .set(as(colaborador));
    expect(res.status).toBe(200);
  });
});

describe("o arquivo não sai do seu lugar", () => {
  it("sem login, nada", async () => {
    const res = await request(app).get(`/api/evidences/${evidenceId}/file`);
    expect(res.status).toBe(401);
  });

  it("outra organização não acha a evidência", async () => {
    const res = await request(app)
      .get(`/api/evidences/${evidenceId}/file`)
      .set(as(outraOrg));
    expect(res.status).toBe(404);
  });

  it("evidência de ocorrência não sai por esta rota", async () => {
    const occ = await request(app)
      .post("/api/occurrences")
      .set(as(sst))
      .send({
        type: "DANGEROUS_EVENT",
        description: "Escada sem corrimão",
        occurred_at: "2026-10-05T10:00:00.000Z",
        establishment_id: EST_ID,
      });
    expect(occ.status).toBe(201);
    const ev = await request(app)
      .post(`/api/occurrences/${occ.body.occurrence.id}/evidences`)
      .set(as(sst))
      .send({
        file_name: "escada.png",
        mime_type: "image/png",
        content_base64: PNG.toString("base64"),
      });
    expect(ev.status).toBe(201);

    const res = await request(app)
      .get(`/api/evidences/${ev.body.evidence.id}/file`)
      .set(as(owner));
    expect(res.status).toBe(404);
  });
});

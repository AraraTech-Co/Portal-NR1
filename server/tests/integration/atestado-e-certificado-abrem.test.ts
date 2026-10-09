import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";

/**
 * O colaborador envia o atestado com foto [S4-B]; o RH abre o arquivo antes
 * de decidir [S5-B]; o certificado em Saúde diz de quem é e abre [S5-K].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";

// PNG 1×1 de verdade — o conteúdo tem de voltar idêntico.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function entrar(app: Express, login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body.token as string;
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Lê a resposta binária inteira. */
function binary(r: request.Test) {
  return r.buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(c));
    res.on("end", () => cb(null, Buffer.concat(chunks)));
  });
}

let app: Express;
let colaborador: string;
let rh: string;
let gerente: string;
let fiscal: string;
let sst: string;

beforeAll(async () => {
  app = createApp();
  colaborador = await entrar(app, "teste.colaborador");
  rh = await entrar(app, "teste.rh");
  gerente = await entrar(app, "teste.gerente");
  fiscal = await entrar(app, "teste.fiscal");
  sst = await entrar(app, "teste.sst");
});

describe("atestado: enviar com foto e o RH abrir antes de decidir", () => {
  let id: string;

  it("o colaborador envia com a foto [S4-B]", async () => {
    const res = await request(app)
      .post("/api/medical-certificates")
      .set(as(colaborador))
      .send({
        start_date: "2026-10-06",
        days: 2,
        reason: "Consulta",
        file_name: "atestado.png",
        mime_type: "image/png",
        content_base64: PNG.toString("base64"),
      });
    expect(res.status).toBe(201);
    expect(res.body.certificate.has_file).toBe(true);
    expect(res.body.certificate.storagePath).toBeUndefined();
    id = res.body.certificate.id;
  });

  it("o RH abre o arquivo e a lista não expõe o caminho interno [S5-B]", async () => {
    const lista = await request(app).get("/api/medical-certificates").set(as(rh));
    const row = (lista.body.certificates as { id: string; has_file: boolean; storagePath?: string }[]).find(
      (c) => c.id === id,
    );
    expect(row?.has_file).toBe(true);
    expect(row?.storagePath).toBeUndefined();

    const file = await binary(request(app).get(`/api/medical-certificates/${id}/file`).set(as(rh)));
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toBe("image/png");
    expect(file.headers["content-disposition"]).toMatch(/^inline;/);
    expect(Buffer.compare(file.body as Buffer, PNG)).toBe(0);

    const decide = await request(app)
      .post(`/api/medical-certificates/${id}/review`)
      .set(as(rh))
      .send({ status: "APPROVED" });
    expect(decide.status).toBe(200);
    expect(decide.body.certificate.storagePath).toBeUndefined();
  });

  it("quem enviou revê o próprio arquivo", async () => {
    const file = await request(app).get(`/api/medical-certificates/${id}/file`).set(as(colaborador));
    expect(file.status).toBe(200);
  });

  it("mais ninguém abre: é dado de saúde", async () => {
    // gerente lê o módulo, mas só o próprio
    expect((await request(app).get(`/api/medical-certificates/${id}/file`).set(as(gerente))).status).toBe(404);
    // técnico e fiscal não têm o módulo
    expect((await request(app).get(`/api/medical-certificates/${id}/file`).set(as(sst))).status).toBe(403);
    expect((await request(app).get(`/api/medical-certificates/${id}/file`).set(as(fiscal))).status).toBe(403);
    expect((await request(app).get(`/api/medical-certificates/${id}/file`)).status).toBe(401);
  });
});

describe("certificado em Saúde: de quem é e abre [S5-K]", () => {
  let id: string;

  it("a lista diz de quem é; o arquivo abre para o dono, o RH e o fiscal", async () => {
    const enviado = await request(app)
      .post("/api/worker-certificates")
      .set(as(colaborador))
      .send({
        name: "NR-35 trabalho em altura",
        file_name: "nr35.png",
        mime_type: "image/png",
        content_base64: PNG.toString("base64"),
      });
    expect(enviado.status).toBe(201);
    expect(enviado.body.certificate.storagePath).toBeUndefined();
    id = enviado.body.certificate.id;

    const lista = await request(app).get("/api/worker-certificates").set(as(rh));
    const row = (lista.body.certificates as { id: string; has_file: boolean; user: { name: string } }[]).find(
      (c) => c.id === id,
    );
    expect(row?.user.name).toBe("Colaborador Teste");
    expect(row?.has_file).toBe(true);

    for (const token of [colaborador, rh, fiscal]) {
      const file = await binary(request(app).get(`/api/worker-certificates/${id}/file`).set(as(token)));
      expect(file.status).toBe(200);
      expect(Buffer.compare(file.body as Buffer, PNG)).toBe(0);
    }
  });

  it("quem só lê o próprio não abre o dos outros", async () => {
    expect((await request(app).get(`/api/worker-certificates/${id}/file`).set(as(gerente))).status).toBe(404);
  });
});

import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";

/**
 * Arquivo de tamanho real de celular passa nas rotas de anexo. [S3-K]
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const MB = 1024 * 1024;

/** "Foto" do tamanho que um celular gera. O conteúdo não importa aqui — o tamanho sim. */
const fotoDe = (megabytes: number) =>
  Buffer.alloc(Math.round(megabytes * MB), 0xff).toString("base64");

let app: Express;
let token: string;

beforeAll(async () => {
  app = createApp();
  const res = await request(app)
    .post("/api/auth")
    .send({ login: "teste.colaborador", password: "teste1234" });
  expect(res.status).toBe(200);
  token = res.body.token;
});

const enviarAtestadoComFoto = (megabytes: number) =>
  request(app)
    .post("/api/medical-certificates")
    .set("Authorization", `Bearer ${token}`)
    .send({
      start_date: "2026-10-06",
      days: 1,
      reason: "Atestado fotografado no celular",
      file_name: "IMG_0001.jpg",
      mime_type: "image/jpeg",
      content_base64: fotoDe(megabytes),
    });

describe("anexo do tamanho de uma foto de celular [S3-K]", () => {
  it("aceita foto de 4 MB — o tamanho comum de um iPhone", async () => {
    const res = await enviarAtestadoComFoto(4);
    expect(res.status).toBe(201);
  });

  it("acima do limite, responde 413 em JSON legível, não em HTML", async () => {
    const res = await enviarAtestadoComFoto(22);
    expect(res.status).toBe(413);
    expect(res.body.message).toMatch(/limite é 20 MB/);
  });

  it("fora das rotas de anexo, o limite de 2 MB continua valendo", async () => {
    const res = await request(app)
      .post("/api/auth")
      .send({ login: "x", password: "x".repeat(3 * MB) });
    expect(res.status).toBe(413);
  });
});

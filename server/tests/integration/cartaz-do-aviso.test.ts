import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O aviso do mural impresso como cartaz A4. [C1-8]
 *
 * O botão é de quem publica avisos e some no aviso retirado; a página do
 * cartaz recusa os dois casos. O servidor passa a mandar o nome da empresa
 * junto com o aviso, para o cabeçalho do cartaz.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string };
let avisoId: string;

/** Sem comentários: o comentário que explica a regra cita o próprio trecho. */
function tela(nome: string) {
  return readFileSync(join(__dirname, "../../../client/src/pages", nome), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

beforeAll(async () => {
  app = createApp();
  const res = await request(app).post("/api/auth").send({ login: "teste.rh", password: SENHA });
  expect(res.status).toBe(200);
  rh = res.body;
  const criado = await request(app)
    .post("/api/announcements")
    .set(as(rh.token))
    .send({ kind: "NOTICE", title: "Cartaz de teste", body: "Texto do **cartaz**." });
  expect(criado.status, JSON.stringify(criado.body)).toBe(201);
  avisoId = criado.body.announcement.id;
});

afterAll(async () => {
  await prisma.announcement.deleteMany({ where: { id: avisoId } });
});

describe("cartaz do aviso [C1-8]", () => {
  it("o aviso vem com o nome da empresa, e só o nome", async () => {
    const res = await request(app).get(`/api/announcements/${avisoId}`).set(as(rh.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.announcement.organization).toEqual({ name: expect.any(String) });
    expect(res.body.announcement.organization.name.length).toBeGreaterThan(0);
  });

  it("o botão é de quem publica e não aparece no aviso retirado", () => {
    const mural = tela("AnnouncementsPage.tsx");
    const botao = mural.indexOf("Imprimir cartaz");
    expect(botao, "o botão existe uma vez").toBeGreaterThan(0);
    expect(mural.indexOf("Imprimir cartaz", botao + 1)).toBe(-1);
    // O bloco que contém o botão é o de `canPublish && !r.withdrawnAt`.
    const guarda = mural.lastIndexOf("{canPublish && !r.withdrawnAt && (", botao);
    expect(guarda).toBeGreaterThan(0);
    const fecha = mural.indexOf("</>", guarda);
    expect(fecha).toBeGreaterThan(botao);
  });

  it("a página do cartaz recusa quem não publica e o aviso retirado", () => {
    const cartaz = tela("AnnouncementPosterPage.tsx");
    expect(cartaz).toMatch(/!podePublicar\s*\?/);
    expect(cartaz).toMatch(/aviso\?\.withdrawnAt\s*\?/);
    expect(cartaz).toContain('useModuleAccess("mural")');
    expect(cartaz).toContain("Este aviso também está no Portal NR-1, no Mural");
    expect(cartaz).toContain("Todas as unidades");
  });
});

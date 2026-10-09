import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";

/**
 * Ficha do colaborador só aceita CPF de verdade. [S5-N]
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
async function entrar(app: Express, login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: "teste1234" });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

/** CPF válido aleatório: o CPF é único por empresa, e o teste roda mais de uma vez. */
function cpfValido(): string {
  const dv = (d: number[]) => {
    const n = d.length;
    const r = (d.reduce((t, x, i) => t + x * (n + 1 - i), 0) * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const base = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const d1 = dv(base);
  return [...base, d1, dv([...base, d1])].join("");
}

let app: Express;
let rh: { token: string };
let perfilDoColaborador: string;
let gerenteSemFicha: string;

beforeAll(async () => {
  app = createApp();
  rh = await entrar(app, "teste.rh");
  const colaborador = await entrar(app, "teste.colaborador");
  gerenteSemFicha = (await entrar(app, "teste.gerente")).user.id;

  const lista = await request(app)
    .get("/api/employee-profiles")
    .set("Authorization", `Bearer ${rh.token}`);
  expect(lista.status).toBe(200);
  const perfis = (lista.body.profiles ?? lista.body) as { id: string; userId: string }[];
  const perfil = perfis.find((p) => p.userId === colaborador.user.id);
  expect(perfil, "ficha do colaborador no seed").toBeTruthy();
  perfilDoColaborador = perfil!.id;
});

const editar = (taxId: string) =>
  request(app)
    .patch(`/api/employee-profiles/${perfilDoColaborador}`)
    .set("Authorization", `Bearer ${rh.token}`)
    .send({ tax_id: taxId });

describe("CPF da ficha [S5-N]", () => {
  it("recusa dígito verificador errado", async () => {
    const res = await editar("123.456.789-00");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/CPF inválido/);
  });

  it("recusa sequência repetida", async () => {
    expect((await editar("111.111.111-11")).status).toBe(400);
  });

  it("recusa CNPJ no lugar de CPF", async () => {
    expect((await editar("30.589.468/0001-24")).status).toBe(400);
  });

  it("não cria ficha nova com CPF inválido", async () => {
    const res = await request(app)
      .post("/api/employee-profiles")
      .set("Authorization", `Bearer ${rh.token}`)
      .send({ user_id: gerenteSemFicha, registration: `GER-${Date.now()}`, tax_id: "123.456.789-00" });
    expect(res.status).toBe(400);
  });

  it("aceita CPF válido e guarda só os dígitos", async () => {
    const cpf = cpfValido();
    const formatado = `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
    const res = await editar(formatado);
    expect(res.status).toBe(200);
    expect(res.body.profile.taxId).toBe(cpf);
  });
});

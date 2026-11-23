import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Quem cria, arquiva e muda os dados cadastrais da filial (Correção 6,
 * C6-11, decisão D6-5): só o Master e o Dono. O nome segue com quem edita a
 * Operação.
 *
 * Usa as pessoas do `scripts/seed-teste-org.ts`. A filial do teste é criada
 * aqui e apagada no fim.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const as = (t: string) => ({ Authorization: `Bearer ${t}` });

let app: Express;
let filial = "";
const token: Record<string, string> = {};
const QUEM_NAO_CUIDA = ["sst", "gerente", "supervisor", "admloja", "rh"];
/** CNPJ válido e novo a cada execução: o CNPJ não se repete entre filiais (23/11). */
function cnpjFicticio(semente: number): string {
  const d = String(10000000 + (semente % 89999999)).padStart(8, "0").split("").map(Number);
  d.push(0, 0, 0, 1);
  const dv = (pesos: number[]) => {
    const r = d.slice(0, pesos.length).reduce((t, x, i) => t + x * pesos[i]!, 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  d.push(dv([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  d.push(dv([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]));
  return d.join("");
}
const CADASTRAIS: Record<string, string> = {
  tax_id: cnpjFicticio(Date.now()),
  legal_name: "Razão de Teste LTDA",
  payroll_code: "9876",
  address: "Rua do Teste, 1",
};

beforeAll(async () => {
  app = createApp();
  for (const quem of ["master", "owner", ...QUEM_NAO_CUIDA]) {
    const res = await request(app).post("/api/auth").send({ login: `teste.${quem}`, password: SENHA });
    expect(res.status, `login de ${quem}`).toBe(200);
    token[quem] = res.body.token;
  }
  filial = (
    await prisma.establishment.create({ data: { organizationId: ORG_ID, name: `Filial C611 ${SUFIXO}` } })
  ).id;
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({ where: { organizationId: ORG_ID, entityId: filial } });
  await prisma.establishment.deleteMany({ where: { organizationId: ORG_ID, name: { contains: `C611 ${SUFIXO}` } } });
});

describe("criar e arquivar filial [C6-11]", () => {
  it("SST, gerente, supervisor, ADM loja e RH recebem 403, e nada é criado nem arquivado", async () => {
    for (const quem of QUEM_NAO_CUIDA) {
      const criar = await request(app)
        .post("/api/establishments")
        .set(as(token[quem]!))
        .send({ name: `Nova C611 ${SUFIXO} ${quem}` });
      expect(criar.status, `criar: ${quem}`).toBe(403);
      expect((await request(app).get(`/api/establishments/${filial}/pode-arquivar`).set(as(token[quem]!))).status, `conferir: ${quem}`).toBe(403);
      expect((await request(app).delete(`/api/establishments/${filial}`).set(as(token[quem]!))).status, `arquivar: ${quem}`).toBe(403);
    }
    expect(await prisma.establishment.count({ where: { name: { startsWith: `Nova C611 ${SUFIXO}` } } })).toBe(0);
    expect((await prisma.establishment.findUniqueOrThrow({ where: { id: filial } })).archivedAt).toBeNull();
  });

  it("o Master e o Dono criam e arquivam", async () => {
    for (const quem of ["master", "owner"]) {
      const criar = await request(app)
        .post("/api/establishments")
        .set(as(token[quem]!))
        .send({ name: `Nova C611 ${SUFIXO} ${quem}` });
      expect(criar.status, `criar: ${quem}`).toBe(201);
      const id = criar.body.establishment.id as string;
      expect((await request(app).get(`/api/establishments/${id}/pode-arquivar`).set(as(token[quem]!))).status).toBe(200);
      expect((await request(app).delete(`/api/establishments/${id}`).set(as(token[quem]!))).status, `arquivar: ${quem}`).toBe(200);
    }
  });
});

describe("os dados cadastrais da filial [C6-11]", () => {
  it("quem não cuida da filial recebe 403 em cada campo cadastral, e nada muda", async () => {
    const antes = await prisma.establishment.findUniqueOrThrow({ where: { id: filial } });
    for (const quem of QUEM_NAO_CUIDA) {
      for (const [campo, valor] of Object.entries(CADASTRAIS)) {
        const res = await request(app).patch(`/api/establishments/${filial}`).set(as(token[quem]!)).send({ [campo]: valor });
        expect(res.status, `${quem} em ${campo}`).toBe(403);
      }
      /* Nem com o nome junto: a edição inteira volta. */
      const junto = await request(app)
        .patch(`/api/establishments/${filial}`)
        .set(as(token[quem]!))
        .send({ name: `Outro C611 ${SUFIXO}`, address: null });
      expect(junto.status, `${quem} com o nome junto`).toBe(403);
    }
    expect(await prisma.establishment.findUniqueOrThrow({ where: { id: filial } })).toEqual(antes);
  });

  it("o nome segue com quem edita a Operação", async () => {
    const res = await request(app)
      .patch(`/api/establishments/${filial}`)
      .set(as(token.sst!))
      .send({ name: `Filial C611 ${SUFIXO} renomeada` });
    expect(res.status).toBe(200);
    expect(res.body.establishment.name).toBe(`Filial C611 ${SUFIXO} renomeada`);
  });

  it("o Master e o Dono mudam os dados cadastrais", async () => {
    for (const quem of ["master", "owner"]) {
      const res = await request(app)
        .patch(`/api/establishments/${filial}`)
        .set(as(token[quem]!))
        .send({ ...CADASTRAIS, address: `Rua do ${quem}, 2` });
      expect(res.status, `${quem}: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.establishment.address).toBe(`Rua do ${quem}, 2`);
    }
  });
});

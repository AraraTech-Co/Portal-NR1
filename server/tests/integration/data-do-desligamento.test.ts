import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { formatDay } from "../../../client/src/lib/labels";

/**
 * Em Pessoas e acessos, "Desligado desde" é o dia do desligamento.
 *
 * A tela tinha uma forma própria de escrever a data, que lia o dia gravado
 * sem hora como um instante e o passava para o fuso de Brasília — caía no
 * dia anterior. E o servidor mandava o instante em que o RH registrou, não a
 * data do desligamento. [B3-1-E]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

let app: Express;
let rh: { token: string };
let master: { token: string };
let userId = "";

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string };
}

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
  master = await entrar("teste.master");

  const login = `desligado.${SUFIXO}`;
  const user = await prisma.user.create({
    data: {
      login,
      email: `${login}@teste.local`,
      name: `Desligado ${SUFIXO}`,
      passwordHash: await bcrypt.hash(SENHA, 4),
    },
  });
  userId = user.id;
  await prisma.membership.create({
    data: { userId, organizationId: ORG_ID, role: Role.COLABORADOR },
  });
  const ficha = await prisma.employeeProfile.create({
    data: {
      organizationId: ORG_ID,
      userId,
      admittedAt: new Date("2025-03-10T00:00:00Z"),
    },
  });

  const res = await request(app)
    .post(`/api/employee-profiles/${ficha.id}/desligamento`)
    .set(as(rh.token))
    .send({ dismissed_at: "2026-10-16", reason: "Pedido de demissão" });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
});

afterAll(async () => {
  if (userId) await prisma.user.delete({ where: { id: userId } }).catch(() => {});
});

describe("Desligado desde [B3-1-E]", () => {
  it("o servidor manda a data do desligamento, não o instante do registro", async () => {
    const res = await request(app).get("/api/pessoas-acessos").set(as(master.token));
    expect(res.status).toBe(200);
    const p = (res.body.people as Array<{ id: string; status: string; status_since: string }>).find(
      (x) => x.id === userId,
    );
    expect(p?.status).toBe("dismissed");
    expect(p?.status_since).toBe("2026-10-16T00:00:00.000Z");
  });

  it("e a tela escreve o mesmo dia da ficha", () => {
    expect(formatDay("2026-10-16T00:00:00.000Z")).toBe("16/10/2026");
    /* O que a forma antiga escrevia, para provar que o caso distingue as duas. */
    expect(
      new Date("2026-10-16T00:00:00.000Z").toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
      }),
    ).toBe("15/10/2026");
  });

  it("Pessoas e acessos usa a forma comum do portal", () => {
    const tela = semComentarios(readFileSync(join(CLIENTE, "pages", "PessoasEAcessos.tsx"), "utf8"));
    expect(tela).not.toMatch(/toLocaleDateString/);
    expect(tela).not.toMatch(/function formatDay/);
    expect(tela).toMatch(/import \{[^}]*\bformatDay\b[^}]*\} from "@\/lib\/labels"/);
  });

  it("suspensão continua mostrando o dia em que foi suspensa", async () => {
    const outro = await prisma.user.create({
      data: {
        login: `suspensa.${SUFIXO}`,
        email: `suspensa.${SUFIXO}@teste.local`,
        name: `Suspensa ${SUFIXO}`,
        passwordHash: await bcrypt.hash(SENHA, 4),
      },
    });
    try {
      const quando = new Date("2026-10-20T15:30:00.000Z");
      await prisma.membership.create({
        data: {
          userId: outro.id,
          organizationId: ORG_ID,
          role: Role.COLABORADOR,
          suspendedAt: quando,
          suspensionReason: "MANUAL",
          /* Com prazo também: "desde" é a suspensão, não o prazo. */
          accessExpiresAt: new Date("2026-12-31T02:59:59.999Z"),
        },
      });
      const res = await request(app).get("/api/pessoas-acessos").set(as(master.token));
      const p = (res.body.people as Array<{ id: string; status: string; status_since: string }>).find(
        (x) => x.id === outro.id,
      );
      expect(p?.status).toBe("suspended");
      expect(p?.status_since).toBe(quando.toISOString());
    } finally {
      await prisma.user.delete({ where: { id: outro.id } }).catch(() => {});
    }
  });
});

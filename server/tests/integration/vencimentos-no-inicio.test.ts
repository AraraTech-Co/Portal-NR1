import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { diasAte, prazoTexto } from "../../src/controller/HomeController";

/**
 * O que vence, no Início.
 *
 * Quando nada vencia, o bloco sumia; o simulado a vencer só aparecia em
 * Emergências; e o cartão do acesso a vencer não trazia a data e contava 15
 * dias onde o calendário dá 14. [S6-B]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const EST_ID = "aaaaaaaa-0001-4000-8000-000000000011";
const SUFIXO = Date.now().toString(36);
const PAGINAS = join(__dirname, "..", "..", "..", "client", "src", "pages");

type Card = { id: string; count: number; detail?: string | null };

let app: Express;
let sst: { token: string; user: { id: string } };
let colaborador: { token: string };
const procedimentos: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: "teste1234" });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body;
}

const inicio = async (token: string) => {
  const res = await request(app).get("/api/inicio").set({ Authorization: `Bearer ${token}` });
  expect(res.status).toBe(200);
  return res.body as { expiring: Card[]; expiring_checked: string[] };
};

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  colaborador = await entrar("teste.colaborador");
});

afterAll(async () => {
  await prisma.emergencyProcedure.deleteMany({ where: { id: { in: procedimentos } } });
});

describe("os dias contam pelo calendário, e o prazo diz a data [S6-B]", () => {
  const agora = new Date("2026-10-27T18:00:00.000Z"); // 27/10, 15h em Brasília

  it("acesso até o fim do dia 10/11: 14 dias, não 15", () => {
    const fimDoDia = new Date("2026-11-11T02:59:59.999Z"); // 10/11, 23h59 em Brasília
    expect(diasAte(fimDoDia, agora)).toBe(14);
    expect(prazoTexto(fimDoDia, agora)).toBe("o mais próximo vence em 10/11/2026, daqui a 14 dia(s)");
  });

  it("data sem hora de hoje vence hoje; a de uma semana atrás venceu há 7 dias", () => {
    expect(prazoTexto(new Date("2026-10-27T00:00:00.000Z"), agora)).toBe("o mais próximo vence hoje, 27/10/2026");
    expect(prazoTexto(new Date("2026-10-20T00:00:00.000Z"), agora)).toBe(
      "o mais antigo venceu em 20/10/2026, há 7 dia(s)",
    );
  });

  it("às 22h30 em Brasília, a manhã seguinte é amanhã, não hoje", () => {
    const noite = new Date("2026-10-28T01:30:00.000Z");
    expect(diasAte(new Date("2026-10-28T12:00:00.000Z"), noite)).toBe(1);
  });
});

describe("o simulado a vencer aparece no Início [S6-B]", () => {
  it("um procedimento com simulado vencendo na janela entra no cartão de simulados, com a data", async () => {
    const antes = (await inicio(sst.token)).expiring.find((c) => c.id === "simulados")?.count ?? 0;
    const p = await prisma.emergencyProcedure.create({
      data: {
        organizationId: ORG_ID,
        establishmentId: EST_ID,
        scenario: `Incêndio na usinagem ${SUFIXO}`,
        drillFrequencyMonths: 12,
        drills: {
          create: {
            performedAt: new Date(Date.now() - 340 * 86_400_000),
            recordedById: sst.user.id,
          },
        },
      },
    });
    procedimentos.push(p.id);

    const cartao = (await inicio(sst.token)).expiring.find((c) => c.id === "simulados");
    expect(cartao, "cartão de simulados").toBeDefined();
    expect(cartao!.count).toBeGreaterThanOrEqual(antes + 1);
    expect(cartao!.detail ?? "").toMatch(/\d{2}\/\d{2}\/\d{4}|nunca teve simulado/);
  });

  it("simulado feito há pouco não entra", async () => {
    const p = await prisma.emergencyProcedure.create({
      data: {
        organizationId: ORG_ID,
        establishmentId: EST_ID,
        scenario: `Vazamento ${SUFIXO}`,
        drillFrequencyMonths: 12,
        drills: { create: { performedAt: new Date(), recordedById: sst.user.id } },
      },
    });
    procedimentos.push(p.id);
    const antes = (await inicio(sst.token)).expiring.find((c) => c.id === "simulados")?.count ?? 0;
    await prisma.emergencyProcedure.update({ where: { id: p.id }, data: { archivedAt: new Date() } });
    const depois = (await inicio(sst.token)).expiring.find((c) => c.id === "simulados")?.count ?? 0;
    /* Arquivar o procedimento em dia não muda a contagem: ele não estava nela. */
    expect(depois).toBe(antes);
  });
});

describe("quando nada vence, a tela diz isso [S6-B]", () => {
  it("o Início diz o que conferiu, conforme o papel", async () => {
    const doSst = await inicio(sst.token);
    expect(doSst.expiring_checked).toEqual(expect.arrayContaining(["avaliações de risco", "simulados"]));
    const doColaborador = await inicio(colaborador.token);
    expect(doColaborador.expiring_checked).toEqual(expect.arrayContaining(["exames", "treinamentos"]));
    expect(doColaborador.expiring_checked).not.toContain("acessos de consulta");
  });

  it("a tela mostra o bloco de nada vence, com o que foi conferido", () => {
    const tela = readFileSync(join(PAGINAS, "HomePage.tsx"), "utf8").replace(/\s+/g, " ");
    expect(tela).toContain("{data && data.expiring.length === 0 && data.expiring_checked.length > 0 && (");
    expect(tela).toContain("<h2>Nada vence nos próximos {data.window_days} dias</h2>");
    expect(tela).toContain('Conferido: {data.expiring_checked.join(", ")}.');
  });
});

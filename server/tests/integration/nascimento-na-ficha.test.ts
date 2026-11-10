import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Data de nascimento na ficha. [C1-7]
 *
 * Entra pela planilha (coluna `nascimento`) e pela ficha, só pelo RH. Em
 * cadastro existente, a planilha completa o que está em branco e nunca
 * sobrescreve [CB-2]. Quem não vê o CPF não vê o nascimento, nem no
 * histórico da ficha [CB-54].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string };
let supervisor: { token: string };
let fiscal: { token: string };

const entrar = async (login: string) => {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string };
};

/** A filial do seed: a organização de teste tem mais de uma, e a linha sem função diz qual; com função, vale a dela. [C3-3] */
const FILIAL_DO_SEED = "aaaaaaaa-0001-4000-8000-000000000011";
const importar = (people: Record<string, unknown>[]) =>
  request(app)
    .post("/api/pessoas-acessos/importar")
    .set(as(rh.token))
    .send({ people: people.map((p) => (p.job_role_id ? p : { establishment_id: FILIAL_DO_SEED, ...p })) });

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
  supervisor = await entrar("teste.supervisor");
  fiscal = await entrar("teste.fiscal");
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { name: { contains: `Nascida ${SUFIXO}` } } });
});

async function perfil(matricula: string) {
  return prisma.employeeProfile.findFirstOrThrow({
    where: { organizationId: ORG_ID, registration: matricula },
    select: { id: true, birthDate: true },
  });
}

describe("nascimento pela planilha [C1-7]", () => {
  it("entra na criação; data inválida ou futura fica de fora com o motivo", async () => {
    const res = await importar([
      { name: `Ana Nascida ${SUFIXO}`, registration: `N1-${SUFIXO}`, birth_date: "1990-03-15" },
      { name: `Bia Nascida ${SUFIXO}`, registration: `N2-${SUFIXO}`, birth_date: "2990-01-01" },
      { name: `Cid Nascida ${SUFIXO}`, registration: `N3-${SUFIXO}`, birth_date: "1990-02-31" },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const [ana, bia, cid] = res.body.results;
    expect(ana.status).toBe("created");
    expect(bia.status).toBe("error");
    expect(bia.message).toMatch(/passado/);
    expect(cid.status).toBe("error");
    expect((await perfil(`N1-${SUFIXO}`)).birthDate?.toISOString()).toBe("1990-03-15T00:00:00.000Z");
  });

  it("em cadastro existente, completa o branco e nunca sobrescreve", async () => {
    const criada = await importar([{ name: `Dan Nascida ${SUFIXO}`, registration: `N4-${SUFIXO}` }]);
    expect(criada.body.results[0].status).toBe("created");
    expect((await perfil(`N4-${SUFIXO}`)).birthDate).toBeNull();

    const completa = await importar([
      { name: `Dan Nascida ${SUFIXO}`, registration: `N4-${SUFIXO}`, birth_date: "1985-07-01" },
    ]);
    expect(completa.body.results[0].status).toBe("completed");
    expect(completa.body.results[0].filled).toContain("nascimento");

    const outra = await importar([
      { name: `Dan Nascida ${SUFIXO}`, registration: `N4-${SUFIXO}`, birth_date: "1970-01-01" },
    ]);
    expect(outra.body.results[0].status).toBe("skipped");
    expect((await perfil(`N4-${SUFIXO}`)).birthDate?.toISOString()).toBe("1985-07-01T00:00:00.000Z");
  });
});

describe("nascimento na ficha [C1-7]", () => {
  it("só o RH altera; quem não vê o CPF não vê o nascimento, nem no histórico", async () => {
    await importar([{ name: `Eva Nascida ${SUFIXO}`, registration: `N5-${SUFIXO}` }]);
    const { id } = await perfil(`N5-${SUFIXO}`);

    const semRh = await request(app)
      .patch(`/api/employee-profiles/${id}`)
      .set(as(supervisor.token))
      .send({ birth_date: "1991-01-01" });
    expect([403, 404]).toContain(semRh.status);

    const doRh = await request(app)
      .patch(`/api/employee-profiles/${id}`)
      .set(as(rh.token))
      .send({ birth_date: "20/05/1992" });
    expect(doRh.status, JSON.stringify(doRh.body)).toBe(200);
    expect((await perfil(`N5-${SUFIXO}`)).birthDate?.toISOString()).toBe("1992-05-20T00:00:00.000Z");

    const futura = await request(app)
      .patch(`/api/employee-profiles/${id}`)
      .set(as(rh.token))
      .send({ birth_date: "2999-01-01" });
    expect(futura.status).toBe(400);

    // O fiscal lê a ficha e o histórico, sem o nascimento (nem o de antes, nem o de agora).
    const doFiscal = await request(app).get(`/api/employee-profiles/${id}`).set(as(fiscal.token));
    expect(doFiscal.status, JSON.stringify(doFiscal.body)).toBe(200);
    expect(JSON.stringify(doFiscal.body)).not.toContain("1992-05-20");
    const ficha = await request(app).get(`/api/employee-profiles/${id}/ficha`).set(as(fiscal.token));
    expect(ficha.status, JSON.stringify(ficha.body)).toBe(200);
    expect(JSON.stringify(ficha.body)).not.toContain("1992-05-20");
    // Canário: o histórico do RH mostra a mudança, então o fiscal só não a vê por regra.
    const fichaDoRh = await request(app).get(`/api/employee-profiles/${id}/ficha`).set(as(rh.token));
    expect(JSON.stringify(fichaDoRh.body)).toContain("1992-05-20");
    const doRhLe = await request(app).get(`/api/employee-profiles/${id}`).set(as(rh.token));
    expect(JSON.stringify(doRhLe.body)).toContain("1992-05-20");
  });
});

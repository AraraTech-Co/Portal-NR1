import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import { AccountRole, ContractorRelation, Role } from "@prisma/client";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * A ficha deixa de ser só leitura [S1-A] [CB-1] [CB-3] e a empresa contratada
 * passa a existir, para que "terceirizado" não fique sem empresa [S1-R] [CB-8].
 *
 * Usa a organização do `scripts/seed-teste-org.ts`, com gente criada aqui.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const ACCOUNT_ID = "aaaaaaaa-0001-4000-8000-000000000002";
const JOB_ID = "aaaaaaaa-0001-4000-8000-000000000013";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string; user: { id: string } };
let sst: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };
const criados: string[] = [];
const contratadas: string[] = [];

const entrar = (login: string) =>
  request(app).post("/api/auth").send({ login, password: SENHA });

/** Pessoa com ficha crua: sem matrícula, sem CPF e sem função. */
async function pessoaSemFicha(nome: string) {
  const login = `ficha.${nome}.${SUFIXO}`;
  const user = await prisma.user.create({
    data: {
      login,
      email: `${login}@teste.local`,
      name: `Pessoa ${nome} ${SUFIXO}`,
      passwordHash: await bcrypt.hash(SENHA, 10),
    },
  });
  criados.push(user.id);
  await prisma.accountMembership.create({
    data: { accountId: ACCOUNT_ID, userId: user.id, role: AccountRole.USER },
  });
  await prisma.membership.create({
    data: { userId: user.id, organizationId: ORG_ID, role: Role.COLABORADOR },
  });
  const profile = await prisma.employeeProfile.create({
    data: { organizationId: ORG_ID, userId: user.id },
  });
  return { userId: user.id, profileId: profile.id };
}

beforeAll(async () => {
  app = createApp();
  rh = (await entrar("teste.rh")).body;
  sst = (await entrar("teste.sst")).body;
  colaborador = (await entrar("teste.colaborador")).body;
});

/*
  CPF válido próprio desta rodada. O 529.982.247-25 é o CPF que o seed dá ao
  teste.colaborador: com o seed recém-rodado, a ficha recusava como
  duplicado. [OB-11]
*/
const CPF_DO_TESTE = (() => {
  const base = (Date.now() % 1_000_000_000).toString().padStart(9, "1").split("").map(Number);
  const digito = (n: number[]) => {
    const soma = n.reduce((t, d, i) => t + d * (n.length + 1 - i), 0);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = digito(base);
  const d2 = digito([...base, d1]);
  const digitos = [...base, d1, d2].join("");
  return {
    digitos,
    formatado: `${digitos.slice(0, 3)}.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-${digitos.slice(9)}`,
  };
})();

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: criados } } });
  await prisma.contractor.deleteMany({ where: { id: { in: contratadas } } });
});

describe("a ficha deixa de ser só leitura [S1-A] [CB-1] [CB-3]", () => {
  it("o RH preenche matrícula, CPF, função, admissão e telefone", async () => {
    const p = await pessoaSemFicha("ana");

    const antes = await request(app)
      .get(`/api/employee-profiles/${p.profileId}/ficha`)
      .set(as(rh.token));
    expect(antes.body.profile.registration).toBeNull();
    expect(antes.body.profile.jobRole).toBeNull();

    const res = await request(app)
      .patch(`/api/employee-profiles/${p.profileId}`)
      .set(as(rh.token))
      .send({
        registration: `FIC-${SUFIXO}`.slice(0, 20),
        tax_id: CPF_DO_TESTE.formatado,
        phone: "19999998888",
        job_role_id: JOB_ID,
        admitted_at: "2025-08-04",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const depois = await request(app)
      .get(`/api/employee-profiles/${p.profileId}/ficha`)
      .set(as(rh.token));
    expect(depois.body.profile.registration).toBe(`FIC-${SUFIXO}`.slice(0, 20));
    // O CPF é guardado só com os dígitos.
    expect(depois.body.profile.taxId).toBe(CPF_DO_TESTE.digitos);
    expect(depois.body.profile.phone).toBe("19999998888");
    expect(depois.body.profile.jobRole.id).toBe(JOB_ID);
    expect(String(depois.body.profile.admittedAt).slice(0, 10)).toBe("2025-08-04");

    // Com função, a ficha passa a mostrar as exigências dela. [CB-3]
    expect((depois.body.requirements as unknown[]).length).toBeGreaterThan(0);
  });

  it("CPF inválido é recusado e a ficha não muda", async () => {
    const p = await pessoaSemFicha("bruno");
    const res = await request(app)
      .patch(`/api/employee-profiles/${p.profileId}`)
      .set(as(rh.token))
      .send({ tax_id: "11111111111" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/CPF/i);
  });

  it("função que não existe na empresa é recusada", async () => {
    const p = await pessoaSemFicha("carla");
    const res = await request(app)
      .patch(`/api/employee-profiles/${p.profileId}`)
      .set(as(rh.token))
      .send({ job_role_id: "00000000-0000-4000-8000-00000000dead" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/[Ff]unção/);
  });

  it("o colaborador muda o próprio telefone e nada mais", async () => {
    const minha = await prisma.employeeProfile.findFirstOrThrow({
      where: { organizationId: ORG_ID, userId: colaborador.user.id },
      select: { id: true, registration: true },
    });
    const res = await request(app)
      .patch(`/api/employee-profiles/${minha.id}`)
      .set(as(colaborador.token))
      .send({ phone: "19911112222", registration: "EU-MESMO" });
    expect(res.status).toBe(200);

    const conferido = await prisma.employeeProfile.findFirstOrThrow({
      where: { id: minha.id },
      select: { phone: true, registration: true },
    });
    expect(conferido.phone).toBe("19911112222");
    expect(conferido.registration, "matrícula não é dele").toBe(minha.registration);
  });
});

describe("a empresa contratada existe [S1-R] [CB-8]", () => {
  it("quem cuida de Terceiros cadastra, edita e vê quantas pessoas são dela", async () => {
    const criada = await request(app)
      .post("/api/contractors")
      .set(as(sst.token))
      .send({
        name: `Limpeza Industrial ${SUFIXO}`,
        relation: ContractorRelation.WE_HIRE,
        services_scope: "Limpeza de piso fabril",
      });
    expect(criada.status).toBe(201);
    const id = criada.body.contractor.id as string;
    contratadas.push(id);

    const editada = await request(app)
      .patch(`/api/contractors/${id}`)
      .set(as(sst.token))
      .send({ interaction_measures: "Isolamento da área durante a limpeza." });
    expect(editada.status).toBe(200);

    // Uma pessoa terceirizada ligada a ela.
    const p = await pessoaSemFicha("davi");
    const vinculo = await request(app)
      .patch(`/api/employee-profiles/${p.profileId}`)
      .set(as(rh.token))
      .send({ bond: "CONTRACTOR", contractor_id: id });
    expect(vinculo.status).toBe(200);

    const lista = await request(app).get("/api/contractors").set(as(sst.token));
    const nossa = (lista.body.contractors as { id: string; workers: number }[]).find(
      (c) => c.id === id,
    );
    expect(nossa?.workers, "a tela diz quantas pessoas são da contratada").toBe(1);

    // E a ficha da pessoa diz de que empresa ela vem.
    const ficha = await request(app)
      .get(`/api/employee-profiles/${p.profileId}/ficha`)
      .set(as(rh.token));
    expect(ficha.body.profile.contractor.name).toContain("Limpeza Industrial");
  });

  it("empresa contratada de outra organização não serve", async () => {
    const deOutra = await prisma.contractor.create({
      data: {
        organizationId: "00000000-0000-4000-8000-000000000001",
        name: `De fora ${SUFIXO}`,
        relation: ContractorRelation.WE_HIRE,
      },
    });
    contratadas.push(deOutra.id);

    const p = await pessoaSemFicha("eva");
    const res = await request(app)
      .patch(`/api/employee-profiles/${p.profileId}`)
      .set(as(rh.token))
      .send({ bond: "CONTRACTOR", contractor_id: deOutra.id });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/[Ee]mpresa contratada/);
  });
});

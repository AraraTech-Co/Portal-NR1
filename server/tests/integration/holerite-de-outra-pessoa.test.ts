import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { holerite, holeriteSemPessoa } from "../helpers/pdf";

/**
 * O holerite de outra pessoa não se publica, com ou sem justificativa.
 *
 * A exceção com justificativa nasceu para holerite CERTO em layout que o
 * portal não lê [CB-28]. Ela passou a valer para qualquer recusa da
 * conferência: a tela recusava dizendo "a matrícula do documento é 000021 e a
 * da pessoa escolhida é 19", e logo abaixo oferecia publicar assim mesmo. Uma
 * frase qualquer entregava o holerite de um trabalhador a outro. [B3-3-A] [S5-G]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
/* Competência própria deste arquivo, para não brigar com os outros testes. */
const MES = 9;
const ANO = 2033;

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string; name: string } };
let matricula = "";

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string; name: string } };
}

const publicar = (conteudo: string, extra: Record<string, unknown> = {}) =>
  request(app)
    .post("/api/payslips")
    .set(as(rh.token))
    .send({
      user_id: colaborador.user.id,
      reference_month: MES,
      reference_year: ANO,
      file_name: `holerite-${SUFIXO}.pdf`,
      mime_type: "application/pdf",
      content_base64: conteudo,
      ...extra,
    });

/** Nenhum holerite desta competência ficou gravado. */
async function nadaGravado(contexto: string) {
  const quantos = await prisma.payslip.count({
    where: { organizationId: ORG_ID, referenceYear: ANO, referenceMonth: MES },
  });
  expect(quantos, contexto).toBe(0);
}

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
  colaborador = await entrar("teste.colaborador");
  const ficha = await prisma.employeeProfile.findFirstOrThrow({
    where: { organizationId: ORG_ID, userId: colaborador.user.id },
    select: { registration: true },
  });
  matricula = ficha.registration!;
  expect(matricula, "o colaborador do seed tem matrícula").toBeTruthy();
  await prisma.payslip.deleteMany({
    where: { organizationId: ORG_ID, referenceYear: ANO, referenceMonth: MES },
  });
});

afterAll(async () => {
  await prisma.payslip.deleteMany({
    where: { organizationId: ORG_ID, referenceYear: ANO, referenceMonth: MES },
  });
});

describe("documento de outra pessoa não tem exceção [B3-3-A]", () => {
  it("a justificativa não publica o holerite de outra pessoa", async () => {
    const res = await publicar(
      holerite("000021", "Paulo Ribeiro", `SETEMBRO/${ANO}`),
      { override_reason: "Pode publicar assim mesmo, confio no escritório." },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe("PAYSLIP_DOCUMENT_MISMATCH");
    expect(res.body.can_override, "a tela não deve nem oferecer a caixa").toBe(false);
    expect(
      (res.body.reasons as string[]).join(" "),
      "diz o que não bateu, como antes",
    ).toContain("matrícula do documento");
    await nadaGravado("o holerite de outra pessoa não pode ficar gravado");
  });

  it("sem justificativa, a recusa é a mesma e diz que não há saída", async () => {
    const res = await publicar(holerite("000021", "Paulo Ribeiro", `SETEMBRO/${ANO}`));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("PAYSLIP_DOCUMENT_MISMATCH");
    await nadaGravado("nada gravado");
  });

  it("competência que o documento afirma e não é a escolhida também não tem exceção", async () => {
    const res = await publicar(
      holerite(matricula, colaborador.user.name, `AGOSTO/${ANO}`),
      { override_reason: "o mês certo é esse mesmo" },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(422);
    expect(res.body.code).toBe("PAYSLIP_DOCUMENT_MISMATCH");
    expect((res.body.reasons as string[]).join(" ")).toContain("competência");
    await nadaGravado("nada gravado");
  });
});

describe("a exceção continua valendo para o que ela foi feita [CB-28]", () => {
  it("layout que o portal não lê publica com justificativa, e fica registrado", async () => {
    const res = await publicar(holeriteSemPessoa(`SETEMBRO/${ANO}`), {
      override_reason: "Contabilidade nova, layout diferente.",
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.overridden_reasons.length).toBeGreaterThan(0);

    const guardado = await prisma.payslip.findFirstOrThrow({
      where: { id: res.body.payslip.id },
      select: { overrideReason: true, overriddenById: true },
    });
    expect(guardado.overrideReason).toMatch(/layout diferente/);
    expect(guardado.overriddenById).toBe(rh.user.id);

    await prisma.payslip.deleteMany({ where: { id: res.body.payslip.id } });
  });

  it("sem justificativa, o layout que não se lê é recusado dizendo que cabe exceção", async () => {
    const res = await publicar(holeriteSemPessoa(`SETEMBRO/${ANO}`));
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("PAYSLIP_CHECK_FAILED");
    expect(res.body.can_override, "aqui a caixa aparece").toBe(true);
    await nadaGravado("nada gravado");
  });

  it("o holerite certo publica sem justificativa nenhuma", async () => {
    const res = await publicar(holerite(matricula, colaborador.user.name, `SETEMBRO/${ANO}`));
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.overridden_reasons).toEqual([]);
    await prisma.payslip.deleteMany({ where: { id: res.body.payslip.id } });
  });
});

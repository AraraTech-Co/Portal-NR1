import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { holerite } from "../helpers/pdf";

/**
 * O holerite para de apagar a própria história.
 *
 * Corrigir o mês substituía o arquivo e apagava a versão que o trabalhador
 * tinha aberto [S5-F]; "Visto" era marcado ao abrir a tela, não o
 * documento [S4-E]; a recusa não dizia o que não conferia [B2-3-B]; e um
 * holerite correto de outra contabilidade travava o RH para sempre [CB-28].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
/*
  Competência própria deste arquivo, para não brigar com outros testes. Mês
  sem acento: o texto extraído do PDF de teste não carrega o cedilha, e a
  conferência compara o nome do mês.
*/
const MES = 9;
const ANO = 2031;

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string; name: string } };
let matricula: string;

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
});

afterAll(async () => {
  await prisma.payslip.deleteMany({
    where: { organizationId: ORG_ID, referenceYear: ANO, referenceMonth: MES },
  });
});

const certo = () => holerite(matricula, colaborador.user.name, `SETEMBRO/${ANO}`);

describe("a versão que o trabalhador viu não some [S5-F]", () => {
  it("corrigir guarda a anterior, com a data em que foi vista", async () => {
    const primeira = await publicar(certo());
    expect(primeira.status, JSON.stringify(primeira.body)).toBe(201);
    const id = primeira.body.payslip.id as string;

    // O trabalhador abre o arquivo: é isso que marca "Visto". [S4-E]
    const baixou = await request(app)
      .get(`/api/payslips/${id}/file`)
      .set(as(colaborador.token));
    expect(baixou.status).toBe(200);

    const vista = await prisma.payslip.findFirstOrThrow({
      where: { id },
      select: { viewedAt: true, storagePath: true },
    });
    expect(vista.viewedAt).not.toBeNull();
    const arquivoAntigo = vista.storagePath;

    // O RH corrige o mesmo mês.
    const segunda = await publicar(certo());
    expect(segunda.status).toBe(200);
    expect(segunda.body.replaced).toBe(true);

    const versoes = await prisma.payslipVersion.findMany({
      where: { payslipId: id },
      orderBy: { replacedAt: "desc" },
    });
    expect(versoes.length, "a anterior virou histórico").toBe(1);
    expect(versoes[0]!.storagePath, "o arquivo de antes continua").toBe(
      arquivoAntigo,
    );
    expect(versoes[0]!.viewedAt, "e a data em que ele a viu").not.toBeNull();
    expect(versoes[0]!.replacedById).toBe(rh.user.id);

    // O vigente volta a ser "não visto": é outro documento.
    const agora = await prisma.payslip.findFirstOrThrow({
      where: { id },
      select: { viewedAt: true },
    });
    expect(agora.viewedAt).toBeNull();
  });

  it("o titular baixa a versão anterior; outra pessoa não", async () => {
    const payslip = await prisma.payslip.findFirstOrThrow({
      where: { organizationId: ORG_ID, referenceYear: ANO, referenceMonth: MES },
      include: { versions: true },
    });
    const versao = payslip.versions[0]!;

    const dono = await request(app)
      .get(`/api/payslips/${payslip.id}/versoes/${versao.id}/file`)
      .set(as(colaborador.token));
    expect(dono.status).toBe(200);

    const outro = await request(app)
      .get(`/api/payslips/${payslip.id}/versoes/${versao.id}/file`)
      .set(as(rh.token));
    expect(outro.status, "nem o RH abre o holerite de alguém").toBe(403);
  });

  it("o detalhe lista as versões anteriores", async () => {
    const payslip = await prisma.payslip.findFirstOrThrow({
      where: { organizationId: ORG_ID, referenceYear: ANO, referenceMonth: MES },
      select: { id: true },
    });
    const res = await request(app)
      .get(`/api/payslips/${payslip.id}`)
      .set(as(colaborador.token));
    expect(res.status).toBe(200);
    expect((res.body.payslip.versions as unknown[]).length).toBeGreaterThan(0);
  });
});

describe("abrir a tela não é ver o documento [S4-E]", () => {
  it("o detalhe não marca Visto; o arquivo marca", async () => {
    await prisma.payslip.deleteMany({
      where: { organizationId: ORG_ID, referenceYear: ANO, referenceMonth: MES },
    });
    const criado = await publicar(certo());
    expect(criado.status).toBe(201);
    const id = criado.body.payslip.id as string;

    const detalhe = await request(app)
      .get(`/api/payslips/${id}`)
      .set(as(colaborador.token));
    expect(detalhe.status).toBe(200);

    const depoisDoDetalhe = await prisma.payslip.findFirstOrThrow({
      where: { id },
      select: { viewedAt: true },
    });
    expect(depoisDoDetalhe.viewedAt, "entrar na tela não é ver").toBeNull();

    await request(app).get(`/api/payslips/${id}/file`).set(as(colaborador.token));

    const depoisDoArquivo = await prisma.payslip.findFirstOrThrow({
      where: { id },
      select: { viewedAt: true },
    });
    expect(depoisDoArquivo.viewedAt).not.toBeNull();
  });
});

describe("a recusa diz o que não confere [B2-3-B] [CB-28]", () => {
  it("documento de outra pessoa é recusado, com o motivo", async () => {
    await prisma.payslip.deleteMany({
      where: { organizationId: ORG_ID, referenceYear: ANO, referenceMonth: MES },
    });

    const res = await publicar(
      holerite("MAT-DE-OUTRO", "Pessoa Que Nao E", `SETEMBRO/${ANO}`),
    );
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("PAYSLIP_CHECK_FAILED");
    expect(Array.isArray(res.body.reasons)).toBe(true);
    expect(res.body.reasons.length, "a tela tem o que mostrar").toBeGreaterThan(0);
  });

  it("com motivo, publica fora do padrão e registra quem foi", async () => {
    await prisma.payslip.deleteMany({
      where: { organizationId: ORG_ID, referenceYear: ANO, referenceMonth: MES },
    });

    const res = await publicar(
      holerite("MAT-DE-OUTRO", "Pessoa Que Nao E", `SETEMBRO/${ANO}`),
      { override_reason: "Contabilidade nova, layout diferente." },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.overridden_reasons.length).toBeGreaterThan(0);

    const guardado = await prisma.payslip.findFirstOrThrow({
      where: { id: res.body.payslip.id },
      select: { overrideReason: true, overriddenById: true },
    });
    expect(guardado.overrideReason).toMatch(/Contabilidade nova/);
    expect(guardado.overriddenById).toBe(rh.user.id);
  });

  it("holerite que confere não guarda motivo nenhum", async () => {
    await prisma.payslip.deleteMany({
      where: { organizationId: ORG_ID, referenceYear: ANO, referenceMonth: MES },
    });

    const res = await publicar(certo(), { override_reason: "não precisava" });
    expect(res.status).toBe(201);

    const guardado = await prisma.payslip.findFirstOrThrow({
      where: { id: res.body.payslip.id },
      select: { overrideReason: true, overriddenById: true },
    });
    expect(guardado.overrideReason, "não inventa exceção").toBeNull();
    expect(guardado.overriddenById).toBeNull();
  });
});

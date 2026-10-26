import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O cartão de treinamento do Painel passa a saber do que fala.
 *
 * Sem exigência por função, o cartão aparecia "Em ordem", em verde, e dizia
 * na mesma linha que sem exigência o portal não sabe quem precisa de qual
 * treinamento [CB-71]. Com exigência, contava só certificado enviado e aceito
 * em Saúde, e quem concluiu o curso no próprio portal aparecia "sem
 * certificado válido" [CB-70]. Os dois são o S7-G.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let sst = "";
let unidade = "";
let setor = "";
let funcao = "";
let curso = "";
let pessoa = "";
let outraPessoa = "";
const criados = { exigencias: [] as string[] };
/*
  As pessoas são emprestadas do seed: a função delas é devolvida como estava
  no fim. Zerar em vez de devolver quebrou a suíte inteira uma vez — o
  colaborador do seed ficou sem função e outros testes dependem dela.
*/
const funcaoOriginal = new Map<string, string | null>();

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

/** O cartão de treinamento do Painel, recortado na unidade do teste. */
async function cartao() {
  const res = await request(app)
    .get(`/api/fiscalizacao?establishment_id=${unidade}`)
    .set(as(sst));
  expect(res.status, JSON.stringify(res.body).slice(0, 200)).toBe(200);
  const c = (res.body.checks as {
    id: string;
    status: string;
    items: { ok: boolean; label: string; detail?: string }[];
  }[]).find((x) => x.id === "treinamentos");
  expect(c, "o cartão de treinamento existe").toBeTruthy();
  return c!;
}

beforeAll(async () => {
  app = createApp();
  const tecnico = await entrar("teste.sst");
  sst = tecnico.token;

  /*
    Unidade, setor e função só deste teste: o cartão olha a organização
    inteira, e exigência de outro teste mudaria o resultado.
  */
  const est = await prisma.establishment.create({
    data: { organizationId: ORG_ID, name: `Unidade do cartão ${SUFIXO}` },
    select: { id: true },
  });
  unidade = est.id;
  const sec = await prisma.sector.create({
    data: { organizationId: ORG_ID, establishmentId: unidade, name: `Setor ${SUFIXO}` },
    select: { id: true },
  });
  setor = sec.id;
  const fn = await prisma.jobRole.create({
    data: { organizationId: ORG_ID, sectorId: setor, name: `Torneiro ${SUFIXO}` },
    select: { id: true },
  });
  funcao = fn.id;

  const t = await prisma.training.create({
    data: {
      organizationId: ORG_ID,
      title: `NR-12 do cartão ${SUFIXO}`,
      kind: "ONLINE",
      passingScore: 70,
      createdById: tecnico.user.id,
    },
    select: { id: true },
  });
  curso = t.id;

  // Duas pessoas na função, as duas ativas.
  const membros = await prisma.membership.findMany({
    where: { organizationId: ORG_ID, suspendedAt: null, user: { active: true } },
    select: { userId: true },
    take: 2,
  });
  expect(membros.length, "duas pessoas no banco local").toBe(2);
  pessoa = membros[0]!.userId;
  outraPessoa = membros[1]!.userId;
  for (const userId of [pessoa, outraPessoa]) {
    const antes = await prisma.employeeProfile.findFirst({
      where: { organizationId: ORG_ID, userId },
      select: { jobRoleId: true },
    });
    funcaoOriginal.set(userId, antes?.jobRoleId ?? null);
    await prisma.employeeProfile.updateMany({
      where: { organizationId: ORG_ID, userId },
      data: { jobRoleId: funcao },
    });
  }
});

afterAll(async () => {
  await prisma.trainingEnrollment.deleteMany({ where: { trainingId: curso } });
  await prisma.jobRoleRequirement.deleteMany({ where: { jobRoleId: funcao } });
  for (const [userId, original] of funcaoOriginal) {
    await prisma.employeeProfile.updateMany({
      where: { organizationId: ORG_ID, userId },
      data: { jobRoleId: original },
    });
  }
  await prisma.training.deleteMany({ where: { id: curso } });
  await prisma.jobRole.deleteMany({ where: { id: funcao } });
  await prisma.sector.deleteMany({ where: { id: setor } });
  await prisma.establishment.deleteMany({ where: { id: unidade } });
});

describe("sem exigência cadastrada, o cartão não diz que está em ordem [CB-71]", () => {
  it("é pendência, e o texto diz o que falta", async () => {
    const c = await cartao();
    /*
      É o defeito do achado: o cartão ficava verde dizendo, na mesma linha,
      que não sabia quem precisa de qual treinamento.
    */
    expect(c.status, "verde sem base era o defeito").not.toBe("ok");
    const semExigencia = c.items.find((i) =>
      i.label.includes("Nenhuma exigência de treinamento por função"),
    );
    expect(semExigencia, "o item aparece").toBeTruthy();
    expect(semExigencia!.ok).toBe(false);
    expect(semExigencia!.detail).toContain("não sabe quem precisa");
  });
});

describe("o curso concluído no portal conta pela exigência [CB-70] [S7-G]", () => {
  it("sem o curso ligado, quem concluiu aqui dentro ainda aparece sem certificado", async () => {
    const semLigacao = await prisma.jobRoleRequirement.create({
      data: {
        organizationId: ORG_ID,
        jobRoleId: funcao,
        name: `NR-12 exigida ${SUFIXO}`,
        kind: "TRAINING",
      },
      select: { id: true },
    });
    criados.exigencias.push(semLigacao.id);

    await prisma.trainingEnrollment.create({
      data: {
        trainingId: curso,
        userId: pessoa,
        status: "COMPLETED",
        completedAt: new Date(),
        score: 90,
        certificateCode: `CERT-${SUFIXO}`,
      },
    });

    const c = await cartao();
    const itens = c.items.filter((i) => i.label.includes(`NR-12 exigida ${SUFIXO}`));
    expect(itens.length).toBeGreaterThan(0);
    expect(
      itens.every((i) => !i.ok),
      "sem ligação, o portal não tem como saber que o curso atende a exigência",
    ).toBe(true);

    await prisma.jobRoleRequirement.deleteMany({ where: { id: semLigacao.id } });
  });

  it("com o curso ligado, quem concluiu passa a contar como em dia", async () => {
    const comLigacao = await prisma.jobRoleRequirement.create({
      data: {
        organizationId: ORG_ID,
        jobRoleId: funcao,
        name: `NR-12 ligada ${SUFIXO}`,
        kind: "TRAINING",
        trainingId: curso,
      },
      select: { id: true },
    });
    criados.exigencias.push(comLigacao.id);

    const c = await cartao();
    const itens = c.items.filter((i) => i.label.includes(`NR-12 ligada ${SUFIXO}`));
    expect(itens.length).toBeGreaterThan(0);
    const emDia = itens.filter((i) => i.ok).length;
    expect(emDia, "quem concluiu o curso no portal conta").toBeGreaterThan(0);
    expect(
      itens.some((i) => (i.detail ?? "").includes("conta o curso")),
      "a tela diz de onde vem a prova",
    ).toBe(true);
    // A outra pessoa não fez o curso: continua pendente.
    expect(itens.some((i) => !i.ok), "quem não fez continua faltando").toBe(true);
  });

  it("nota abaixo da mínima não conta: o certificado está marcado para refazer [CB-31]", async () => {
    await prisma.trainingEnrollment.updateMany({
      where: { trainingId: curso, userId: pessoa },
      data: { score: 30 },
    });
    const c = await cartao();
    const itens = c.items.filter((i) => i.label.includes(`NR-12 ligada ${SUFIXO}`));
    expect(
      itens.every((i) => !i.ok),
      "curso concluído errando tudo não comprova capacitação",
    ).toBe(true);
    await prisma.trainingEnrollment.updateMany({
      where: { trainingId: curso, userId: pessoa },
      data: { score: 90 },
    });
  });

  it("certificado vencido do curso também não conta", async () => {
    await prisma.trainingEnrollment.updateMany({
      where: { trainingId: curso, userId: pessoa },
      data: { expiresAt: new Date("2020-01-01") },
    });
    const c = await cartao();
    const itens = c.items.filter((i) => i.label.includes(`NR-12 ligada ${SUFIXO}`));
    expect(itens.every((i) => !i.ok)).toBe(true);
    await prisma.trainingEnrollment.updateMany({
      where: { trainingId: curso, userId: pessoa },
      data: { expiresAt: null },
    });
  });
});

describe("a exigência guarda o curso vindo da tela [CB-70]", () => {
  it("a rota de criar aceita training_id e a listagem devolve o curso", async () => {
    const res = await request(app)
      .post("/api/job-role-requirements")
      .set(as(sst))
      .send({
        job_role_id: funcao,
        name: `Exigência pela tela ${SUFIXO}`,
        kind: "TRAINING",
        training_id: curso,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const lista = await request(app)
      .get(`/api/job-role-requirements?job_role_id=${funcao}`)
      .set(as(sst));
    expect(lista.status).toBe(200);
    const criada = (lista.body.requirements as {
      name: string;
      training: { id: string; title: string } | null;
    }[]).find((r) => r.name === `Exigência pela tela ${SUFIXO}`);
    expect(criada, "a exigência aparece").toBeTruthy();
    expect(criada!.training?.id, "com o curso ligado").toBe(curso);
  });
});

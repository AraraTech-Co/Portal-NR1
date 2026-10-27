import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import {
  formatarCnpj,
  itensDoCertificado,
  LOCAL_A_DISTANCIA,
  type DadosDoCertificado,
} from "../../../client/src/lib/certificado";

/**
 * O certificado traz a lista do NR-1 1.7.1.1.
 *
 * Decisão B3-3-G: nome e assinatura do trabalhador, conteúdo programático,
 * carga horária, data, local, nome e qualificação de quem ministrou e
 * assinatura do responsável técnico. Linhas para assinar no papel; no curso
 * online, quem ministrou e o local ("a distância"). O cadastro do
 * treinamento ganha o responsável técnico e a qualificação de quem
 * ministra. [B3-3-G]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");

type Sessao = { token: string; user: { id: string } };
let app: Express;
let rh: Sessao;
let colaborador: Sessao;
const treinamentos: string[] = [];

const as = (s: Sessao) => ({ Authorization: `Bearer ${s.token}` });

async function entrar(login: string): Promise<Sessao> {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as Sessao;
}

async function treinamento(titulo: string, extra: Record<string, unknown> = {}) {
  const res = await request(app)
    .post("/api/trainings")
    .set(as(rh))
    .send({
      title: `${titulo} ${SUFIXO}`,
      kind: "ONLINE",
      summary: "Proteções do torno CNC; parada de emergência; uso de óculos.",
      duration_minutes: 120,
      passing_score: 70,
      ...extra,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  treinamentos.push(res.body.training.id);
  return res.body.training.id as string;
}

/** O mesmo formato de `rotulos-de-auditoria.test.ts`: bloco, depois linha. */
function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const fonte = (...c: string[]) =>
  semComentarios(readFileSync(join(CLIENTE, ...c), "utf8"));
const plano = (t: string) => t.replace(/\s+/g, " ");

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
  colaborador = await entrar("teste.colaborador");
});

afterAll(async () => {
  await prisma.auditEvent.deleteMany({
    where: { entityType: "Training", entityId: { in: treinamentos } },
  });
  await prisma.training.deleteMany({ where: { id: { in: treinamentos } } });
});

describe("o cadastro guarda o que o certificado pede [B3-3-G]", () => {
  it("quem ministra e o responsável técnico entram no cadastro", async () => {
    const id = await treinamento("Com responsável", {
      instructor_name: " Daniel Ferreira ",
      instructor_qualification: "Técnico em Segurança do Trabalho",
      technical_responsible_name: "Hefler Souza",
      technical_responsible_qualification: "Engenheiro de Segurança do Trabalho",
    });
    const t = await prisma.training.findUniqueOrThrow({ where: { id } });
    expect(t.instructorName).toBe("Daniel Ferreira");
    expect(t.instructorQualification).toBe("Técnico em Segurança do Trabalho");
    expect(t.technicalResponsibleName).toBe("Hefler Souza");
    expect(t.technicalResponsibleQualification).toBe("Engenheiro de Segurança do Trabalho");
  });

  it("no treinamento já cadastrado, quem cuida completa — e o que não vem fica como está", async () => {
    const id = await treinamento("Antigo", { instructor_name: "Fica" });
    const res = await request(app)
      .patch(`/api/trainings/${id}/certificado`)
      .set(as(rh))
      .send({
        technical_responsible_name: "Hefler Souza",
        technical_responsible_qualification: "Engenheiro de Segurança do Trabalho",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const t = await prisma.training.findUniqueOrThrow({ where: { id } });
    expect(t.technicalResponsibleName).toBe("Hefler Souza");
    expect(t.instructorName, "campo que não veio não muda").toBe("Fica");

    const trilha = await prisma.auditEvent.findFirst({
      where: { entityType: "Training", entityId: id, action: "training.certificate_data" },
    });
    expect(trilha, "a mudança entra na trilha").toBeTruthy();
  });

  it("campo vazio apaga; campo que não é texto é recusado", async () => {
    const id = await treinamento("Apagar", { instructor_name: "Alguém" });
    const vazio = await request(app)
      .patch(`/api/trainings/${id}/certificado`)
      .set(as(rh))
      .send({ instructor_name: "  " });
    expect(vazio.status).toBe(200);
    expect((await prisma.training.findUniqueOrThrow({ where: { id } })).instructorName).toBeNull();

    const numero = await request(app)
      .patch(`/api/trainings/${id}/certificado`)
      .set(as(rh))
      .send({ instructor_name: 42 });
    expect(numero.status).toBe(400);
  });

  it("quem só faz o treinamento não mexe no cadastro", async () => {
    const id = await treinamento("Só faz");
    const res = await request(app)
      .patch(`/api/trainings/${id}/certificado`)
      .set(as(colaborador))
      .send({ technical_responsible_name: "Eu mesmo" });
    expect(res.status).toBe(403);
    expect(
      (await prisma.training.findUniqueOrThrow({ where: { id } })).technicalResponsibleName,
    ).toBeNull();
  });

  it("treinamento de outra empresa não é achado", async () => {
    const res = await request(app)
      .patch(`/api/trainings/00000000-0000-4000-8000-00000000ffff/certificado`)
      .set(as(rh))
      .send({ instructor_name: "x" });
    expect(res.status).toBe(404);
  });
});

describe("o certificado devolve os itens do 1.7.1.1 [B3-3-G]", () => {
  it("curso a distância: quem ministra e o responsável técnico vêm do cadastro", async () => {
    const id = await treinamento("A distância", {
      instructor_name: "Daniel Ferreira",
      instructor_qualification: "Técnico em Segurança do Trabalho",
      technical_responsible_name: "Hefler Souza",
      technical_responsible_qualification: "Engenheiro de Segurança do Trabalho",
    });
    const ini = await request(app).post(`/api/trainings/${id}/start`).set(as(colaborador));
    expect(ini.status, JSON.stringify(ini.body)).toBe(200);
    const fim = await request(app)
      .post(`/api/trainings/${id}/complete`)
      .set(as(colaborador))
      .send({ answers: [] });
    expect(fim.status, JSON.stringify(fim.body)).toBe(200);

    const cert = await request(app)
      .get(`/api/certificados/${ini.body.enrollment.id}`)
      .set(as(colaborador));
    expect(cert.status, JSON.stringify(cert.body)).toBe(200);
    const t = cert.body.certificate.training;
    expect(t.instructor_name).toBe("Daniel Ferreira");
    expect(t.instructor_qualification).toBe("Técnico em Segurança do Trabalho");
    expect(t.technical_responsible_name).toBe("Hefler Souza");
    expect(t.technical_responsible_qualification).toBe("Engenheiro de Segurança do Trabalho");
  });

  it("presencial: a turma diz quem deu a aula e a qualificação dele", async () => {
    const id = await treinamento("Presencial", {
      kind: "CLASSROOM",
      technical_responsible_name: "Hefler Souza",
    });
    const turma = await request(app)
      .post(`/api/trainings/${id}/turmas`)
      .set(as(rh))
      .send({
        held_at: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
        instructor_name: "Marcos Lima",
        instructor_qualification: "Técnico em Segurança do Trabalho",
        location: "Sala 2",
        duration_minutes: 240,
        attendees: [{ user_id: colaborador.user.id, present: true }],
      });
    expect(turma.status, JSON.stringify(turma.body)).toBe(201);
    const matricula = await prisma.trainingEnrollment.findFirstOrThrow({
      where: { trainingId: id, userId: colaborador.user.id },
      select: { id: true },
    });
    const cert = await request(app)
      .get(`/api/certificados/${matricula.id}`)
      .set(as(colaborador));
    expect(cert.status).toBe(200);
    expect(cert.body.certificate.session.instructor_name).toBe("Marcos Lima");
    expect(cert.body.certificate.session.instructor_qualification).toBe(
      "Técnico em Segurança do Trabalho",
    );
    expect(cert.body.certificate.training.technical_responsible_name).toBe("Hefler Souza");

    const lista = await request(app).get(`/api/trainings/${id}/turmas`).set(as(rh));
    expect(lista.body.sessions[0].instructor_qualification).toBe(
      "Técnico em Segurança do Trabalho",
    );
  });
});

describe("a montagem do certificado [B3-3-G]", () => {
  const base: DadosDoCertificado = {
    completed_at: "2026-10-20T15:00:00.000Z",
    training: {
      kind: "ONLINE",
      summary: "Proteções do torno.",
      instructor_name: "Daniel Ferreira",
      instructor_qualification: "Técnico em Segurança do Trabalho",
      technical_responsible_name: "Hefler Souza",
      technical_responsible_qualification: "Engenheiro de Segurança do Trabalho",
    },
    session: null,
  };

  it("a distância: local 'a distância', quem ministra do cadastro, data da conclusão", () => {
    const i = itensDoCertificado(base);
    expect(i.local).toBe(LOCAL_A_DISTANCIA);
    expect(i.ministrou).toEqual({
      nome: "Daniel Ferreira",
      qualificacao: "Técnico em Segurança do Trabalho",
      registro: null,
    });
    expect(i.data).toBe("2026-10-20T15:00:00.000Z");
    expect(i.responsavel.nome).toBe("Hefler Souza");
    expect(i.faltando).toEqual([]);
  });

  it("presencial: a turma manda — quem deu, onde e quando", () => {
    const i = itensDoCertificado({
      ...base,
      training: { ...base.training, kind: "CLASSROOM" },
      session: {
        held_at: "2026-10-30T00:00:00.000Z",
        location: "Sala 2",
        instructor_name: "Marcos Lima",
        instructor_registration: "MTE 123",
        instructor_qualification: "Técnico em Segurança do Trabalho",
      },
    });
    expect(i.local).toBe("Sala 2");
    expect(i.ministrou.nome, "não o nome do cadastro").toBe("Marcos Lima");
    expect(i.ministrou.registro).toBe("MTE 123");
    expect(i.data).toBe("2026-10-30T00:00:00.000Z");
  });

  it("presencial sem local nem qualificação: o certificado diz o que falta", () => {
    const i = itensDoCertificado({
      ...base,
      training: { ...base.training, kind: "CLASSROOM", technical_responsible_name: null },
      session: {
        held_at: "2026-10-30T00:00:00.000Z",
        location: null,
        instructor_name: "Marcos Lima",
        instructor_registration: null,
        instructor_qualification: null,
      },
    });
    expect(i.local).toBeNull();
    expect(i.faltando).toEqual([
      "local",
      "qualificação de quem ministrou",
      "responsável técnico",
    ]);
  });

  it("a distância sem cadastro: falta quem ministrou e o conteúdo", () => {
    const i = itensDoCertificado({
      ...base,
      training: {
        ...base.training,
        summary: null,
        instructor_name: null,
        instructor_qualification: null,
      },
    });
    expect(i.faltando).toEqual([
      "conteúdo programático",
      "quem ministrou",
      "qualificação de quem ministrou",
    ]);
  });

  it("o CNPJ sai pontuado", () => {
    expect(formatarCnpj("38472486000133")).toBe("38.472.486/0001-33");
    expect(formatarCnpj("38.472.486/0001-33")).toBe("38.472.486/0001-33");
    expect(formatarCnpj("123")).toBe("123");
    expect(formatarCnpj(null)).toBeNull();
  });
});

describe("as telas [B3-3-G]", () => {
  it("o certificado traz conteúdo, local, quem ministrou e as duas assinaturas", () => {
    const p = plano(fonte("pages", "CertificatePage.tsx"));
    expect(p, "o stripper não comeu o código").toContain("export function CertificatePage");
    expect(p).toContain("const itens = itensDoCertificado(cert);");
    expect(p).toContain("<strong>Conteúdo programático:</strong>");
    expect(p).toContain('<dd>{itens.local ?? "não informado"}</dd>');
    expect(p).toContain('{itens.ministrou.nome ?? "não informado"}');
    expect(p).toContain('<span className="cert-sub">Assinatura do trabalhador</span>');
    expect(p).toContain("Assinatura do responsável técnico");
    expect(p.match(/className="cert-signature-line"/g)?.length).toBe(2);
    expect(p).toContain("const cnpj = formatarCnpj(cert.organization?.taxId ?? null);");
    expect(p).toContain("{itens.faltando.length > 0 && (");
  });

  it("no papel, sem a moldura da tela e sem o aviso do que falta", () => {
    const css = plano(fonte("pages", "certificado.css"));
    const impressao = css.slice(css.indexOf("@media print"));
    expect(impressao).toContain(".cert-pendente,");
    expect(impressao).toContain(".sidebar,");
    expect(impressao).toContain("min-height: 0 !important;");
  });

  it("o cadastro, a edição e a turma mandam o que o certificado pede", () => {
    const novo = plano(fonte("pages", "NewTrainingForm.tsx"));
    expect(novo).toContain("technical_responsible_name: responsavelTecnico.trim() || undefined,");
    expect(novo).toContain("instructor_qualification: qualificacaoInstrutor.trim() || undefined,");
    const lista = plano(fonte("pages", "TrainingsPage.tsx"));
    expect(lista).toContain("<TrainingCertificateData trainingId={r.id} dados={dadosDo(r)} canEdit={canWrite}");
    expect(lista).toContain('defaultInstructor={dadosDo(r).instructor_name ?? ""}');
    const turma = plano(fonte("pages", "TrainingSessions.tsx"));
    expect(turma).toContain("instructor_qualification: qualificacao.trim() || undefined,");
    expect(turma).toContain("setInstrutor(defaultInstructor); setQualificacao(defaultQualification); setAberto(true);");
    expect(fonte("api", "inspection.ts")).toContain(
      '"training.certificate_data": "Dados do certificado do treinamento alterados",',
    );
  });
});

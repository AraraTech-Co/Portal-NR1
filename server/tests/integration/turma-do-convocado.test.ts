import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { formatCalendarDayTime } from "../../src/helper/calendar-day";
import { jaChegou } from "../../../client/src/lib/labels";

/**
 * O convocado vê, no treinamento presencial, a turma para a qual foi chamado.
 *
 * A página do treinamento presencial dizia só que a presença é lançada por
 * quem dá a aula. Quando, onde e com quem estavam no aviso do sino, que levava
 * a Convocações — e a convocação não sabia de qual turma era. A turma também
 * não tinha hora. [B3-3-C]
 *
 * O que estes casos seguram: que a convocação nasce ligada à turma; que o
 * treinamento devolve ao convocado — e só a ele — a turma que espera a lista
 * de presença, com dia e hora, local, instrutor e duração; que a turma já
 * lançada sai dali e a próxima entra; que a confirmação aparece; que o aviso
 * leva ao treinamento e diz a hora quando há hora; e que as convocações
 * criadas antes da ligação são ligadas pela migração sem casar a errada.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");
const MIGRACAO = join(
  __dirname,
  "..",
  "..",
  "..",
  "prisma",
  "migrations",
  "20261027120000_convocacao_da_turma",
  "migration.sql",
);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

type Sessao = { token: string; user: { id: string } };
let app: Express;
let rh: Sessao;
let colaborador: Sessao;
let outro: Sessao;
const treinamentos: string[] = [];

async function entrar(login: string): Promise<Sessao> {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as Sessao;
}

/** O mesmo formato de `rotulos-de-auditoria.test.ts`: bloco, depois linha. */
function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function fonte(...caminho: string[]): string {
  return semComentarios(readFileSync(join(CLIENTE, ...caminho), "utf8"));
}

/** O trecho entre duas âncoras, com as duas exigidas. */
function entre(texto: string, inicio: string, fim: string): string {
  const a = texto.indexOf(inicio);
  expect(a, `âncora não encontrada: ${inicio}`).toBeGreaterThanOrEqual(0);
  const b = texto.indexOf(fim, a);
  expect(b, `âncora não encontrada: ${fim}`).toBeGreaterThan(a);
  return texto.slice(a, b);
}

const plano = (texto: string) => texto.replace(/\s+/g, " ");

async function presencial(titulo: string) {
  const res = await request(app)
    .post("/api/trainings")
    .set(as(rh.token))
    .send({
      title: `${titulo} ${SUFIXO}`,
      kind: "CLASSROOM",
      summary: "Conteúdo do treinamento presencial.",
      duration_minutes: 240,
      passing_score: 70,
      validity_months: 24,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  treinamentos.push(res.body.training.id);
  return res.body.training.id as string;
}

async function marcar(
  trainingId: string,
  heldAt: string,
  extra: Record<string, unknown> = {},
) {
  const res = await request(app)
    .post(`/api/trainings/${trainingId}/turmas`)
    .set(as(rh.token))
    .send({
      held_at: heldAt,
      instructor_name: "Daniel Ferreira",
      location: "Sala de treinamento 2",
      duration_minutes: 240,
      invite_user_ids: [colaborador.user.id],
      ...extra,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.session.id as string;
}

async function minhaTurma(token: string, trainingId: string) {
  const res = await request(app).get(`/api/trainings/${trainingId}`).set(as(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.training.my_session as null | {
    id: string;
    held_at: string;
    location: string | null;
    instructor_name: string;
    duration_minutes: number;
    summon_id: string;
    attendance_status: string;
  };
}

function emDias(dias: number, hora?: string): string {
  const dia = new Date(Date.now() + dias * 86_400_000).toISOString().slice(0, 10);
  return hora ? new Date(`${dia}T${hora}:00-03:00`).toISOString() : dia;
}

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
  colaborador = await entrar("teste.colaborador");
  outro = await entrar("teste.supervisor");
});

afterAll(async () => {
  const sessoes = await prisma.trainingSession.findMany({
    where: { trainingId: { in: treinamentos } },
    select: { id: true },
  });
  await prisma.notification.deleteMany({
    where: { entityType: "TrainingSession", entityId: { in: sessoes.map((s) => s.id) } },
  });
  await prisma.summon.deleteMany({
    where: { title: { contains: SUFIXO } },
  });
  await prisma.training.deleteMany({ where: { id: { in: treinamentos } } });
});

describe("a convocação sabe de qual turma é [B3-3-C]", () => {
  it("marcar a turma cria a convocação ligada a ela", async () => {
    const t = await presencial("Ligada");
    const sessionId = await marcar(t, emDias(6, "14:30"));
    const convocacao = await prisma.summon.findFirstOrThrow({
      where: { title: `Treinamento: Ligada ${SUFIXO}` },
      select: { trainingSessionId: true },
    });
    expect(convocacao.trainingSessionId).toBe(sessionId);
  });

  it("Convocações devolve o treinamento da turma, para levar até ele", async () => {
    const t = await presencial("Com caminho");
    await marcar(t, emDias(6));
    const res = await request(app).get("/api/summons").set(as(colaborador.token));
    expect(res.status).toBe(200);
    const linha = res.body.summons.find(
      (s: { title: string }) => s.title === `Treinamento: Com caminho ${SUFIXO}`,
    );
    expect(linha?.trainingSession).toEqual({ trainingId: t });
  });
});

describe("o treinamento mostra a turma ao convocado [B3-3-C]", () => {
  it("o convocado vê dia e hora, local, instrutor, duração e a situação", async () => {
    const t = await presencial("Torno");
    const heldAt = emDias(3, "14:30");
    const sessionId = await marcar(t, heldAt);

    const turma = await minhaTurma(colaborador.token, t);
    expect(turma, "o convocado abria o treinamento e não via a turma").not.toBeNull();
    expect(turma!.id).toBe(sessionId);
    expect(new Date(turma!.held_at).toISOString()).toBe(heldAt);
    expect(turma!.location).toBe("Sala de treinamento 2");
    expect(turma!.instructor_name).toBe("Daniel Ferreira");
    expect(turma!.duration_minutes).toBe(240);
    expect(turma!.attendance_status).toBe("INVITED");

    const convocacao = await prisma.summon.findFirstOrThrow({
      where: { trainingSessionId: sessionId },
      select: { id: true },
    });
    expect(turma!.summon_id).toBe(convocacao.id);
  });

  it("quem não foi convocado não recebe turma nenhuma", async () => {
    const t = await presencial("Só do convocado");
    await marcar(t, emDias(3));
    expect(await minhaTurma(outro.token, t)).toBeNull();
    expect(await minhaTurma(rh.token, t), "quem marcou não foi convocado").toBeNull();
  });

  it("confirmar a presença aparece na turma", async () => {
    const t = await presencial("Confirma");
    await marcar(t, emDias(4));
    const antes = await minhaTurma(colaborador.token, t);
    const res = await request(app)
      .post(`/api/summons/${antes!.summon_id}/attendance`)
      .set(as(colaborador.token))
      .send({ status: "CONFIRMED" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const depois = await minhaTurma(colaborador.token, t);
    expect(depois!.attendance_status).toBe("CONFIRMED");
  });

  it("vem a turma mais próxima; lançada a presença, ela sai e a seguinte entra", async () => {
    const t = await presencial("Duas turmas");
    const depois = await marcar(t, emDias(20), { location: "Auditório" });
    const primeiro = await marcar(t, emDias(5));

    const agora = await minhaTurma(colaborador.token, t);
    expect(agora!.id, "a mais próxima vem primeiro, não a última marcada").toBe(primeiro);

    // A primeira aula acontece e a presença é lançada.
    await prisma.trainingSession.update({
      where: { id: primeiro },
      data: { heldAt: new Date(Date.now() - 86_400_000) },
    });
    const lancou = await request(app)
      .post(`/api/trainings/${t}/turmas/${primeiro}/presenca`)
      .set(as(rh.token))
      .send({ attendees: [{ user_id: colaborador.user.id, present: true }] });
    expect(lancou.status, JSON.stringify(lancou.body)).toBe(200);

    const seguinte = await minhaTurma(colaborador.token, t);
    expect(seguinte!.id, "a turma já lançada não é mais a que espera").toBe(depois);
    expect(seguinte!.location).toBe("Auditório");
  });

  it("a turma marcada só com o dia continua aparecendo depois da data, até lançarem a presença", async () => {
    const t = await presencial("Falta lançar");
    const sessionId = await marcar(t, emDias(2));
    await prisma.trainingSession.update({
      where: { id: sessionId },
      data: { heldAt: new Date(`${emDias(-1)}T00:00:00.000Z`) },
    });
    const turma = await minhaTurma(colaborador.token, t);
    expect(turma?.id).toBe(sessionId);
  });
});

describe("o aviso leva ao treinamento e diz a hora [B3-3-C]", () => {
  it("com hora: o aviso diz a hora de Brasília e leva ao treinamento", async () => {
    const t = await presencial("Aviso com hora");
    const heldAt = emDias(8, "14:30");
    const sessionId = await marcar(t, heldAt);
    const aviso = await prisma.notification.findFirstOrThrow({
      where: { userId: colaborador.user.id, entityId: sessionId },
      select: { body: true, link: true },
    });
    expect(aviso.link, "levava a Convocações, sem a turma").toBe(`/treinamentos/${t}`);
    expect(aviso.body).toContain("às 14:30");
    expect(aviso.body).toContain(formatCalendarDayTime(heldAt));
  });

  it("só com o dia: o aviso não inventa hora", async () => {
    const t = await presencial("Aviso sem hora");
    const dia = emDias(8);
    const sessionId = await marcar(t, dia);
    const aviso = await prisma.notification.findFirstOrThrow({
      where: { userId: colaborador.user.id, entityId: sessionId },
      select: { body: true },
    });
    const [ano, mes, d] = dia.split("-");
    expect(aviso.body).toContain(`${d}/${mes}/${ano}`);
    expect(aviso.body).not.toContain(" às ");
  });

  it("formatCalendarDayTime: meia-noite UTC é dia; outro instante é hora de Brasília", () => {
    /* O servidor roda em UTC: é aí que a hora de Brasília pode se perder. */
    const fuso = process.env.TZ;
    process.env.TZ = "UTC";
    try {
      expect(formatCalendarDayTime("2026-10-30T00:00:00.000Z")).toBe("30/10/2026");
      expect(formatCalendarDayTime("2026-10-30T17:30:00.000Z")).toBe("30/10/2026 às 14:30");
      // 22h em Brasília é o dia seguinte em UTC: o dia não pode virar.
      expect(formatCalendarDayTime("2026-10-31T01:00:00.000Z")).toBe("30/10/2026 às 22:00");
      expect(formatCalendarDayTime(null)).toBe("—");
    } finally {
      if (fuso === undefined) delete process.env.TZ;
      else process.env.TZ = fuso;
    }
  });
});

describe("as convocações de antes da ligação [B3-3-C]", () => {
  it("a migração liga a convocação da mesma transação, e não a de outra hora", async () => {
    const t = await presencial("Antiga");
    const treino = await prisma.training.findUniqueOrThrow({
      where: { id: t },
      select: { organizationId: true, title: true },
    });
    const heldAt = new Date(`${emDias(10)}T00:00:00.000Z`);
    const criadaEm = new Date(Date.now() - 3_600_000);
    const turma = await prisma.trainingSession.create({
      data: {
        organizationId: treino.organizationId,
        trainingId: t,
        heldAt,
        instructorName: "Daniel Ferreira",
        durationMinutes: 240,
        recordedById: rh.user.id,
        createdAt: criadaEm,
      },
    });
    const base = {
      organizationId: treino.organizationId,
      title: `Treinamento: ${treino.title}`,
      scheduledFor: heldAt,
      createdById: rh.user.id,
    };
    const daMesma = await prisma.summon.create({
      data: { ...base, createdAt: new Date(criadaEm.getTime() + 200) },
    });
    // Mesmo título e dia, criada cinco minutos depois: outra convocação.
    const deOutraHora = await prisma.summon.create({
      data: { ...base, createdAt: new Date(criadaEm.getTime() + 5 * 60_000) },
    });
    /*
      Mesma pessoa, mesmo dia, mesmo minuto, outro treinamento: marcar duas
      turmas seguidas é rotina, e cada convocação é da sua.
    */
    const outroAssunto = await prisma.summon.create({
      data: {
        ...base,
        title: `Treinamento: Outro curso ${SUFIXO}`,
        createdAt: new Date(criadaEm.getTime() + 100),
      },
    });

    const sql = readFileSync(MIGRACAO, "utf8");
    const update = sql.slice(sql.indexOf('UPDATE "Summon"'));
    expect(update.startsWith('UPDATE "Summon"'), "a migração preenche as antigas").toBe(true);
    await prisma.$executeRawUnsafe(update.trim().replace(/;$/, ""));

    const ligadas = await prisma.summon.findMany({
      where: { id: { in: [daMesma.id, deOutraHora.id, outroAssunto.id] } },
      select: { id: true, trainingSessionId: true },
    });
    const de = (id: string) => ligadas.find((s) => s.id === id)!.trainingSessionId;
    expect(de(daMesma.id)).toBe(turma.id);
    expect(de(deOutraHora.id), "convocação de outra hora não é desta turma").toBeNull();
    expect(de(outroAssunto.id), "a convocação de outro treinamento não é desta turma").toBeNull();
  });
});

describe("as telas [B3-3-C]", () => {
  it("jaChegou: só o dia vale o dia inteiro; com hora, vale a hora", () => {
    /* O navegador de quem usa está em Brasília. */
    const fuso = process.env.TZ;
    process.env.TZ = "America/Sao_Paulo";
    try {
      const agora = new Date(2026, 9, 30, 10, 0);
      expect(jaChegou("2026-10-30T00:00:00.000Z", agora)).toBe(true);
      expect(jaChegou("2026-10-31T00:00:00.000Z", agora)).toBe(false);
      expect(jaChegou(new Date(2026, 9, 30, 9, 59), agora)).toBe(true);
      expect(jaChegou(new Date(2026, 9, 30, 14, 30), agora)).toBe(false);
      // Às 22h do dia 30, a turma do dia 31 (meia-noite UTC = 21h do 30)
      // ainda não chegou: o dia é do calendário, não do instante.
      const noite = new Date(2026, 9, 30, 22, 0);
      expect(jaChegou("2026-10-31T00:00:00.000Z", noite)).toBe(false);
    } finally {
      if (fuso === undefined) delete process.env.TZ;
      else process.env.TZ = fuso;
    }
  });

  it("a página do treinamento mostra a turma e deixa confirmar", () => {
    const pagina = fonte("pages", "TrainingPage.tsx");
    expect(pagina, "o stripper não comeu o código").toContain("export function TrainingPage");
    const bloco = plano(entre(pagina, "{presencial && turma && (", "{presencial && !concluido && ("));
    expect(bloco).toContain("formatDayTime(turma.held_at)");
    expect(bloco).toContain('turma.location ?? "Local ainda não informado"');
    expect(bloco).toContain("{turma.instructor_name}");
    expect(bloco).toContain("{turma.duration_minutes} min");
    expect(bloco).toContain("SUMMON_ATTENDANCE_LABEL[turma.attendance_status]");
    expect(bloco).toContain(
      'turma.attendance_status === "INVITED" && !jaChegou(turma.held_at) && (',
    );
    expect(bloco).toContain("confirmarPresenca(turma.summon_id)");
    expect(pagina).toContain("const turma = training.my_session;");
  });

  it("marcar a turma aceita a hora, e a lista mostra a hora", () => {
    const tela = fonte("pages", "TrainingSessions.tsx");
    expect(plano(tela)).toContain(
      "held_at: agendando && hora ? new Date(`${data}T${hora}`).toISOString() : data,",
    );
    expect(tela).toContain('type="time"');
    expect(tela).toContain("<strong>{formatDayTime(s.held_at)}</strong>");
    expect(tela, "a presença segue a hora da turma").toContain("jaChegou(s.held_at) && (");
  });

  it("Convocações leva ao treinamento da turma", () => {
    const tela = fonte("pages", "SummonsPage.tsx");
    const celula = plano(entre(tela, "<strong>{r.title}</strong>", "r.description &&"));
    expect(celula).toContain("{r.trainingSession && (");
    expect(celula).toContain("to={`/treinamentos/${r.trainingSession.trainingId}`}");
  });
});

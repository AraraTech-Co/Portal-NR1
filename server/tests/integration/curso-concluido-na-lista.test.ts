import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { formatDay } from "../../../client/src/lib/labels";
import { situacaoNaLista } from "../../../client/src/lib/situacao-do-curso";

/**
 * O curso concluído aparece como concluído na lista.
 *
 * O link dizia "Fazer" em todo curso online, sem olhar se quem abria a
 * lista já tinha concluído: o Carlos achou que devia o treinamento e não
 * achou o certificado. Agora a lista traz a situação de quem a abre, com a
 * validade, e o concluído leva ao certificado. [B3-3-B]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const PAGINAS = join(__dirname, "..", "..", "..", "client", "src", "pages");

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ")
    .replace(/\s+/g, " ");
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string };
let colaborador: { token: string; user: { id: string } };
let supervisor: { token: string };
let cursoId = "";
let inscricaoId = "";

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body;
}

beforeAll(async () => {
  app = createApp();
  rh = await entrar("teste.rh");
  colaborador = await entrar("teste.colaborador");
  supervisor = await entrar("teste.supervisor");

  const curso = await request(app).post("/api/trainings").set(as(rh.token)).send({
    title: `Torno CNC ${SUFIXO}`,
    kind: "ONLINE",
    summary: "Proteções do torno.",
    duration_minutes: 60,
    passing_score: 70,
  });
  expect(curso.status, JSON.stringify(curso.body)).toBe(201);
  cursoId = curso.body.training.id;

  const inscricao = await prisma.trainingEnrollment.create({
    data: {
      trainingId: cursoId,
      userId: colaborador.user.id,
      status: "COMPLETED",
      completedAt: new Date("2026-10-16T13:00:00.000Z"),
      score: 100,
      expiresAt: new Date("2027-10-16T13:00:00.000Z"),
      certificateCode: `CERT-${SUFIXO}`,
    },
  });
  inscricaoId = inscricao.id;
});

afterAll(async () => {
  await prisma.trainingEnrollment.deleteMany({ where: { trainingId: cursoId } });
  await prisma.training.deleteMany({ where: { id: cursoId } });
});

type Linha = { id: string; my_enrollment: { id: string; status: string; expiresAt: string | null } | null };

describe("a lista traz a situação de quem a abre [B3-3-B]", () => {
  it("quem concluiu vê a própria inscrição, com a validade", async () => {
    const res = await request(app).get("/api/trainings").set(as(colaborador.token));
    expect(res.status).toBe(200);
    const linha = (res.body.trainings as Linha[]).find((t) => t.id === cursoId);
    expect(linha?.my_enrollment).toMatchObject({
      id: inscricaoId,
      status: "COMPLETED",
      expiresAt: "2027-10-16T13:00:00.000Z",
    });
  });

  it("outra pessoa não vê a inscrição de quem concluiu", async () => {
    const res = await request(app).get("/api/trainings").set(as(supervisor.token));
    const linha = (res.body.trainings as Linha[]).find((t) => t.id === cursoId);
    expect(linha).toBeDefined();
    expect(linha?.my_enrollment).toBeNull();
    expect(linha).not.toHaveProperty("enrollments");
  });
});

describe("o que a lista diz e para onde leva [B3-3-B]", () => {
  const AGORA = new Date("2026-10-27T15:00:00.000Z");
  const base = { trainingId: "t1", presencial: false, somenteLeitura: false, agora: AGORA };
  const concluida = {
    id: "e1",
    status: "COMPLETED",
    completedAt: "2026-10-16T13:00:00.000Z",
    expiresAt: "2027-10-16T13:00:00.000Z",
  };

  it("concluído e válido: diz até quando vale e leva ao certificado", () => {
    expect(situacaoNaLista({ ...base, minha: concluida })).toEqual({
      situacao: { texto: `Concluído · vale até ${formatDay(concluida.expiresAt)}`, tom: "success" },
      link: { texto: "Ver certificado", para: "/certificados/e1" },
    });
    expect(formatDay(concluida.expiresAt)).toBe("16/10/2027");
  });

  it("concluído sem validade: só concluído, e o certificado", () => {
    const r = situacaoNaLista({ ...base, minha: { ...concluida, expiresAt: null } });
    expect(r.situacao?.texto).toBe("Concluído");
    expect(r.link.texto).toBe("Ver certificado");
  });

  it("presencial concluído também leva ao certificado", () => {
    expect(situacaoNaLista({ ...base, presencial: true, minha: concluida }).link.texto).toBe("Ver certificado");
  });

  it("vencido: diz que venceu e chama para refazer", () => {
    const vencida = { ...concluida, expiresAt: "2026-10-20T13:00:00.000Z" };
    expect(situacaoNaLista({ ...base, minha: vencida })).toEqual({
      situacao: { texto: "Vencido em 20/10/2026", tom: "danger" },
      link: { texto: "Refazer", para: "/treinamentos/t1" },
    });
    expect(situacaoNaLista({ ...base, presencial: true, minha: vencida }).link.texto).toBe("Abrir");
  });

  it("não passou: diz isso e chama para refazer; em andamento: continuar", () => {
    const naoPassou = situacaoNaLista({ ...base, minha: { ...concluida, status: "FAILED", expiresAt: null } });
    expect(naoPassou.situacao?.texto).toBe("Não passou na prova");
    expect(naoPassou.link.texto).toBe("Refazer");
    const andamento = situacaoNaLista({ ...base, minha: { ...concluida, status: "IN_PROGRESS", expiresAt: null } });
    expect(andamento.link.texto).toBe("Continuar");
  });

  it("sem inscrição: Fazer; quem só consulta e o presencial: Abrir", () => {
    expect(situacaoNaLista({ ...base, minha: null })).toEqual({
      situacao: null,
      link: { texto: "Fazer", para: "/treinamentos/t1" },
    });
    expect(situacaoNaLista({ ...base, somenteLeitura: true, minha: null }).link.texto).toBe("Abrir");
    expect(situacaoNaLista({ ...base, presencial: true, minha: null }).link.texto).toBe("Abrir");
  });

  it("a tela usa a regra com a inscrição de quem abre", () => {
    const tela = readFileSync(join(PAGINAS, "TrainingsPage.tsx"), "utf8").replace(/\s+/g, " ");
    expect(tela).toMatch(
      /situacaoNaLista\(\{ trainingId: r\.id, presencial: r\.kind === "CLASSROOM", somenteLeitura: isReadOnlyPermission\(user\?\.permission\), minha: r\.my_enrollment, \}\)/,
    );
    expect(tela).toContain("<Link to={minha.link.para}>{minha.link.texto}</Link>");
    expect(tela).toContain("{minha.situacao.texto}");
    /* No celular, a coluna da pessoa vem logo depois do título, à vista sem rolar. */
    expect(semComentarios(tela)).toMatch(/<th>Título<\/th> <th>Você<\/th>/);
  });
});

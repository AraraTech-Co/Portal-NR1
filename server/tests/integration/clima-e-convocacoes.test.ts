import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import {
  SUMMON_ATTENDANCE_STATUS_VALUES,
  SURVEY_STATUS_VALUES,
} from "../../src/constants";
import {
  formatDayTime,
  SUMMON_ATTENDANCE_LABEL,
  SURVEY_STATUS_LABEL,
} from "../../../client/src/lib/labels";

/**
 * As outras duas telas que só criavam: Clima organizacional e Convocações.
 *
 * O clima criava a pesquisa como rascunho e parava aí — não havia como
 * abri-la para respostas, respondê-la nem encerrá-la. A convocação dizia
 * "quem é convocado recebe aviso e confirma presença no portal", e confirmar
 * não existia: a coluna "Minha presença" mostrava o código do banco
 * ("INVITED"). As rotas já existiam no servidor. [CB-64] [OB-4]
 *
 * O que estes casos seguram: que o rascunho não recebe resposta e a
 * encerrada para de receber, que a pesquisa anônima não guarda quem
 * respondeu, que quem só responde não abre nem encerra pesquisa, que o
 * convocado confirma a PRÓPRIA presença e não se dá por presente nem marca a
 * de outro, e que nenhuma das situações chega à tela em código.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string; user: { id: string } };
let sst: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };

const pesquisas: string[] = [];
const convocacoes: string[] = [];

const entrar = (login: string) =>
  request(app).post("/api/auth").send({ login, password: SENHA });

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

async function pesquisaNova(titulo: string, comPerguntas = true) {
  const res = await request(app)
    .post("/api/climate-surveys")
    .set(as(rh.token))
    .send({
      title: titulo,
      description: "Pesquisa criada pelo teste.",
      ...(comPerguntas
        ? {
            questions: [
              { order: 1, prompt: "Como você avalia a carga de trabalho?" },
              { order: 2, prompt: "Você se sente respeitado no dia a dia?" },
            ],
          }
        : {}),
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  pesquisas.push(res.body.survey.id);
  return res.body.survey.id as string;
}

async function perguntasDe(id: string): Promise<string[]> {
  const res = await request(app)
    .get(`/api/climate-surveys/${id}`)
    .set(as(rh.token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.survey.questions.map((q: { id: string }) => q.id);
}

async function convocacaoNova(quando: string) {
  const res = await request(app)
    .post("/api/summons")
    .set(as(rh.token))
    .send({
      title: `Reunião da CIPA ${SUFIXO}`,
      scheduled_for: quando,
      location: "Sala de treinamento",
      description: "Pauta: acidentes do mês.",
      invitee_ids: [colaborador.user.id, sst.user.id],
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  convocacoes.push(res.body.summon.id);
  return res.body.summon.id as string;
}

async function minhaPresenca(token: string, summonId: string) {
  const res = await request(app).get("/api/summons").set(as(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const linha = res.body.summons.find(
    (s: { id: string }) => s.id === summonId,
  );
  expect(linha, "a convocação aparece na lista de quem foi chamado").toBeTruthy();
  return linha.my_attendance;
}

beforeAll(async () => {
  app = createApp();
  rh = (await entrar("teste.rh")).body;
  sst = (await entrar("teste.sst")).body;
  colaborador = (await entrar("teste.colaborador")).body;
});

afterAll(async () => {
  await prisma.climateSurvey.deleteMany({ where: { id: { in: pesquisas } } });
  await prisma.summon.deleteMany({ where: { id: { in: convocacoes } } });
});

describe("a pesquisa de clima abre, recebe resposta e encerra [CB-64]", () => {
  it("rascunho não recebe; aberta recebe; encerrada para de receber", async () => {
    const id = await pesquisaNova(`Clima do setor ${SUFIXO}`);
    const [primeira] = await perguntasDe(id);
    const responder = (token: string) =>
      request(app)
        .post(`/api/climate-surveys/${id}/respond`)
        .set(as(token))
        .send({ answers: [{ question_id: primeira, score: 4 }] });

    /* Rascunho: existe, mas não é para ser respondido ainda. */
    const noRascunho = await responder(colaborador.token);
    expect(noRascunho.status, JSON.stringify(noRascunho.body)).toBe(404);

    const abriu = await request(app)
      .post(`/api/climate-surveys/${id}/open`)
      .set(as(rh.token));
    expect(abriu.status, JSON.stringify(abriu.body)).toBe(200);
    expect(abriu.body.survey.status).toBe("OPEN");

    const respondeu = await responder(colaborador.token);
    expect(respondeu.status, JSON.stringify(respondeu.body)).toBe(201);

    const encerrou = await request(app)
      .post(`/api/climate-surveys/${id}/close`)
      .set(as(rh.token));
    expect(encerrou.status, JSON.stringify(encerrou.body)).toBe(200);
    expect(encerrou.body.survey.status).toBe("CLOSED");

    const depois = await responder(colaborador.token);
    expect(depois.status, JSON.stringify(depois.body)).toBe(404);

    /* E a resposta que entrou continua contada. */
    const lista = await request(app)
      .get("/api/climate-surveys")
      .set(as(rh.token));
    const linha = lista.body.surveys.find((s: { id: string }) => s.id === id);
    expect(linha._count.responses).toBe(1);
    expect(linha._count.questions).toBe(2);
  });

  it("a pesquisa anônima não guarda quem respondeu", async () => {
    const id = await pesquisaNova(`Clima anônimo ${SUFIXO}`);
    const [primeira] = await perguntasDe(id);
    await request(app)
      .post(`/api/climate-surveys/${id}/open`)
      .set(as(rh.token));

    const res = await request(app)
      .post(`/api/climate-surveys/${id}/respond`)
      .set(as(colaborador.token))
      .send({
        answers: [
          { question_id: primeira, score: 2, text: "Carga alta na segunda." },
        ],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.response.anonymous).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain(colaborador.user.id);

    const guardada = await prisma.climateResponse.findMany({
      where: { surveyId: id },
      select: { userId: true },
    });
    expect(guardada).toHaveLength(1);
    expect(guardada[0].userId, "o relato não tem autor no banco").toBeNull();
  });

  it("quem só responde não abre nem encerra pesquisa", async () => {
    const id = await pesquisaNova(`Clima sem permissão ${SUFIXO}`);
    for (const acao of ["open", "close"]) {
      const res = await request(app)
        .post(`/api/climate-surveys/${id}/${acao}`)
        .set(as(colaborador.token));
      expect(res.status, `${acao}: ${JSON.stringify(res.body)}`).toBe(403);
    }
    const depois = await prisma.climateSurvey.findUniqueOrThrow({
      where: { id },
      select: { status: true },
    });
    expect(depois.status).toBe("DRAFT");
  });

  it("o rascunho não aparece para quem só responde", async () => {
    const id = await pesquisaNova(`Clima em rascunho ${SUFIXO}`);
    const lista = await request(app)
      .get("/api/climate-surveys")
      .set(as(colaborador.token));
    expect(lista.status).toBe(200);
    expect(
      lista.body.surveys.some((s: { id: string }) => s.id === id),
      "rascunho fora da lista de quem responde",
    ).toBe(false);

    const direto = await request(app)
      .get(`/api/climate-surveys/${id}`)
      .set(as(colaborador.token));
    expect(direto.status, JSON.stringify(direto.body)).toBe(404);
  });
});

describe("o convocado confirma a própria presença [CB-64]", () => {
  it("a presença fica confirmada, com a data", async () => {
    const id = await convocacaoNova("2026-11-10T14:30:00.000Z");
    expect((await minhaPresenca(colaborador.token, id)).status).toBe("INVITED");

    const res = await request(app)
      .post(`/api/summons/${id}/attendance`)
      .set(as(colaborador.token))
      .send({ status: "CONFIRMED" });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    const minha = await minhaPresenca(colaborador.token, id);
    expect(minha.status).toBe("CONFIRMED");
    expect(minha.confirmedAt, "com a data da confirmação").toBeTruthy();
  });

  it("não se dá por presente nem confirma pela outra pessoa", async () => {
    const id = await convocacaoNova("2026-11-11T09:00:00.000Z");

    /* Presente e faltou são do RH, depois da reunião. */
    for (const status of ["ATTENDED", "ABSENT"]) {
      const res = await request(app)
        .post(`/api/summons/${id}/attendance`)
        .set(as(colaborador.token))
        .send({ status });
      expect(res.status, `${status}: ${JSON.stringify(res.body)}`).toBe(403);
    }

    /*
      E pedir pela outra pessoa não a confirma: o servidor confirma a de quem
      pediu e ignora o user_id de quem não administra.
    */
    const res = await request(app)
      .post(`/api/summons/${id}/attendance`)
      .set(as(colaborador.token))
      .send({ status: "CONFIRMED", user_id: sst.user.id });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect((await minhaPresenca(colaborador.token, id)).status).toBe(
      "CONFIRMED",
    );
    expect(
      (await minhaPresenca(sst.token, id)).status,
      "a presença da outra pessoa continua como convocado",
    ).toBe("INVITED");
  });

  it("o aviso da convocação chega a quem foi chamado", async () => {
    /* Não regressão do [CB-29]: o aviso já existe, e a tela conta com ele. */
    const id = await convocacaoNova("2026-11-12T08:00:00.000Z");
    const avisos = await prisma.notification.findMany({
      where: { entityType: "Summon", entityId: id },
      select: { userId: true, title: true, link: true },
    });
    expect(avisos.map((a) => a.userId).sort()).toEqual(
      [colaborador.user.id, sst.user.id].sort(),
    );
    expect(avisos[0].link).toBe("/convocacoes");
  });
});

describe("nenhuma situação chega à tela em código [CB-64]", () => {
  it("toda situação de presença tem nome em português", () => {
    for (const status of SUMMON_ATTENDANCE_STATUS_VALUES) {
      const nome = SUMMON_ATTENDANCE_LABEL[status];
      expect(nome, `sem rótulo: ${status}`).toBeTruthy();
      expect(nome, `${status} saindo em código`).not.toBe(status);
    }
  });

  it("toda situação de pesquisa tem nome em português", () => {
    for (const status of SURVEY_STATUS_VALUES) {
      const nome = SURVEY_STATUS_LABEL[status];
      expect(nome, `sem rótulo: ${status}`).toBeTruthy();
      expect(nome, `${status} saindo em código`).not.toBe(status);
    }
  });

  it("a hora marcada aparece, e a data sem hora não ganha uma inventada", () => {
    /* A convocação é marcada em hora cheia: a tela mostrava só o dia. */
    const reuniao = new Date("2026-11-10T14:30:00.000Z");
    const esperado = `${String(reuniao.getHours()).padStart(2, "0")}:${String(
      reuniao.getMinutes(),
    ).padStart(2, "0")}`;
    expect(formatDayTime(reuniao.toISOString())).toContain(` às ${esperado}`);
    /* Data gravada como dia (meia-noite UTC) continua só com o dia. */
    expect(formatDayTime("2026-11-10T00:00:00.000Z")).toBe("10/11/2026");
    expect(formatDayTime(null)).toBe("—");
  });

  it("a tela de convocações mostra o nome, a hora e o botão de confirmar", () => {
    const tela = fonte("pages", "SummonsPage.tsx");
    expect(tela, "a varredura não engoliu código junto").toContain(
      'useModuleAccess("convocacoes")',
    );
    expect(tela).toContain("SUMMON_ATTENDANCE_LABEL[r.my_attendance.status]");
    expect(tela).toContain("formatDayTime(r.scheduledFor)");
    expect(
      tela.includes("{r.my_attendance?.status ?? \"—\"}"),
      "o código do banco não é mais a coluna",
    ).toBe(false);
    /* Confirmar é de quem está convocado e ainda não confirmou. */
    const botao = entre(
      tela,
      '{r.my_attendance?.status === "INVITED" && (',
      "</td>",
    );
    expect(botao).toContain("confirmar(r.id)");
    expect(botao).toContain("Confirmar presença");
  });

  it("no celular, confirmar e responder cabem na tela", () => {
    /*
      Conferido em navegador a 375×812: os dois botões ficavam numa coluna à
      parte, fora da tela, e a tabela rolava de lado sem nada dizer isso — é
      pelo celular que chega o aviso da convocação. Os botões passam para a
      célula da situação, e as colunas de contagem e autoria saem na tela
      estreita. [CB-64]
    */
    for (const [arquivo, css, classe, botao] of [
      ["SummonsPage.tsx", "summons.css", "summons-col-extra", "Confirmar presença"],
      ["ClimatePage.tsx", "climate.css", "climate-col-extra", "abrirParaResponder(r.id)"],
    ] as const) {
      const tela = fonte("pages", arquivo);
      expect(tela).toContain(`import "./${css}";`);
      /* Duas colunas a mais, cada uma no cabeçalho e na célula. */
      const usos = tela.match(new RegExp(`className="${classe}"`, "g")) ?? [];
      expect(usos.length, `${arquivo}: ${classe}`).toBe(4);
      /* O botão mora na mesma célula da situação, não numa coluna sem título. */
      expect(tela.includes("<th />"), `${arquivo}: coluna sem título`).toBe(false);
      expect(tela).toContain(botao);

      const estilo = readFileSync(join(CLIENTE, "pages", css), "utf8");
      const estreito = entre(estilo, "@media (max-width:", "}\n}");
      expect(estreito).toContain(classe);
      expect(estreito).toContain("display: none;");
    }
  });

  it("a tela de clima abre, responde e encerra, cada coisa com o seu portão", () => {
    const tela = fonte("pages", "ClimatePage.tsx");
    expect(tela, "a varredura não engoliu código junto").toContain(
      'useModuleAccess("clima")',
    );
    /* Responder é de quem pode ler, e só faz sentido com a pesquisa aberta. */
    const responder = entre(
      tela,
      '{r.status === "OPEN" && (',
      "</Button>",
    );
    expect(responder).toContain("abrirParaResponder(r.id)");
    expect(responder, "e o botão se chama Responder").toContain("Responder\n");
    /* Abrir e encerrar são de quem cuida do módulo. */
    for (const [portao, acao] of [
      ['{canManage && r.status === "DRAFT" && (', '"abrir"'],
      ['{canManage && r.status === "OPEN" && (', '"encerrar"'],
    ] as const) {
      const trecho = entre(tela, portao, "</Button>");
      expect(trecho, `${portao} chama ${acao}`).toContain(
        `mudarSituacao(r.id, ${acao})`,
      );
    }
    /* Pesquisa sem pergunta nenhuma não abre: ninguém conseguiria responder. */
    expect(tela).toContain("Sem pergunta nenhuma: não dá para abrir.");
    /*
      O aviso sozinho não basta: o botão tem de estar desligado. A mesma
      expressão aparece no aviso, então a afirmação é sobre o botão de abrir.
    */
    const abrir = entre(tela, '{canManage && r.status === "DRAFT" && (', "</Button>")
      .replace(/\s+/g, " ");
    expect(abrir).toContain(
      "disabled={ mudando === r.id || (r._count?.questions ?? 0) === 0 }",
    );
  });
});

describe("a pesquisa anônima conta respostas, não pessoas [CB-64]", () => {
  /*
    Decidido: a pesquisa anônima continua sem guardar quem respondeu, e por
    isso não impede a mesma pessoa de responder de novo. A tela de quem cuida
    do módulo diz que a contagem é de respostas.
  */
  it("a mesma pessoa responde duas vezes, e as duas entram sem autor", async () => {
    const id = await pesquisaNova(`Clima repetido ${SUFIXO}`);
    const [primeira] = await perguntasDe(id);
    await request(app).post(`/api/climate-surveys/${id}/open`).set(as(rh.token));

    for (const score of [2, 4]) {
      const res = await request(app)
        .post(`/api/climate-surveys/${id}/respond`)
        .set(as(colaborador.token))
        .send({ answers: [{ question_id: primeira, score }] });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
    }

    const lista = await request(app).get("/api/climate-surveys").set(as(rh.token));
    const linha = (lista.body.surveys as { id: string; _count: { responses: number } }[]).find(
      (s) => s.id === id,
    )!;
    expect(linha._count.responses, "a contagem é de respostas").toBe(2);
    const guardadas = await prisma.climateResponse.findMany({
      where: { surveyId: id },
      select: { userId: true },
    });
    expect(guardadas.map((g) => g.userId)).toEqual([null, null]);
  });

  it("a tela de quem cuida do módulo diz que a contagem é de respostas", () => {
    const tela = fonte("pages", "ClimatePage.tsx");
    expect(tela, "a varredura não engoliu código junto").toContain(
      'useModuleAccess("clima")',
    );
    /*
      Na lista: só para quem cuida do módulo, quando há pesquisa anônima, uma
      vez acima da tabela — fora da coluna da contagem, que some no celular.
    */
    const aviso = entre(tela, "{canManage && rows.some((r) => r.isAnonymous) && (", ")}").replace(/\s+/g, " ");
    expect(aviso).toContain(
      "Nas pesquisas anônimas, o número é de respostas, não de pessoas: o portal não guarda quem respondeu, e a mesma pessoa pode ter respondido mais de uma vez.",
    );
    expect(tela.indexOf("respostas, não de pessoas"), "acima da tabela").toBeLessThan(
      tela.indexOf('<table className="data-table climate-table">'),
    );
    expect(tela.split("respostas, não de pessoas").length - 1, "uma vez só").toBe(1);
    /* Ao montar a pesquisa, que já é só de quem cuida do módulo. */
    const montar = entre(tela, "<NewRecordSection", "submitLabel=");
    expect(montar).toContain("canWrite={canManage}");
    expect(montar).toContain("o portal conta respostas, não pessoas.");
  });
});

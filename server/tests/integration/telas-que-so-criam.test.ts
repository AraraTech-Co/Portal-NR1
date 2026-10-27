import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Telas que só criavam: Onboarding, Ideias e Banco de talentos.
 *
 * As três ganharam "porta de entrada" e pararam aí: o passo de integração
 * era criado e ninguém o marcava como feito, a ideia era recebida e não
 * havia como respondê-la — enquanto o Início do RH contava "ideias sem
 * resposta" —, e a indicação não saía de "Recebida". As rotas de marcar,
 * responder e mudar a situação já existiam no servidor; tela nenhuma as
 * usava. [CB-64] [OB-4]
 *
 * O que estes casos seguram: que as três rotas fazem o que a tela agora
 * promete, que o progresso do onboarding é de quem marca e não da turma,
 * que responder uma ideia sem escrever a resposta é recusado (a tela avisa
 * antes, mas a regra é do servidor), que quem só escreve a própria ideia não
 * decide a dos outros, e que o caminho que cada tela chama é o caminho que o
 * servidor atende.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");
const SERVIDOR = join(__dirname, "..", "..", "src");

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let rh: { token: string; user: { id: string } };
let sst: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };

const passos: string[] = [];
const ideias: string[] = [];
const indicacoes: string[] = [];

const entrar = (login: string) =>
  request(app).post("/api/auth").send({ login, password: SENHA });

/** O mesmo formato de `rotulos-de-auditoria.test.ts`: bloco, depois linha. */
function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function fonte(raiz: string, ...caminho: string[]): string {
  return semComentarios(readFileSync(join(raiz, ...caminho), "utf8"));
}

/**
 * O trecho entre duas âncoras, com as duas exigidas.
 *
 * `indexOf` devolve -1 quando não acha, e um recorte a partir de -1 pega o
 * fim do arquivo: a afirmação passaria a ser sobre outro pedaço de código.
 */
function entre(texto: string, inicio: string, fim: string): string {
  const a = texto.indexOf(inicio);
  expect(a, `âncora não encontrada: ${inicio}`).toBeGreaterThanOrEqual(0);
  const b = texto.indexOf(fim, a);
  expect(b, `âncora não encontrada: ${fim}`).toBeGreaterThan(a);
  return texto.slice(a, b);
}

/** O passo, como a lista daquela pessoa o mostra. */
async function passoNaLista(token: string, stepId: string) {
  const res = await request(app).get("/api/onboarding-steps").set(as(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.steps.find((s: { id: string }) => s.id === stepId);
}

async function ideiaNaLista(token: string, ideaId: string) {
  const res = await request(app).get("/api/ideas").set(as(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.ideas.find((i: { id: string }) => i.id === ideaId);
}

async function indicacaoNaLista(token: string, id: string) {
  const res = await request(app).get("/api/referrals").set(as(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.referrals.find((r: { id: string }) => r.id === id);
}

beforeAll(async () => {
  app = createApp();
  rh = (await entrar("teste.rh")).body;
  sst = (await entrar("teste.sst")).body;
  colaborador = (await entrar("teste.colaborador")).body;
});

afterAll(async () => {
  await prisma.onboardingStep.deleteMany({ where: { id: { in: passos } } });
  await prisma.idea.deleteMany({ where: { id: { in: ideias } } });
  await prisma.referral.deleteMany({ where: { id: { in: indicacoes } } });
});

describe("o passo da integração se marca como feito [CB-64]", () => {
  it("fica marcado para quem marcou, e não para os outros", async () => {
    const criado = await request(app)
      .post("/api/onboarding-steps")
      .set(as(rh.token))
      .send({ order: 900, title: `Entregar o crachá ${SUFIXO}` });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);
    passos.push(criado.body.step.id);
    const stepId = criado.body.step.id;

    expect((await passoNaLista(colaborador.token, stepId)).done_at).toBeNull();

    const marcou = await request(app)
      .post(`/api/onboarding-steps/${stepId}/complete`)
      .set(as(colaborador.token));
    expect(marcou.status, JSON.stringify(marcou.body)).toBe(200);

    /*
      A data é o que a tela mostra: sem ela o passo continuaria "a fazer"
      logo depois de a pessoa dizer que o fez.
    */
    const meu = await passoNaLista(colaborador.token, stepId);
    expect(meu.done_at, "o passo marcado volta com a data").toBeTruthy();
    expect(Number.isNaN(Date.parse(meu.done_at))).toBe(false);

    /* E o passo é de cada um: ninguém marca o roteiro do outro. */
    expect(
      (await passoNaLista(sst.token, stepId)).done_at,
      "o passo de outra pessoa continua a fazer",
    ).toBeNull();
  });

  it("marcar de novo não desmarca", async () => {
    const criado = await request(app)
      .post("/api/onboarding-steps")
      .set(as(rh.token))
      .send({ order: 901, title: `Ler a ordem de serviço ${SUFIXO}` });
    passos.push(criado.body.step.id);
    const stepId = criado.body.step.id;

    await request(app)
      .post(`/api/onboarding-steps/${stepId}/complete`)
      .set(as(colaborador.token));
    const primeira = (await passoNaLista(colaborador.token, stepId)).done_at;
    await request(app)
      .post(`/api/onboarding-steps/${stepId}/complete`)
      .set(as(colaborador.token));

    const depois = await passoNaLista(colaborador.token, stepId);
    expect(depois.done_at, "continua marcado").toBeTruthy();
    expect(Date.parse(depois.done_at)).toBeGreaterThanOrEqual(
      Date.parse(primeira),
    );
    const linhas = await prisma.onboardingProgress.count({
      where: { stepId, userId: colaborador.user.id },
    });
    expect(linhas, "uma marcação por pessoa").toBe(1);
  });
});

describe("a ideia recebe resposta [CB-64]", () => {
  async function ideiaNova(titulo: string) {
    const res = await request(app)
      .post("/api/ideas")
      .set(as(colaborador.token))
      .send({
        title: titulo,
        description: `Descrição de ${titulo}, escrita por quem faz o trabalho.`,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    ideias.push(res.body.idea.id);
    return res.body.idea.id as string;
  }

  it("sai de Nova e guarda a resposta e quem respondeu", async () => {
    const id = await ideiaNova(`Carrinho para as peças ${SUFIXO}`);
    expect((await ideiaNaLista(colaborador.token, id)).status).toBe("NEW");

    const res = await request(app)
      .post(`/api/ideas/${id}/decide`)
      .set(as(rh.token))
      .send({
        status: "IMPLEMENTED",
        decision_note: "Carrinho comprado; chega na semana que vem.",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(200);

    /* Quem teve a ideia vê a resposta na própria lista. */
    const vista = await ideiaNaLista(colaborador.token, id);
    expect(vista.status).toBe("IMPLEMENTED");
    expect(vista.decisionNote).toContain("Carrinho comprado");
    expect(vista.decidedBy?.name, JSON.stringify(vista)).toBeTruthy();
    expect(vista.decidedAt).toBeTruthy();
  });

  it("implantar ou recusar sem escrever a resposta é recusado, e a ideia não muda", async () => {
    const id = await ideiaNova(`Trocar a lâmpada do setor ${SUFIXO}`);

    for (const status of ["IMPLEMENTED", "REJECTED"]) {
      const res = await request(app)
        .post(`/api/ideas/${id}/decide`)
        .set(as(rh.token))
        .send({ status });
      expect(res.status, `${status}: ${JSON.stringify(res.body)}`).toBe(400);
    }

    expect((await ideiaNaLista(colaborador.token, id)).status).toBe("NEW");

    /* Pôr em análise é só dizer que alguém pegou: não precisa de resposta. */
    const analise = await request(app)
      .post(`/api/ideas/${id}/decide`)
      .set(as(rh.token))
      .send({ status: "IN_ANALYSIS" });
    expect(analise.status, JSON.stringify(analise.body)).toBe(200);
    expect((await ideiaNaLista(colaborador.token, id)).status).toBe(
      "IN_ANALYSIS",
    );
  });

  it("quem escreve a própria ideia não responde a ideia nenhuma", async () => {
    const id = await ideiaNova(`Ventilador na expedição ${SUFIXO}`);
    const res = await request(app)
      .post(`/api/ideas/${id}/decide`)
      .set(as(colaborador.token))
      .send({ status: "IMPLEMENTED", decision_note: "Eu mesmo aprovo." });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect((await ideiaNaLista(colaborador.token, id)).status).toBe("NEW");
  });
});

describe("a indicação anda [CB-64]", () => {
  async function indicacaoNova() {
    const res = await request(app)
      .post("/api/referrals")
      .set(as(rh.token))
      .send({
        candidate_name: `Candidata ${SUFIXO}`,
        position: "Operadora de torno",
        email: `candidata.${SUFIXO}@exemplo.local`,
        note: "Trabalhou comigo na usinagem.",
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    indicacoes.push(res.body.referral.id);
    return res.body.referral.id as string;
  }

  it("de recebida a contratada, e a lista mostra o contato e o motivo", async () => {
    const id = await indicacaoNova();
    const recebida = await indicacaoNaLista(rh.token, id);
    expect(recebida.status).toBe("RECEIVED");
    /* Sem contato e motivo, a tela mostrava um nome e nada com que agir. */
    expect(recebida.email).toContain("@");
    expect(recebida.note).toContain("usinagem");

    for (const status of ["IN_PROCESS", "HIRED"]) {
      const res = await request(app)
        .patch(`/api/referrals/${id}`)
        .set(as(rh.token))
        .send({ status });
      expect(res.status, `${status}: ${JSON.stringify(res.body)}`).toBe(200);
      expect((await indicacaoNaLista(rh.token, id)).status).toBe(status);
    }
  });

  it("situação que não existe é recusada e nada muda", async () => {
    const id = await indicacaoNova();
    const res = await request(app)
      .patch(`/api/referrals/${id}`)
      .set(as(rh.token))
      .send({ status: "CONTRATADO" });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect((await indicacaoNaLista(rh.token, id)).status).toBe("RECEIVED");
  });
});

describe("as telas chamam o que o servidor atende [CB-64]", () => {
  it("o caminho de cada ação existe na rota do servidor", () => {
    const cliente = fonte(CLIENTE, "api", "modules.ts");
    const rotas = [
      ["onboarding", "/api/onboarding-steps/${encodeURIComponent(id)}/complete", "/api/onboarding-steps/:id/complete"],
      ["ideias", "/api/ideas/${encodeURIComponent(id)}/decide", "/api/ideas/:id/decide"],
      ["talentos", "/api/referrals/${encodeURIComponent(id)}", "/api/referrals/:id"],
    ] as const;
    for (const [modulo, noCliente, noServidor] of rotas) {
      expect(cliente, `${modulo}: o cliente monta o caminho`).toContain(
        noCliente,
      );
      const arquivo = fonte(
        SERVIDOR,
        "api",
        "hr",
        `${modulo === "ideias" ? "ideas" : modulo === "talentos" ? "referrals" : "onboarding"}.route.ts`,
      );
      expect(arquivo, `${modulo}: o servidor atende o caminho`).toContain(
        `"${noServidor}"`,
      );
    }
  });

  it("a tela do onboarding marca o passo", () => {
    const tela = fonte(CLIENTE, "pages", "OnboardingPage.tsx");
    expect(tela, "a varredura não engoliu código junto").toContain(
      "useResourceList(fetchOnboardingSteps)",
    );
    expect(tela).toContain("completeOnboardingStep(id)");
    expect(tela).toContain("Marquei como feito");
  });

  it("no celular, o botão de marcar o passo cabe na tela", () => {
    /*
      Conferido em navegador a 375×812: o botão ficava fora da tela, e a
      tabela rolava de lado sem nada dizer isso — o roteiro de quem chega é
      aberto justamente no celular. A ordem e a coluna da descrição saem, e
      a descrição entra embaixo do título. [CB-64]
    */
    const tela = fonte(CLIENTE, "pages", "OnboardingPage.tsx");
    expect(tela, "a varredura não engoliu código junto").toContain(
      "useResourceList(fetchOnboardingSteps)",
    );
    expect(tela).toContain('import "./onboarding.css";');
    for (const classe of ["onboarding-col-ordem", "onboarding-col-descricao"]) {
      const usos = tela.match(new RegExp(classe, "g")) ?? [];
      expect(usos.length, `${classe}: no cabeçalho e na célula`).toBe(2);
    }
    expect(tela).toContain("onboarding-descricao-embaixo");

    const css = readFileSync(
      join(CLIENTE, "pages", "onboarding.css"),
      "utf8",
    );
    const estreito = entre(css, "@media (max-width:", "}\n");
    expect(estreito, "as colunas sobrando somem na tela estreita").toContain(
      "display: none;",
    );
    for (const classe of ["onboarding-col-ordem", "onboarding-col-descricao"]) {
      expect(estreito).toContain(classe);
    }
  });

  it("a tela das ideias responde, e só para quem cuida do módulo", () => {
    const tela = fonte(CLIENTE, "pages", "IdeasPage.tsx");
    expect(tela, "a varredura não engoliu código junto").toContain(
      'useModuleAccess("ideias")',
    );
    expect(tela).toContain("decideIdea(id, { status, decision_note:");
    /* A coluna das ações não é montada para quem só escreve a própria. */
    const acoes = tela.match(/\{canManage && \(/g) ?? [];
    expect(acoes.length, "cabeçalho e célula atrás do mesmo portão").toBe(1);
    expect(tela).toContain("{canManage && <th />}");
    /* E a resposta é exigida antes de chamar o servidor. */
    const guarda = entre(
      tela,
      'if ((status === "IMPLEMENTED" || status === "REJECTED") && !nota) {',
      "setDecidindo(id)",
    );
    expect(guarda, "a tela pede a resposta antes de implantar ou recusar")
      .toContain("return;");
  });

  it("a tela do banco de talentos muda a situação, e só para quem cuida", () => {
    const tela = fonte(CLIENTE, "pages", "ReferralsPage.tsx");
    expect(tela, "a varredura não engoliu código junto").toContain(
      'useModuleAccess("talentos")',
    );
    expect(tela).toContain("updateReferralStatus(id, status)");
    const acoes = tela.match(/\{canManage && \(/g) ?? [];
    expect(acoes.length).toBe(1);
    expect(tela).toContain("{canManage && <th />}");
    /* A situação em que a indicação está não vira botão de si mesma. */
    expect(tela).toContain("ANDAMENTO.filter((a) => a.status !== r.status)");
  });
});

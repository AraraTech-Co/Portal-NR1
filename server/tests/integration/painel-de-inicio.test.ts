import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";

/**
 * O painel de início responde, pelo papel de quem abre: o que é meu [S1-F],
 * o que está na minha mesa [S5-A], a empresa está em dia [S6-A] e o que
 * vence agora [S6-B].
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

async function entrar(app: Express, login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

type Card = { id: string; label: string; count: number; link: string; tone?: string; detail?: string | null };
type Painel = {
  mine: Card[];
  desk: Card[];
  compliance: Card[] | null;
  expiring: Card[];
  first_steps: { id: string; done: boolean }[] | null;
  window_days: number;
};

let app: Express;
let owner: { token: string; user: { id: string } };
let rh: { token: string; user: { id: string } };
let sst: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };
let fiscal: { token: string; user: { id: string } };

const painel = async (token: string) => {
  const res = await request(app).get("/api/inicio").set(as(token));
  expect(res.status).toBe(200);
  return res.body as Painel;
};

const acha = (cards: Card[], id: string) => cards.find((c) => c.id === id);

beforeAll(async () => {
  app = createApp();
  owner = await entrar(app, "teste.owner");
  rh = await entrar(app, "teste.rh");
  sst = await entrar(app, "teste.sst");
  colaborador = await entrar(app, "teste.colaborador");
  supervisor = await entrar(app, "teste.supervisor");
  fiscal = await entrar(app, "teste.fiscal");
});

describe("o painel é montado pelo papel de quem abre", () => {
  it("quem cuida do PGR vê conformidade e primeiros passos; o colaborador, não", async () => {
    const doOwner = await painel(owner.token);
    expect(doOwner.compliance, "o dono lê o PGR").not.toBeNull();
    expect(doOwner.window_days).toBeGreaterThan(0);

    const doColaborador = await painel(colaborador.token);
    // Colaborador lê documentos_pgr pela matriz, mas não monta a casa.
    expect(doColaborador.first_steps).toBeNull();
    expect(doColaborador.desk, "nada na mesa de quem não decide").toEqual([]);
  });

  it("sem login, nada", async () => {
    expect((await request(app).get("/api/inicio")).status).toBe(401);
  });
});

describe("o que está na minha mesa [S5-A]", () => {
  it("atestado pendente aparece para o RH e não para quem enviou", async () => {
    const envio = await request(app)
      .post("/api/medical-certificates")
      .set(as(colaborador.token))
      .send({
        start_date: "2026-10-05",
        days: 2,
        reason: `Consulta ${SUFIXO}`,
        file_name: "atestado.png",
        mime_type: "image/png",
        content_base64: Buffer.from(`atestado ${SUFIXO}`).toString("base64"),
      });
    expect(envio.status).toBe(201);

    const doRh = await painel(rh.token);
    const card = acha(doRh.desk, "atestados_pendentes");
    expect(card?.count).toBeGreaterThanOrEqual(1);
    expect(card?.link).toBe("/atestados");
    expect(card?.tone).toBe("warning");

    const doColaborador = await painel(colaborador.token);
    expect(acha(doColaborador.desk, "atestados_pendentes")).toBeUndefined();
  });

  it("a ação atribuída aparece para quem vai executar, com o prazo", async () => {
    const criada = await request(app)
      .post("/api/actions")
      .set(as(sst.token))
      .send({
        effectiveness_criteria: "Critério do teste",
        title: `Trocar o piso ${SUFIXO}`,
        assignee_id: supervisor.user.id,
        // Data fixa que virou passado; o prazo agora é recusado. [CB-21]
        due_date: "2027-01-10",
        priority: "HIGH",
      });
    expect(criada.status).toBe(201);

    const doSupervisor = await painel(supervisor.token);
    const card = acha(doSupervisor.mine, "minhas_acoes");
    expect(card, "a ação é dele").toBeTruthy();
    // Prazo de janeiro de 2026 já passou: o cartão avisa.
    expect(card!.tone).toBe("warning");
    expect(card!.detail).toMatch(/venceu/);

    // Quem abriu não recebe a ação como sua.
    const doSst = await painel(sst.token);
    const meu = acha(doSst.mine, "minhas_acoes");
    expect(meu?.count ?? 0).not.toBe(card!.count + 1);

    // E para quem cuida do plano ela entra como atrasada.
    const doOwner = await painel(owner.token);
    expect(acha(doOwner.desk, "acoes_atrasadas")?.count).toBeGreaterThanOrEqual(1);
  });
});

describe("a empresa está em dia? [S6-A]", () => {
  it("cada pendência de conformidade vem com o caminho para resolver", async () => {
    const doOwner = await painel(owner.token);
    const conformidade = doOwner.compliance!;
    // A org de teste tem buraco de propósito; o painel aponta onde.
    expect(conformidade.length).toBeGreaterThan(0);
    for (const card of conformidade) {
      expect(card.count, card.id).toBeGreaterThan(0);
      expect(card.link, card.id).toMatch(/^\//);
      expect(card.label.length, card.id).toBeGreaterThan(5);
    }

    const ids = conformidade.map((c) => c.id);
    expect(
      ids.some((id) =>
        [
          "documentos",
          "riscos_sem_avaliacao",
          "avaliacoes_vencidas",
          "funcoes_sem_ordem",
          "sem_aep",
          "sem_emergencia",
        ].includes(id),
      ),
    ).toBe(true);
  });

  it("o fiscal abre o painel e vê a conformidade, sem nada na mesa", async () => {
    const doFiscal = await painel(fiscal.token);
    expect(doFiscal.compliance).not.toBeNull();
    expect(doFiscal.desk).toEqual([]);
    expect(doFiscal.first_steps).toBeNull();
  });
});

describe("o que vence agora [S6-B]", () => {
  it("exame com vencimento próximo aparece para quem cuida de saúde", async () => {
    const vence = new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10);
    const criado = await request(app)
      .post("/api/occupational-exams")
      .set(as(rh.token))
      .send({ user_id: colaborador.user.id, kind: "PERIODIC", due_at: vence });
    expect(criado.status).toBe(201);

    const doRh = await painel(rh.token);
    const card = acha(doRh.expiring, "exames");
    expect(card?.count).toBeGreaterThanOrEqual(1);
    expect(card?.detail).toMatch(/vence/);
    expect(card?.label).toMatch(/Exames ocupacionais/);

    // O colaborador vê o dele, com o rótulo na primeira pessoa.
    const doColaborador = await painel(colaborador.token);
    const meu = acha(doColaborador.expiring, "exames");
    expect(meu?.label).toMatch(/^Seus exames/);
  });
});

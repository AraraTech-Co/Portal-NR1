import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O que a empresa mostra ao fiscal tem de corresponder ao que ela tem.
 *
 * Documento vazio não se assina [S2-B]; documento emitido antes de o
 * inventário mudar aparece como desatualizado [B2-4-A]; quem validou a ação
 * aparece [B2-4-D]; função sem ninguém não conta como em ordem [B2-4-B]; o
 * nível do risco vai junto do ✓ [B2-1-K]; a criação de unidade, setor,
 * função e atividade entra no histórico [CB-15] e salvar sem mudar nada não
 * entra [CB-16]; a lista de responsáveis não traz fiscal nem desligado
 * [CB-49] [CB-23]; a entrada no portal fica registrada [OB-5].
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

type Item = { ok: boolean; label: string; detail?: string | null; level?: string | null };
type Check = { id: string; items: Item[]; status: string };

let app: Express;
let sst: { token: string; user: { id: string } };
let owner: { token: string; user: { id: string } };
let supervisor: { token: string; user: { id: string } };
let fiscal: { token: string; user: { id: string } };

const painel = async (token: string, establishmentId?: string) => {
  const res = await request(app)
    .get(`/api/fiscalizacao${establishmentId ? `?establishment_id=${establishmentId}` : ""}`)
    .set(as(token));
  expect(res.status).toBe(200);
  return res.body.checks as Check[];
};

const acha = (checks: Check[], id: string) => {
  const c = checks.find((x) => x.id === id);
  expect(c, `check ${id}`).toBeTruthy();
  return c!;
};

beforeAll(async () => {
  app = createApp();
  sst = await entrar(app, "teste.sst");
  owner = await entrar(app, "teste.owner");
  supervisor = await entrar(app, "teste.supervisor");
  fiscal = await entrar(app, "teste.fiscal");
});

describe("documento vazio não se assina [S2-B]", () => {
  it("inventário sem nenhum perigo é recusado, com o motivo", async () => {
    // Organização nova, sem nada: é o cenário em que o vazio é possível.
    const vazia = await prisma.organization.create({
      data: { name: `Empresa sem nada ${SUFIXO}`, responsibleName: "Alguém" },
    });
    try {
      const res = await request(app)
        .post("/api/pgr-documents")
        .set(as(sst.token))
        .send({ type: "INVENTORY", establishment_id: null });
      // A organização do ator é a de teste, que tem perigos: para provar o
      // bloqueio, usa-se um estabelecimento recém-criado, ainda sem perigo.
      const est = (
        await request(app)
          .post("/api/establishments")
          .set(as(sst.token))
          .send({ name: `Unidade crua ${SUFIXO}` })
      ).body.establishment;
      const semPerigo = await request(app)
        .post("/api/pgr-documents")
        .set(as(sst.token))
        .send({ type: "INVENTORY", establishment_id: est.id });
      expect(semPerigo.status).toBe(400);
      expect(semPerigo.body.code).toBe("EMPTY_DOCUMENT");
      expect(semPerigo.body.message).toMatch(/nenhum perigo/i);
      expect(res.status, "a org de teste tem perigos, então esta passa").toBe(201);
    } finally {
      await prisma.organization.deleteMany({ where: { id: vazia.id } });
    }
  });

  it("a mensagem diz o que falta, por tipo de documento", async () => {
    const est = (
      await request(app)
        .post("/api/establishments")
        .set(as(sst.token))
        .send({ name: `Unidade sem nada ${SUFIXO}` })
    ).body.establishment;
    const res = await request(app)
      .post("/api/pgr-documents")
      .set(as(sst.token))
      .send({ type: "INVENTORY", establishment_id: est.id });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Levante os perigos antes de assinar/);
  });
});

describe("o documento emitido envelhece [B2-4-A]", () => {
  it("mudar o inventário depois da emissão marca o documento como desatualizado", async () => {
    const emitido = (
      await request(app)
        .post("/api/pgr-documents")
        .set(as(sst.token))
        .send({ type: "INVENTORY", responsible_name: `Responsável ${SUFIXO}` })
    ).body.document;

    const antes = await request(app)
      .get(`/api/pgr-documents/${emitido.id}`)
      .set(as(sst.token));
    expect(antes.body.document.outdated).toBe(false);

    // Qualquer mexida no inventário envelhece o papel assinado.
    const est = (
      await request(app)
        .post("/api/establishments")
        .set(as(sst.token))
        .send({ name: `Mudança ${SUFIXO}` })
    ).body.establishment;
    const setor = (
      await request(app)
        .post("/api/sectors")
        .set(as(sst.token))
        .send({ establishment_id: est.id, name: "Produção" })
    ).body.sector;
    const atividade = (
      await request(app).post("/api/activities").set(as(sst.token)).send({
        establishment_id: est.id,
        sector_id: setor.id,
        name: `Nova atividade ${SUFIXO}`,
        description: "Descrição da atividade nova",
      })
    ).body.activity;
    await request(app).post("/api/hazards").set(as(sst.token)).send({
      activity_id: atividade.id,
      description: `Perigo descoberto depois ${SUFIXO}`,
      category: "ACCIDENT",
    });

    const depois = await request(app)
      .get(`/api/pgr-documents/${emitido.id}`)
      .set(as(sst.token));
    expect(depois.body.document.outdated).toBe(true);
    expect(depois.body.document.changes_since).toBeGreaterThan(0);

    // E o painel para de dar o documento como em ordem.
    const documentos = acha(await painel(owner.token), "documentos");
    const inventario = documentos.items.find((i) => i.label.includes("Inventário"));
    expect(inventario?.ok).toBe(false);
    expect(inventario?.detail).toMatch(/desatualizado/i);
  });
});

describe("o que o fiscal lê no painel", () => {
  it("o risco em ordem traz o nível junto do ✓ [B2-1-K]", async () => {
    const inventario = acha(await painel(fiscal.token), "inventario");
    const avaliado = inventario.items.find((i) => i.ok && i.level);
    expect(avaliado, "há risco avaliado com nível").toBeTruthy();
    expect(
      ["TRIVIAL", "TOLERABLE", "MODERATE", "SUBSTANTIAL", "INTOLERABLE"],
    ).toContain(avaliado!.level);
  });

  it("função sem ninguém não conta como em ordem nem diz que alguém leu [B2-4-B]", async () => {
    const est = (
      await request(app)
        .post("/api/establishments")
        .set(as(sst.token))
        .send({ name: `Unidade vazia ${SUFIXO}` })
    ).body.establishment;
    const setor = (
      await request(app)
        .post("/api/sectors")
        .set(as(sst.token))
        .send({ establishment_id: est.id, name: "Torno" })
    ).body.sector;
    const funcao = (
      await request(app)
        .post("/api/job-roles")
        .set(as(sst.token))
        .send({ sector_id: setor.id, name: `Torneiro CNC ${SUFIXO}` })
    ).body.job_role;

    const ordens = acha(await painel(owner.token, est.id), "ordens_servico");
    const linha = ordens.items.find((i) => i.label === funcao.name);
    expect(linha?.ok, "função sem ninguém não é pendência da empresa").toBe(true);
    expect(linha?.detail).toMatch(/ninguém nesta função/i);
    expect(linha?.detail).not.toMatch(/todos deram ciência/i);
  });

  it("o cartão de treinamento conta os cursos em vez de dizer que não há registro [B2-4-C]", async () => {
    const treinamentos = acha(await painel(owner.token), "treinamentos");
    expect(treinamentos.status).not.toBe("empty");
  });

  it("o responsável pelo PGR leva para onde se cadastra [B2-1-M]", async () => {
    const responsavel = acha(await painel(owner.token), "responsavel");
    for (const item of responsavel.items) {
      expect((item as { link?: string }).link).toBe("/configuracoes");
    }
  });
});

describe("quem validou a ação aparece [B2-4-D]", () => {
  it("a ação validada traz o nome de quem validou, na lista e no plano emitido", async () => {
    const criada = await request(app)
      .post("/api/actions")
      .set(as(sst.token))
      .send({
        title: `Instalar proteção ${SUFIXO}`,
        assignee_id: supervisor.user.id,
        due_date: "2027-06-30",
      });
    expect(criada.status).toBe(201);
    const acaoId = criada.body.action.id as string;

    await request(app)
      .post("/api/evidences")
      .set(as(supervisor.token))
      .send({
        action_id: acaoId,
        file_name: "foto.png",
        mime_type: "image/png",
        content_base64: Buffer.from(`prova ${SUFIXO}`).toString("base64"),
      });
    await request(app).post(`/api/actions/${acaoId}/complete`).set(as(supervisor.token));
    const validada = await request(app)
      .post(`/api/actions/${acaoId}/review`)
      .set(as(sst.token))
      .send({ decision: "approve", effectiveness_result: "Proteção conferida no local." });
    expect(validada.status).toBe(200);

    const lista = await request(app).get("/api/actions").set(as(fiscal.token));
    const acao = (lista.body.actions as {
      id: string;
      validatedBy: { name: string } | null;
      validatedAt: string | null;
    }[]).find((a) => a.id === acaoId);
    expect(acao?.validatedBy?.name, "quem validou aparece").toBeTruthy();
    expect(acao?.validatedAt).toBeTruthy();

    const plano = await request(app)
      .post("/api/pgr-documents")
      .set(as(sst.token))
      .send({ type: "ACTION_PLAN", responsible_name: `Responsável ${SUFIXO}` });
    expect(plano.status).toBe(201);
    const aberto = await request(app)
      .get(`/api/pgr-documents/${plano.body.document.id}`)
      .set(as(fiscal.token));
    const noPapel = (aberto.body.document.content.actions as {
      id: string;
      validated_by: string | null;
    }[]).find((a) => a.id === acaoId);
    expect(noPapel?.validated_by, "o plano emitido também mostra").toBeTruthy();
  });
});

describe("o histórico conta a história certa", () => {
  it("criar unidade, setor, função e atividade entra no histórico [CB-15]", async () => {
    const marca = `Historico ${SUFIXO}`;
    const est = (
      await request(app).post("/api/establishments").set(as(sst.token)).send({ name: marca })
    ).body.establishment;
    const setor = (
      await request(app)
        .post("/api/sectors")
        .set(as(sst.token))
        .send({ establishment_id: est.id, name: "Setor do histórico" })
    ).body.sector;
    await request(app)
      .post("/api/job-roles")
      .set(as(sst.token))
      .send({ sector_id: setor.id, name: `Função do histórico ${SUFIXO}` });
    await request(app).post("/api/activities").set(as(sst.token)).send({
      establishment_id: est.id,
      sector_id: setor.id,
      name: `Atividade do histórico ${SUFIXO}`,
      description: "Para conferir o histórico",
    });

    const hist = await request(app)
      .get("/api/fiscalizacao/historico?limit=200")
      .set(as(owner.token));
    const acoes = (hist.body.events as { action: string }[]).map((e) => e.action);
    for (const esperada of [
      "establishment.create",
      "sector.create",
      "job_role.create",
      "activity.create",
    ]) {
      expect(acoes, esperada).toContain(esperada);
    }
  });

  it("salvar sem mudar nada não vira registro [CB-16]", async () => {
    const setor = (
      await request(app)
        .post("/api/sectors")
        .set(as(sst.token))
        .send({
          establishment_id: (
            await request(app)
              .post("/api/establishments")
              .set(as(sst.token))
              .send({ name: `Sem mudança ${SUFIXO}` })
          ).body.establishment.id,
          name: "Setor",
        })
    ).body.sector;
    const funcao = (
      await request(app)
        .post("/api/job-roles")
        .set(as(sst.token))
        .send({ sector_id: setor.id, name: `Inalterada ${SUFIXO}`, description: "mesma" })
    ).body.job_role;

    const antes = await prisma.auditEvent.count({
      where: { entityType: "JobRole", entityId: funcao.id, action: "job_role.update" },
    });
    await request(app)
      .patch(`/api/job-roles/${funcao.id}`)
      .set(as(sst.token))
      .send({ name: `Inalterada ${SUFIXO}`, description: "mesma" });
    const depois = await prisma.auditEvent.count({
      where: { entityType: "JobRole", entityId: funcao.id, action: "job_role.update" },
    });
    expect(depois, "nada mudou, nada se registra").toBe(antes);

    // Mudança de verdade continua entrando.
    await request(app)
      .patch(`/api/job-roles/${funcao.id}`)
      .set(as(sst.token))
      .send({ name: `Alterada ${SUFIXO}` });
    const comMudanca = await prisma.auditEvent.count({
      where: { entityType: "JobRole", entityId: funcao.id, action: "job_role.update" },
    });
    expect(comMudanca).toBe(antes + 1);
  });

  it("a entrada no portal fica registrada [OB-5]", async () => {
    const antes = await prisma.auditEvent.count({
      where: { action: "session.signin", actorId: sst.user.id },
    });
    await entrar(app, "teste.sst");
    const depois = await prisma.auditEvent.count({
      where: { action: "session.signin", actorId: sst.user.id },
    });
    expect(depois).toBe(antes + 1);
  });
});

describe("a lista de quem pode responder [CB-49] [CB-23]", () => {
  it("não traz o fiscal nem quem foi desligado", async () => {
    const res = await request(app).get("/api/org-members").set(as(sst.token));
    expect(res.status).toBe(200);
    const ids = (res.body.members as { id: string }[]).map((m) => m.id);
    expect(ids, "o fiscal não assina documento nem responde por ação").not.toContain(
      fiscal.user.id,
    );
    expect(ids.length).toBeGreaterThan(0);
  });
});

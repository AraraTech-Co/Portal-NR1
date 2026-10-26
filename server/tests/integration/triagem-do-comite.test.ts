import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * O comitê de ética: quem entra nele, e o caso que não pode passar por ele.
 *
 * - Designar quem não tem o módulo do comitê punha a pessoa na lista sem que
 *   ela abrisse denúncia nenhuma; e tirar o último que abre deixava as
 *   denúncias sem ninguém, em silêncio. [CB-62]
 * - A contagem de denúncias do Início era de todas as da empresa: quem foi
 *   tirado do caso via "2 em aberto" e encontrava uma só na lista — o número
 *   revelava a existência de um caso que ela não pode abrir. [CB-68]
 * - A denúncia contra alguém do comitê chegava a essa pessoa junto com todo
 *   o comitê. Pela decisão B3-3-H, o canal pergunta se alguém do comitê está
 *   envolvido, sem mostrar nomes; quando sim, o caso vai a quem é dono da
 *   conta e só volta ao comitê depois da triagem. [B3-3-H]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let master: { token: string; user: { id: string } };
let owner: { token: string; user: { id: string } };
let rh: { token: string; user: { id: string } };
let sst: { token: string; user: { id: string } };

const relatos: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

/** Uma denúncia pelo canal público, anônima. */
async function relatar(opts: { envolveComite: boolean; texto: string }) {
  const res = await request(app).post("/api/ethics-reports").send({
    organization_id: ORG_ID,
    category: "HARASSMENT_MORAL",
    description: opts.texto,
    is_anonymous: true,
    committee_involved: opts.envolveComite,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  relatos.push(res.body.report.id);
  return res.body.report as { id: string; protocol: string };
}

const lista = async (token: string) => {
  const res = await request(app).get("/api/ethics-reports").set(as(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.reports as Array<{ id: string; protocol: string }>;
};

/** Quantas denúncias em aberto o Início daquela pessoa diz haver. */
async function contagemDoInicio(token: string): Promise<number> {
  const res = await request(app).get("/api/inicio").set(as(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const card = (res.body.desk as Array<{ id: string; count: number }>).find(
    (c) => c.id === "denuncias",
  );
  return card?.count ?? 0;
}

const designar = (quem: string, member: boolean) =>
  request(app)
    .post("/api/ethics-committee")
    .set(as(master.token))
    .send({ user_id: quem, member });

beforeAll(async () => {
  app = createApp();
  master = await entrar("teste.master");
  owner = await entrar("teste.owner");
  rh = await entrar("teste.rh");
  sst = await entrar("teste.sst");
  await prisma.ethicsCommitteeMember.deleteMany({ where: { organizationId: ORG_ID } });
});

afterAll(async () => {
  await prisma.ethicsCommitteeMember.deleteMany({ where: { organizationId: ORG_ID } });
  await prisma.notification.deleteMany({ where: { entityId: { in: relatos } } });
  await prisma.ethicsReportCited.deleteMany({ where: { reportId: { in: relatos } } });
  await prisma.ethicsReportMessage.deleteMany({ where: { reportId: { in: relatos } } });
  await prisma.ethicsReport.deleteMany({ where: { id: { in: relatos } } });
});

describe("só entra no comitê quem abre as denúncias [CB-62]", () => {
  it("designar quem não tem o módulo é recusado, com o que fazer", async () => {
    const res = await designar(sst.user.id, true);
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.message).toContain("não tem acesso ao módulo do comitê");
    expect(res.body.message, "diz o que resolve").toContain("papel");

    const depois = await prisma.ethicsCommitteeMember.findFirst({
      where: { organizationId: ORG_ID, userId: sst.user.id },
    });
    expect(depois, "não entrou na lista").toBeNull();
  });

  it("a lista de quem dá para designar traz só quem abre as denúncias", async () => {
    const res = await request(app).get("/api/ethics-committee").set(as(master.token));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ids = (res.body.people as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toContain(rh.user.id);
    expect(ids).toContain(owner.user.id);
    expect(ids, "o SST não tem o módulo do comitê").not.toContain(sst.user.id);
  });

  it("tirar o último que abre as denúncias é recusado", async () => {
    expect((await designar(rh.user.id, true)).status).toBe(200);
    expect((await designar(owner.user.id, true)).status).toBe(200);

    /*
      Com dois designados, tirar um é normal — o outro continua abrindo.
      O que não pode é a lista ficar sem ninguém que abra.
    */
    expect((await designar(owner.user.id, false)).status).toBe(200);

    const sozinho = await designar(rh.user.id, false);
    expect(sozinho.status, JSON.stringify(sozinho.body)).toBe(200);
    /*
      Voltar a zero designados é permitido: é a volta à regra antiga (quem
      tem o módulo), que a própria tela anuncia. O que o CB-62 impede é
      sobrar gente na lista sem ninguém que abra.
    */
    const vazio = await request(app).get("/api/ethics-committee").set(as(master.token));
    expect(vazio.body.falling_back).toBe(true);
  });

  it("a lista marca quem está designado e não abre as denúncias", async () => {
    await designar(rh.user.id, true);
    /* Designação antiga, feita quando a regra não existia. */
    await prisma.ethicsCommitteeMember.create({
      data: { organizationId: ORG_ID, userId: sst.user.id, addedById: master.user.id },
    });

    const res = await request(app).get("/api/ethics-committee").set(as(master.token));
    const porId = new Map(
      (res.body.members as Array<{ userId: string; can_open: boolean }>).map((m) => [
        m.userId,
        m.can_open,
      ]),
    );
    expect(porId.get(rh.user.id)).toBe(true);
    expect(porId.get(sst.user.id), "está na lista e não abre nada").toBe(false);

    const tirar = await designar(rh.user.id, false);
    expect(tirar.status, "sobraria só quem não abre").toBe(400);
    expect(tirar.body.message).toContain("sem ninguém");

    await prisma.ethicsCommitteeMember.deleteMany({
      where: { organizationId: ORG_ID, userId: sst.user.id },
    });
  });
});

describe("a denúncia contra alguém do comitê não passa pelo comitê [B3-3-H]", () => {
  it("vai a quem tria, some do comitê e volta depois da triagem", async () => {
    await prisma.ethicsCommitteeMember.deleteMany({ where: { organizationId: ORG_ID } });
    expect((await designar(rh.user.id, true)).status).toBe(200);

    const relato = await relatar({
      envolveComite: true,
      texto: `Assédio praticado por alguém do próprio comitê ${SUFIXO}.`,
    });

    /* O comitê não soube que existe: nem aviso, nem lista, nem endereço. */
    const avisoDoRh = await prisma.notification.findFirst({
      where: { userId: rh.user.id, entityId: relato.id },
    });
    expect(avisoDoRh, "o comitê não é avisado antes da triagem").toBeNull();

    const doRh = await lista(rh.token);
    expect(doRh.some((r) => r.id === relato.id)).toBe(false);

    const direto = await request(app)
      .get(`/api/ethics-reports/${relato.id}`)
      .set(as(rh.token));
    expect(direto.status, "nem pelo endereço direto").toBe(404);

    expect(await contagemDoInicio(rh.token)).toBe(
      (await lista(rh.token)).filter((r) =>
        ["RECEIVED", "IN_ANALYSIS"].includes(
          (r as { status?: string }).status ?? "RECEIVED",
        ),
      ).length,
    );

    /* Quem tria soube, e vê o caso. */
    const avisoDoDono = await prisma.notification.findFirst({
      where: { userId: owner.user.id, entityId: relato.id },
    });
    expect(avisoDoDono, "o dono da conta é avisado").toBeTruthy();
    expect(avisoDoDono?.title).toContain("triagem");
    expect(avisoDoDono?.body, "o protocolo, para achar o caso").toContain(
      relato.protocol,
    );

    const doDono = await request(app)
      .get(`/api/ethics-reports/${relato.id}`)
      .set(as(owner.token));
    expect(doDono.status, JSON.stringify(doDono.body)).toBe(200);
    expect(doDono.body.report.committeeInvolved).toBe(true);
    expect(doDono.body.report.triagedAt).toBeNull();

    /* A triagem: marca quem o caso envolve e devolve ao comitê. */
    const marcar = await request(app)
      .post(`/api/ethics-reports/${relato.id}/citados`)
      .set(as(owner.token))
      .send({ user_id: rh.user.id, cited: true });
    expect(marcar.status, JSON.stringify(marcar.body)).toBe(200);

    const devolver = await request(app)
      .post(`/api/ethics-reports/${relato.id}/triagem`)
      .set(as(owner.token));
    expect(devolver.status, JSON.stringify(devolver.body)).toBe(200);

    /* O citado continua fora: a triagem não o traz de volta. */
    expect((await lista(rh.token)).some((r) => r.id === relato.id)).toBe(false);
    const aindaNao = await prisma.notification.findFirst({
      where: { userId: rh.user.id, entityId: relato.id },
    });
    expect(aindaNao, "o citado não é avisado da devolução").toBeNull();

    /* E quem não foi citado passa a ver. */
    expect((await designar(master.user.id, true)).status).toBe(200);
    const segundo = await relatar({
      envolveComite: true,
      texto: `Outro caso que diz envolver o comitê ${SUFIXO}.`,
    });
    await request(app).post(`/api/ethics-reports/${segundo.id}/triagem`).set(as(owner.token));
    expect((await lista(master.token)).some((r) => r.id === segundo.id)).toBe(true);
    const avisoDepois = await prisma.notification.findFirst({
      where: { userId: master.user.id, entityId: segundo.id },
    });
    expect(avisoDepois?.title, "agora sim o comitê é avisado").toBe(
      "Denúncia nova no canal",
    );
  });

  it("a denúncia comum segue indo ao comitê na hora", async () => {
    await prisma.ethicsCommitteeMember.deleteMany({ where: { organizationId: ORG_ID } });
    expect((await designar(rh.user.id, true)).status).toBe(200);
    /* O dono designado, para alcançar o caso e tentar triá-lo. */
    expect((await designar(owner.user.id, true)).status).toBe(200);

    const relato = await relatar({
      envolveComite: false,
      texto: `Caso comum, sem ninguém do comitê envolvido ${SUFIXO}.`,
    });

    expect((await lista(rh.token)).some((r) => r.id === relato.id)).toBe(true);
    const aviso = await prisma.notification.findFirst({
      where: { userId: rh.user.id, entityId: relato.id },
    });
    expect(aviso?.title).toBe("Denúncia nova no canal");

    const triar = await request(app)
      .post(`/api/ethics-reports/${relato.id}/triagem`)
      .set(as(owner.token));
    expect(triar.status, "não há o que triar num caso que já é do comitê").toBe(400);
    expect(triar.body.message).toContain("não passou pela triagem");
  });

  it("quem tria e não é do comitê alcança a triagem, e só ela", async () => {
    await prisma.ethicsCommitteeMember.deleteMany({ where: { organizationId: ORG_ID } });
    expect((await designar(rh.user.id, true)).status).toBe(200);

    const comum = await relatar({
      envolveComite: false,
      texto: `Caso comum, fora do alcance de quem só tria ${SUFIXO}.`,
    });
    const naTriagem = await relatar({
      envolveComite: true,
      texto: `Caso de triagem, dentro do alcance de quem tria ${SUFIXO}.`,
    });

    /*
      O dono não designado não herda o acervo do comitê: a decisão lhe deu a
      triagem, e nada além dela. [B3-3-H]
    */
    const doDono = await lista(owner.token);
    expect(doDono.some((r) => r.id === naTriagem.id)).toBe(true);
    expect(doDono.some((r) => r.id === comum.id)).toBe(false);
    const direto = await request(app)
      .get(`/api/ethics-reports/${comum.id}`)
      .set(as(owner.token));
    expect(direto.status).toBe(404);
  });

  it("quem é do comitê e não tria não devolve o caso", async () => {
    await prisma.ethicsCommitteeMember.deleteMany({ where: { organizationId: ORG_ID } });
    expect((await designar(rh.user.id, true)).status).toBe(200);

    const relato = await relatar({
      envolveComite: true,
      texto: `Caso para ver quem pode devolver ${SUFIXO}.`,
    });
    const res = await request(app)
      .post(`/api/ethics-reports/${relato.id}/triagem`)
      .set(as(rh.token));
    expect(res.status, "o RH do comitê nem enxerga o caso").toBe(404);
  });
});

describe("o Início conta o que a pessoa pode abrir [CB-68]", () => {
  it("quem foi tirado do caso não o vê contado", async () => {
    await prisma.ethicsCommitteeMember.deleteMany({ where: { organizationId: ORG_ID } });
    expect((await designar(rh.user.id, true)).status).toBe(200);
    expect((await designar(master.user.id, true)).status).toBe(200);

    const relato = await relatar({
      envolveComite: false,
      texto: `Caso em que o RH é citado ${SUFIXO}.`,
    });

    const antes = await contagemDoInicio(rh.token);
    const marcar = await request(app)
      .post(`/api/ethics-reports/${relato.id}/citados`)
      .set(as(master.token))
      .send({ user_id: rh.user.id, cited: true });
    expect(marcar.status, JSON.stringify(marcar.body)).toBe(200);

    const depois = await contagemDoInicio(rh.token);
    expect(depois, "o caso sai da conta de quem ele cita").toBe(antes - 1);

    /* E a conta é exatamente o que a lista dele mostra em aberto. */
    const abertas = (
      await lista(rh.token)
    ).filter((r) =>
      ["RECEIVED", "IN_ANALYSIS"].includes((r as { status: string }).status),
    ).length;
    expect(depois).toBe(abertas);

    /* Para quem não foi citado, o caso continua contado. */
    const doMaster = (await lista(master.token)).some((r) => r.id === relato.id);
    expect(doMaster).toBe(true);
  });
});

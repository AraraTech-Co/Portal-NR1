import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { Role } from "@prisma/client";
import type { Express } from "express";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";

/**
 * Seis fatos ainda aconteciam sem aviso nenhum — e quem precisava agir só
 * descobria entrando na tela certa por conta própria:
 *
 * - ganhar pontos e pedir um prêmio (o saldo mudava em silêncio, e o resgate
 *   ficava parado até alguém do RH abrir a Gamificação); [B3-3-F]
 * - a decisão do pedido de férias ou licença, que não chegava a quem pediu;
 *   [B3-3-I]
 * - a convocação, que é obrigação com data; [CB-29]
 * - a denúncia nova, que ficava esperando o comitê olhar; [CB-29]
 * - o pedido de entrada, com a pessoa esperando do lado de fora. [CB-53]
 *
 * E o aviso de uma unidade só não alcançava quem não tem função registrada
 * — SST, RH, gerente, dono: o portal não sabe a que unidade essas pessoas
 * atendem, e ficar de fora é pior que receber a mais. [CB-60]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const ACCOUNT_ID = "aaaaaaaa-0001-4000-8000-000000000002";
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let master: { token: string; user: { id: string } };
let rh: { token: string; user: { id: string } };
let sst: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };

const premios: string[] = [];
const convocacoes: string[] = [];
const relatos: string[] = [];
const links: string[] = [];
const pedidosDeEntrada: string[] = [];
const unidades: string[] = [];
const avisosDoMural: string[] = [];
const usuariosCriados: string[] = [];

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

/** Os avisos daquela pessoa, de um tipo só. */
const avisos = async (userId: string, kind: string) =>
  prisma.notification.findMany({
    where: { userId, kind: kind as never },
    orderBy: { createdAt: "desc" },
  });

/** Os cartões de "Esperando a sua decisão" no Início de quem abriu. */
async function mesa(token: string) {
  const res = await request(app).get("/api/inicio").set(as(token));
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body.desk as { id: string; count: number; link: string }[];
}

/** Um colaborador sem ficha: não há como saber a que unidade ele pertence. */
async function colaboradorSemFuncao() {
  const login = `semfuncao.${SUFIXO}`;
  const user = await prisma.user.create({
    data: {
      login,
      email: `${login}@teste.local`,
      name: `Sem Função ${SUFIXO}`,
      passwordHash: await bcrypt.hash(SENHA, 10),
      mustChangePassword: false,
    },
  });
  usuariosCriados.push(user.id);
  await prisma.membership.create({
    data: { userId: user.id, organizationId: ORG_ID, role: Role.COLABORADOR },
  });
  await prisma.accountMembership.create({
    data: { accountId: ACCOUNT_ID, userId: user.id, role: "USER" },
  });
  return user.id;
}

beforeAll(async () => {
  app = createApp();
  master = await entrar("teste.master");
  rh = await entrar("teste.rh");
  sst = await entrar("teste.sst");
  colaborador = await entrar("teste.colaborador");
});

afterAll(async () => {
  await prisma.notification.deleteMany({
    where: {
      OR: [
        { entityType: "PointEntry" },
        { entityType: "RewardRedemption" },
        { entityId: { in: convocacoes } },
        { entityId: { in: relatos } },
        { entityId: { in: avisosDoMural } },
      ],
    },
  });
  await prisma.rewardRedemption.deleteMany({ where: { rewardId: { in: premios } } });
  await prisma.pointEntry.deleteMany({
    where: { organizationId: ORG_ID, activity: { contains: SUFIXO } },
  });
  await prisma.pointEntry.deleteMany({
    where: {
      organizationId: ORG_ID,
      OR: premios.map((id) => ({ activity: { contains: id } })),
    },
  });
  await prisma.reward.deleteMany({ where: { id: { in: premios } } });
  await prisma.summonAttendance.deleteMany({ where: { summonId: { in: convocacoes } } });
  await prisma.summon.deleteMany({ where: { id: { in: convocacoes } } });
  await prisma.ethicsCommitteeMember.deleteMany({ where: { organizationId: ORG_ID } });
  await prisma.ethicsReportMessage.deleteMany({ where: { reportId: { in: relatos } } });
  await prisma.ethicsReport.deleteMany({ where: { id: { in: relatos } } });
  await prisma.accountJoinRequest.deleteMany({ where: { id: { in: pedidosDeEntrada } } });
  await prisma.accountInviteLink.deleteMany({ where: { id: { in: links } } });
  await prisma.announcementEstablishment.deleteMany({
    where: { announcementId: { in: avisosDoMural } },
  });
  await prisma.announcement.deleteMany({ where: { id: { in: avisosDoMural } } });
  await prisma.establishment.deleteMany({ where: { id: { in: unidades } } });
  await prisma.employeeProfile.deleteMany({ where: { userId: { in: usuariosCriados } } });
  await prisma.membership.deleteMany({ where: { userId: { in: usuariosCriados } } });
  await prisma.accountMembership.deleteMany({ where: { userId: { in: usuariosCriados } } });
  await prisma.user.deleteMany({ where: { id: { in: usuariosCriados } } });
});

describe("pontos e resgate avisam [B3-3-F]", () => {
  it("quem ganha pontos é avisado; quem lançou, não", async () => {
    const atividade = `Quase-acidente relatado ${SUFIXO}`;
    const res = await request(app)
      .post("/api/point-entries")
      .set(as(rh.token))
      .send({ user_id: colaborador.user.id, activity: atividade, points: 30 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const doColaborador = await avisos(colaborador.user.id, "POINTS_GRANTED");
    const meu = doColaborador.find((n) => n.body === atividade);
    expect(meu, "o colaborador soube que ganhou").toBeTruthy();
    expect(meu?.title, "quantos pontos").toContain("30");
    expect(meu?.link).toBe("/gamificacao");

    const doRh = await avisos(rh.user.id, "POINTS_GRANTED");
    expect(
      doRh.some((n) => n.body === atividade),
      "quem lançou não precisa ser avisado do próprio lançamento",
    ).toBe(false);
  });

  it("o resgate pedido avisa quem entrega e entra na mesa do RH", async () => {
    const premio = await request(app)
      .post("/api/rewards")
      .set(as(rh.token))
      .send({ name: `Vale-livro ${SUFIXO}`, cost: 10, stock: 2 });
    expect(premio.status, JSON.stringify(premio.body)).toBe(201);
    premios.push(premio.body.reward.id);

    await request(app)
      .post("/api/point-entries")
      .set(as(rh.token))
      .send({ user_id: colaborador.user.id, activity: `saldo ${SUFIXO}`, points: 10 });

    const resgate = await request(app)
      .post(`/api/rewards/${premio.body.reward.id}/redeem`)
      .set(as(colaborador.token));
    expect(resgate.status, JSON.stringify(resgate.body)).toBe(201);
    const resgateId = resgate.body.redemption.id as string;

    const doRh = await avisos(rh.user.id, "REWARD_REQUESTED");
    const aviso = doRh.find((n) => n.entityId === resgateId);
    expect(aviso, "quem cuida da gamificação soube do pedido").toBeTruthy();
    expect(aviso?.body, "qual prêmio").toContain(`Vale-livro ${SUFIXO}`);

    const doSst = await avisos(sst.user.id, "REWARD_REQUESTED");
    expect(
      doSst.some((n) => n.entityId === resgateId),
      "quem só lê o módulo não entrega prêmio",
    ).toBe(false);

    const cartoes = await mesa(rh.token);
    const naMesa = cartoes.find((c) => c.id === "resgates");
    expect(naMesa, "o resgate pedido aparece em Esperando a sua decisão").toBeTruthy();
    expect(naMesa!.count).toBeGreaterThan(0);
    expect(naMesa!.link).toBe("/gamificacao");
  });
});

describe("a decisão do pedido chega a quem pediu [B3-3-I]", () => {
  it("recusar avisa com o motivo; aprovar avisa que saiu", async () => {
    const pedido = await request(app)
      .post("/api/leaves")
      .set(as(colaborador.token))
      .send({ kind: "VACATION", start_date: "2027-03-01", end_date: "2027-03-10" });
    expect(pedido.status, JSON.stringify(pedido.body)).toBe(201);
    const pedidoId = pedido.body.leave.id as string;

    const motivo = `Equipe reduzida em março ${SUFIXO}`;
    const recusa = await request(app)
      .post(`/api/leaves/${pedidoId}/decide`)
      .set(as(rh.token))
      .send({ status: "REJECTED", decision_note: motivo });
    expect(recusa.status, JSON.stringify(recusa.body)).toBe(200);

    const caixa = await avisos(colaborador.user.id, "LEAVE_DECIDED");
    const aviso = caixa.find((n) => n.entityId === pedidoId);
    expect(aviso, "quem pediu soube da decisão").toBeTruthy();
    expect(aviso?.title, "de que pedido se trata").toBe("Férias");
    expect(aviso?.body, "o motivo da recusa vai no aviso").toContain(motivo);
    expect(aviso?.link).toBe("/ferias");

    await prisma.leaveRequest.deleteMany({ where: { id: pedidoId } });
    await prisma.notification.deleteMany({ where: { entityId: pedidoId } });
  });

  it("aprovar avisa que saiu, com o tipo do pedido", async () => {
    const pedido = await request(app)
      .post("/api/leaves")
      .set(as(colaborador.token))
      .send({ kind: "LEAVE", start_date: "2027-04-01", end_date: "2027-04-03" });
    expect(pedido.status, JSON.stringify(pedido.body)).toBe(201);
    const pedidoId = pedido.body.leave.id as string;

    const ok = await request(app)
      .post(`/api/leaves/${pedidoId}/decide`)
      .set(as(rh.token))
      .send({ status: "APPROVED" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);

    const caixa = await avisos(colaborador.user.id, "LEAVE_DECIDED");
    const aviso = caixa.find((n) => n.entityId === pedidoId);
    expect(aviso?.title, "licença não é férias").toBe("Licença");
    expect(aviso?.body).toBe("Aprovado.");

    await prisma.leaveRequest.deleteMany({ where: { id: pedidoId } });
    await prisma.notification.deleteMany({ where: { entityId: pedidoId } });
  });

  it("recusar sem motivo nem decide nem avisa", async () => {
    const pedido = await request(app)
      .post("/api/leaves")
      .set(as(colaborador.token))
      .send({ kind: "DAY_OFF", start_date: "2027-05-04", end_date: "2027-05-04" });
    expect(pedido.status, JSON.stringify(pedido.body)).toBe(201);
    const pedidoId = pedido.body.leave.id as string;

    const semMotivo = await request(app)
      .post(`/api/leaves/${pedidoId}/decide`)
      .set(as(rh.token))
      .send({ status: "REJECTED" });
    expect(semMotivo.status, "o motivo da recusa é obrigatório").toBe(400);

    const caixa = await avisos(colaborador.user.id, "LEAVE_DECIDED");
    expect(
      caixa.some((n) => n.entityId === pedidoId),
      "sem decisão, sem aviso",
    ).toBe(false);

    await prisma.leaveRequest.deleteMany({ where: { id: pedidoId } });
  });
});

describe("a convocação chega a quem foi chamado [CB-29]", () => {
  it("criar a convocação avisa os convidados, com a data", async () => {
    const res = await request(app)
      .post("/api/summons")
      .set(as(rh.token))
      .send({
        title: `Reunião da CIPA ${SUFIXO}`,
        scheduled_for: "2027-06-15T13:00:00.000Z",
        location: "Sala 2",
        invitee_ids: [colaborador.user.id],
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    convocacoes.push(res.body.summon.id);

    const caixa = await avisos(colaborador.user.id, "SUMMON_OPENED");
    const aviso = caixa.find((n) => n.entityId === res.body.summon.id);
    expect(aviso, "quem foi convocado soube").toBeTruthy();
    expect(aviso?.body, "o assunto").toContain(`Reunião da CIPA ${SUFIXO}`);
    expect(aviso?.body, "a data, que é a obrigação").toContain("2027");
    expect(aviso?.link).toBe("/convocacoes");

    const doRh = await avisos(rh.user.id, "SUMMON_OPENED");
    expect(
      doRh.some((n) => n.entityId === res.body.summon.id),
      "quem convocou não se avisa",
    ).toBe(false);
  });

  it("convidar depois também avisa", async () => {
    const criada = await request(app)
      .post("/api/summons")
      .set(as(rh.token))
      .send({
        title: `Convocação avulsa ${SUFIXO}`,
        scheduled_for: "2027-07-20T13:00:00.000Z",
      });
    expect(criada.status).toBe(201);
    convocacoes.push(criada.body.summon.id);

    const convite = await request(app)
      .post(`/api/summons/${criada.body.summon.id}/invite`)
      .set(as(rh.token))
      .send({ user_ids: [colaborador.user.id] });
    expect(convite.status, JSON.stringify(convite.body)).toBe(201);

    const caixa = await avisos(colaborador.user.id, "SUMMON_OPENED");
    expect(caixa.some((n) => n.entityId === criada.body.summon.id)).toBe(true);
  });
});

describe("a denúncia nova chega ao comitê [CB-29]", () => {
  it("avisa quem foi designado, com o protocolo e sem dizer quem relatou", async () => {
    await prisma.ethicsCommitteeMember.create({
      data: { organizationId: ORG_ID, userId: sst.user.id, addedById: master.user.id },
    });

    const res = await request(app).post("/api/ethics-reports").send({
      organization_id: ORG_ID,
      category: "SAFETY_RISK",
      description: `Relato de fora do portal ${SUFIXO}, sem login nenhum.`,
      is_anonymous: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    relatos.push(res.body.report.id);
    const protocolo = res.body.report.protocol as string;

    const caixa = await avisos(sst.user.id, "ETHICS_REPORT_OPENED");
    const aviso = caixa.find((n) => n.entityId === res.body.report.id);
    expect(aviso, "o comitê designado soube").toBeTruthy();
    expect(aviso?.body, "o protocolo, para achar o relato").toContain(protocolo);
    expect(
      `${aviso?.title} ${aviso?.body}`,
      "o aviso não carrega o teor do relato",
    ).not.toContain(SUFIXO);
    expect(aviso?.link).toBe("/comite");

    const doRh = await avisos(rh.user.id, "ETHICS_REPORT_OPENED");
    expect(
      doRh.some((n) => n.entityId === res.body.report.id),
      "quem não foi designado não recebe a denúncia",
    ).toBe(false);
  });
});

describe("o pedido de entrada entra na mesa de quem aprova [CB-53]", () => {
  it("aparece em Esperando a sua decisão, e só para quem decide", async () => {
    const link = await request(app)
      .post("/api/invite-links")
      .set(as(master.token))
      .send({ label: `Convite ${SUFIXO}`, role_mode: "ON_APPROVE" });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    links.push(link.body.link.id);
    const token = link.body.link.path.split("/").pop() as string;

    const pedido = await request(app)
      .post(`/api/invites/${token}`)
      .send({ name: `Quem Espera ${SUFIXO}`, password: "senha-boa-123" });
    expect(pedido.status, JSON.stringify(pedido.body)).toBe(201);
    pedidosDeEntrada.push(pedido.body.request_id);

    const cartoes = await mesa(master.token);
    const naMesa = cartoes.find((c) => c.id === "pedidos_entrada");
    expect(naMesa, "quem aprova vê o pedido no Início").toBeTruthy();
    expect(naMesa!.count).toBeGreaterThan(0);
    /* Leva direto à parte dos pedidos em Conta e usuários. [B2-1-I] */
    expect(naMesa!.link).toBe("/conta?parte=entrada");

    const doColaborador = await mesa(colaborador.token);
    expect(
      doColaborador.some((c) => c.id === "pedidos_entrada"),
      "quem não decide não vê quem está entrando",
    ).toBe(false);
  });
});

describe("o aviso de uma unidade alcança quem não tem função [CB-60]", () => {
  it("chega ao SST sem ficha; não chega a colaborador de outra unidade", async () => {
    const semFuncao = await colaboradorSemFuncao();

    const unidade = await request(app)
      .post("/api/establishments")
      .set(as(sst.token))
      .send({ name: `Unidade do aviso ${SUFIXO}` });
    expect(unidade.status, JSON.stringify(unidade.body)).toBe(201);
    unidades.push(unidade.body.establishment.id);

    const titulo = `Parada da manutenção ${SUFIXO}`;
    const aviso = await request(app)
      .post("/api/announcements")
      .set(as(rh.token))
      .send({
        kind: "CAMPAIGN",
        title: titulo,
        body: "A unidade para às 14h.",
        establishment_ids: [unidade.body.establishment.id],
      });
    expect(aviso.status, JSON.stringify(aviso.body)).toBe(201);
    avisosDoMural.push(aviso.body.announcement.id);

    const doSst = await avisos(sst.user.id, "ANNOUNCEMENT_PUBLISHED");
    expect(
      doSst.some((n) => n.title === titulo),
      "o SST não tem função registrada: atende a empresa toda",
    ).toBe(true);

    const doColaborador = await avisos(colaborador.user.id, "ANNOUNCEMENT_PUBLISHED");
    expect(
      doColaborador.some((n) => n.title === titulo),
      "o colaborador tem função em outra unidade: não é com ele",
    ).toBe(false);

    const doSemFuncao = await avisos(semFuncao, "ANNOUNCEMENT_PUBLISHED");
    expect(
      doSemFuncao.some((n) => n.title === titulo),
      "colaborador sem ficha continua fora: a unidade dele vem da função",
    ).toBe(false);

    /* O mural tem de dizer o mesmo que o sino. [CB-60] */
    const mural = await request(app).get("/api/announcements").set(as(sst.token));
    expect(mural.status).toBe(200);
    expect(
      (mural.body.announcements as { title: string }[]).some((a) => a.title === titulo),
      "o que o sino avisa, o mural mostra",
    ).toBe(true);
  });
});

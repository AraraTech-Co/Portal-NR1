import { beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { Role } from "@prisma/client";
import { createApp } from "../../src/app";
import { assignableOrgRoles } from "../../src/helper/invite-access";
import type { Actor } from "../../src/types/auth";

/**
 * Papel de consulta para a fiscalização: vê o que a NR-1 pede, de todos;
 * não grava nada; o que abre fica registrado. [S7-A] [S7-G] [S5-J]
 *
 * Exige a organização do `scripts/seed-teste-org.ts` (com `teste.fiscal`).
 */
const SENHA = "teste1234";

async function entrar(app: Express, login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string; user: { id: string } };
}

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

let app: Express;
let fiscal: { token: string; user: { id: string } };
let rh: { token: string; user: { id: string } };
let owner: { token: string; user: { id: string } };
let colaborador: { token: string; user: { id: string } };

beforeAll(async () => {
  app = createApp();
  fiscal = await entrar(app, "teste.fiscal");
  rh = await entrar(app, "teste.rh");
  owner = await entrar(app, "teste.owner");
  colaborador = await entrar(app, "teste.colaborador");
});

describe("o que o fiscal vê", () => {
  it("a sessão traz só leitura, e só os módulos da fiscalização", async () => {
    const res = await request(app).get("/api/auth").set(as(fiscal.token));
    expect(res.status).toBe(200);
    const modules = res.body.user.modules as Record<string, string>;
    expect(Object.values(modules).every((l) => l === "read")).toBe(true);
    for (const m of ["documentos_pgr", "inventario", "acoes", "ocorrencias", "treinamentos", "saude"]) {
      expect(modules[m], m).toBe("read");
    }
    for (const m of ["atestados", "holerites", "denuncia", "comite", "clima", "ideias", "ponto", "ferias", "conta"]) {
      expect(modules[m], m).toBeUndefined();
    }
  });

  it("abre PGR, inventário, plano de ação e ocorrências", async () => {
    for (const path of ["/api/pgr-documents", "/api/inventory", "/api/actions", "/api/occurrences", "/api/aeps"]) {
      const res = await request(app).get(path).set(as(fiscal.token));
      expect(res.status, path).toBe(200);
    }
  });

  it("não entra em atestado, holerite, denúncia, clima, ideias nem ponto", async () => {
    for (const path of [
      "/api/medical-certificates",
      "/api/payslips",
      "/api/ethics-reports",
      "/api/climate-surveys",
      "/api/ideas",
      "/api/time-entries",
    ]) {
      const res = await request(app).get(path).set(as(fiscal.token));
      expect(res.status, path).toBe(403);
    }
  });

  it("vê os colaboradores sem CPF, telefone, login nem e-mail", async () => {
    const res = await request(app).get("/api/employee-profiles").set(as(fiscal.token));
    expect(res.status).toBe(200);
    const profiles = res.body.profiles as Record<string, unknown>[];
    expect(profiles.length).toBeGreaterThan(1);
    for (const p of profiles) {
      expect(p.taxId).toBeNull();
      expect(p.phone).toBeNull();
      expect(Object.keys(p.user as object).sort()).toEqual(["id", "name"]);
    }
  });

  it("vê quem fez o treinamento, com nota e certificado; o colaborador não", async () => {
    const created = await request(app)
      .post("/api/trainings")
      .set(as(rh.token))
      .send({
        title: "Uso de escada",
        validity_months: 12,
        slides: [{ title: "Intro", body: "Três pontos de apoio" }],
        questions: [{ prompt: "Quantos pontos de apoio?", options: ["Um", "Três"], correct_index: 1 }],
      });
    expect(created.status).toBe(201);
    const id = created.body.training.id as string;

    await request(app).post(`/api/trainings/${id}/enroll`).set(as(colaborador.token));
    await request(app).post(`/api/trainings/${id}/start`).set(as(colaborador.token));
    const detail = await request(app).get(`/api/trainings/${id}`).set(as(colaborador.token));
    const qid = detail.body.training.questions[0].id;
    const done = await request(app)
      .post(`/api/trainings/${id}/complete`)
      .set(as(colaborador.token))
      .send({ answers: [{ question_id: qid, index: 1 }] });
    expect(done.status).toBe(200);

    const lista = await request(app).get(`/api/trainings/${id}/enrollments`).set(as(fiscal.token));
    expect(lista.status).toBe(200);
    const feito = lista.body.enrollments.find(
      (e: { user: { id: string } }) => e.user.id === colaborador.user.id,
    );
    expect(feito.status).toBe("COMPLETED");
    expect(feito.score).toBe(100);
    expect(feito.certificateCode).toBeTruthy();

    const doRh = await request(app).get(`/api/trainings/${id}/enrollments`).set(as(rh.token));
    expect(doRh.status).toBe(200);

    const doColaborador = await request(app)
      .get(`/api/trainings/${id}/enrollments`)
      .set(as(colaborador.token));
    expect(doColaborador.status).toBe(403);
  });

  it("vê o prazo do exame de todos, sem apto/inapto e sem o arquivo", async () => {
    const exam = await request(app)
      .post("/api/occupational-exams")
      .set(as(rh.token))
      .send({ user_id: colaborador.user.id, kind: "PERIODIC", performed_at: "2026-09-01", fit: true });
    expect(exam.status).toBe(201);

    const res = await request(app).get("/api/occupational-exams").set(as(fiscal.token));
    expect(res.status).toBe(200);
    const doColaborador = (res.body.exams as { userId: string; fit: unknown; storagePath?: unknown; user: { name: string } }[])
      .filter((e) => e.userId === colaborador.user.id);
    expect(doColaborador.length).toBeGreaterThan(0);
    for (const e of doColaborador) {
      expect(e.fit).toBeNull();
      expect(e.storagePath).toBeUndefined();
      expect(e.user.name).toBeTruthy();
    }
  });

  it("vê documento geral e quem deu ciência; documento pessoal, não", async () => {
    const geral = await request(app)
      .post("/api/hr-documents")
      .set(as(rh.token))
      .send({ kind: "TERM", title: "Ordem de serviço de segurança — estoque", requires_ack: true, file_name: "os.pdf", mime_type: "application/pdf" });
    expect(geral.status).toBe(201);
    const pessoal = await request(app)
      .post("/api/hr-documents")
      .set(as(rh.token))
      .send({ kind: "WARNING", title: "Advertência", target_user_id: colaborador.user.id, file_name: "adv.pdf", mime_type: "application/pdf" });
    expect(pessoal.status).toBe(201);

    const ack = await request(app).post(`/api/hr-documents/${geral.body.document.id}/ack`).set(as(colaborador.token));
    expect(ack.status).toBe(200);

    const lista = await request(app).get("/api/hr-documents").set(as(fiscal.token));
    const ids = (lista.body.documents as { id: string }[]).map((d) => d.id);
    expect(ids).toContain(geral.body.document.id);
    expect(ids).not.toContain(pessoal.body.document.id);

    const aberto = await request(app).get(`/api/hr-documents/${geral.body.document.id}`).set(as(fiscal.token));
    expect(aberto.status).toBe(200);
    const quem = (aberto.body.document.acks as { userId: string; acknowledgedAt: string | null; user: { name: string } }[]);
    expect(quem.some((a) => a.userId === colaborador.user.id && a.acknowledgedAt)).toBe(true);
    // abrir não deixou "lido" em nome do fiscal
    expect(quem.some((a) => a.userId === fiscal.user.id)).toBe(false);

    const negado = await request(app).get(`/api/hr-documents/${pessoal.body.document.id}`).set(as(fiscal.token));
    expect(negado.status).toBe(403);
  });
});

describe("o fiscal não grava nada", () => {
  it("nem nas rotas que o colaborador usa para o próprio registro", async () => {
    const docs = await request(app).get("/api/hr-documents").set(as(fiscal.token));
    const docId = docs.body.documents[0].id as string;
    const trainings = await request(app).get("/api/trainings").set(as(fiscal.token));
    const trainingId = trainings.body.trainings[0].id as string;
    const me = await request(app).get("/api/employee-profiles").set(as(fiscal.token));
    const profileId = me.body.profiles[0].id as string;

    const tentativas = [
      request(app).post(`/api/hr-documents/${docId}/ack`).set(as(fiscal.token)),
      request(app).post(`/api/trainings/${trainingId}/enroll`).set(as(fiscal.token)),
      request(app).patch(`/api/employee-profiles/${profileId}`).set(as(fiscal.token)).send({ phone: "11999999999" }),
      request(app).post("/api/worker-certificates").set(as(fiscal.token)).send({ name: "x" }),
      request(app).post("/api/ethics-reports").set(as(fiscal.token)).send({ category: "OTHER", description: "teste" }),
    ];
    for (const res of await Promise.all(tentativas)) {
      expect(res.status, res.req.path).toBe(403);
      expect(res.body.code).toBe("READ_ONLY");
    }
  });

  it("nas rotas de escrita dos módulos, o servidor também recusa", async () => {
    const res = await request(app)
      .post("/api/occurrences")
      .set(as(fiscal.token))
      .send({ type: "DANGEROUS_EVENT", description: "x", occurred_at: "2026-10-05T10:00:00.000Z" });
    expect(res.status).toBe(403);
  });
});

describe("o que o fiscal abre fica registrado", () => {
  it("quem cuida de Conta e usuários vê; o fiscal e o colaborador, não", async () => {
    await request(app).get("/api/inventory").set(as(fiscal.token));
    const res = await request(app).get("/api/consulta-acessos").set(as(owner.token));
    expect(res.status).toBe(200);
    const acessos = res.body.acessos as { path: string; user: { id: string } }[];
    expect(acessos.some((a) => a.path === "/api/inventory" && a.user.id === fiscal.user.id)).toBe(true);

    expect((await request(app).get("/api/consulta-acessos").set(as(fiscal.token))).status).toBe(403);
    expect((await request(app).get("/api/consulta-acessos").set(as(colaborador.token))).status).toBe(403);
  });
});

describe("quem dá o papel de fiscal", () => {
  const actor = (role: Role, permission: string) => ({ role, permission }) as unknown as Actor;

  it("só quem cuida de Conta e usuários (Master e RH, pela planilha)", () => {
    expect(assignableOrgRoles(actor(Role.RH, "rh"))).toContain(Role.FISCAL);
    expect(assignableOrgRoles(actor(Role.MASTER, "master"))).toContain(Role.FISCAL);
    expect(assignableOrgRoles(actor(Role.SST, "sst"))).not.toContain(Role.FISCAL);
    expect(assignableOrgRoles(actor(Role.GERENTE, "gerente"))).not.toContain(Role.FISCAL);
    expect(assignableOrgRoles(actor(Role.FISCAL, "fiscal"))).not.toContain(Role.FISCAL);
  });
});

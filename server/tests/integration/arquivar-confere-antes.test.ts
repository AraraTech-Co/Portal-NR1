import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import {
  conferirEArquivar,
  perguntaDeArquivar,
} from "../../../client/src/lib/arquivar";

/**
 * Arquivar confere antes de perguntar.
 *
 * O portal perguntava "Arquivar a função…? Ele some das listas" e, depois
 * do OK, recusava porque a função estava em atividades ativas. Agora a tela
 * pergunta ao servidor se pode, diz já o que impede, e só pede confirmação
 * quando arquivar é possível — tratando setor, função e atividade pelo
 * gênero certo. [B3-1-C]
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const SENHA = "teste1234";
const SUFIXO = Date.now().toString(36);
const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const plano = (t: string) => t.replace(/\s+/g, " ");

let app: Express;
let sst: { token: string };
let colaborador: { token: string };
const ids = { est: "", setor: "", funcao: "", funcaoLivre: "", atividade: "" };

async function entrar(login: string) {
  const res = await request(app).post("/api/auth").send({ login, password: SENHA });
  expect(res.status, `login de ${login}`).toBe(200);
  return res.body as { token: string };
}

const conferir = (caminho: string, id: string, token = sst.token) =>
  request(app).get(`/api/${caminho}/${id}/pode-arquivar`).set(as(token));

beforeAll(async () => {
  app = createApp();
  sst = await entrar("teste.sst");
  colaborador = await entrar("teste.colaborador");

  const est = (
    await request(app).post("/api/establishments").set(as(sst.token)).send({ name: `Arquivo ${SUFIXO}` })
  ).body.establishment;
  const setor = (
    await request(app).post("/api/sectors").set(as(sst.token)).send({ establishment_id: est.id, name: "Usinagem" })
  ).body.sector;
  const funcao = (
    await request(app).post("/api/job-roles").set(as(sst.token)).send({ sector_id: setor.id, name: `Torneiro ${SUFIXO}` })
  ).body.job_role;
  const funcaoLivre = (
    await request(app).post("/api/job-roles").set(as(sst.token)).send({ sector_id: setor.id, name: `Sem uso ${SUFIXO}` })
  ).body.job_role;
  const atividade = (
    await request(app).post("/api/activities").set(as(sst.token)).send({
      establishment_id: est.id,
      sector_id: setor.id,
      name: `Tornear ${SUFIXO}`,
      description: "Opera o torno",
      job_role_ids: [funcao.id],
    })
  ).body.activity;
  const perigo = await request(app).post("/api/hazards").set(as(sst.token)).send({
    activity_id: atividade.id,
    description: `Cavaco ${SUFIXO}`,
    category: "ACCIDENT",
  });
  expect(perigo.status, JSON.stringify(perigo.body)).toBe(201);
  Object.assign(ids, {
    est: est.id,
    setor: setor.id,
    funcao: funcao.id,
    funcaoLivre: funcaoLivre.id,
    atividade: atividade.id,
  });
});

describe("o servidor diz se pode, sem arquivar [B3-1-C]", () => {
  const casos = [
    ["establishments", "est", "ESTABLISHMENT_HAS_SECTORS", /1 setor/],
    ["sectors", "setor", "SECTOR_HAS_ACTIVITIES", /1 atividade/],
    ["job-roles", "funcao", "JOB_ROLE_IN_USE", /1 atividade/],
    ["activities", "atividade", "ACTIVITY_HAS_HAZARDS", /1 perigo/],
  ] as const;

  for (const [caminho, chave, codigo, texto] of casos) {
    it(`${caminho}: diz o que impede, e o arquivamento recusa pelo mesmo motivo`, async () => {
      const res = await conferir(caminho, ids[chave]);
      expect(res.status).toBe(200);
      expect(res.body.can_archive).toBe(false);
      expect(res.body.code).toBe(codigo);
      expect(res.body.message).toMatch(texto);

      const arquivar = await request(app).delete(`/api/${caminho}/${ids[chave]}`).set(as(sst.token));
      expect(arquivar.status).toBe(409);
      expect(arquivar.body.code).toBe(codigo);
      expect(arquivar.body.message).toBe(res.body.message);
    });
  }

  it("quando pode, diz que pode — e não arquiva", async () => {
    const res = await conferir("job-roles", ids.funcaoLivre);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ can_archive: true });
    const funcao = await prisma.jobRole.findUniqueOrThrow({
      where: { id: ids.funcaoLivre },
      select: { archivedAt: true },
    });
    expect(funcao.archivedAt).toBeNull();
  });

  it("o que já foi arquivado, ou não existe, é 404", async () => {
    const arquivada = await request(app).delete(`/api/job-roles/${ids.funcaoLivre}`).set(as(sst.token));
    expect(arquivada.status).toBe(200);
    expect((await conferir("job-roles", ids.funcaoLivre)).status).toBe(404);
    expect((await conferir("sectors", "00000000-0000-4000-8000-00000000dead")).status).toBe(404);
  });

  it("quem não arquiva também não consulta", async () => {
    const res = await conferir("sectors", ids.setor, colaborador.token);
    expect(res.status).toBe(403);
  });
});

describe("a tela confere antes de perguntar [B3-1-C]", () => {
  it("a pergunta trata cada coisa pelo gênero certo", () => {
    expect(perguntaDeArquivar("job_role", "Torneiro")).toBe(
      "Arquivar a função “Torneiro”? Ela some das listas, mas o histórico fica.",
    );
    expect(perguntaDeArquivar("activity", "Tornear")).toMatch(/^Arquivar a atividade “Tornear”\? Ela /);
    expect(perguntaDeArquivar("sector", "Usinagem")).toMatch(/^Arquivar o setor “Usinagem”\? Ele /);
    expect(perguntaDeArquivar("establishment", "Matriz")).toMatch(/^Arquivar o estabelecimento “Matriz”\? Ele /);
  });

  it("com impedimento, mostra o motivo sem perguntar nem arquivar", async () => {
    const confirmar = vi.fn(() => true);
    const arquivar = vi.fn(async () => {});
    const msg = await conferirEArquivar({
      tipo: "job_role",
      nome: "Torneiro",
      conferir: async () => ({ can_archive: false, message: "Esta função ainda está em 6 atividade(s) ativa(s)." }),
      arquivar,
      confirmar,
    });
    expect(msg).toMatch(/6 atividade/);
    expect(confirmar).not.toHaveBeenCalled();
    expect(arquivar).not.toHaveBeenCalled();
  });

  it("sem impedimento, pergunta; desistir não arquiva", async () => {
    const confirmar = vi.fn(() => false);
    const arquivar = vi.fn(async () => {});
    const msg = await conferirEArquivar({
      tipo: "sector",
      nome: "Usinagem",
      conferir: async () => ({ can_archive: true }),
      arquivar,
      confirmar,
    });
    expect(msg).toBeNull();
    expect(confirmar).toHaveBeenCalledWith(perguntaDeArquivar("sector", "Usinagem"));
    expect(arquivar).not.toHaveBeenCalled();
  });

  it("confirmando, arquiva; se o servidor recusar no meio tempo, mostra a recusa", async () => {
    const arquivar = vi.fn(async () => {});
    expect(
      await conferirEArquivar({
        tipo: "activity",
        nome: "Tornear",
        conferir: async () => ({ can_archive: true }),
        arquivar,
        confirmar: () => true,
      }),
    ).toBeNull();
    expect(arquivar).toHaveBeenCalledTimes(1);

    const recusa = await conferirEArquivar({
      tipo: "activity",
      nome: "Tornear",
      conferir: async () => ({ can_archive: true }),
      arquivar: async () => {
        throw new Error("Esta atividade tem 1 perigo(s) no inventário.");
      },
      confirmar: () => true,
    });
    expect(recusa).toMatch(/1 perigo/);
  });

  it("se a conferência falhar, não pergunta", async () => {
    const confirmar = vi.fn(() => true);
    const msg = await conferirEArquivar({
      tipo: "sector",
      nome: "Usinagem",
      conferir: async () => {
        throw new Error("Sem conexão");
      },
      arquivar: async () => {},
      confirmar,
    });
    expect(msg).toBe("Sem conexão");
    expect(confirmar).not.toHaveBeenCalled();
  });

  it("Operação usa a conferência nos quatro lugares, e não pergunta direto", () => {
    const editores = plano(semComentarios(readFileSync(join(CLIENTE, "pages", "OperationEditors.tsx"), "utf8")));
    const pagina = plano(semComentarios(readFileSync(join(CLIENTE, "pages", "OperationPage.tsx"), "utf8")));
    expect(editores).not.toMatch(/window\.confirm/);
    expect(editores).toContain('conferir: () => fetchCanArchive("establishments", establishment.id)');
    expect(editores).toContain('conferir: () => fetchCanArchive("activities", activity.id)');
    expect(editores).toContain("conferir: onCheckArchive");
    expect(pagina).toContain('onCheckArchive={() => fetchCanArchive("sectors", selectedSector.id)}');
    expect(pagina).toContain('onCheckArchive={() => fetchCanArchive("job-roles", j.id)}');
  });
});

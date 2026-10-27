import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { CANAL_BASE, canalPath, canalUrl } from "../../../client/src/lib/canal";

/**
 * O endereço do canal de denúncia aparece em Conta e usuários.
 *
 * O canal público existe desde a decisão S4-L, mas o endereço não aparecia em
 * tela nenhuma: o identificador da empresa é um código de 36 caracteres, e
 * quem administra tinha de pedir o link ao suporte para poder divulgá-lo.
 * [CB-63]
 *
 * O que estes casos seguram: que o endereço montado para a tela é um endereço
 * que o canal atende sem sessão nenhuma, que o relato enviado por ele cai
 * nesta empresa, e que a rota do canal e o endereço divulgado saem do mesmo
 * lugar — não de duas cópias escritas à mão que podem divergir.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const CONTA_ID = "aaaaaaaa-0001-4000-8000-000000000002";
const SUFIXO = Date.now().toString(36);
const DOMINIO = "https://portal.exemplo.com.br";

const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");

let app: Express;
const relatos: string[] = [];

/** Sem cabeçalho de autorização: é exatamente o ponto do canal. */
const semSessao = () => request(app);

/**
 * Comentário sai antes da busca. O comentário que explica a correção cita o
 * próprio trecho corrigido, e a varredura tomaria a citação por código.
 *
 * Bloco primeiro, e sem tentar casar o `{…}` do JSX em volta: a primeira
 * versão disto casava chave, comentário e chave, e quando o fecha-comentário
 * não vinha seguido de chave ela engolia 6 mil caracteres de código junto —
 * inclusive o trecho que este arquivo afirma estar lá. O mesmo formato de
 * `rotulos-de-auditoria.test.ts`.
 */
function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** O identificador da empresa lido de volta do endereço, como a rota o lê. */
function idNoEndereco(endereco: string): string {
  const { pathname } = new URL(endereco);
  const base = `${CANAL_BASE}/`;
  expect(pathname.startsWith(base), `caminho de ${endereco}`).toBe(true);
  return decodeURIComponent(pathname.slice(base.length));
}

beforeAll(() => {
  app = createApp();
});

afterAll(async () => {
  await prisma.ethicsReport.deleteMany({ where: { id: { in: relatos } } });
});

describe("o endereço do canal de denúncia [CB-63]", () => {
  it("é o domínio deste portal mais o caminho do canal desta empresa", () => {
    const endereco = canalUrl(DOMINIO, ORG_ID);
    expect(endereco).toBe(`${DOMINIO}${canalPath(ORG_ID)}`);
    expect(idNoEndereco(endereco), "a empresa volta inteira do endereço").toBe(
      ORG_ID,
    );
  });

  it("abre o canal da empresa sem sessão nenhuma", async () => {
    const empresa = idNoEndereco(canalUrl(DOMINIO, ORG_ID));
    const res = await semSessao().get(
      `/api/ethics-reports/meta?organization_id=${empresa}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.organization?.id, JSON.stringify(res.body)).toBe(ORG_ID);
    expect(res.body.organization?.name).toBeTruthy();
  });

  it("o relato enviado por ele cai nesta empresa", async () => {
    const empresa = idNoEndereco(canalUrl(DOMINIO, ORG_ID));
    const res = await semSessao()
      .post("/api/ethics-reports")
      .send({
        organization_id: empresa,
        category: "HARASSMENT_MORAL",
        description: `Relato enviado pelo endereço divulgado ${SUFIXO}.`,
        is_anonymous: true,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    relatos.push(res.body.report.id);

    const guardado = await prisma.ethicsReport.findUniqueOrThrow({
      where: { id: res.body.report.id },
      select: { organizationId: true },
    });
    expect(guardado.organizationId).toBe(ORG_ID);
  });

  it("o identificador da conta não abriria canal nenhum", async () => {
    /*
      A tela monta o endereço com a empresa da sessão, e não com a conta: as
      duas estão ali, lado a lado, e com a conta o link só diria "link
      inválido" a quem denuncia.
    */
    const res = await semSessao().get(
      `/api/ethics-reports/meta?organization_id=${CONTA_ID}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.organization, JSON.stringify(res.body)).toBeNull();
  });

  it("a rota do canal e o endereço divulgado saem do mesmo lugar", () => {
    const rotas = semComentarios(
      readFileSync(join(CLIENTE, "App.tsx"), "utf8"),
    );
    expect(rotas).toContain('from "@/lib/canal"');
    expect(rotas, "a rota monta o caminho com a constante").toContain(
      "${CANAL_BASE}/:organizationId",
    );
    expect(
      rotas.includes('path="/canal'),
      "nenhuma cópia do caminho escrita à mão na rota",
    ).toBe(false);
  });

  it("a tela de Conta e usuários mostra o endereço para copiar", () => {
    const tela = semComentarios(
      readFileSync(join(CLIENTE, "pages", "AccountPage.tsx"), "utf8"),
    );
    /* Canário: este trecho vinha logo depois de um comentário de bloco e era
       o que a primeira varredura engolia. Se ele desaparecer, o que vem
       abaixo não está afirmando nada. */
    expect(tela, "a varredura não engoliu código junto").toContain(
      "= useAuth();",
    );
    expect(tela, "o montador vem da biblioteca, não escrito à mão").toContain(
      'from "@/lib/canal"',
    );
    /*
      Uma só: o endereço mostrado e o endereço copiado são o mesmo valor, e é
      a empresa da sessão que abre o canal — a conta está ali ao lado na mesma
      tela e o link dela só diria "link inválido".
    */
    const montagens = tela.match(/canalUrl\([^)]*\)/g) ?? [];
    expect(montagens).toEqual([
      "canalUrl(window.location.origin, user.organization.id)",
    ]);
    expect(tela).toContain("<h2>Canal de denúncia</h2>");
    expect(tela, "com botão de copiar").toContain(
      "navigator.clipboard\n                    .writeText(canalDaEmpresa)",
    );
  });
});

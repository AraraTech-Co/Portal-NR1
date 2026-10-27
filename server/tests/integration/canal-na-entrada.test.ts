import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "../../src/app";
import prisma from "../../src/model/prisma";
import { CANAL_BASE, canalPath } from "../../../client/src/lib/canal";

/**
 * O canal de denúncia na tela de entrada.
 *
 * O endereço do canal passou a aparecer em Conta e usuários [CB-63], mas só
 * para quem já entrou. Quem vai denunciar é muitas vezes quem não tem conta
 * no portal — terceiro, candidato, quem já saiu —, e a tela de entrada não
 * dizia que o canal existe.
 *
 * A dificuldade é que a entrada não sabe de qual empresa é quem está
 * olhando, e o portal atende mais de uma. O que estes casos seguram:
 *
 * - quando a instalação atende uma empresa só, a consulta pública diz qual
 *   é, e a entrada do canal leva direto ao canal dela;
 * - quando atende mais de uma, a consulta não aponta empresa nenhuma e não
 *   deixa escapar nome nenhum — ela responde sem sessão;
 * - acompanhar um relato não precisa da empresa: protocolo e código bastam;
 * - um relato novo precisa, e o servidor recusa o relato sem empresa — não é
 *   só a tela que pede o endereço divulgado.
 *
 * Exige a organização do `scripts/seed-teste-org.ts`.
 */
const ORG_ID = "aaaaaaaa-0001-4000-8000-000000000001";
const SUFIXO = Date.now().toString(36);

const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");

let app: Express;
const relatos: string[] = [];

/** Sem cabeçalho de autorização: é exatamente o ponto do canal. */
const semSessao = () => request(app);

/**
 * Comentário sai antes da busca: o comentário que explica a correção cita o
 * próprio trecho corrigido, e a varredura tomaria a citação por código.
 *
 * Bloco primeiro, linha depois, e sem tentar casar o `{…}` do JSX em volta —
 * o mesmo formato de `rotulos-de-auditoria.test.ts` e de
 * `endereco-do-canal.test.ts`.
 */
function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function tela(...caminho: string[]): string {
  return semComentarios(readFileSync(join(CLIENTE, ...caminho), "utf8"));
}

/** As empresas ativas, para devolver o banco como estava. */
async function ativas(): Promise<Array<{ id: string; name: string }>> {
  return prisma.organization.findMany({
    where: { active: true },
    select: { id: true, name: true },
  });
}

beforeAll(() => {
  app = createApp();
});

afterAll(async () => {
  await prisma.ethicsReport.deleteMany({ where: { id: { in: relatos } } });
});

describe("o canal de denúncia na tela de entrada [CB-63]", () => {
  it("não aponta empresa nenhuma quando a instalação atende mais de uma", async () => {
    const empresas = await ativas();
    expect(
      empresas.length,
      "este caso precisa de mais de uma empresa ativa no banco de teste",
    ).toBeGreaterThan(1);

    const res = await semSessao().get("/api/ethics-reports/meta");
    expect(res.status).toBe(200);
    expect(res.body.single_organization, JSON.stringify(res.body)).toBeNull();

    /*
      E não deixa escapar nome: a rota responde sem sessão nenhuma, e quem
      consulta não tem por que saber quem mais está neste portal.
    */
    const corpo = JSON.stringify(res.body);
    for (const empresa of empresas) {
      expect(corpo, `o nome de ${empresa.name} não sai daqui`).not.toContain(
        empresa.name,
      );
    }
  });

  it("aponta a empresa quando ela é a única da instalação", async () => {
    const outras = (await ativas()).filter((e) => e.id !== ORG_ID);
    expect(outras.length, "o caso precisa de outra empresa para desativar")
      .toBeGreaterThan(0);
    try {
      await prisma.organization.updateMany({
        where: { id: { in: outras.map((e) => e.id) } },
        data: { active: false },
      });

      const res = await semSessao().get("/api/ethics-reports/meta");
      expect(res.status).toBe(200);
      expect(
        res.body.single_organization?.id,
        JSON.stringify(res.body),
      ).toBe(ORG_ID);

      /* E é com esse identificador que a entrada monta o canal. */
      expect(canalPath(res.body.single_organization.id)).toBe(
        canalPath(ORG_ID),
      );
    } finally {
      await prisma.organization.updateMany({
        where: { id: { in: outras.map((e) => e.id) } },
        data: { active: true },
      });
    }
  });

  it("acompanhar um relato não precisa da empresa", async () => {
    const criado = await semSessao()
      .post("/api/ethics-reports")
      .send({
        organization_id: ORG_ID,
        category: "HARASSMENT_MORAL",
        description: `Relato para acompanhar pela entrada do canal ${SUFIXO}.`,
        is_anonymous: true,
      });
    expect(criado.status, JSON.stringify(criado.body)).toBe(201);
    relatos.push(criado.body.report.id);

    /* Sem organization_id: é o que a entrada do canal tem em mãos. */
    const res = await semSessao().post("/api/ethics-reports/track").send({
      protocol: criado.body.report.protocol,
      access_code: criado.body.access_code,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.report.protocol).toBe(criado.body.report.protocol);
    expect(res.body.report.description).toContain(SUFIXO);
  });

  it("um relato novo sem empresa o servidor recusa", async () => {
    const res = await semSessao()
      .post("/api/ethics-reports")
      .send({
        category: "HARASSMENT_MORAL",
        description: `Relato sem empresa, que não deveria entrar ${SUFIXO}.`,
        is_anonymous: true,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    const sobrou = await prisma.ethicsReport.count({
      where: { description: { contains: `não deveria entrar ${SUFIXO}` } },
    });
    expect(sobrou, "nada entrou no banco").toBe(0);
  });

  it("a tela de entrada oferece o canal, sem empresa no endereço", () => {
    const login = tela("pages", "LoginPage.tsx");
    /* Canário: se a varredura engolir código, o que vem abaixo não afirma
       nada. */
    expect(login, "a varredura não engoliu código junto").toContain(
      "= useAuth();",
    );
    expect(login, "o caminho vem da biblioteca, não escrito à mão").toContain(
      'from "@/lib/canal"',
    );
    expect(login).toContain("<Link to={CANAL_BASE}>Canal de denúncia</Link>");
    expect(
      login.includes('to="/canal'),
      "nenhuma cópia do caminho escrita à mão",
    ).toBe(false);
  });

  it("a rota sem empresa sai da mesma constante da rota com empresa", () => {
    const rotas = tela("App.tsx");
    expect(rotas).toContain("<Route path={CANAL_BASE} element={<PublicEthicsHomePage />} />");
    expect(rotas).toContain("${CANAL_BASE}/:organizationId");
    expect(
      rotas.includes('path="/canal'),
      "nenhuma cópia do caminho escrita à mão na rota",
    ).toBe(false);
  });

  it("a entrada leva direto ao canal quando há uma empresa só", () => {
    const entrada = tela("pages", "PublicEthicsHomePage.tsx");
    expect(entrada, "a varredura não engoliu código junto").toContain(
      "useState<Estado>({ fase: \"carregando\" })",
    );
    /* A empresa única vem da consulta, e não de um palpite da tela. */
    expect(entrada).toContain(
      'meta.single_organization\n            ? { fase: "uma-empresa", id: meta.single_organization.id }',
    );
    /* Um só jeito de montar o destino, e é o caminho do canal. */
    const destinos = entrada.match(/<Navigate to=\{[^}]*\}/g) ?? [];
    expect(destinos).toEqual(["<Navigate to={canalPath(estado.id)}"]);
  });

  it("sem empresa a entrada deixa acompanhar e não oferece relato novo", () => {
    const entrada = tela("pages", "PublicEthicsHomePage.tsx");
    expect(entrada).toContain("<EthicsReportPage publico semEmpresa />");

    const canal = tela("pages", "EthicsReportPage.tsx");
    expect(canal, "a varredura não engoliu código junto").toContain(
      "const { user } = useAuth();",
    );
    /* Abre em acompanhar, que é o que funciona sem a empresa. */
    expect(canal).toContain(
      'useState<Mode>(semEmpresa ? "track" : "new")',
    );
    /*
      E as seções do relato novo — o formulário e o recibo com protocolo e
      código — ficam fora. Cada aparição do modo "new" no JSX tem de estar
      atrás de uma condição; uma que escape volta a oferecer o envio sem
      empresa, e o servidor recusaria com um 400 na cara de quem relata.

      São três: as duas seções e o botão que alterna os modos — que mora
      dentro do bloco de ações, e esse bloco inteiro não é montado sem a
      empresa. O número entra no caso para que uma quarta aparição, não
      prevista, reprove em vez de passar sem ser olhada.
    */
    const aparicoes = canal.match(/\{[^{}]*mode === "new"[^{}]*/g) ?? [];
    expect(
      aparicoes.map((t) => t.slice(0, 40)),
      "as aparições do modo novo no JSX",
    ).toHaveLength(3);
    expect(canal, "o bloco de ações não é montado sem a empresa").toContain(
      "semEmpresa ? undefined : (",
    );
    for (const trecho of aparicoes) {
      const guardado =
        trecho.includes("!semEmpresa &&") ||
        trecho.includes('? "primary" : "secondary"');
      expect(guardado, `aparição sem guarda: ${trecho.slice(0, 60)}`).toBe(
        true,
      );
    }
  });

  it("e diz como conseguir o endereço para um relato novo", () => {
    const canal = tela("pages", "EthicsReportPage.tsx");
    const trecho = canal.slice(canal.indexOf("{semEmpresa && ("));
    expect(
      trecho.startsWith("{semEmpresa && ("),
      "a dica existe na tela",
    ).toBe(true);
    /* A frase quebra em várias linhas no arquivo: o espaço não conta. */
    const dica = trecho
      .slice(0, trecho.indexOf(")}"))
      .replace(/\s+/g, " ");
    expect(dica).toContain("endereço do canal que a sua empresa divulgou");
    expect(dica, "e onde quem administra o encontra").toContain(
      "Conta e usuários",
    );
  });

  it("o caminho do canal continua sendo o da constante", () => {
    expect(canalPath(ORG_ID)).toBe(`${CANAL_BASE}/${ORG_ID}`);
  });
});

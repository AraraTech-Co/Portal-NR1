import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parteAberta, partesDaConta, ROTULO_DA_PARTE } from "../../../client/src/lib/partes-da-conta";

/**
 * Conta e usuários em partes.
 *
 * A página reunia nove seções numa só. A sessão fica sempre à vista; o resto
 * se divide em partes, conforme o que quem abre pode fazer, e a parte vai no
 * endereço. [B2-1-I]
 */
const RAIZ = join(__dirname, "..", "..", "..");
const fonte = (...c: string[]) =>
  readFileSync(join(RAIZ, ...c), "utf8")
    .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ")
    .replace(/\s+/g, " ");

describe("quais partes cada um vê [B2-1-I]", () => {
  it("quem administra a conta vê todas, começando por Pessoas e acessos", () => {
    expect(partesDaConta({ gerenciar: true, decidirPedidos: true })).toEqual([
      "pessoas",
      "entrada",
      "contas",
      "canal",
      "fiscalizacao",
    ]);
  });

  it("quem só decide pedidos começa pela entrada e não vê pessoas nem fiscalização", () => {
    expect(partesDaConta({ gerenciar: false, decidirPedidos: true })).toEqual(["entrada", "contas", "canal"]);
  });

  it("os demais veem as contas e o canal", () => {
    expect(partesDaConta({ gerenciar: false, decidirPedidos: false })).toEqual(["contas", "canal"]);
  });

  it("a parte do endereço vale se quem abre pode vê-la; senão, abre a primeira", () => {
    const todas = partesDaConta({ gerenciar: true, decidirPedidos: true });
    expect(parteAberta(todas, "fiscalizacao")).toBe("fiscalizacao");
    expect(parteAberta(todas, null)).toBe("pessoas");
    const poucas = partesDaConta({ gerenciar: false, decidirPedidos: false });
    expect(parteAberta(poucas, "fiscalizacao")).toBe("contas");
    expect(parteAberta(poucas, "qualquer-coisa")).toBe("contas");
  });

  it("toda parte tem nome em português", () => {
    for (const p of partesDaConta({ gerenciar: true, decidirPedidos: true })) {
      expect(ROTULO_DA_PARTE[p], p).toMatch(/^[A-ZÁÉÍÓÚ][a-záéíóúãõç ]+/);
    }
  });
});

describe("a página usa as partes [B2-1-I]", () => {
  const tela = fonte("client", "src", "pages", "AccountPage.tsx");

  it("a sessão fica fora das partes, sempre à vista", () => {
    const iSessao = tela.indexOf("<h2>Sessão</h2>");
    const iPartes = tela.indexOf('<nav className="conta-partes"');
    expect(iSessao).toBeGreaterThan(0);
    expect(iSessao).toBeLessThan(iPartes);
    expect(tela.slice(tela.lastIndexOf("{", iSessao), iSessao)).not.toMatch(/parte ===/);
  });

  it("cada seção aparece só na sua parte", () => {
    expect(tela).toContain('{parte === "canal" && user && ( <section className="form-section"> <h2>Canal de denúncia</h2>');
    expect(tela).toContain('{parte === "contas" && !loading && accounts.length > 0 && (');
    expect(tela).toContain('{parte === "entrada" && canDecide && ( <section className="form-section"> <h2>Pedidos de entrada</h2>');
    expect(tela).toContain('{parte === "entrada" && canManage && ( <section className="form-section"> <h2>Links de convite</h2>');
    expect(tela).toContain('{parte === "pessoas" && canManage && <PessoasEAcessos />}');
    expect(tela).toContain('{parte === "pessoas" && canManage && <ImportPeople />}');
    expect(tela).toContain('{parte === "canal" && canManage && <EthicsCommitteeSection />}');
    expect(tela).toContain('{parte === "fiscalizacao" && canManage && <FiscaisComAcesso />}');
    expect(tela).toContain('{parte === "fiscalizacao" && canManage && <ConsultaAcessos />}');
  });

  it("a parte vai no endereço, e a entrada mostra quantos pedidos esperam", () => {
    expect(tela).toContain('const parte = parteAberta(partes, parametros.get("parte"));');
    expect(tela).toContain("setParametros(p === partes[0] ? {} : { parte: p }, { replace: true });");
    expect(tela).toMatch(/\{p === "entrada" && requests\.length > 0 && \( <span className="conta-parte-conta">\{requests\.length\}<\/span> \)\}/);
  });

  it("o Início leva direto à parte certa", () => {
    const inicio = fonte("server", "src", "controller", "HomeController.ts");
    expect(inicio).toContain('link: "/conta?parte=entrada"');
    expect(inicio).toContain('link: "/conta?parte=fiscalizacao"');
    expect(inicio).not.toContain('link: "/conta",');
  });
});

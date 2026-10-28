import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Pessoas e acessos: um botão por linha.
 *
 * Até quatro botões por linha (Ver acessos, Suspender acesso, Mudar papel,
 * Redefinir senha) quebravam em duas linhas no notebook, em 19 das 23
 * pessoas, nas larguras de 1366 e 1536 pontos. A linha fica com um botão; as
 * ações abrem no painel da pessoa, junto dos acessos. [B2-1-J]
 */
const tela = readFileSync(
  join(__dirname, "..", "..", "..", "client", "src", "pages", "PessoasEAcessos.tsx"),
  "utf8",
)
  .replace(/\{?\/\*[\s\S]*?\*\/\}?/g, " ")
  .replace(/\s+/g, " ");

const linha = tela.slice(tela.indexOf('<tr className={open ? "is-open" : undefined}>'), tela.indexOf("</tr>", tela.indexOf('<tr className={open ? "is-open" : undefined}>')));
const ultimaCelula = linha.slice(linha.lastIndexOf("<td>"));
const painel = tela.slice(tela.indexOf("{open && ( <tr className=\"people-expand\">"));

describe("a linha da pessoa [B2-1-J]", () => {
  it("tem um botão só, que abre o painel", () => {
    expect(ultimaCelula.match(/<Button/g)?.length).toBe(1);
    expect(ultimaCelula).toContain('className="people-abrir" onClick={() => setOpenId(open ? null : p.id)}');
    expect(ultimaCelula).toContain('{open ? "Fechar" : temAcoes ? "Acessos e ações" : "Ver acessos"}');
  });

  it("o painel traz as ações, e só as que a pessoa pode usar", () => {
    const acoes = painel.slice(0, painel.indexOf("<Acessos modules={p.modules} />"));
    expect(acoes).toContain('{temAcoes && ( <div className="form-actions people-row-actions">');
    expect(acoes).toMatch(/\{p\.can_suspend && \(/);
    expect(acoes).toMatch(/\{p\.can_change_role && \(/);
    expect(acoes).toMatch(/\{p\.can_reset_password && \(/);
    expect(acoes).toContain("Mudar papel");
    expect(acoes).toContain('"Redefinir senha"');
  });

  it("o painel vem logo abaixo da linha, antes do formulário de mudar papel e da senha nova", () => {
    const iPainel = tela.indexOf('{open && ( <tr className="people-expand">');
    const iEdicao = tela.indexOf("{editing?.userId === p.id && (");
    const iSenha = tela.indexOf("{showReset && reset && (");
    expect(iPainel).toBeGreaterThan(0);
    expect(iPainel).toBeLessThan(iEdicao);
    expect(iPainel).toBeLessThan(iSenha);
  });
});

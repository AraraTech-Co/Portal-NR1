import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Em Operação, a função mostra os cargos da folha juntados a ela e deixa
 * remover o apelido (Correção 6, C6-4).
 */
const semComentarios = (codigo: string) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const ler = (arquivo: string) =>
  semComentarios(readFileSync(join(__dirname, "../../../client/src", arquivo), "utf8"));

describe("os apelidos na função", () => {
  const pagina = ler("pages/OperationPage.tsx");
  const editores = ler("pages/OperationEditors.tsx");
  const api = ler("api/operation.ts");

  it("a lista mostra a grafia da folha, não a chave", () => {
    expect(editores).toMatch(/<span className="muted">Também chamada na folha de:<\/span>/);
    expect(editores).toMatch(/<li key=\{a\.id\}>\s*\{a\.grafia\}/);
    expect(editores).not.toMatch(/\{a\.chave\}/);
  });

  it("remover pergunta antes, dizendo que o cargo volta ao bloco, e só aparece para quem pode", () => {
    expect(editores).toMatch(
      /if \(\s*!window\.confirm\(\s*`Remover "\$\{a\.grafia\}" de \$\{funcao\}\? Na próxima planilha, esse cargo volta a aparecer em Cargos sem função\.`,?\s*\)\s*\) \{\s*return;\s*\}\s*setRemovendo/,
    );
    expect(editores).toMatch(/\{podeRemover && \(\s*<Button/);
    expect(pagina).toMatch(/const removeApelido = canEdit && editaConta;/);
    expect(pagina).toMatch(/podeRemover=\{removeApelido\}/);
    expect(pagina).toMatch(/await removeJobRoleAlias\(j\.id, aliasId\);\s*await reload\(\);/);
    expect(api).toMatch(/request\(`\/api\/job-roles\/\$\{jobRoleId\}\/apelidos\/\$\{aliasId\}`, \{ method: "DELETE" \}\)/);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cuidaDaFilial as noServidor } from "../../src/helper/module-access";

/**
 * A tela de Operação esconde de quem não é Master nem Dono o que o servidor
 * recusa na filial (Correção 6, C6-11): Novo estabelecimento, Arquivar e os
 * campos cadastrais.
 */
const semComentarios = (codigo: string) =>
  codigo.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
const ler = (arquivo: string) =>
  semComentarios(readFileSync(join(__dirname, "../../../client/src/pages", arquivo), "utf8"));

describe("a regra da tela é a do servidor", () => {
  it("a lista de papéis da tela dá a mesma resposta que o servidor para cada papel", () => {
    /* O module-access da tela importa o contexto do React: a lista é lida do arquivo. */
    const codigo = semComentarios(
      readFileSync(join(__dirname, "../../../client/src/lib/module-access.ts"), "utf8"),
    );
    const lista = codigo.match(/const ESTABLISHMENT_ROLES: readonly string\[\] = \[([^\]]*)\];/);
    expect(lista).not.toBeNull();
    const naTela = new Set([...lista![1]!.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]));
    expect(codigo).toMatch(/export function cuidaDaFilial\(permission: string \| undefined\): boolean \{\s*return ESTABLISHMENT_ROLES\.includes\(permission \?\? ""\);/);
    for (const papel of ["master", "owner", "admin", "sst", "rh", "gerente", "adm_loja", "supervisor", "colaborador", "fiscal"]) {
      expect(naTela.has(papel), papel).toBe(noServidor(papel));
    }
    expect(noServidor("owner")).toBe(true);
    expect(noServidor("sst")).toBe(false);
  });
});

describe("a tela de Operação", () => {
  const pagina = ler("OperationPage.tsx");
  const editores = ler("OperationEditors.tsx");

  it("Novo estabelecimento só para quem cuida da filial, nos dois lugares", () => {
    expect(pagina).toMatch(/const editaFilial = canEdit && cuidaDaFilial\(user\?\.permission\);/);
    expect(pagina.match(/label="Novo estabelecimento"/g)).toHaveLength(2);
    expect(pagina).toMatch(/editaFilial \? \(\s*<QuickAdd\s*label="Novo estabelecimento"/);
    expect(pagina).toMatch(/\{editaFilial && \(\s*<QuickAdd\s*label="Novo estabelecimento"/);
    expect(pagina).toMatch(/editaCadastro=\{editaFilial\}/);
  });

  it("Arquivar e os campos cadastrais só com editaCadastro, e o envio só leva o nome sem ele", () => {
    expect(editores).toMatch(/\{editaCadastro && \(\s*<Button[^>]*onClick=\{\(\) => void onArchive\(\)\}>\s*Arquivar/);
    const campos = editores.slice(editores.indexOf("{editaCadastro && (\n              <>"));
    for (const rotulo of ["CNPJ", "Razão social", "Código da folha", "Endereço"]) {
      expect(campos.indexOf(rotulo), rotulo).toBeGreaterThan(-1);
      expect(campos.indexOf(rotulo), rotulo).toBeLessThan(campos.indexOf("</>"));
    }
    expect(editores).toMatch(/const cadastrais = editaCadastro\s*\?/);
    expect(editores).toMatch(/:\s*\{\};\s*await updateEstablishment\(establishment\.id, \{\s*\.\.\.\(name\.trim\(\) !== establishment\.name \? \{ name: name\.trim\(\) \} : \{\}\),\s*\.\.\.cadastrais,\s*\}\);/);
  });
});

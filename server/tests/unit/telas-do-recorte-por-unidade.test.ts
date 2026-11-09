import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Telas do recorte por unidade. [C2-13]
 *
 * - Gestor sem unidade vê o aviso para regularizar o vínculo.
 * - Em Conta e usuários, quem muda o papel define as unidades de gerente,
 *   supervisor e ADM loja (e do Admin legado, que vale como gerente).
 */
const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");

function tela(arquivo: string): string {
  return readFileSync(join(CLIENTE, arquivo), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const vezes = (texto: string, trecho: string) => texto.split(trecho).length - 1;

describe("aviso de gestor sem unidade [C2-13]", () => {
  it("aparece só com needs_units", () => {
    const shell = tela("layout/AppShell.tsx");
    expect(vezes(shell, "{user?.needs_units && (")).toBe(1);
    const aviso = shell.indexOf("{user?.needs_units && (");
    expect(shell.indexOf("Nenhuma unidade está sob a sua responsabilidade ainda.", aviso)).toBeGreaterThan(aviso);
  });
});

describe("atribuição de unidades em Conta e usuários [C2-13]", () => {
  it("monta o bloco para quem muda o papel, só nos papéis recortados", () => {
    const pagina = tela("pages/PessoasEAcessos.tsx");
    expect(
      vezes(pagina, "{p.can_change_role && PAPEIS_COM_UNIDADE.includes(p.org_role) && ("),
    ).toBe(1);
    expect(vezes(pagina, "<UnidadesSobResponsabilidade userId={p.id} name={p.name} />")).toBe(1);
    const bloco = tela("pages/UnidadesSobResponsabilidade.tsx");
    expect(bloco).toContain('export const PAPEIS_COM_UNIDADE = ["GERENTE", "SUPERVISOR", "ADM_LOJA", "ADMIN"];');
  });

  it("o bloco grava pela rota do vínculo", () => {
    const api = tela("api/managed-units.ts");
    expect(vezes(api, "`/api/pessoas-acessos/${userId}/unidades`")).toBe(2);
    expect(api).toContain('method: "PUT"');
  });
});

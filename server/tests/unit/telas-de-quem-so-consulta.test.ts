import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Telas de quem só consulta e de quem vê a lista toda. [C2-8]
 *
 * - O fiscal (só consulta) não vê o formulário de queixa ergonômica: o
 *   servidor já recusa a gravação, e o botão só confundia.
 * - Em Colaboradores, "Sua ficha na empresa." fica para quem vê só a
 *   própria ficha; quem vê a lista sem administrar recebe texto de lista.
 */
const CLIENTE = join(__dirname, "..", "..", "..", "client", "src");

/** Sem comentários (o comentário da correção cita o que se procura) e com fim de linha único. */
function tela(arquivo: string): string {
  return readFileSync(join(CLIENTE, arquivo), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function unica(texto: string, trecho: string | RegExp): void {
  const vezes =
    typeof trecho === "string" ? texto.split(trecho).length - 1 : (texto.match(new RegExp(trecho, "g")) ?? []).length;
  expect(vezes, String(trecho)).toBe(1);
}

describe("Avaliação ergonômica para quem só consulta [C2-8]", () => {
  const aep = tela("pages/AepPage.tsx");

  it("a seção de queixa só aparece para quem não é só consulta", () => {
    unica(aep, "const somenteConsulta = isReadOnlyPermission(user?.permission);");
    unica(aep, "{!somenteConsulta && <ErgonomicComplaints onEvaluated={reload} />}");
    // Nenhuma outra montagem da seção, sem a condição.
    unica(aep, "<ErgonomicComplaints");
  });
});

describe("subtítulo de Colaboradores [C2-8]", () => {
  const pagina = tela("pages/EmployeesPage.tsx");

  it("a escolha entre lista e ficha própria segue as linhas que a tela mostra", () => {
    unica(pagina, "rows.some((r) => r.userId !== user?.id)");
    const lista = pagina.indexOf("rows.some((r) => r.userId !== user?.id)");
    const textoLista = pagina.indexOf('"Quem trabalha com você.', lista);
    const textoFicha = pagina.indexOf('"Sua ficha na empresa."', lista);
    expect(textoLista).toBeGreaterThan(lista);
    expect(textoFicha).toBeGreaterThan(textoLista);
    unica(pagina, '"Sua ficha na empresa."');
  });
});

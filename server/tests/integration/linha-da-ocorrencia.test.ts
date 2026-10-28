import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { abrePelaLinha } from "../../../client/src/lib/linha-que-abre";

/**
 * A linha da ocorrência abre a ocorrência.
 *
 * A linha tinha a mão de clique e mudava de cor ao passar o mouse, mas só a
 * data era link: quem clicava na descrição achava que a tela não
 * respondia. [B3-2-B]
 */
const PAGINAS = join(__dirname, "..", "..", "..", "client", "src", "pages");

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const plano = (t: string) => t.replace(/\s+/g, " ");

const elemento = (dentroDeInterativo: boolean) => {
  const pedidos: string[] = [];
  return {
    pedidos,
    closest: (seletor: string) => {
      pedidos.push(seletor);
      return dentroDeInterativo ? {} : null;
    },
  };
};

describe("quando o clique na linha abre [B3-2-B]", () => {
  it("clique na descrição, no tipo, no local: abre", () => {
    expect(abrePelaLinha(elemento(false), "")).toBe(true);
  });

  it("clique num link ou botão da linha: deixa o link fazer o seu", () => {
    const alvo = elemento(true);
    expect(abrePelaLinha(alvo, "")).toBe(false);
    const seletor = alvo.pedidos[0].split(",").map((s) => s.trim());
    expect(seletor).toEqual(expect.arrayContaining(["a", "button", "input", "select"]));
  });

  it("quem estava selecionando texto para copiar não é levado embora", () => {
    expect(abrePelaLinha(elemento(false), "Queda de material")).toBe(false);
    expect(abrePelaLinha(elemento(false), "   ")).toBe(true);
  });
});

describe("a lista de ocorrências [B3-2-B]", () => {
  const tela = plano(semComentarios(readFileSync(join(PAGINAS, "OccurrencesPage.tsx"), "utf8")));

  it("a linha abre a ocorrência pelo clique, e a data continua link", () => {
    const linha = tela.slice(tela.indexOf('className="is-clickable"'));
    const abertura = linha.slice(0, linha.indexOf(">", linha.indexOf("navigate(")));
    expect(abertura).toMatch(/onClick=\{\(e\) => \{ if \( abrePelaLinha\( e\.target as Element, window\.getSelection\(\)\?\.toString\(\) \?\? "", \) \) \{ navigate\(`\/ocorrencias\/\$\{row\.id\}`\);/);
    expect(tela).toContain("<Link to={`/ocorrencias/${row.id}`}>");
  });

  it("nenhuma linha com cara de clicável fica sem ação, em tela nenhuma", () => {
    const semAcao: string[] = [];
    let vistas = 0;
    for (const arquivo of readdirSync(PAGINAS).filter((f) => f.endsWith(".tsx"))) {
      const fonte = plano(semComentarios(readFileSync(join(PAGINAS, arquivo), "utf8")));
      let i = fonte.indexOf("is-clickable");
      while (i !== -1) {
        const inicio = fonte.lastIndexOf("<tr", i);
        const fim = fonte.indexOf("> <td", i);
        const tag = fonte.slice(inicio, fim === -1 ? i + 2000 : fim);
        vistas += 1;
        if (!/onClick=/.test(tag)) semAcao.push(arquivo);
        i = fonte.indexOf("is-clickable", i + 1);
      }
    }
    expect(vistas, "a varredura achou as linhas clicáveis").toBeGreaterThanOrEqual(7);
    expect(semAcao).toEqual([]);
  });
});

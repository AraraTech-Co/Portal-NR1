import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Em "Ações vinculadas", o nome da ação abre a própria ação. [CB-73]
 *
 * O nome levava à lista geral do Plano de ação, e a pessoa tinha de procurar
 * a ação. Agora o link leva a /acoes?acao=<id>, e o Plano abre essa ação e vai
 * até ela, sem ligar sozinho o filtro "minhas", que poderia escondê-la.
 *
 * A tela não tem renderizador no projeto: o teste lê os componentes sem os
 * comentários.
 */
const PAGINAS = join(__dirname, "..", "..", "..", "client", "src", "pages");
const ler = (arquivo: string) =>
  readFileSync(join(PAGINAS, arquivo), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ");

describe("da ocorrência para a ação [CB-73]", () => {
  it("o nome da ação vinculada aponta para a ação, não para a lista", () => {
    const ocorrencia = ler("OccurrenceDetailPage.tsx");
    expect(ocorrencia).toContain("<Link to={`/acoes?acao=${a.id}`}>{a.title}</Link>");
    expect(ocorrencia).not.toContain('<Link to="/acoes">');
  });

  it("o Plano de ação abre a ação pedida e vai até ela", () => {
    const plano = ler("ActionsPage.tsx");
    expect(plano).toContain('const acaoPedida = parametros.get("acao");');
    expect(plano).toContain(
      "if (acaoPedida && data.actions.some((a) => a.id === acaoPedida)) { setOpenId(acaoPedida); }",
    );
    expect(plano).toContain("id={`acao-${a.id}`}");
    expect(plano).toContain(
      'document.getElementById(`acao-${acaoPedida}`)?.scrollIntoView({ block: "center" });',
    );
  });

  it("com uma ação pedida, o filtro 'minhas' não liga sozinho", () => {
    const plano = ler("ActionsPage.tsx");
    expect(plano).toContain("const minhas = acaoPedida ? [] : data.actions.filter(");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A ação aberta para o achado do simulado diz o que será feito. [B4-C]
 *
 * O nome da ação era o texto do achado, sem campo para a providência, e a
 * prioridade saía sempre Alta. Na sessão, a providência foi escrita no campo
 * do critério de eficácia, e "Alta" foi lido como o nível do risco. Agora o
 * diálogo tem "O que será feito" (sugerido pelo achado, editável), separado
 * do critério, e a prioridade é escolhida por quem abre.
 *
 * A tela não tem renderizador no projeto: o teste lê o componente sem os
 * comentários, como os outros testes de tela.
 */
const TELA = readFileSync(
  join(__dirname, "..", "..", "..", "client", "src", "pages", "EmergenciesPage.tsx"),
  "utf8",
)
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, " ")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
  .replace(/\s+/g, " ");

/** O trecho entre duas âncoras, com a de início exigida uma vez só. */
function trecho(inicio: string, fim: string): string {
  expect(TELA.split(inicio).length - 1, `âncora única: ${inicio}`).toBe(1);
  const a = TELA.indexOf(inicio);
  const b = TELA.indexOf(fim, a);
  expect(b, `fim não encontrado: ${fim}`).toBeGreaterThan(a);
  return TELA.slice(a, b);
}

describe("a ação do achado do simulado [B4-C]", () => {
  it("o nome da ação é a providência escrita, e a prioridade é a escolhida", () => {
    const envio = trecho("await createActionFromFinding({", "});");
    expect(envio).toContain("title: oQueSeraFeito.trim().slice(0, 160),");
    expect(envio).toContain("priority: prioridadeDaAcao,");
    expect(envio).toContain("description: `Achado do simulado de emergência: ${acaoDoAchado.findings}`,");
    expect(envio).toContain("effectiveness_criteria: criterioDaAcao.trim(),");
    expect(TELA).not.toContain('priority: "HIGH"');
    expect(TELA).not.toContain("title: acaoDoAchado.findings");
  });

  it("a providência vem sugerida pelo achado, e a prioridade começa sem escolha", () => {
    const abrir = trecho("setAcaoDoAchado({ drillId: d.id,", "Abrir ação para este achado");
    expect(abrir).toContain("setOQueSeraFeito(d.findings!.slice(0, 160));");
    expect(abrir).toContain('setPrioridadeDaAcao("");');
  });

  it("o diálogo tem os dois campos, obrigatórios, separados do critério", () => {
    const dialogo = trecho('title="Abrir ação para o achado do simulado"', "</Dialog>");
    const providencia = dialogo.indexOf("O que será feito <input value={oQueSeraFeito}");
    const criterio = dialogo.indexOf("{CRITERIO_LABEL}");
    expect(providencia, "campo da providência").toBeGreaterThan(0);
    expect(criterio).toBeGreaterThan(providencia);
    expect(dialogo.slice(providencia, dialogo.indexOf("</label>", providencia))).toContain("required");

    const prioridade = dialogo.slice(
      dialogo.indexOf("Prioridade <select value={prioridadeDaAcao}"),
      dialogo.indexOf("</select>", dialogo.indexOf("Prioridade <select")),
    );
    expect(prioridade).toContain("required");
    expect(prioridade).toContain('<option value="">Escolha</option>');
    expect(prioridade).toContain("Object.entries(ACTION_PRIORITY_LABEL)");
  });

  it("não abre sem providência nem prioridade, no envio e no botão", () => {
    const guarda = trecho("async function abrirAcaoDoAchado(e: FormEvent) {", "setAbrindoAcao(true);");
    expect(guarda).toContain("!oQueSeraFeito.trim() ||");
    expect(guarda).toContain("!prioridadeDaAcao ||");
    const desligado = TELA.slice(
      TELA.lastIndexOf("disabled={", TELA.indexOf('{abrindoAcao ? "Abrindo…" : "Abrir ação"}')),
      TELA.indexOf('{abrindoAcao ? "Abrindo…" : "Abrir ação"}'),
    );
    expect(desligado).toContain("!oQueSeraFeito.trim() ||");
    expect(desligado).toContain("!prioridadeDaAcao ||");
  });
});

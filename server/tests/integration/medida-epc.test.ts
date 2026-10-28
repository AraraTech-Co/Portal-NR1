import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ControlType } from "@prisma/client";
import { CONTROL_TYPE_EXAMPLE, CONTROL_TYPE_LABEL } from "../../../client/src/lib/labels";

/**
 * A proteção coletiva tem nome na tela.
 *
 * Os tipos de medida eram Eliminação, Substituição, Engenharia,
 * Administrativa e EPI. Quem procurou EPC não achou e escolheu EPI: a
 * proteção da máquina saiu como EPI no inventário assinado e na ordem de
 * serviço. Agora o tipo se chama proteção coletiva (EPC), e cada tipo traz
 * um exemplo. [B3-2-D]
 */
const PAGINAS = join(__dirname, "..", "..", "..", "client", "src", "pages");

function semComentarios(codigo: string): string {
  return codigo
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}
const tela = (arquivo: string) =>
  semComentarios(readFileSync(join(PAGINAS, arquivo), "utf8")).replace(/\s+/g, " ");

describe("os nomes dos tipos de medida [B3-2-D]", () => {
  it("a proteção coletiva aparece como tal, com a sigla EPC", () => {
    expect(CONTROL_TYPE_LABEL.ENGINEERING).toMatch(/Proteção coletiva/);
    expect(CONTROL_TYPE_LABEL.ENGINEERING).toMatch(/\bEPC\b/);
    expect(CONTROL_TYPE_LABEL.PPE).toMatch(/\bEPI\b/);
    expect(CONTROL_TYPE_LABEL.PPE).toMatch(/individual/);
  });

  it("todo tipo do banco tem nome e exemplo, na ordem da NR-1", () => {
    expect(Object.keys(CONTROL_TYPE_LABEL)).toEqual([
      "ELIMINATION",
      "SUBSTITUTION",
      "ENGINEERING",
      "ADMINISTRATIVE",
      "PPE",
    ]);
    expect(Object.keys(CONTROL_TYPE_LABEL).sort()).toEqual(Object.values(ControlType).sort());
    for (const tipo of Object.values(ControlType)) {
      expect(CONTROL_TYPE_EXAMPLE[tipo], tipo).toMatch(/Ex\.: \S/);
    }
  });

  it("o exemplo da proteção coletiva fala da proteção de máquina", () => {
    expect(CONTROL_TYPE_EXAMPLE.ENGINEERING).toMatch(/intertravamento/);
  });

  it("o nome cabe entre parênteses no documento sem parêntese dentro", () => {
    for (const nome of Object.values(CONTROL_TYPE_LABEL)) expect(nome).not.toMatch(/[()]/);
  });
});

describe("onde o nome aparece [B3-2-D]", () => {
  it("ao registrar a medida, o exemplo do tipo escolhido aparece junto da escolha", () => {
    const painel = tela("ControlActionPanel.tsx");
    expect(painel).toContain('aria-describedby="ctrl-tipo-exemplo"');
    expect(painel).toContain(
      '<p id="ctrl-tipo-exemplo" className="form-hint ctrl-tipo-exemplo"> <strong>{CONTROL_TYPE_LABEL[controlType]}:</strong> {CONTROL_TYPE_EXAMPLE[controlType]} </p>',
    );
  });

  it("o inventário emitido e a ordem de serviço usam os mesmos nomes", () => {
    expect(tela("DocumentViewPage.tsx")).toContain("label(CONTROL_TYPE_LABEL, c.type)");
    expect(tela("ServiceOrderViewPage.tsx")).toContain("label(CONTROL_TYPE_LABEL, c.type)");
  });
});

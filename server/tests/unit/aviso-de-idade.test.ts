import { describe, expect, it } from "vitest";
import { avisoDeIdade as daTela } from "../../../client/src/lib/idade";
import { avisoDeIdade as doServidor } from "../../src/helper/birth-date";

/** Idade fora de 14 a 100 anos: aviso para conferir a data, sem bloquear. [C4-8] */
const HOJE = new Date(2026, 10, 12);

describe("aviso de idade [C4-8]", () => {
  it("dentro de 14 a 100 anos, nenhum aviso, na tela e no servidor", () => {
    for (const d of ["2012-11-12", "1984-05-25", "1926-11-13"]) {
      expect(daTela(d, HOJE), d).toBeNull();
      expect(doServidor(new Date(`${d}T00:00:00.000Z`), HOJE), d).toBeNull();
    }
  });

  it("fora da faixa, o aviso diz a idade calculada, e a tela e o servidor dizem o mesmo", () => {
    for (const [d, idade] of [["2020-01-05", 6], ["2012-11-13", 13], ["1925-01-01", 101], ["2025-11-12", 1]] as const) {
      const esperado = `Idade calculada: ${idade} ${idade === 1 ? "ano" : "anos"}. Confira a data.`;
      expect(daTela(d, HOJE), d).toBe(esperado);
      expect(doServidor(new Date(`${d}T00:00:00.000Z`), HOJE), d).toBe(esperado);
    }
  });
});

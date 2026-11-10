import { describe, expect, it } from "vitest";
import { empregadorDe, empregadorGravado } from "../../src/helper/empregador";

/** Em nome de quem o documento sai. [C3-4] */
const EMPRESA = { name: "Grupo Americana", taxId: "11222333000181" };

describe("empregadorDe [C3-4]", () => {
  it("a filial com razão social e CNPJ", () => {
    expect(empregadorDe(EMPRESA, { legalName: " Loja Centro Ltda ", taxId: "44555666000102" })).toEqual({
      name: "Loja Centro Ltda",
      taxId: "44555666000102",
    });
  });

  it("razão sem CNPJ, CNPJ sem razão ou razão em branco: a empresa, nunca a mistura", () => {
    for (const filial of [
      { legalName: "Loja Centro Ltda", taxId: null },
      { legalName: null, taxId: "44555666000102" },
      { legalName: "   ", taxId: "44555666000102" },
      null,
    ]) {
      expect(empregadorDe(EMPRESA, filial), JSON.stringify(filial)).toEqual(EMPRESA);
    }
  });
});

describe("empregadorGravado [C3-4]", () => {
  it("o retrato da emissão vale; sem ele, a empresa", () => {
    expect(empregadorGravado({ employerName: "Loja Ltda", employerTaxId: "44555666000102" }, EMPRESA)).toEqual({
      name: "Loja Ltda",
      taxId: "44555666000102",
    });
    expect(empregadorGravado({ employerName: null, employerTaxId: null }, EMPRESA)).toEqual(EMPRESA);
  });
});

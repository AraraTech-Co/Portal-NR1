import { describe, expect, it } from "vitest";
import { parseBirthDate } from "../../src/helper/birth-date";
import { CABECALHO_OFICIAL, lerLinhas } from "../../../client/src/lib/planilha";

/** Data de nascimento: dia real e no passado, sem faixa de idade. [C1-7] */
describe("data de nascimento [C1-7]", () => {
  it("aceita dd/mm/aaaa e AAAA-MM-DD, e grava o dia à meia-noite UTC", () => {
    expect(parseBirthDate("15/03/1990")?.toISOString()).toBe("1990-03-15T00:00:00.000Z");
    expect(parseBirthDate("1990-03-15")?.toISOString()).toBe("1990-03-15T00:00:00.000Z");
  });

  it("vazio é nulo", () => {
    expect(parseBirthDate("")).toBeNull();
    expect(parseBirthDate(undefined)).toBeNull();
    expect(parseBirthDate(null)).toBeNull();
  });

  it("recusa dia que não existe, formato errado e data no futuro", () => {
    expect(() => parseBirthDate("31/02/1990")).toThrow(/não existe/);
    expect(() => parseBirthDate("1990/03/15")).toThrow(/inválida/);
    const amanha = new Date(Date.now() + 2 * 24 * 3600_000);
    const iso = amanha.toISOString().slice(0, 10);
    expect(() => parseBirthDate(iso)).toThrow(/passado/);
  });

  it("sem faixa de idade: quem nasceu ontem ou há 110 anos entra", () => {
    const anteontem = new Date(Date.now() - 2 * 24 * 3600_000).toISOString().slice(0, 10);
    expect(parseBirthDate(anteontem)).not.toBeNull();
    expect(parseBirthDate("01/01/1916")).not.toBeNull();
  });

  it("a planilha lê a coluna nascimento e converte dd/mm/aaaa", () => {
    expect(CABECALHO_OFICIAL).toContain("nascimento");
    const { rows, problems } = lerLinhas(
      "nome;matricula;cpf;nascimento\nMaria de Souza;1023;;15/03/1990",
      [],
      [],
      { papeis: {}, vinculos: {} },
    );
    expect(problems).toEqual([]);
    expect(rows[0]?.birth_date).toBe("1990-03-15");
  });
});

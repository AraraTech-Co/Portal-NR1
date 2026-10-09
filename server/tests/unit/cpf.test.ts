import { describe, expect, it } from "vitest";
import { isValidCpf, normalizeCpf } from "../../src/helper/cpf";

describe("CPF do colaborador (NR-7 7.5.19.1 b) [S5-N]", () => {
  it("aceita CPF válido, com ou sem pontuação", () => {
    expect(isValidCpf("529.982.247-25")).toBe(true);
    expect(isValidCpf("52998224725")).toBe(true);
  });

  it("recusa dígito verificador errado", () => {
    expect(isValidCpf("529.982.247-24")).toBe(false);
    expect(isValidCpf("12345678900")).toBe(false);
  });

  it("recusa sequência repetida, que passa na conta mas não é CPF", () => {
    expect(isValidCpf("111.111.111-11")).toBe(false);
    expect(isValidCpf("00000000000")).toBe(false);
  });

  it("recusa tamanho errado — inclusive CNPJ", () => {
    expect(isValidCpf("5299822472")).toBe(false);
    expect(isValidCpf("30589468000124")).toBe(false);
  });

  it("guarda só os dígitos", () => {
    expect(normalizeCpf("529.982.247-25")).toBe("52998224725");
  });
});

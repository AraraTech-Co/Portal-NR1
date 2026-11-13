import { describe, expect, it } from "vitest";
import {
  checkPayslip,
  extractEmployeeEntries,
  extractEmployer,
  podeJustificar,
  samePayrollCode,
  type PayslipExpectation,
} from "../../src/helper/payslip-check";
import { splitBatchPages } from "../../src/helper/payslip-batch";

/**
 * A empresa que paga, lida do cabeçalho do holerite: código da folha >
 * matrícula. A matrícula 153 existe em empresas diferentes do grupo para
 * pessoas diferentes; o código impresso antes da razão social desempata.
 *
 * O texto segue o que o leitor de PDF devolve do layout IOB — itens unidos
 * por espaço, sem quebra de linha —, com empresa e pessoa FICTÍCIAS.
 */
const cabecalho = (codigo: string, cnpj = "11.222.333/0001-44") =>
  `Código - Nome do Funcionário  IOB Office Folha de Pagamento  C.B.O.   Emp. Local   Depto.   Setor   Seção   Fl.  Cód.   Descrição   Referência   Vencimentos   Descontos ${codigo} - EMPRESA DEMONSTRACAO LTDA  R DAS FLORES, 260 - AMERICANA ${cnpj} 2124-05   00002   00000   00000`;

const holerite = (codigo: string, cnpj?: string) =>
  `${cabecalho(codigo, cnpj)} OUTUBRO/2026 Data do Crédito: 20/10/2026 1 000153 - MARIA SOUZA LIMA   13/07/2024 Data Admissão ADIANTAMENTO DE SALÁRIO 1520 1.408,95 TOTAL LÍQUIDO 1.408,95`;

const esperado = (over: Partial<PayslipExpectation> = {}): PayslipExpectation => ({
  registration: "153",
  name: "Maria Souza Lima",
  referenceMonth: 10,
  referenceYear: 2026,
  admittedAt: new Date("2024-07-13"),
  ...over,
});

describe("a empresa que paga, lida do cabeçalho", () => {
  it("lê o código antes da razão social, e não o número do endereço", () => {
    expect(extractEmployer(holerite("0682"))).toEqual({ code: "0682", cnpj: "11.222.333/0001-44" });
  });

  it("com quebras de linha, como em outro leitor, lê o mesmo", () => {
    const texto = holerite("1238").replace(/ {2,}/g, "\n");
    expect(extractEmployer(texto)?.code).toBe("1238");
  });

  it("as duas vias na página: vale o primeiro cabeçalho", () => {
    expect(extractEmployer(`${holerite("0683")} ${holerite("0683")}`)?.code).toBe("0683");
  });

  it("sem CNPJ não há cabeçalho de empresa para ler", () => {
    const semCnpj = holerite("0682").replace("11.222.333/0001-44", "");
    expect(extractEmployer(semCnpj)).toBeNull();
  });

  it("código longe demais do CNPJ não é o da empresa", () => {
    const longe = `0682 - EMPRESA DEMONSTRACAO LTDA ${"x".repeat(220)} 11.222.333/0001-44`;
    expect(extractEmployer(longe)).toBeNull();
  });

  it("número colado em outro número não é código: o RG e a data ficam de fora", () => {
    const texto = `R.G.: 43.956.032-9 - EMPRESA 11.222.333/0001-44`;
    expect(extractEmployer(texto)).toBeNull();
  });

  it("o cabeçalho da empresa não vira pessoa", () => {
    expect(extractEmployeeEntries(holerite("0682"))).toEqual([
      { registration: "000153", name: "MARIA SOUZA LIMA" },
    ]);
  });
});

describe("código da folha igual", () => {
  it("zero à esquerda é enfeite; letra compara sem maiúscula", () => {
    expect(samePayrollCode("0682", "682")).toBe(true);
    expect(samePayrollCode(" 0682 ", "0682")).toBe(true);
    expect(samePayrollCode("ab-1", "AB-1")).toBe(true);
    expect(samePayrollCode("0682", "0683")).toBe(false);
    expect(samePayrollCode("0", "00")).toBe(true);
    expect(samePayrollCode("10", "1")).toBe(false);
  });
});

describe("a conferência pela empresa", () => {
  it("a mesma empresa confere", () => {
    const r = checkPayslip(holerite("0682"), esperado({ payrollCode: "682" }));
    expect(r.blockers).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it("outra empresa, mesma matrícula e mesmo nome: recusa que justificativa não cobre", () => {
    const r = checkPayslip(holerite("0683"), esperado({ payrollCode: "0682" }));
    expect(r.ok).toBe(false);
    expect(r.fatalBlockers).toEqual([
      "O documento é da empresa código 0683, e a filial da pessoa tem o código 0682.",
    ]);
    expect(podeJustificar(r)).toBe(false);
  });

  it("filial sem código da folha: não há o que comparar, confere como antes", () => {
    for (const payrollCode of [null, undefined, ""]) {
      expect(checkPayslip(holerite("0683"), esperado({ payrollCode })).ok).toBe(true);
    }
  });

  it("documento sem cabeçalho legível: não se confere a empresa", () => {
    const semCnpj = holerite("0683").replace("11.222.333/0001-44", "");
    expect(checkPayslip(semCnpj, esperado({ payrollCode: "0682" })).ok).toBe(true);
  });
});

describe("o lote separa as páginas pela empresa e pela matrícula", () => {
  const semCabecalho = (codigo: string) => holerite(codigo).replace("11.222.333/0001-44", "");

  it("a 153 da loja seguida da 153 da AG são duas partes, e nenhuma é repetida", () => {
    const partes = splitBatchPages([holerite("0682"), holerite("0683")]);
    expect(partes.map((p) => [p.pages, p.employerCode, p.problem])).toEqual([
      [[1], "0682", null],
      [[2], "0683", null],
    ]);
  });

  it("a segunda folha da mesma pessoa, na mesma empresa, junta", () => {
    const partes = splitBatchPages([holerite("0682"), holerite("682")]);
    expect(partes.map((p) => [p.pages, p.problem])).toEqual([[[1, 2], null]]);
  });

  it("a mesma matrícula em trechos separados, de empresas diferentes, sai", () => {
    const outra = holerite("0682").replace("000153 - MARIA SOUZA LIMA", "000200 - JOAO PEREIRA");
    const partes = splitBatchPages([holerite("0682"), outra, holerite("0683")]);
    expect(partes.map((p) => p.problem)).toEqual([null, null, null]);
  });

  it("sem o código numa das páginas, não junta e recusa as duas", () => {
    const partes = splitBatchPages([holerite("0682"), semCabecalho("0682")]);
    expect(partes.map((p) => [p.pages, p.problem])).toEqual([
      [[1], "REPETIDA"],
      [[2], "REPETIDA"],
    ]);
  });

  it("sem o código em nenhuma, segue como antes: junta as seguidas", () => {
    const partes = splitBatchPages([semCabecalho("0682"), semCabecalho("0682")]);
    expect(partes.map((p) => [p.pages, p.employerCode, p.problem])).toEqual([[[1, 2], null, null]]);
  });
});

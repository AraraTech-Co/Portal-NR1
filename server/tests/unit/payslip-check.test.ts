import { describe, expect, it } from "vitest";
import {
  checkPayslip,
  extractCompetences,
  extractEmployeeEntries,
  podeJustificar,
  type PayslipExpectation,
} from "../../src/helper/payslip-check";

/**
 * Texto no formato que a folha (IOB) gera, com pessoa e valores FICTÍCIOS.
 * Holerite de verdade não entra em teste: é salário de gente real.
 */
const HOLERITE = `Código - Nome do Funcionário
IOB Office Folha de Pagamento
C.B.O. Emp. Local Depto. Setor Seção Fl.
0683 - EMPRESA DEMONSTRACAO LTDA
R DAS FLORES, 100 - AMERICANA
11.222.333/0001-44
5201-10 0002 0000 0000
SETEMBRO/2026
Data do Crédito: 18/09/2026
1	000074 - MARIA SOUZA LIMA 25/04/2019
Data Admissão
ADIANTAMENTO DE SALÁRIO	1520 1.408,95	40,0000
Total de Vencimentos Total de Descontos
TOTAL LÍQUIDO 1.408,95
CTPS n. 22213 /00268
R.G.: 43.956.032-9 T.P.: MENSALISTA`;

const esperado = (over: Partial<PayslipExpectation> = {}): PayslipExpectation => ({
  registration: "000074",
  name: "Maria Souza Lima",
  referenceMonth: 9,
  referenceYear: 2026,
  admittedAt: new Date("2019-04-25"),
  ...over,
});

describe("leitura do holerite", () => {
  it("acha matrícula e nome uma única vez, mesmo com as duas vias na página", () => {
    const duasVias = `${HOLERITE}\n${HOLERITE}`;
    expect(extractEmployeeEntries(duasVias)).toEqual([
      { registration: "000074", name: "MARIA SOUZA LIMA" },
    ]);
  });

  it("não confunde linha de verba com pessoa", () => {
    const entries = extractEmployeeEntries(HOLERITE);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("MARIA SOUZA LIMA");
  });

  it("não confunde data de crédito com competência", () => {
    // "Data do Crédito: 18/09/2026" num holerite de AGOSTO não torna o
    // documento de setembro — era o defeito que o teste de integração pegou.
    const agosto = HOLERITE.replace("SETEMBRO/2026", "AGOSTO/2026");
    expect(extractCompetences(agosto)).toEqual([{ month: 8, year: 2026 }]);
  });

  it("lê competência por extenso e numérica", () => {
    expect(extractCompetences("SETEMBRO/2026")).toEqual([{ month: 9, year: 2026 }]);
    expect(extractCompetences("competência 09/2026")).toEqual([{ month: 9, year: 2026 }]);
  });
});

describe("matrícula alfanumérica (COL-001), como neste portal", () => {
  const COM_CODIGO = HOLERITE.replace("000074 - MARIA SOUZA LIMA", "COL-001 - MARIA SOUZA LIMA");

  it("acha a pessoa pelo código", () => {
    expect(extractEmployeeEntries(COM_CODIGO)).toEqual([
      { registration: "COL-001", name: "MARIA SOUZA LIMA" },
    ]);
  });

  it("passa com o código certo e trava com o de outra pessoa", () => {
    expect(checkPayslip(COM_CODIGO, esperado({ registration: "COL-001" })).ok).toBe(true);
    expect(checkPayslip(COM_CODIGO, esperado({ registration: "COL-002" })).ok).toBe(false);
  });

  it("não diferencia maiúsculas: folha e cadastro divergem nisso", () => {
    expect(checkPayslip(COM_CODIGO, esperado({ registration: "col-001" })).ok).toBe(true);
  });
});

describe("as três travas", () => {
  it("passa quando matrícula, nome e competência batem", () => {
    const result = checkPayslip(HOLERITE, esperado());
    expect(result.blockers).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("trava matrícula de outra pessoa", () => {
    const result = checkPayslip(HOLERITE, esperado({ registration: "000075" }));
    expect(result.ok).toBe(false);
    expect(result.blockers[0]).toContain("matrícula do documento é 000074");
  });

  it("aceita zero à esquerda: cadastro 74, documento 000074", () => {
    expect(checkPayslip(HOLERITE, esperado({ registration: "74" })).ok).toBe(true);
  });

  it("trava nome de outra pessoa", () => {
    const result = checkPayslip(HOLERITE, esperado({ name: "João Pereira" }));
    expect(result.ok).toBe(false);
    expect(result.blockers.join(" ")).toContain("nome do documento");
  });

  it("aceita cadastro mais curto que o documento", () => {
    expect(checkPayslip(HOLERITE, esperado({ name: "Maria Lima" })).ok).toBe(true);
  });

  it("trava cadastro mais completo que o documento", () => {
    expect(checkPayslip(HOLERITE, esperado({ name: "Maria Souza Lima Neto" })).ok).toBe(false);
  });

  it("trava competência diferente da que o RH está publicando", () => {
    const result = checkPayslip(HOLERITE, esperado({ referenceMonth: 8 }));
    expect(result.ok).toBe(false);
    expect(result.blockers.join(" ")).toContain("agosto/2026");
  });

  it("trava PDF sem texto (digitalizado)", () => {
    const result = checkPayslip("   ", esperado());
    expect(result.ok).toBe(false);
    expect(result.blockers[0]).toContain("digitalizado");
  });

  it("trava arquivo com mais de uma pessoa", () => {
    const juntao = `${HOLERITE}\n1\t000075 - JOAO PEREIRA SILVA 02/01/2020\n`;
    const result = checkPayslip(juntao, esperado());
    expect(result.ok).toBe(false);
    expect(result.blockers[0]).toContain("mais de uma pessoa");
  });
});

describe("admissão confirma, mas não trava", () => {
  it("avisa quando a admissão do cadastro não está no documento", () => {
    const result = checkPayslip(HOLERITE, esperado({ admittedAt: new Date("2020-01-02") }));
    expect(result.ok).toBe(true);
    expect(result.warnings.join(" ")).toContain("02/01/2020");
  });

  it("silêncio quando a admissão bate", () => {
    expect(checkPayslip(HOLERITE, esperado()).warnings).toEqual([]);
  });
});

/**
 * A exceção com justificativa nasceu para holerite CERTO em layout que o
 * portal não lê [CB-28]; passou a valer para qualquer recusa, e com uma frase
 * qualquer o holerite de um trabalhador ia para outro. [B3-3-A] [S5-G]
 */
describe("o que a justificativa cobre [B3-3-A]", () => {
  it("documento de outra pessoa: recusa sem exceção, pela matrícula e pelo nome", () => {
    const outraPessoa = checkPayslip(HOLERITE, esperado({
      registration: "19",
      name: "Carlos Pereira",
    }));
    expect(outraPessoa.ok).toBe(false);
    expect(podeJustificar(outraPessoa), "é o defeito do achado").toBe(false);
    expect(outraPessoa.fatalBlockers.join(" ")).toContain("matrícula do documento");
    expect(outraPessoa.fatalBlockers.join(" ")).toContain("nome do documento");
  });

  it("só a matrícula de outra pessoa já basta para não ter exceção", () => {
    const check = checkPayslip(HOLERITE, esperado({ registration: "000075" }));
    expect(podeJustificar(check)).toBe(false);
  });

  it("só o nome de outra pessoa já basta para não ter exceção", () => {
    const check = checkPayslip(HOLERITE, esperado({ name: "João Pereira Silva" }));
    expect(podeJustificar(check)).toBe(false);
  });

  it("competência que o documento afirma e não bate: sem exceção", () => {
    const check = checkPayslip(HOLERITE, esperado({ referenceMonth: 8 }));
    expect(podeJustificar(check)).toBe(false);
    expect(check.fatalBlockers.join(" ")).toContain("competência");
  });

  it("arquivo com mais de uma pessoa: sem exceção, senão entrega a folha das outras", () => {
    const juntao = `${HOLERITE}\n1\t000075 - JOAO PEREIRA SILVA 02/01/2020\n`;
    expect(podeJustificar(checkPayslip(juntao, esperado()))).toBe(false);
  });

  it("PDF digitalizado continua publicável com justificativa [CB-28]", () => {
    const check = checkPayslip("   ", esperado());
    expect(check.ok).toBe(false);
    expect(podeJustificar(check), "é o caso para o qual a exceção foi feita").toBe(true);
    expect(check.fatalBlockers).toEqual([]);
  });

  it("layout que não traz matrícula e nome continua publicável com justificativa [CB-28]", () => {
    const semPessoa = `Demonstrativo de pagamento
EMPRESA DEMONSTRACAO LTDA
SETEMBRO/2026
Vencimentos 1.408,95
Descontos 0,00
Total liquido 1.408,95
Assinatura do empregado`;
    const check = checkPayslip(semPessoa, esperado());
    expect(check.ok).toBe(false);
    expect(check.blockers.join(" ")).toContain("Não encontrei matrícula e nome");
    expect(podeJustificar(check)).toBe(true);
  });

  it("holerite que confere não tem recusa nenhuma", () => {
    const check = checkPayslip(HOLERITE, esperado());
    expect(check.ok).toBe(true);
    expect(check.fatalBlockers).toEqual([]);
    expect(podeJustificar(check), "sem recusa não há o que justificar").toBe(false);
  });
});

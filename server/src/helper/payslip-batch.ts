/**
 * A folha do mês num arquivo só: em que páginas está cada pessoa.
 *
 * O arquivo da folha (IOB Office, por exemplo) traz uma pessoa por página, com
 * "000010 - NOME" e a admissão no cabeçalho. Quem tem mais verbas do que cabe
 * numa folha ocupa duas páginas seguidas, com o mesmo cabeçalho. A leitura de
 * cada página é a mesma do envio individual (`extractEmployeeEntries`); aqui
 * só se decide o que vai junto. [B4-F]
 *
 * Função pura sobre o texto de cada página: dá para testar sem PDF e sem banco.
 */
import {
  extractEmployeeEntries,
  extractEmployer,
  samePayrollCode,
  sameRegistration,
} from "./payslip-check";

export type BatchPartProblem =
  /** Página sem "matrícula - nome": resumo da folha, página em branco. */
  | "SEM_FUNCIONARIO"
  /** Mais de uma pessoa na mesma página: publicar entregaria a de outra. */
  | "VARIAS_PESSOAS"
  /**
   * A mesma matrícula em dois trechos separados do arquivo. Não há como saber
   * qual é o holerite certo, então nenhum dos dois sai.
   */
  | "REPETIDA";

/**
 * A mesma pessoa é a mesma matrícula NA MESMA EMPRESA: a 153 da loja e a 153
 * da AG são duas. Página sem o código da empresa legível não prova que é
 * outra, então conta como a mesma para recusar o repetido, e como outra para
 * não juntar páginas. Na dúvida, nenhuma página vai para quem não é dela.
 */
function mesmaEmpresa(a: string | null, b: string | null, semCodigo: boolean): boolean {
  if (a === null || b === null) return a === b || semCodigo;
  return samePayrollCode(a, b);
}

export type BatchPart = {
  /** Páginas da parte, contadas a partir de 1, como o RH as vê no arquivo. */
  pages: number[];
  registration: string | null;
  /** O nome como está impresso no documento. */
  name: string | null;
  /** O código da empresa impresso no cabeçalho (0682), quando se lê. */
  employerCode: string | null;
  /** O texto das páginas da parte, para o `checkPayslip`. */
  text: string;
  problem: BatchPartProblem | null;
};

export function splitBatchPages(pageTexts: string[]): BatchPart[] {
  const parts: BatchPart[] = [];

  pageTexts.forEach((text, index) => {
    const page = index + 1;
    const entries = extractEmployeeEntries(text);
    const employerCode = extractEmployer(text)?.code ?? null;

    if (entries.length !== 1) {
      parts.push({
        pages: [page],
        registration: null,
        name: null,
        employerCode,
        text,
        problem: entries.length === 0 ? "SEM_FUNCIONARIO" : "VARIAS_PESSOAS",
      });
      return;
    }

    const [entry] = entries;
    const last = parts[parts.length - 1];
    // A segunda folha da mesma pessoa vem logo depois da primeira. Página
    // sem pessoa, ou com mais de uma, não tem matrícula: não junta ninguém.
    // A mesma matrícula de outra empresa é outra pessoa: não junta.
    if (
      last?.registration &&
      sameRegistration(last.registration, entry.registration) &&
      mesmaEmpresa(last.employerCode, employerCode, false)
    ) {
      last.pages.push(page);
      last.text += `\n${text}`;
      return;
    }

    parts.push({
      pages: [page],
      registration: entry.registration,
      name: entry.name,
      employerCode,
      text,
      problem: null,
    });
  });

  for (const part of parts) {
    const registration = part.registration;
    if (!registration) continue;
    const repeated = parts.some(
      (other) =>
        other !== part &&
        other.registration !== null &&
        sameRegistration(other.registration, registration) &&
        mesmaEmpresa(other.employerCode, part.employerCode, true),
    );
    if (repeated) part.problem = "REPETIDA";
  }

  return parts;
}

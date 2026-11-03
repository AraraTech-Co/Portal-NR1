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
import { extractEmployeeEntries, sameRegistration } from "./payslip-check";

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

export type BatchPart = {
  /** Páginas da parte, contadas a partir de 1, como o RH as vê no arquivo. */
  pages: number[];
  registration: string | null;
  /** O nome como está impresso no documento. */
  name: string | null;
  /** O texto das páginas da parte, para o `checkPayslip`. */
  text: string;
  problem: BatchPartProblem | null;
};

export function splitBatchPages(pageTexts: string[]): BatchPart[] {
  const parts: BatchPart[] = [];

  pageTexts.forEach((text, index) => {
    const page = index + 1;
    const entries = extractEmployeeEntries(text);

    if (entries.length !== 1) {
      parts.push({
        pages: [page],
        registration: null,
        name: null,
        text,
        problem: entries.length === 0 ? "SEM_FUNCIONARIO" : "VARIAS_PESSOAS",
      });
      return;
    }

    const [entry] = entries;
    const last = parts[parts.length - 1];
    // A segunda folha da mesma pessoa vem logo depois da primeira. Página
    // sem pessoa, ou com mais de uma, não tem matrícula: não junta ninguém.
    if (last?.registration && sameRegistration(last.registration, entry.registration)) {
      last.pages.push(page);
      last.text += `\n${text}`;
      return;
    }

    parts.push({
      pages: [page],
      registration: entry.registration,
      name: entry.name,
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
        sameRegistration(other.registration, registration),
    );
    if (repeated) part.problem = "REPETIDA";
  }

  return parts;
}

/**
 * Confere se o holerite é MESMO da pessoa a quem o RH atribuiu o arquivo.
 *
 * O nome do arquivo não é prova de nada — quem manda o lote é o escritório de
 * contabilidade, e um arquivo trocado significa salário de um aparecendo para
 * outro. Então o que vale é o que está IMPRESSO no documento.
 *
 * Três travas (qualquer uma falhando, aquele holerite não é publicado):
 *   1. matrícula   2. nome   3. competência
 *
 * E uma confirmação, que avisa mas não trava: a data de admissão.
 *
 * Tudo aqui é função pura sobre o texto extraído do PDF — dá para testar sem
 * PDF, sem banco e sem rede.
 */

export type PayslipExpectation = {
  registration: string;
  name: string;
  /** Competência escolhida pelo RH no envio. */
  referenceMonth: number;
  referenceYear: number;
  admittedAt: Date | null;
};

export type PayslipCheck = {
  ok: boolean;
  /** Motivos de recusa, em português, prontos para a tela. */
  blockers: string[];
  /** Divergências que não impedem a publicação. */
  warnings: string[];
};

const MONTHS = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const NAME_NOISE = new Set(["de", "da", "do", "das", "dos", "e"]);

function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function nameTokens(value: string): string[] {
  return fold(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2 && !NAME_NOISE.has(token) && !/^\d+$/.test(token));
}

/**
 * "000074" e "74" são a mesma matrícula: zero à esquerda é enfeite da folha.
 * Matrícula alfanumérica ("COL-001") é comparada como texto, sem diferenciar
 * maiúsculas — folha e cadastro divergem nisso com frequência.
 */
function sameRegistration(a: string, b: string): boolean {
  const x = a.trim();
  const y = b.trim();
  if (x.toUpperCase() === y.toUpperCase()) return true;
  if (!/^\d+$/.test(x) || !/^\d+$/.test(y)) return false;
  return x.replace(/^0+/, "") === y.replace(/^0+/, "");
}

/** Terminação de razão social: o cabeçalho da empresa tem o MESMO formato. */
const COMPANY_SUFFIX = /\b(ltda?|lt|s\/?a|sa|me|mei|eireli|epp|cia|companhia)\.?$/;

/**
 * Pares "matrícula - nome" do documento.
 *
 * O layout imprime "000074 - DANIEL MIRAGE POSELLA   25/04/2019" para a pessoa
 * — e "0683 - AG AMERICANA SERVIÇOS LT" para a EMPRESA, no mesmo formato. O que
 * separa os dois é a data de admissão logo depois do nome da pessoa; quando o
 * layout não a imprime, cai na segunda regra: razão social termina em LTDA, ME,
 * S/A e companhia. A segunda via repete o mesmo par, então deduplicamos.
 */
export function extractEmployeeEntries(text: string): { registration: string; name: string }[] {
  // A matrícula vem como dígitos ("000074") ou como código ("COL-001"); o que
  // identifica a linha da pessoa é o " - " seguido de um nome de gente.
  const pattern =
    /([A-Za-z0-9][A-Za-z0-9.\-\/]{1,19})\s+-\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\s]{4,60}?)(?=\s{2,}|\s*\d{2}\/\d{2}\/\d{4}|\n|$)/g;

  const withDate = new Map<string, string>();
  const withoutDate = new Map<string, string>();

  for (const match of text.matchAll(pattern)) {
    const registration = match[1];
    const name = match[2].replace(/\s+/g, " ").trim();
    // Linha de verba ("1520 ADIANTAMENTO DE SALÁRIO") também casa o formato;
    // o que separa é o nome ter ao menos duas palavras de gente.
    if (nameTokens(name).length < 2) continue;

    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 24);
    const target = /\d{2}\/\d{2}\/\d{4}/.test(after) ? withDate : withoutDate;
    if (!target.has(registration)) target.set(registration, name);
  }

  const chosen =
    withDate.size > 0
      ? withDate
      : new Map([...withoutDate].filter(([, name]) => !COMPANY_SUFFIX.test(fold(name))));

  return [...chosen].map(([registration, name]) => ({ registration, name }));
}

/**
 * Competências do documento: "SETEMBRO/2026" ou "09/2026".
 *
 * Antes de procurar a forma numérica, as datas completas saem do texto: em
 * "Data do Crédito: 18/09/2026" o "09/2026" NÃO é competência, e ler assim
 * fazia o holerite de agosto passar por setembro (pego pelo teste de
 * integração em 18/09/2026).
 */
export function extractCompetences(text: string): { month: number; year: number }[] {
  const out: { month: number; year: number }[] = [];
  const seen = new Set<string>();
  const push = (month: number, year: number) => {
    const key = `${month}/${year}`;
    if (month >= 1 && month <= 12 && year >= 2000 && year <= 2100 && !seen.has(key)) {
      seen.add(key);
      out.push({ month, year });
    }
  };

  const folded = fold(text);
  for (const match of folded.matchAll(/([a-z]{4,9})\s*\/\s*(\d{4})/g)) {
    const month = MONTHS.findIndex((name) => fold(name) === match[1]);
    if (month >= 0) push(month + 1, Number(match[2]));
  }
  const semDatas = text.replace(/\d{1,2}\/\d{1,2}\/\d{2,4}/g, " ");
  for (const match of semDatas.matchAll(/(?<!\d)(0[1-9]|1[0-2])\s*\/\s*(\d{4})(?!\d)/g)) {
    push(Number(match[1]), Number(match[2]));
  }
  return out;
}

/** Datas dd/mm/aaaa do documento, para conferir a admissão. */
export function extractDates(text: string): string[] {
  return [...text.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].map(
    (m) => `${m[3]}-${m[2]}-${m[1]}`,
  );
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const MONTH_LABEL = (month: number, year: number) => `${MONTHS[month - 1]}/${year}`;

/**
 * A conferência em si. `text` é o texto extraído do PDF; vazio significa
 * documento sem camada de texto (digitalizado), e aí não há o que conferir.
 */
export function checkPayslip(text: string, expected: PayslipExpectation): PayslipCheck {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (text.trim().length < 40) {
    return {
      ok: false,
      blockers: [
        "Não foi possível ler o texto deste PDF — provavelmente é digitalizado. Peça ao escritório o arquivo gerado pela folha.",
      ],
      warnings,
    };
  }

  const entries = extractEmployeeEntries(text);
  if (entries.length === 0) {
    blockers.push("Não encontrei matrícula e nome no documento.");
  } else if (entries.length > 1) {
    blockers.push(
      `Este arquivo tem mais de uma pessoa (matrículas ${entries
        .map((entry) => entry.registration)
        .join(", ")}). Envie um PDF por colaborador.`,
    );
  } else {
    const [entry] = entries;

    if (!sameRegistration(entry.registration, expected.registration)) {
      blockers.push(
        `A matrícula do documento é ${entry.registration} e a da pessoa escolhida é ${expected.registration}.`,
      );
    }

    const expectedTokens = nameTokens(expected.name);
    const documentTokens = new Set(nameTokens(entry.name));
    const missing = expectedTokens.filter((token) => !documentTokens.has(token));
    if (expectedTokens.length === 0 || missing.length > 0) {
      blockers.push(`O nome do documento é ${entry.name} e o do cadastro é ${expected.name}.`);
    }
  }

  const competences = extractCompetences(text);
  const matchesCompetence = competences.some(
    (competence) =>
      competence.month === expected.referenceMonth && competence.year === expected.referenceYear,
  );
  if (competences.length === 0) {
    blockers.push("Não encontrei a competência (mês/ano) no documento.");
  } else if (!matchesCompetence) {
    blockers.push(
      `O documento é da competência ${MONTH_LABEL(competences[0].month, competences[0].year)} e você está publicando ${MONTH_LABEL(expected.referenceMonth, expected.referenceYear)}.`,
    );
  }

  if (expected.admittedAt) {
    const admitted = isoDay(expected.admittedAt);
    const dates = extractDates(text);
    if (dates.length > 0 && !dates.includes(admitted)) {
      warnings.push(
        `A data de admissão do cadastro (${admitted.split("-").reverse().join("/")}) não aparece no documento. Confira o cadastro.`,
      );
    }
  }

  return { ok: blockers.length === 0, blockers, warnings };
}

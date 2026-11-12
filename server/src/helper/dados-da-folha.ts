import type { Prisma } from "@prisma/client";

/**
 * Os dados da planilha da folha que o portal guarda à parte da ficha:
 * a mesma leitura para a importação e para a edição à mão. [PF-2]
 *
 * O salário não está aqui de propósito (decisão do Leonardo, 12/11/2026).
 */

type Tipo = "texto" | "data" | "inteiro" | "uf" | "competencia";

/** Nome na API (snake_case) → coluna, rótulo e tipo. */
export const CAMPOS_DA_FOLHA = {
  rg: { coluna: "rg", rotulo: "RG", tipo: "texto" },
  pis: { coluna: "pis", rotulo: "PIS", tipo: "texto" },
  ctps_number: { coluna: "ctpsNumber", rotulo: "CTPS", tipo: "texto" },
  ctps_series: { coluna: "ctpsSeries", rotulo: "série da CTPS", tipo: "texto" },
  ctps_uf: { coluna: "ctpsUf", rotulo: "UF da CTPS", tipo: "uf" },
  salary_type: { coluna: "salaryType", rotulo: "tipo de salário", tipo: "texto" },
  fgts_option_date: { coluna: "fgtsOptionDate", rotulo: "opção do FGTS", tipo: "data" },
  dependents: { coluna: "dependents", rotulo: "dependentes", tipo: "inteiro" },
  education_level: { coluna: "educationLevel", rotulo: "grau de instrução", tipo: "texto" },
  nationality_code: { coluna: "nationalityCode", rotulo: "nacionalidade", tipo: "texto" },
  address: { coluna: "address", rotulo: "endereço", tipo: "texto" },
  address_complement: { coluna: "addressComplement", rotulo: "complemento", tipo: "texto" },
  district: { coluna: "district", rotulo: "bairro", tipo: "texto" },
  city: { coluna: "city", rotulo: "cidade", tipo: "texto" },
  termination_date: { coluna: "terminationDate", rotulo: "data da rescisão", tipo: "data" },
  termination_cause: { coluna: "terminationCause", rotulo: "causa da rescisão", tipo: "texto" },
  movement_type: { coluna: "movementType", rotulo: "tipo de movimento", tipo: "texto" },
  competence: { coluna: "competence", rotulo: "competência", tipo: "competencia" },
} as const satisfies Record<string, { coluna: string; rotulo: string; tipo: Tipo }>;

export type CampoDaFolha = keyof typeof CAMPOS_DA_FOLHA;
export type ColunaDaFolha = (typeof CAMPOS_DA_FOLHA)[CampoDaFolha]["coluna"];
export type DadosDaFolha = Pick<Prisma.EmployeePayrollDataUncheckedCreateInput, ColunaDaFolha>;

export class DadoDaFolhaInvalido extends Error {
  status = 400;
}

function valor(campo: CampoDaFolha, bruto: unknown): string | number | Date | null {
  const { rotulo, tipo } = CAMPOS_DA_FOLHA[campo];
  if (bruto === null || bruto === undefined) return null;
  if (typeof bruto !== "string" && typeof bruto !== "number") {
    throw new DadoDaFolhaInvalido(`${rotulo}: valor inválido.`);
  }
  const texto = String(bruto).trim();
  if (texto === "") return null;
  if (texto.length > 200) throw new DadoDaFolhaInvalido(`${rotulo}: passa de 200 caracteres.`);
  if (tipo === "data") {
    const dia = texto.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(Date.parse(`${dia}T00:00:00Z`))) {
      throw new DadoDaFolhaInvalido(`${rotulo}: data inválida — use AAAA-MM-DD.`);
    }
    return new Date(`${dia}T00:00:00.000Z`);
  }
  if (tipo === "inteiro") {
    if (!/^\d{1,3}$/.test(texto)) throw new DadoDaFolhaInvalido(`${rotulo}: use um número inteiro.`);
    return Number(texto);
  }
  if (tipo === "uf") {
    const uf = texto.toUpperCase();
    if (!/^[A-Z]{2}$/.test(uf)) throw new DadoDaFolhaInvalido(`${rotulo}: use a sigla do estado, como SP.`);
    return uf;
  }
  if (tipo === "competencia") {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(texto)) {
      throw new DadoDaFolhaInvalido(`${rotulo}: use AAAA-MM.`);
    }
    return texto;
  }
  return texto;
}

/**
 * Lê só os campos conhecidos que vieram no corpo. Campo ausente não entra
 * (a edição à mão manda só o que mudou); campo vazio vira nulo.
 */
export function lerDadosDaFolha(entrada: unknown): DadosDaFolha {
  if (entrada === null || entrada === undefined) return {};
  if (typeof entrada !== "object" || Array.isArray(entrada)) {
    throw new DadoDaFolhaInvalido("Dados da folha inválidos.");
  }
  const dados: DadosDaFolha = {};
  for (const [campo, def] of Object.entries(CAMPOS_DA_FOLHA) as [CampoDaFolha, (typeof CAMPOS_DA_FOLHA)[CampoDaFolha]][]) {
    if (!(campo in (entrada as Record<string, unknown>))) continue;
    (dados as Record<string, unknown>)[def.coluna] = valor(campo, (entrada as Record<string, unknown>)[campo]);
  }
  return dados;
}

function igual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return (a ?? null) === (b ?? null);
}

/** Os rótulos dos campos que mudariam, para o relatório e a trilha (sem os valores). */
export function camposQueMudam(
  atual: Partial<Record<ColunaDaFolha, unknown>> | null,
  novos: DadosDaFolha,
): string[] {
  const out: string[] = [];
  for (const def of Object.values(CAMPOS_DA_FOLHA)) {
    if (!(def.coluna in novos) || def.coluna === "competence") continue;
    if (!igual(atual?.[def.coluna], (novos as Record<string, unknown>)[def.coluna])) out.push(def.rotulo);
  }
  return out;
}

/** Só os que têm valor: a planilha não apaga um dado com uma célula em branco. */
export function soPreenchidos(dados: DadosDaFolha): DadosDaFolha {
  return Object.fromEntries(Object.entries(dados).filter(([, v]) => v !== null)) as DadosDaFolha;
}

/** Na API, de volta em snake_case e com as datas em AAAA-MM-DD. */
export function dadosDaFolhaParaApi(
  linha: Partial<Record<ColunaDaFolha, unknown>> & { updatedAt?: Date } | null,
): Record<string, string | number | null> | null {
  if (!linha) return null;
  const out: Record<string, string | number | null> = {};
  for (const [campo, def] of Object.entries(CAMPOS_DA_FOLHA)) {
    const v = linha[def.coluna];
    out[campo] = v instanceof Date ? v.toISOString().slice(0, 10) : ((v as string | number | null) ?? null);
  }
  out.updated_at = linha.updatedAt ? linha.updatedAt.toISOString() : null;
  return out;
}

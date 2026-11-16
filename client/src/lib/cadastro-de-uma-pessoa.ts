import type { ImportRow } from "@/api/people";

/**
 * O formulário "Cadastrar uma pessoa" de Conta e usuários: o que ele exige
 * e como vira a pessoa que a rota de importar recebe. Nome, nascimento, CPF
 * e matrícula: o primeiro acesso pede os três últimos na mesma ficha.
 */
export type Formulario = {
  nome: string;
  nascimento: string;
  cpf: string;
  matricula: string;
  admissao: string;
  filialId: string;
  funcaoId: string;
  papel: string;
  vinculo: string;
  contratadaId: string;
  email: string;
};

export const FORMULARIO_VAZIO: Formulario = {
  nome: "",
  nascimento: "",
  cpf: "",
  matricula: "",
  admissao: "",
  filialId: "",
  funcaoId: "",
  papel: "COLABORADOR",
  vinculo: "EMPLOYEE",
  contratadaId: "",
  email: "",
};

/** O que falta para conferir; nulo quando o formulário pode ir ao servidor. */
export function faltaNoFormulario(f: Formulario, quantasFiliais: number): string | null {
  if (!f.nome.trim()) return "Informe o nome.";
  if (!f.nascimento.trim()) return "Informe a data de nascimento: é com ela que a pessoa faz o primeiro acesso.";
  if (!f.cpf.trim()) return "Informe o CPF: o primeiro acesso pede matrícula, CPF e data de nascimento.";
  if (!f.matricula.trim()) return "Informe a matrícula: o primeiro acesso pede matrícula, CPF e data de nascimento.";
  if (quantasFiliais > 1 && !f.filialId) return "Escolha a filial.";
  if (f.vinculo === "CONTRACTOR" && !f.contratadaId) return "Escolha a empresa contratada.";
  return null;
}

/** A pessoa como a rota recebe: só o que foi preenchido. */
export function pessoaDoFormulario(f: Formulario): ImportRow {
  const se = (v: string) => (v.trim() ? v.trim() : undefined);
  return {
    name: f.nome.trim(),
    birth_date: se(f.nascimento),
    tax_id: se(f.cpf),
    registration: se(f.matricula),
    admitted_at: se(f.admissao),
    establishment_id: se(f.filialId),
    job_role_id: se(f.funcaoId),
    org_role: se(f.papel),
    bond: se(f.vinculo),
    contractor_id: f.vinculo === "CONTRACTOR" ? se(f.contratadaId) : undefined,
    email: se(f.email),
  };
}

/** As funções da filial escolhida; sem filial, nenhuma. */
export function funcoesDaFilial<T extends { establishment?: { id: string } }>(funcoes: T[], filialId: string): T[] {
  return filialId ? funcoes.filter((f) => f.establishment?.id === filialId) : [];
}

/** Os papéis que quem cadastra pode dar, sem Fiscal: ele entra pelo pedido de entrada, com prazo. */
export function papeisDoFormulario(podeDar: string[]): string[] {
  return podeDar.filter((p) => p !== "FISCAL");
}

/**
 * Os dados que foram conferidos. "Cadastrar" só vale para eles: mudar um
 * campo apaga a conferência.
 */
export function chaveDoFormulario(f: Formulario): string {
  return JSON.stringify(pessoaDoFormulario(f));
}

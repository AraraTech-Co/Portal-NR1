/*
  Sem import nenhum: os testes do servidor leem este arquivo direto, como
  fazem com `labels.ts`.
*/

/** O mínimo que a montagem do certificado precisa saber. */
export type DadosDoCertificado = {
  completed_at: string | null;
  training: {
    kind: string;
    summary: string | null;
    instructor_name: string | null;
    instructor_qualification: string | null;
    technical_responsible_name: string | null;
    technical_responsible_qualification: string | null;
  };
  session: {
    held_at: string;
    location: string | null;
    instructor_name: string;
    instructor_registration: string | null;
    instructor_qualification: string | null;
  } | null;
};

export type ItensDoCertificado = {
  data: string | null;
  local: string | null;
  conteudo: string | null;
  ministrou: { nome: string | null; qualificacao: string | null; registro: string | null };
  responsavel: { nome: string | null; qualificacao: string | null };
  /** O que o 1.7.1.1 pede e o cadastro não tem — para a tela avisar. */
  faltando: string[];
  /**
   * A parte do que falta que se completa na TURMA, não no curso: no
   * presencial, local e quem deu a aula vêm dela. A tela mandava completar
   * tudo "na linha do curso", onde esses itens não se mudam. [B4-B]
   */
  faltandoNaTurma: string[];
};

export const LOCAL_A_DISTANCIA = "A distância, pelo portal";

/**
 * O que o certificado traz, item por item do NR-1 1.7.1.1: nome e
 * assinatura do trabalhador, conteúdo programático, carga horária, data,
 * local, nome e qualificação de quem ministrou e assinatura do responsável
 * técnico. No curso a distância, quem ministrou vem do cadastro do
 * treinamento e o local é "a distância"; no presencial, a turma diz quem deu
 * a aula, onde e quando. [B3-3-G]
 */
export function itensDoCertificado(cert: DadosDoCertificado): ItensDoCertificado {
  const presencial = cert.training.kind === "CLASSROOM";
  const turma = presencial ? cert.session : null;
  const ministrou = turma
    ? {
        nome: turma.instructor_name,
        qualificacao: turma.instructor_qualification,
        registro: turma.instructor_registration,
      }
    : {
        nome: cert.training.instructor_name,
        qualificacao: cert.training.instructor_qualification,
        registro: null,
      };
  const local = presencial ? (turma?.location ?? null) : LOCAL_A_DISTANCIA;
  const itens: ItensDoCertificado = {
    data: turma ? turma.held_at : cert.completed_at,
    local,
    conteudo: cert.training.summary,
    ministrou,
    responsavel: {
      nome: cert.training.technical_responsible_name,
      qualificacao: cert.training.technical_responsible_qualification,
    },
    faltando: [],
    faltandoNaTurma: [],
  };
  if (!itens.conteudo) itens.faltando.push("conteúdo programático");
  if (!itens.local) itens.faltando.push("local");
  if (!ministrou.nome) itens.faltando.push("quem ministrou");
  if (!ministrou.qualificacao) itens.faltando.push("qualificação de quem ministrou");
  if (!itens.responsavel.nome) itens.faltando.push("responsável técnico");
  if (turma) {
    itens.faltandoNaTurma = itens.faltando.filter((item) =>
      ["local", "quem ministrou", "qualificação de quem ministrou"].includes(item),
    );
  }
  return itens;
}

/** CNPJ com a pontuação: o certificado saía "38472486000133". [B3-3-G] */
export function formatarCnpj(valor: string | null): string | null {
  const digitos = valor?.replace(/\D/g, "") ?? "";
  if (digitos.length !== 14) return valor;
  return digitos.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

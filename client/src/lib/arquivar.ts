/**
 * Arquivar algo da operação: conferir, depois perguntar.
 *
 * A pergunta vinha antes da consulta ao servidor: quem confirmava recebia
 * em seguida a notícia de que não podia. E a pergunta dizia "Ele" para
 * função e atividade. [B3-1-C]
 */
export type Arquivavel = "establishment" | "sector" | "job_role" | "activity";

export type PodeArquivar = { can_archive: boolean; message?: string; code?: string };

const COMO_SE_DIZ: Record<Arquivavel, { artigo: string; pronome: string }> = {
  establishment: { artigo: "o estabelecimento", pronome: "Ele" },
  sector: { artigo: "o setor", pronome: "Ele" },
  job_role: { artigo: "a função", pronome: "Ela" },
  activity: { artigo: "a atividade", pronome: "Ela" },
};

/** "o setor", "a função": para os rótulos que falam da coisa. */
export function artigoDe(tipo: Arquivavel): string {
  return COMO_SE_DIZ[tipo].artigo;
}

export function perguntaDeArquivar(tipo: Arquivavel, nome: string): string {
  const { artigo, pronome } = COMO_SE_DIZ[tipo];
  return `Arquivar ${artigo} “${nome}”? ${pronome} some das listas, mas o histórico fica.`;
}

/**
 * Devolve a mensagem para mostrar, ou null quando arquivou ou quando a
 * pessoa desistiu. O impedimento chega sem pergunta nenhuma.
 */
export async function conferirEArquivar(opcoes: {
  tipo: Arquivavel;
  nome: string;
  conferir: () => Promise<PodeArquivar>;
  arquivar: () => Promise<unknown>;
  confirmar?: (pergunta: string) => boolean;
}): Promise<string | null> {
  const confirmar = opcoes.confirmar ?? ((p: string) => window.confirm(p));
  try {
    const pode = await opcoes.conferir();
    if (!pode.can_archive) return pode.message ?? "Não é possível arquivar agora.";
    if (!confirmar(perguntaDeArquivar(opcoes.tipo, opcoes.nome))) return null;
    /* Entre a conferência e o clique, alguém pode ter ligado algo: o servidor confere de novo. */
    await opcoes.arquivar();
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : "Falha ao arquivar";
  }
}

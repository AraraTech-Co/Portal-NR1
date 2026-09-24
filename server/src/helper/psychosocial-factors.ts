/**
 * Catálogo de referência dos fatores de risco psicossociais.
 *
 * ⚠️ LISTA ORIENTATIVA, NÃO TAXATIVA. O próprio MTE registra que as listagens
 * de guias e manuais têm "caráter orientativo e referencial, não sendo, por si
 * só, taxativas ou normativas" (docs/PESQUISA-NR1.md, seção 4). Ela serve para
 * organizar a conversa na Avaliação Ergonômica Preliminar (AEP) — nunca como
 * checklist fechado nem como classificação automática de risco.
 *
 * Consequências de a lista ser orientativa, e que valem para toda a UI:
 * - a organização pode registrar fator FORA desta lista (perigo em texto livre);
 * - nenhum item aqui vira perigo sozinho: quem decide é a pessoa que conduz a
 *   AEP, com base na condição e na organização do trabalho observadas;
 * - concluir a AEP sem nenhum fator identificado é resultado LEGÍTIMO, desde
 *   que a justificativa técnica esteja registrada (campo `findings`).
 *
 * A `fieldQuestion` é deliberadamente escrita em linguagem de campo: é o que se
 * pergunta em pé no setor, não o jargão da norma. O objeto é sempre a condição
 * e a organização do trabalho — NUNCA a saúde mental individual de alguém.
 */

export type PsychosocialFactor = {
  /** Estável — vai para o texto do perigo e para a trilha de auditoria. */
  id: string;
  label: string;
  /** Pergunta em linguagem de campo, para orientar observação e diálogo. */
  fieldQuestion: string;
  /** O que costuma aparecer quando o fator existe (apoio de leitura). */
  examples: string;
};

export const PSYCHOSOCIAL_FACTORS: readonly PsychosocialFactor[] = [
  {
    id: "HARASSMENT",
    label: "Assédio de qualquer natureza no trabalho",
    fieldQuestion:
      "Existem situações de humilhação, constrangimento, ameaça ou insistência indesejada — de chefia, de colegas, de clientes?",
    examples:
      "Apelidos e piadas que constrangem, cobrança feita aos gritos, exposição pública de erros, insistência de teor sexual.",
  },
  {
    id: "ROLE_CLARITY",
    label: "Baixa clareza de papel ou de função",
    fieldQuestion: "As pessoas sabem exatamente o que se espera delas e a quem devem responder?",
    examples:
      "Duas chefias mandando coisas diferentes, tarefa que ninguém sabe de quem é, prioridade que muda sem aviso.",
  },
  {
    id: "LOW_REWARD",
    label: "Baixas recompensas e falta de reconhecimento",
    fieldQuestion:
      "O esforço das pessoas é reconhecido de alguma forma — em retorno, em oportunidade, em respeito?",
    examples:
      "Só aparece quem erra, promessa de reconhecimento que nunca chega, esforço extra tratado como obrigação.",
  },
  {
    id: "LOW_SUPPORT",
    label: "Falta de suporte ou apoio no trabalho",
    fieldQuestion:
      "Quando alguém trava ou passa por um problema, tem a quem recorrer — chefia, colega, equipe de apoio?",
    examples:
      "Novato aprendendo sozinho, chefia inacessível, turno noturno sem retaguarda, pedido de ajuda ignorado.",
  },
  {
    id: "LOW_CONTROL",
    label: "Baixo controle e falta de autonomia",
    fieldQuestion:
      "As pessoas têm alguma influência sobre como, quando e em que ordem fazem o próprio trabalho?",
    examples:
      "Ritmo ditado por máquina ou por meta minuto a minuto, pausa que depende de autorização, roteiro rígido.",
  },
  {
    id: "LOW_JUSTICE",
    label: "Baixa justiça organizacional",
    fieldQuestion:
      "As regras — escala, folga, promoção, punição — valem igual para todo mundo e são explicadas?",
    examples:
      "Escala de fim de semana sempre para os mesmos, critério de promoção que ninguém conhece, punição desigual.",
  },
  {
    id: "VIOLENT_EVENTS",
    label: "Eventos violentos ou traumáticos",
    fieldQuestion:
      "As pessoas se expõem a assalto, agressão, acidente grave ou sofrimento de terceiros nesta atividade?",
    examples:
      "Atendimento ao público hostil, transporte de valores, socorro a vítimas, presenciar acidente de colega.",
  },
  {
    id: "UNDERLOAD",
    label: "Baixa demanda ou subcarga",
    fieldQuestion:
      "Há períodos longos sem tarefa relevante, ou trabalho muito repetitivo e sem sentido para quem executa?",
    examples:
      "Posto ocioso por horas com obrigação de permanecer atento, tarefa esvaziada após mudança de processo.",
  },
  {
    id: "OVERLOAD",
    label: "Excesso de demandas e sobrecarga",
    fieldQuestion: "As pessoas conseguem dar conta do volume de trabalho no tempo disponível?",
    examples:
      "Hora extra virou rotina, meta que só fecha pulando pausa, equipe reduzida sem redução de serviço.",
  },
  {
    id: "POOR_RELATIONSHIPS",
    label: "Más relações no local de trabalho",
    fieldQuestion: "Como é a convivência na equipe e com as outras áreas — há conflito crônico?",
    examples:
      "Atrito constante entre turnos, isolamento de alguém pelo grupo, disputa que trava o serviço.",
  },
  {
    id: "DIFFICULT_COMMUNICATION",
    label: "Trabalho em condições de difícil comunicação",
    fieldQuestion:
      "Dá para se comunicar e pedir socorro com facilidade no ponto onde a atividade acontece?",
    examples:
      "Ruído alto, EPI que abafa a voz, área sem sinal, trabalho em espaço confinado ou em zona rural distante.",
  },
  {
    id: "REMOTE_ISOLATED_WORK",
    label: "Trabalho remoto, híbrido ou isolado",
    fieldQuestion:
      "Quem trabalha remoto, híbrido ou sozinho tem contato, limites de horário e apoio da equipe?",
    examples:
      "Cobrança fora do expediente por aplicativo, teletrabalho sem contato com a equipe, vigia sozinho à noite.",
  },
  {
    id: "COGNITIVE_MULTITASKING",
    label: "Exigência de múltiplas tarefas com alta demanda cognitiva",
    fieldQuestion:
      "A pessoa precisa fazer várias coisas ao mesmo tempo, com atenção constante e sem poder errar?",
    examples:
      "Atender telefone enquanto opera sistema e recebe cliente, monitorar vários painéis, interrupção o tempo todo.",
  },
  {
    id: "CHANGE_MANAGEMENT",
    label: "Má gestão de mudanças organizacionais",
    fieldQuestion:
      "Quando algo muda — sistema, chefia, processo, jornada —, as pessoas são avisadas, ouvidas e preparadas?",
    examples:
      "Reestruturação anunciada em cima da hora, sistema novo sem treinamento, boato de demissão sem resposta.",
  },
] as const;

export const PSYCHOSOCIAL_FACTOR_IDS: readonly string[] = PSYCHOSOCIAL_FACTORS.map((f) => f.id);

export function findPsychosocialFactor(id: string): PsychosocialFactor | undefined {
  return PSYCHOSOCIAL_FACTORS.find((factor) => factor.id === id);
}

/** Rótulo para exibição; devolve o próprio id quando o fator não está no catálogo. */
export function psychosocialFactorLabel(id: string | null | undefined): string {
  if (!id) return "Fator fora do catálogo";
  return findPsychosocialFactor(id)?.label ?? id;
}

const FACTOR_NOTE_PREFIX = "AEP (NR-17) · fator psicossocial: ";

/**
 * Texto gravado em `Hazard.monitoringData` quando o perigo nasce de um item do
 * catálogo. Serve a dois propósitos de uma vez:
 * - preenche o campo "h" do inventário (NR-1 1.5.7.3.2), que pede justamente os
 *   resultados da avaliação de ergonomia da NR-17;
 * - deixa rastro legível de QUAL fator foi reconhecido — não existe coluna
 *   `factorId` no schema, e criar uma amarraria o registro a uma lista que o
 *   próprio MTE diz não ser taxativa.
 */
export function psychosocialFactorNote(factor: PsychosocialFactor | undefined): string {
  return factor
    ? `${FACTOR_NOTE_PREFIX}${factor.label}`
    : `${FACTOR_NOTE_PREFIX}fator informado fora do catálogo orientativo`;
}

/** Caminho inverso: descobre o fator a partir da nota, para marcar o catálogo. */
export function factorIdFromNote(note: string | null | undefined): string | undefined {
  if (!note || !note.startsWith(FACTOR_NOTE_PREFIX)) return undefined;
  const label = note.slice(FACTOR_NOTE_PREFIX.length).trim();
  return PSYCHOSOCIAL_FACTORS.find((factor) => factor.label === label)?.id;
}

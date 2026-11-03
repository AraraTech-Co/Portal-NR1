import { AssessmentStatus } from "@prisma/client";
import prisma from "../model/prisma";

/**
 * O nível que decide prioridade e limite de prazo: o da avaliação MAIS
 * RECENTE, validada ou à espera de validação. Só o validado valia, e quem
 * avalia não valida a própria avaliação: no caminho mais comum — avaliar e
 * já abrir a ação —, a tela dizia "Sem risco avaliado" e aceitava qualquer
 * prazo. A avaliação substituída não conta. [B3-2-A]
 */
export async function nivelDoRisco(
  organizationId: string,
  riskId: string,
): Promise<{ nivel: string; validada: boolean } | null> {
  const avaliacao = await prisma.riskAssessment.findFirst({
    where: {
      organizationId,
      riskId,
      status: { not: AssessmentStatus.SUPERSEDED },
    },
    orderBy: { assessedAt: "desc" },
    select: { resultingLevel: true, status: true },
  });
  if (!avaliacao?.resultingLevel) return null;
  return {
    nivel: avaliacao.resultingLevel,
    validada: avaliacao.status === AssessmentStatus.VALIDATED,
  };
}

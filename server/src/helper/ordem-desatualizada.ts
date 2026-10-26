import prisma from "../model/prisma";

/**
 * Quantas mudanças no inventário da função aconteceram depois de a ordem de
 * serviço ser emitida.
 *
 * A ordem sai do inventário vivo no instante da emissão e não muda mais — é o
 * que foi dado a conhecer ao trabalhador. Quando a função ganha atividade,
 * perigo, risco ou medida depois disso, a ordem fica para trás e nada dizia:
 * a lista e o Painel seguiam mostrando "Emitida · v1", e o trabalhador dava
 * ciência de uma ordem que não fala do risco que ele corre hoje. Os
 * documentos do PGR já fazem essa comparação. [CB-69] [B2-4-A]
 *
 * Conta só o que entra no conteúdo da ordem: a própria função, as atividades
 * ligadas a ela, os perigos dessas atividades, os riscos desses perigos, as
 * avaliações e medidas desses riscos, e as exigências da função.
 */
export async function mudancasDesdeAEmissao(
  organizationId: string,
  jobRoleId: string,
  since: Date,
): Promise<number> {
  const role = await prisma.jobRole.findFirst({
    where: { id: jobRoleId, organizationId },
    select: {
      id: true,
      requirements: { select: { id: true } },
      activities: {
        select: {
          activity: {
            select: {
              id: true,
              hazards: {
                select: {
                  id: true,
                  risks: {
                    select: {
                      id: true,
                      assessments: { select: { id: true } },
                      controls: { select: { id: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!role) return 0;

  const ids = new Set<string>([role.id]);
  for (const q of role.requirements) ids.add(q.id);
  for (const { activity } of role.activities) {
    ids.add(activity.id);
    for (const h of activity.hazards) {
      ids.add(h.id);
      for (const r of h.risks) {
        ids.add(r.id);
        for (const a of r.assessments) ids.add(a.id);
        for (const c of r.controls) ids.add(c.id);
      }
    }
  }

  return prisma.auditEvent.count({
    where: {
      organizationId,
      createdAt: { gt: since },
      entityId: { in: [...ids] },
    },
  });
}

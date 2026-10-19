import prisma from "../model/prisma";
import { Role } from "@prisma/client";
import { accessEnded } from "./access-period";

/**
 * Quem recebe um aviso do mural.
 *
 * O aviso ia para todas as pessoas com acesso à organização: todas as
 * unidades, o fiscal que está lá por uma semana e quem já foi desligado. E a
 * conta de "quem leu" usava a mesma base, então "2 de 19 leram" misturava
 * quem precisa ler com quem não precisa. [CB-33] [CB-36]
 *
 * Ficam de fora, sempre:
 *
 * - o fiscal, que entra para fiscalizar e não é público de aviso interno;
 * - quem foi desligado, por registro na ficha ou por suspensão do acesso;
 * - quem está com o acesso suspenso ou com o prazo vencido;
 * - a pessoa desativada no sistema.
 *
 * Com unidades escolhidas, entra só quem trabalha nelas — a unidade da
 * pessoa é a do setor da sua função. Quem não está ligado a nenhuma função
 * (acesso só administrativo, por exemplo) não entra num aviso de unidade:
 * não há como dizer de que unidade essa pessoa é.
 */
export async function announcementAudience(
  organizationId: string,
  establishmentIds: readonly string[],
  now = new Date(),
): Promise<string[]> {
  const porUnidade = establishmentIds.length > 0;

  const membros = await prisma.membership.findMany({
    where: {
      organizationId,
      role: { not: Role.FISCAL },
      suspendedAt: null,
      user: { active: true },
    },
    select: {
      userId: true,
      accessExpiresAt: true,
      user: {
        select: {
          employeeProfiles: {
            where: { organizationId },
            take: 1,
            select: {
              dismissedAt: true,
              jobRole: { select: { sector: { select: { establishmentId: true } } } },
            },
          },
        },
      },
    },
  });

  return membros
    .filter((m) => {
      if (accessEnded(m.accessExpiresAt, now)) return false;
      const ficha = m.user.employeeProfiles[0] ?? null;
      if (ficha?.dismissedAt) return false;
      if (!porUnidade) return true;
      const unidade = ficha?.jobRole?.sector.establishmentId ?? null;
      return unidade !== null && establishmentIds.includes(unidade);
    })
    .map((m) => m.userId);
}

/** As unidades escolhidas para um aviso (vazio = a empresa toda). */
export async function announcementEstablishmentIds(
  announcementId: string,
): Promise<string[]> {
  const rows = await prisma.announcementEstablishment.findMany({
    where: { announcementId },
    select: { establishmentId: true },
  });
  return rows.map((r) => r.establishmentId);
}

/**
 * O recorte do mural para quem está olhando.
 *
 * Quem cuida do mural vê tudo — precisa cobrar leitura. Para os demais, o
 * mural passa a mostrar só o que é para eles: aviso da unidade do vizinho não
 * é informação, é ruído. Quem não está ligado a uma unidade vê os avisos da
 * empresa toda. [CB-33]
 */
export async function announcementVisibility(
  organizationId: string,
  userId: string,
  podeGerir: boolean,
): Promise<Record<string, unknown>> {
  if (podeGerir) return {};
  const ficha = await prisma.employeeProfile.findFirst({
    where: { organizationId, userId },
    select: {
      jobRole: { select: { sector: { select: { establishmentId: true } } } },
    },
  });
  const minhaUnidade = ficha?.jobRole?.sector.establishmentId ?? null;
  const daEmpresaToda = { establishments: { none: {} } };
  if (!minhaUnidade) return daEmpresaToda;
  return {
    OR: [daEmpresaToda, { establishments: { some: { establishmentId: minhaUnidade } } }],
  };
}

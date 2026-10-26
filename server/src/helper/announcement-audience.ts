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
 * Com unidades escolhidas, entra quem trabalha nelas — a unidade da pessoa é
 * a do setor da sua função.
 *
 * E entra também quem NÃO está ligado a nenhuma função e não é colaborador:
 * supervisor, SST, RH, gerente e dono costumam não ter função de chão de
 * fábrica, e são justamente quem precisa saber do aviso da unidade. A regra
 * antiga deixava de fora o líder da usinagem, o SST, o RH e o gerente — um
 * aviso para a Brasmetal chegava a 8 das 19 pessoas. Como o portal não sabe
 * a que unidade essas pessoas atendem, elas recebem os avisos de todas: ficar
 * de fora é pior que receber a mais. [CB-60]
 *
 * O colaborador sem função é ficha incompleta, não administrativo: continua
 * fora do aviso de unidade, e recebe os da empresa toda.
 */
/** Papéis cuja unidade vem da função; os demais atendem a empresa. [CB-60] */
function ehColaborador(role: Role): boolean {
  return role === Role.COLABORADOR;
}

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
      role: true,
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
      if (unidade !== null) return establishmentIds.includes(unidade);
      /* Sem função: entra se não for colaborador. [CB-60] */
      return !ehColaborador(m.role);
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
  if (!minhaUnidade) {
    /*
      Sem função: se recebe os avisos de todas as unidades, precisa vê-los no
      mural também — senão o aviso chega ao sino e some da lista. [CB-60]
    */
    const membro = await prisma.membership.findFirst({
      where: { organizationId, userId },
      select: { role: true },
    });
    if (membro && !ehColaborador(membro.role)) return {};
    return daEmpresaToda;
  }
  return {
    OR: [daEmpresaToda, { establishments: { some: { establishmentId: minhaUnidade } } }],
  };
}

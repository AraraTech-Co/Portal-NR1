import prisma from "../model/prisma";

/**
 * Tem ficha ativa nesta empresa: é funcionário dela e não foi desligado.
 * É o que abre a consulta própria de holerites, férias e atestados. [C2-1]
 */
export async function hasActiveProfile(organizationId: string, userId: string): Promise<boolean> {
  const ficha = await prisma.employeeProfile.findFirst({
    where: { organizationId, userId, dismissedAt: null },
    select: { id: true },
  });
  return ficha !== null;
}

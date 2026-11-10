import prisma from "../model/prisma";

/**
 * Filial (estabelecimento) da ficha. [C3-2]
 *
 * - Com função, é a unidade do setor da função. O banco grava isso sozinho
 *   (gatilho da migração 20261110000000); aqui só se recusa a combinação
 *   impossível, para a resposta dizer o porquê em vez de o banco trocar a
 *   filial em silêncio.
 * - Sem função, é a filial escolhida, que tem de ser ativa desta empresa.
 * - Sem nenhuma das duas, e a empresa tem uma filial ativa só, é essa. Com
 *   mais de uma, fica sem filial (`null`): quem chama decide se aceita.
 */
export type FilialDaFicha =
  | { ok: true; establishmentId: string | null }
  | { ok: false; message: string; field: "establishment_id" | "job_role_id" };

export async function filialDaFicha(
  orgId: string,
  entrada: { jobRoleId?: string | null; establishmentId?: string | null },
): Promise<FilialDaFicha> {
  const escolhida = entrada.establishmentId?.trim() || null;

  if (entrada.jobRoleId) {
    const funcao = await prisma.jobRole.findFirst({
      where: { id: entrada.jobRoleId, organizationId: orgId },
      select: { sector: { select: { establishmentId: true } } },
    });
    if (!funcao) {
      return { ok: false, message: "Função (job_role) inválida.", field: "job_role_id" };
    }
    const daFuncao = funcao.sector.establishmentId;
    if (escolhida && escolhida !== daFuncao) {
      return {
        ok: false,
        message: "A função escolhida é de outra filial.",
        field: "establishment_id",
      };
    }
    return { ok: true, establishmentId: daFuncao };
  }

  if (escolhida) {
    const filial = await prisma.establishment.findFirst({
      where: { id: escolhida, organizationId: orgId, archivedAt: null },
      select: { id: true },
    });
    if (!filial) {
      return { ok: false, message: "Filial inválida.", field: "establishment_id" };
    }
    return { ok: true, establishmentId: filial.id };
  }

  const ativas = await prisma.establishment.findMany({
    where: { organizationId: orgId, archivedAt: null },
    select: { id: true },
    take: 2,
  });
  return { ok: true, establishmentId: ativas.length === 1 ? ativas[0].id : null };
}

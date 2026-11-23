import prisma from "../model/prisma";
import { nomeNormalizado } from "./nome";

/**
 * Filial sem duplicar (decisão do Léo, 23/11/2026). A tela de login lista as
 * filiais pelo nome: duas com o mesmo nome deixam a pessoa sem saber qual
 * escolher.
 *
 * - Nome: não pode repetir o de outra filial ATIVA da empresa, sem acento,
 *   sem diferença de maiúscula e com os espaços normalizados. A arquivada
 *   não aparece no login, e o nome dela fica livre.
 * - CNPJ: não pode repetir o de outra filial da empresa, ativa ou arquivada.
 *   Compara os dígitos, e só quando há CNPJ.
 *
 * `excetoId` é a própria filial, na edição. Devolve a mensagem do 409, ou nulo.
 */
export async function filialRepetida(
  organizationId: string,
  dados: { nome?: string | null; cnpj?: string | null },
  excetoId?: string,
): Promise<string | null> {
  const outras = await prisma.establishment.findMany({
    where: { organizationId, ...(excetoId ? { id: { not: excetoId } } : {}) },
    select: { name: true, taxId: true, archivedAt: true },
  });
  if (dados.nome) {
    const nome = nomeNormalizado(dados.nome);
    const igual = outras.find((o) => !o.archivedAt && nomeNormalizado(o.name) === nome);
    if (igual) return `Já existe a filial ${igual.name}. Use outro nome.`;
  }
  if (dados.cnpj) {
    const digitos = dados.cnpj.replace(/\D/g, "");
    const igual = outras.find((o) => o.taxId && o.taxId.replace(/\D/g, "") === digitos);
    if (igual) return `O CNPJ informado já é da filial ${igual.name}${igual.archivedAt ? " (arquivada)" : ""}.`;
  }
  return null;
}

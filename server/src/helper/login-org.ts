import prisma from "../model/prisma";

/**
 * A empresa e as filiais da tela de login. [C3-2b]
 *
 * A tela de login abre com a escolha da filial, antes da matrícula e da
 * senha. A empresa é resolvida só aqui, no servidor — a rota pública não
 * recebe parâmetro, para ninguém listar filiais de outra empresa por id:
 *
 * 1. `LOGIN_ORG_ID`, se apontar para uma empresa ativa;
 * 2. senão, a única empresa ativa do banco;
 * 3. senão, nenhuma: a tela mostra só "Externo", o servidor avisa no log e o
 *    Início do Master mostra o aviso. Nunca se misturam filiais de duas
 *    empresas.
 *
 * A filial não é fator de autorização: só restringe onde a matrícula e o
 * CPF são procurados. Não vai para a sessão nem para o recorte.
 */

/** O valor da opção para quem não tem ficha (Master, RH e SST da central). */
export const EXTERNO = "externo";

let avisou = false;

export async function loginOrganizationId(): Promise<string | null> {
  const doAmbiente = process.env.LOGIN_ORG_ID?.trim();
  if (doAmbiente) {
    const org = await prisma.organization.findFirst({
      where: { id: doAmbiente, active: true },
      select: { id: true },
    });
    if (org) return org.id;
  } else {
    const ativas = await prisma.organization.findMany({
      where: { active: true },
      select: { id: true },
      take: 2,
    });
    if (ativas.length === 1) return ativas[0].id;
  }
  if (!avisou) {
    avisou = true;
    console.warn(
      "[login] Sem empresa para a tela de login: defina LOGIN_ORG_ID com uma empresa ativa. " +
        "Até lá, só a opção Externo aparece.",
    );
  }
  return null;
}

/** Só id e nome, das filiais ativas e não arquivadas da empresa do login. */
export async function loginEstablishments(): Promise<{ id: string; name: string }[]> {
  const orgId = await loginOrganizationId();
  if (!orgId) return [];
  return prisma.establishment.findMany({
    where: { organizationId: orgId, archivedAt: null, organization: { active: true } },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
}

/**
 * O que foi escolhido na tela. Vazio ou "externo" é Externo. Uma filial
 * que não é da empresa do login (ou arquivada, ou que não existe) volta
 * como `invalida`, e quem chama responde igual a dado errado.
 */
export type FilialDoLogin =
  | { kind: "externo" }
  | { kind: "filial"; id: string }
  | { kind: "invalida"; id: string };

export async function filialDoLogin(raw: unknown): Promise<FilialDoLogin> {
  const valor = typeof raw === "string" ? raw.trim() : "";
  if (!valor || valor === EXTERNO) return { kind: "externo" };
  const id = valor.slice(0, 64);
  const orgId = await loginOrganizationId();
  if (!orgId) return { kind: "invalida", id };
  const filial = await prisma.establishment.findFirst({
    where: { id, organizationId: orgId, archivedAt: null },
    select: { id: true },
  });
  return filial ? { kind: "filial", id: filial.id } : { kind: "invalida", id };
}

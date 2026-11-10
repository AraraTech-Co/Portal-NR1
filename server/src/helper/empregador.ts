/**
 * Em nome de quem o documento sai. [C3-4]
 *
 * Cada filial da Americana é um CNPJ: o PGR de uma filial, a ordem de serviço
 * de uma função e o painel filtrado por filial saem com a razão social e o
 * CNPJ dela. Sem filial ou sem razão social, saem com a empresa, como antes.
 *
 * Razão social e CNPJ andam juntos: a filial só conta se tiver os dois (a
 * tela de filiais não deixa gravar razão sem CNPJ), para nunca sair a razão
 * de uma com o CNPJ de outra.
 */
export type Empregador = { name: string; taxId: string | null };

type Empresa = { name: string; taxId: string | null };
type Filial = { legalName: string | null; taxId: string | null } | null | undefined;

export function empregadorDe(empresa: Empresa, filial: Filial): Empregador {
  const razao = filial?.legalName?.trim();
  if (razao && filial?.taxId) return { name: razao, taxId: filial.taxId };
  return { name: empresa.name, taxId: empresa.taxId ?? null };
}

/**
 * O que saiu no papel: o retrato gravado na emissão. Documento emitido antes
 * da C3-4 não tem retrato e mostra a empresa, como sempre mostrou.
 */
export function empregadorGravado(
  doc: { employerName: string | null; employerTaxId: string | null },
  empresa: Empresa,
): Empregador {
  if (doc.employerName) return { name: doc.employerName, taxId: doc.employerTaxId };
  return { name: empresa.name, taxId: empresa.taxId ?? null };
}

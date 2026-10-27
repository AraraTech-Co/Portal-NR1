/**
 * O endereço do canal público de denúncia.
 *
 * O canal existe desde a decisão S4-L, mas o endereço não aparecia em tela
 * nenhuma: o identificador da empresa é um código de 36 caracteres, e quem
 * administra tinha de pedir o link ao suporte para poder divulgá-lo. [CB-63]
 *
 * Fica aqui, e não escrito à mão na tela, porque a rota do canal
 * (`/canal/:organizationId`, em `App.tsx`) e o endereço que a empresa copia
 * têm de ser o mesmo — e um teste confere os dois contra esta função.
 */
export const CANAL_BASE = "/canal";

/** Caminho do canal desta empresa, sem o domínio. */
export function canalPath(organizationId: string): string {
  return `${CANAL_BASE}/${encodeURIComponent(organizationId)}`;
}

/** Endereço completo, como se divulga: domínio deste portal mais o caminho. */
export function canalUrl(origin: string, organizationId: string): string {
  return `${origin}${canalPath(organizationId)}`;
}

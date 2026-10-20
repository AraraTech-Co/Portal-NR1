/**
 * Caminho da tela → módulo da matriz de acesso.
 *
 * Serve para não oferecer a alguém um aviso que leva a uma tela que ela não
 * abre: o fiscal recebia aviso de mural de antes de o mural passar a ter
 * público, e o aviso continuava na caixa dele, levando a lugar nenhum.
 * [B2-4-F]
 */
const MODULO_POR_ROTA: Record<string, string> = {
  operacao: "operacao",
  aep: "aep",
  inventario: "inventario",
  acoes: "acoes",
  ocorrencias: "ocorrencias",
  emergencias: "emergencias",
  documentos: "documentos_pgr",
  "ordens-servico": "documentos_pgr",
  fiscalizacao: "documentos_pgr",
  terceiros: "terceiros",
  colaboradores: "colaboradores",
  "documentos-rh": "documentos_rh",
  holerites: "holerites",
  ferias: "ferias",
  ponto: "ponto",
  onboarding: "onboarding",
  talentos: "talentos",
  saude: "saude",
  atestados: "atestados",
  treinamentos: "treinamentos",
  certificados: "treinamentos",
  participacao: "participacao",
  denuncia: "denuncia",
  comite: "comite",
  clima: "clima",
  ideias: "ideias",
  mural: "mural",
  gamificacao: "gamificacao",
  convocacoes: "convocacoes",
  conta: "conta",
  configuracoes: "configuracoes",
};

/** Nulo quando a tela não pertence a módulo nenhum (o Início, por exemplo). */
export function moduloDaRota(link: string | null | undefined): string | null {
  if (!link) return null;
  const primeiro = link.replace(/^\//, "").split(/[/?#]/)[0] ?? "";
  return MODULO_POR_ROTA[primeiro] ?? null;
}

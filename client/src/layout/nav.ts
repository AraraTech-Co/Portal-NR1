export type NavItem = {
  href: string;
  label: string;
  /** Id do módulo — filtro por permissão entra depois. */
  moduleId: string;
};

export type NavGroup = {
  title: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Riscos e segurança",
    items: [
      { href: "/operacao", label: "Operação", moduleId: "operacao" },
      { href: "/aep", label: "Avaliação ergonômica", moduleId: "aep" },
      { href: "/inventario", label: "Inventário de riscos", moduleId: "inventario" },
      { href: "/acoes", label: "Plano de ação", moduleId: "acoes" },
      { href: "/ocorrencias", label: "Ocorrências", moduleId: "ocorrencias" },
      { href: "/emergencias", label: "Emergências", moduleId: "emergencias" },
      { href: "/documentos", label: "Documentos do PGR", moduleId: "documentos_pgr" },
      { href: "/terceiros", label: "Terceiros", moduleId: "terceiros" },
    ],
  },
  {
    title: "Pessoas",
    items: [
      { href: "/colaboradores", label: "Colaboradores", moduleId: "colaboradores" },
      { href: "/documentos-rh", label: "Documentos", moduleId: "documentos_rh" },
      { href: "/holerites", label: "Holerites", moduleId: "holerites" },
      { href: "/ferias", label: "Férias e licenças", moduleId: "ferias" },
      { href: "/ponto", label: "Banco de horas", moduleId: "ponto" },
      { href: "/onboarding", label: "Onboarding", moduleId: "onboarding" },
      { href: "/talentos", label: "Banco de talentos", moduleId: "talentos" },
    ],
  },
  {
    title: "Saúde e conformidade",
    items: [
      { href: "/saude", label: "Saúde e exigências", moduleId: "saude" },
      { href: "/atestados", label: "Atestados", moduleId: "atestados" },
      { href: "/treinamentos", label: "Treinamentos", moduleId: "treinamentos" },
      { href: "/participacao", label: "Participação", moduleId: "participacao" },
    ],
  },
  {
    title: "Escuta e engajamento",
    items: [
      { href: "/comite", label: "Canal de denúncia", moduleId: "comite" },
      { href: "/clima", label: "Clima organizacional", moduleId: "clima" },
      { href: "/ideias", label: "Ideias", moduleId: "ideias" },
      { href: "/mural", label: "Mural de avisos", moduleId: "mural" },
      { href: "/gamificacao", label: "Gamificação", moduleId: "gamificacao" },
      { href: "/convocacoes", label: "Convocações", moduleId: "convocacoes" },
    ],
  },
  {
    title: "Administração",
    items: [
      { href: "/conta", label: "Conta e usuários", moduleId: "conta" },
      { href: "/configuracoes", label: "Configurações", moduleId: "configuracoes" },
    ],
  },
];

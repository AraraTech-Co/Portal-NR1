import { useParams } from "react-router-dom";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";

const TITLES: Record<string, string> = {
  aep: "Avaliação ergonômica",
  terceiros: "Terceiros",
  colaboradores: "Colaboradores",
  "documentos-rh": "Documentos",
  holerites: "Holerites",
  ferias: "Férias e licenças",
  ponto: "Banco de horas",
  onboarding: "Onboarding",
  talentos: "Banco de talentos",
  saude: "Saúde e exigências",
  atestados: "Atestados",
  treinamentos: "Treinamentos",
  participacao: "Participação",
  comite: "Canal de denúncia",
  clima: "Clima organizacional",
  ideias: "Ideias",
  mural: "Mural de avisos",
  gamificacao: "Gamificação",
  convocacoes: "Convocações",
  conta: "Conta e usuários",
  configuracoes: "Configurações",
};

export function PlaceholderPage() {
  const { slug } = useParams();
  const title = (slug && TITLES[slug]) || "Em breve";

  return (
    <div>
      <PageHeader
        title={title}
        description="Esta tela ainda não foi migrada. O menu já aponta para cá."
      />
      <EmptyState
        title="Página em construção"
        description="Inventário, plano de ação e ocorrências já estão no ar. As demais entram uma a uma."
      />
    </div>
  );
}

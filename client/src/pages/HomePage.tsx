import { Link } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";
import { Chip } from "@/components/Chip";
import { PageHeader } from "@/components/PageHeader";
import "./home.css";

const SHORTCUTS = [
  {
    href: "/denuncia",
    title: "Fazer denúncia",
    desc: "Canal confidencial — anônimo por padrão.",
  },
  {
    href: "/mural",
    title: "Mural de avisos",
    desc: "Comunicados e campanhas da empresa.",
  },
  {
    href: "/holerites",
    title: "Holerites",
    desc: "Seus contracheques e status de leitura.",
  },
  {
    href: "/inventario",
    title: "Inventário",
    desc: "Perigos, riscos e níveis validados.",
  },
  {
    href: "/acoes",
    title: "Ações",
    desc: "Plano de ação e acompanhamentos.",
  },
] as const;

export function HomePage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div>
      <PageHeader
        title={`Olá, ${user.name}`}
        description="Painel inicial do Portal NR-1 — atalhos para o dia a dia de SST."
        actions={
          user.is_master ? <Chip tone="ouro">MASTER</Chip> : undefined
        }
      />

      <section className="home-meta">
        <div>
          <p className="label-cond home-meta-label">Empresa</p>
          <p className="home-meta-value">{user.organization.name}</p>
        </div>
        <div>
          <p className="label-cond home-meta-label">Conta</p>
          <p className="home-meta-value">
            {user.account.name}
            {user.account_role ? ` · ${user.account_role}` : ""}
          </p>
        </div>
      </section>

      <section className="home-shortcuts" aria-label="Atalhos">
        {SHORTCUTS.map((item) => (
          <Link key={item.href} to={item.href} className="home-shortcut">
            <h2>{item.title}</h2>
            <p className="muted">{item.desc}</p>
          </Link>
        ))}
      </section>
    </div>
  );
}

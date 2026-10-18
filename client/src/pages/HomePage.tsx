import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { fetchNotifications, type Notification } from "@/api/notifications";
import { fetchHome, type HomeCard, type HomeOverview } from "@/api/home";
import { useAuth } from "@/auth/AuthContext";
import { Chip } from "@/components/Chip";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { ORG_ROLE_LABEL } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import "./home.css";

const SHORTCUTS = [
  { href: "/denuncia", title: "Fazer denúncia", desc: "Canal confidencial — anônimo por padrão.", module: "denuncia" },
  { href: "/mural", title: "Mural de avisos", desc: "Comunicados e campanhas da empresa.", module: "mural" },
  { href: "/holerites", title: "Holerites", desc: "Seus contracheques e status de leitura.", module: "holerites" },
  { href: "/inventario", title: "Inventário", desc: "Perigos, riscos e níveis validados.", module: "inventario" },
  { href: "/acoes", title: "Ações", desc: "Plano de ação e acompanhamentos.", module: "acoes" },
] as const;

/** Uma pendência: o número grande, o que é, e o caminho para resolver. */
function CardList({ cards }: { cards: HomeCard[] }) {
  return (
    <ul className="home-cards">
      {cards.map((c) => (
        <li key={c.id} className={c.tone === "warning" ? "is-warning" : undefined}>
          <Link to={c.link}>
            <span className="home-card-count">{c.count}</span>
            <span className="home-card-body">
              <span className="home-card-label">{c.label}</span>
              {c.detail && <span className="home-card-detail">{c.detail}</span>}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Painel de início: o que é seu, o que está na sua mesa, se a empresa está
 * em dia e o que vence agora. Era tudo dado que o portal já tinha e não
 * mostrava a ninguém. [S1-F] [S5-A] [S6-A] [S6-B]
 */
export function HomePage() {
  const { user } = useAuth();
  const [data, setData] = useState<HomeOverview | null>(null);
  const [carregando, setCarregando] = useState(true);
  /*
    Aviso não lido aparece com o título, não só a contagem [S4-G] — e sai da
    mesma caixa do sino, para que os dois não contem coisas diferentes.
    [B2-3-A]
  */
  const [naoLidos, setNaoLidos] = useState<Notification[]>([]);
  const [totalNaoLidos, setTotalNaoLidos] = useState(0);
  const modules = user?.modules;
  const { canRead: leDocumentos } = useModuleAccess("documentos_pgr");

  useEffect(() => {
    let cancelled = false;
    fetchHome()
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch(() => {
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setCarregando(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchNotifications()
      .then(({ notifications, unread }) => {
        if (cancelled) return;
        setNaoLidos(notifications.filter((n) => !n.readAt).slice(0, 4));
        setTotalNaoLidos(unread);
      })
      .catch(() => {
        if (cancelled) return;
        setNaoLidos([]);
        setTotalNaoLidos(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!user) return null;

  const atalhos = SHORTCUTS.filter((s) => {
    const nivel = modules?.[s.module];
    return nivel === "read" || nivel === "write";
  });

  const emDia =
    data?.compliance !== null &&
    data?.compliance !== undefined &&
    data.compliance.length === 0;

  return (
    <div>
      <PageHeader
        title={`Olá, ${user.name}`}
        description="O que precisa da sua atenção hoje."
        actions={user.is_master ? <Chip tone="ouro">MASTER</Chip> : undefined}
      />

      {carregando && <LoadingState label="Montando o seu painel…" />}

      {data?.first_steps && (
        <section className="home-steps" aria-label="Primeiros passos">
          <h2>Primeiros passos</h2>
          <p className="muted">
            O gerenciamento de riscos se monta nesta ordem. Some daqui quando
            estiver tudo feito.
          </p>
          <ol>
            {data.first_steps.map((p) => (
              <li key={p.id} className={p.done ? "is-done" : undefined}>
                <span className="home-step-mark" aria-hidden="true">
                  {p.done ? "✓" : "○"}
                </span>
                {p.done ? (
                  <span>{p.label}</span>
                ) : (
                  <Link to={p.link}>{p.label}</Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {naoLidos.length > 0 && (
        <section className="home-unread" aria-label="Avisos não lidos">
          <h2>
            {totalNaoLidos === 1
              ? "1 aviso que você ainda não leu"
              : `${totalNaoLidos} avisos que você ainda não leu`}
          </h2>
          <ul>
            {naoLidos.map((n) => (
              <li key={n.id}>
                {n.link ? <Link to={n.link}>{n.title}</Link> : n.title}
                {n.body && <span className="muted"> · {n.body}</span>}
              </li>
            ))}
          </ul>
          {totalNaoLidos > naoLidos.length && (
            <p className="muted">
              e mais {totalNaoLidos - naoLidos.length} no sino.
            </p>
          )}
        </section>
      )}

      {data && data.mine.length > 0 && (
        <section className="home-block" aria-label="O que é seu">
          <h2>Para você fazer</h2>
          <CardList cards={data.mine} />
        </section>
      )}

      {data && data.desk.length > 0 && (
        <section className="home-block" aria-label="Na sua mesa">
          <h2>Esperando a sua decisão</h2>
          <CardList cards={data.desk} />
        </section>
      )}

      {data?.compliance && data.compliance.length > 0 && (
        <section className="home-block" aria-label="A empresa está em dia?">
          <h2>
            A empresa está em dia?{" "}
            <Link to="/fiscalizacao" className="home-block-link">
              ver o painel da fiscalização
            </Link>
          </h2>
          <CardList cards={data.compliance} />
        </section>
      )}

      {emDia && (
        <section className="home-ok" role="status">
          <strong>Nenhuma pendência de conformidade encontrada.</strong>
          <p className="muted">
            Inventário avaliado, documentos emitidos e ordens de serviço no
            lugar.{" "}
            {leDocumentos && <Link to="/fiscalizacao">Conferir item a item</Link>}
          </p>
        </section>
      )}

      {data && data.expiring.length > 0 && (
        <section className="home-block" aria-label="O que vence agora">
          <h2>
            Vencendo nos próximos {data.window_days} dias
          </h2>
          <CardList cards={data.expiring} />
        </section>
      )}

      {atalhos.length > 0 && (
        <section className="home-shortcuts" aria-label="Atalhos">
          {atalhos.map((item) => (
            <Link key={item.href} to={item.href} className="home-shortcut">
              <h2>{item.title}</h2>
              <p className="muted">{item.desc}</p>
            </Link>
          ))}
        </section>
      )}

      <section className="home-meta">
        <div>
          <p className="label-cond home-meta-label">Empresa</p>
          <p className="home-meta-value">{user.organization.name}</p>
        </div>
        <div>
          <p className="label-cond home-meta-label">Conta</p>
          <p className="home-meta-value">{user.account.name}</p>
        </div>
        <div>
          {/* Um papel só, e é este que decide o que a pessoa vê. [OB-3] */}
          <p className="label-cond home-meta-label">Seu papel</p>
          <p className="home-meta-value">
            {ORG_ROLE_LABEL[user.role] ?? user.role}
          </p>
        </div>
      </section>
    </div>
  );
}

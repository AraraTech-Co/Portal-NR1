import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AUDIT_ACTION_LABEL,
  fetchInspection,
  fetchInspectionHistory,
  type AuditEntry,
  type InspectionCheck,
  type InspectionOverview,
} from "@/api/inspection";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { RISK_LEVEL_LABEL } from "@/lib/labels";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import "@/components/form.css";
import "./inspection.css";

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatCnpj(value: string | null): string | null {
  const digits = value?.replace(/\D/g, "") ?? "";
  if (digits.length !== 14) return value;
  return digits.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/**
 * Cor por nível do risco. Um risco Substancial com a documentação em dia
 * aparecia com o mesmo ✓ de um Trivial; quem não é da área lia como "sob
 * controle". [B2-1-K]
 */
function riskTone(
  level: string,
):
  | "risk-trivial"
  | "risk-tolerable"
  | "risk-moderate"
  | "risk-substantial"
  | "risk-intolerable"
  | "neutral" {
  const mapa = {
    TRIVIAL: "risk-trivial",
    TOLERABLE: "risk-tolerable",
    MODERATE: "risk-moderate",
    SUBSTANTIAL: "risk-substantial",
    INTOLERABLE: "risk-intolerable",
  } as const;
  return mapa[level as keyof typeof mapa] ?? "neutral";
}

function CheckCard({ check }: { check: InspectionCheck }) {
  const faltam = check.items.filter((i) => !i.ok);
  const emOrdem = check.items.filter((i) => i.ok);
  const [verTudo, setVerTudo] = useState(false);
  // A pendência vem primeiro, e o cartão não vira parede: o resto fica a um
  // clique. Uma unidade grande tem dezenas de itens em cada exigência.
  const mostrados = verTudo
    ? check.items
    : [...faltam.slice(0, 6), ...emOrdem.slice(0, faltam.length > 0 ? 2 : 4)];

  return (
    <section className={`insp-card insp-${check.status}`}>
      <header className="insp-card-head">
        <div>
          <h2>{check.title}</h2>
          <p className="insp-req">{check.requirement}</p>
        </div>
        {check.status === "ok" && <Chip tone="success">Em ordem</Chip>}
        {check.status === "pending" && (
          <Chip tone="warning">
            {faltam.length === 1 ? "1 pendência" : `${faltam.length} pendências`}
          </Chip>
        )}
        {check.status === "empty" && <Chip tone="neutral">Sem registro</Chip>}
      </header>

      {check.items.length === 0 ? (
        <p className="insp-empty">{check.summary}</p>
      ) : (
        <>
          <ul className="insp-items">
            {mostrados.map((item, i) => (
              <li key={`${check.id}-${i}`} className={item.ok ? "is-ok" : "is-pending"}>
                <span className="insp-mark" aria-hidden="true">
                  {item.ok ? "✓" : "!"}
                </span>
                <div className="insp-item-body">
                  <span className="insp-label">
                    {item.label}
                    {item.level && (
                      <>
                        {" "}
                        <Chip tone={riskTone(item.level)}>
                          {RISK_LEVEL_LABEL[item.level] ?? item.level}
                        </Chip>
                      </>
                    )}
                  </span>
                  {item.detail && <span className="insp-detail">{item.detail}</span>}
                  {(item.who || item.when) && (
                    <span className="insp-who">
                      {[item.who, item.when].filter(Boolean).join(" · ")}
                    </span>
                  )}
                </div>
                {item.link && (
                  <Link to={item.link} className="insp-go">
                    ver
                  </Link>
                )}
              </li>
            ))}
          </ul>
          {check.items.length > mostrados.length && (
            <Button type="button" variant="ghost" onClick={() => setVerTudo(true)}>
              Ver os {check.items.length} itens
            </Button>
          )}
          {verTudo && check.items.length > 6 && (
            <Button type="button" variant="ghost" onClick={() => setVerTudo(false)}>
              Mostrar menos
            </Button>
          )}
        </>
      )}
    </section>
  );
}

function History() {
  const [events, setEvents] = useState<AuditEntry[] | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchInspectionHistory(50)
      .then((data) => {
        if (!cancelled) setEvents(data.events);
      })
      .catch(() => {
        if (!cancelled) setDenied(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Papel sem acesso ao histórico não vê a seção — nem uma lista vazia que
  // daria a entender que nada aconteceu.
  if (denied) return null;
  if (!events) return <LoadingState label="Carregando o histórico…" />;

  return (
    <section className="insp-card">
      <header className="insp-card-head">
        <div>
          <h2>Histórico: quem mexeu no quê</h2>
          <p className="insp-req">
            Os últimos registros de auditoria. O portal grava cada mudança — é
            daqui que sai a prova de quando cada coisa foi feita.
          </p>
        </div>
      </header>
      {events.length === 0 ? (
        <p className="insp-empty">Nenhum registro ainda.</p>
      ) : (
        <ol className="insp-history">
          {events.map((e) => (
            <li key={e.id}>
              <span className="insp-history-when">{formatDateTime(e.at)}</span>
              <span className="insp-history-what">
                {AUDIT_ACTION_LABEL[e.action] ?? e.action}
              </span>
              <span className="insp-history-who">{e.who}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * O que a fiscalização vê: o PGR inteiro, com as lacunas à mostra, cada item
 * com autor, data e para onde ir ver a prova. [S7-B] [S7-D]
 */
export function InspectionPage() {
  const [data, setData] = useState<InspectionOverview | null>(null);
  const [establishmentId, setEstablishmentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await fetchInspection(establishmentId || undefined));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar");
    } finally {
      setLoading(false);
    }
  }, [establishmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) return <LoadingState label="Montando o painel…" />;
  if (error && !data) {
    return (
      <p className="page-error" role="alert">
        {error}
      </p>
    );
  }
  if (!data) return null;

  const cnpj = formatCnpj(data.organization.taxId);
  const pendentes = data.totals.items_pending;

  return (
    <div className="insp-page">
      <PageHeader
        title="Painel da fiscalização"
        description="Tudo o que um auditor pede, em uma tela — e o que ainda falta, dito com nome e sobrenome. Nada aqui esconde lacuna."
      />

      <section className="insp-summary">
        <div>
          <h2>{data.organization.name}</h2>
          <p className="muted">
            {cnpj ? `CNPJ ${cnpj} · ` : ""}
            Responsável: {data.organization.responsibleName ?? "não cadastrado"}
            {data.organization.responsibleRole
              ? ` (${data.organization.responsibleRole})`
              : ""}
          </p>
          <p className="muted">
            Revisão das avaliações a cada {data.organization.assessmentReviewMonths} meses
            {data.organization.hasSstCertification
              ? " · certificação em sistema de gestão declarada"
              : ""}
          </p>
        </div>
        <div className="insp-score">
          {pendentes === 0 ? (
            <Chip tone="success">Nenhuma pendência encontrada</Chip>
          ) : (
            <Chip tone="warning">
              {pendentes === 1 ? "1 pendência" : `${pendentes} pendências`}
            </Chip>
          )}
          <span className="muted">
            Montado em {formatDateTime(data.generated_at)}
          </span>
          <div className="insp-actions">
            <Button type="button" variant="secondary" onClick={() => void load()}>
              Atualizar
            </Button>
            <Button type="button" onClick={() => window.print()}>
              Imprimir
            </Button>
          </div>
        </div>
      </section>

      {data.establishments.length > 1 && (
        <label className="form-field insp-filter">
          Estabelecimento
          <select
            value={establishmentId}
            onChange={(e) => setEstablishmentId(e.target.value)}
          >
            <option value="">Todos</option>
            {data.establishments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      <div className="insp-grid">
        {data.checks.map((c) => (
          <CheckCard key={c.id} check={c} />
        ))}
      </div>

      {data.people_detail && <History />}
    </div>
  );
}

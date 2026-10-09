import { useEffect, useState } from "react";
import { fetchRiskHistory, type RiskHistory } from "@/api/inventory";
import { Chip } from "@/components/Chip";
import {
  ACTION_STATUS_LABEL,
  CONTROL_STATUS_LABEL,
  CONTROL_TYPE_LABEL,
  formatDay,
  RISK_LEVEL_LABEL,
} from "@/lib/labels";

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/** Nome do que aconteceu, a partir da ação gravada na trilha. */
const CHANGE_LABEL: Record<string, string> = {
  "establishment.update": "Estabelecimento alterado",
  "establishment.archive": "Estabelecimento arquivado",
  "sector.update": "Setor alterado",
  "sector.archive": "Setor arquivado",
  "job_role.update": "Função alterada",
  "job_role.archive": "Função arquivada",
  "activity.update": "Atividade alterada",
  "activity.archive": "Atividade arquivada",
  "change_event.create": "Mudança registrada na operação",
};

/** Campos que a trilha guarda, com nome de gente. */
const FIELD_LABEL: Record<string, string> = {
  name: "nome",
  description: "descrição",
  address: "endereço",
  taxId: "CNPJ",
  archivedAt: "arquivado em",
  job_role_ids: "funções",
};

function describeChange(before: unknown, after: unknown): string[] {
  const b = (before ?? {}) as Record<string, unknown>;
  const a = (after ?? {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  return keys
    .filter((k) => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map((k) => {
      const label = FIELD_LABEL[k] ?? k;
      const from = b[k] == null || b[k] === "" ? "vazio" : String(b[k]);
      const to = a[k] == null || a[k] === "" ? "vazio" : String(a[k]);
      return before === null || before === undefined ? `${label}: ${to}` : `${label}: ${from} → ${to}`;
    });
}

function levelTone(level: string | null) {
  if (!level) return "neutral" as const;
  const key = `risk-${level.toLowerCase()}`;
  const known = [
    "risk-trivial",
    "risk-tolerable",
    "risk-moderate",
    "risk-substantial",
    "risk-intolerable",
  ];
  return (known.includes(key) ? key : "neutral") as
    | "risk-trivial"
    | "risk-tolerable"
    | "risk-moderate"
    | "risk-substantial"
    | "risk-intolerable"
    | "neutral";
}

/**
 * Tudo o que aconteceu com um risco: de onde ele vem, as avaliações (inclusive
 * as substituídas), os controles, as ações e as mudanças na operação. [S2-N]
 */
export function RiskHistoryPanel({ riskId }: { riskId: string }) {
  const [data, setData] = useState<RiskHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setError(null);
    fetchRiskHistory(riskId)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar");
      });
    return () => {
      cancelled = true;
    };
  }, [riskId]);

  if (error) {
    return (
      <p className="form-error" role="alert">
        {error}
      </p>
    );
  }
  if (!data) return <p className="muted">Carregando histórico…</p>;

  const { risk, assessments, controls, actions, changes } = data;
  const current = assessments.find((a) => a.status === "VALIDATED" && !a.supersededAt);

  return (
    <div className="risk-history">
      <div className="risk-history-head">
        <div>
          <h3>{risk.description}</h3>
          <p className="muted">
            {risk.hazard.description} · {risk.hazard.establishment} · {risk.hazard.sector} ·{" "}
            {risk.hazard.activity}
          </p>
        </div>
        {current && (
          <Chip tone={levelTone(current.level)}>{RISK_LEVEL_LABEL[current.level] ?? current.level}</Chip>
        )}
      </div>

      {risk.needsReassessment && (
        <p className="risk-history-flag">
          Precisa de nova avaliação{risk.reassessmentReason ? `: ${risk.reassessmentReason}` : "."}
        </p>
      )}

      <section>
        <h4>Avaliações</h4>
        {assessments.length === 0 ? (
          <p className="muted">Nenhuma avaliação registrada.</p>
        ) : (
          <ol className="risk-history-list">
            {assessments.map((a) => (
              <li key={a.id} className={a.supersededAt ? "is-past" : undefined}>
                <div className="risk-history-row">
                  <Chip tone={levelTone(a.level)}>{RISK_LEVEL_LABEL[a.level] ?? a.level}</Chip>
                  <span>
                    Severidade {a.severity} · Probabilidade {a.probability}
                  </span>
                  <span className="muted">{a.methodology}</span>
                  {a.supersededAt && <span className="muted">substituída em {formatDay(a.supersededAt)}</span>}
                  {a.status === "DRAFT" && <Chip tone="warning">Rascunho</Chip>}
                </div>
                <p className="muted">
                  Avaliado por {a.assessor.name} em {formatDay(a.assessedAt)}
                  {a.validatedBy && a.validatedAt
                    ? ` · validado por ${a.validatedBy.name} em ${formatDay(a.validatedAt)}`
                    : " · ainda não validado"}
                  {a.expiresAt ? ` · revisar até ${formatDay(a.expiresAt)}` : ""}
                </p>
                {(a.severityReason || a.probabilityReason || a.controlsConsidered) && (
                  <p className="muted">
                    {[a.severityReason, a.probabilityReason, a.controlsConsidered].filter(Boolean).join(" · ")}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      <section>
        <h4>Medidas de prevenção</h4>
        {controls.length === 0 ? (
          <p className="muted">Nenhuma medida registrada.</p>
        ) : (
          <ul className="risk-history-list">
            {controls.map((c) => (
              <li key={c.id}>
                <div className="risk-history-row">
                  <strong>{c.description}</strong>
                  <Chip>{CONTROL_TYPE_LABEL[c.type] ?? c.type}</Chip>
                  <Chip tone={c.status === "IMPLEMENTED" ? "success" : "warning"}>
                    {CONTROL_STATUS_LABEL[c.status] ?? c.status}
                  </Chip>
                  {c.implementedAt && <span className="muted">desde {formatDay(c.implementedAt)}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4>Ações</h4>
        {actions.length === 0 ? (
          <p className="muted">Nenhuma ação aberta para este risco.</p>
        ) : (
          <ul className="risk-history-list">
            {actions.map((a) => (
              <li key={a.id}>
                <div className="risk-history-row">
                  <strong>{a.title}</strong>
                  <Chip tone={a.status === "VALIDATED" || a.status === "CLOSED" ? "success" : "info"}>
                    {ACTION_STATUS_LABEL[a.status] ?? a.status}
                  </Chip>
                  {a.dueDate && <span className="muted">prazo {formatDay(a.dueDate)}</span>}
                  {a.assignee && <span className="muted">{a.assignee.name}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h4>Mudanças na operação</h4>
        {changes.length === 0 ? (
          <p className="muted">Nada registrado.</p>
        ) : (
          <ul className="risk-history-list">
            {changes.map((c) => {
              const details = describeChange(c.before, c.after);
              return (
                <li key={c.id}>
                  <div className="risk-history-row">
                    <strong>{CHANGE_LABEL[c.action] ?? c.action}</strong>
                    <span className="muted">
                      {c.actor?.name ?? "—"} · {formatDateTime(c.createdAt)}
                    </span>
                  </div>
                  {details.length > 0 && <p className="muted">{details.join(" · ")}</p>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

import { Fragment, useEffect, useMemo, useState } from "react";
import { fetchActions, type ActionRow } from "@/api/actions";
import { useAuth } from "@/auth/AuthContext";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import {
  ACTION_PRIORITY_LABEL,
  ACTION_STATUS_LABEL,
  formatDay,
  isOverdue,
} from "@/lib/labels";
import "@/components/data-table.css";
import { LoadingState } from "@/components/LoadingState";
import { useModuleAccess } from "@/lib/module-access";
import { ActionEvidencePanel } from "./ActionEvidencePanel";
import "./actions.css";

const STATUS_OPTIONS = Object.keys(ACTION_STATUS_LABEL);

function priorityTone(
  priority: string,
): "neutral" | "info" | "warning" | "danger" {
  switch (priority) {
    case "CRITICAL":
      return "danger";
    case "HIGH":
      return "warning";
    case "MEDIUM":
      return "info";
    default:
      return "neutral";
  }
}

function statusTone(
  status: string,
): "neutral" | "info" | "success" | "warning" | "danger" {
  switch (status) {
    case "CLOSED":
    case "VALIDATED":
      return "success";
    case "WAITING_VALIDATION":
      return "warning";
    case "CANCELLED":
      return "danger";
    case "IN_PROGRESS":
      return "info";
    default:
      return "neutral";
  }
}

export function ActionsPage() {
  const { user } = useAuth();
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mine, setMine] = useState(false);
  const [autoMine, setAutoMine] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [highPriority, setHighPriority] = useState(false);
  const [status, setStatus] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const { canWrite: canReview } = useModuleAccess("acoes");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchActions()
      .then((data) => {
        if (cancelled) return;
        setActions(data.actions);
        /*
          Quem tem ação aberta no próprio nome abre a tela já filtrada: a
          pessoa entra aqui para resolver a dela. [S3-C]
        */
        if (!autoMine && user) {
          const minhas = data.actions.filter(
            (a) =>
              (a.assigneeId ?? a.createdById) === user.id &&
              (a.status === "OPEN" || a.status === "IN_PROGRESS"),
          );
          if (minhas.length > 0) setMine(true);
          setAutoMine(true);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Falha ao carregar");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [autoMine, user]);

  const filtered = useMemo(() => {
    return actions.filter((a) => {
      // Responsável é o assignee; sem assignee, quem criou.
      if (mine && user && (a.assigneeId ?? a.createdById) !== user.id) return false;
      if (overdueOnly && !isOverdue(a.dueDate, a.status)) return false;
      if (
        highPriority &&
        a.priority !== "HIGH" &&
        a.priority !== "CRITICAL"
      ) {
        return false;
      }
      if (status && a.status !== status) return false;
      return true;
    });
  }, [actions, mine, overdueOnly, highPriority, status, user]);

  const overdueCount = filtered.filter((a) =>
    isOverdue(a.dueDate, a.status),
  ).length;
  const hasFilter = mine || overdueOnly || highPriority || !!status;

  return (
    <div>
      <PageHeader
        title="Plano de ação"
        description="O que precisa ser feito, por quem e até quando. Uma ação só encerra com evidência validada."
      />

      <div className="filter-bar">
        <button
          type="button"
          className={`filter-toggle${mine ? " is-active" : ""}`}
          onClick={() => setMine((v) => !v)}
        >
          Minhas ações
        </button>
        <button
          type="button"
          className={`filter-toggle${overdueOnly ? " is-active" : ""}`}
          onClick={() => setOverdueOnly((v) => !v)}
        >
          Atrasadas
        </button>
        <button
          type="button"
          className={`filter-toggle${highPriority ? " is-active" : ""}`}
          onClick={() => setHighPriority((v) => !v)}
        >
          Alta prioridade
        </button>
        <label className="muted" style={{ marginLeft: "auto", fontSize: "0.8rem" }}>
          Situação{" "}
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filtrar por situação"
          >
            <option value="">Todas</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {ACTION_STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!loading && !error && (
        <p className="filter-meta muted">
          <span>{filtered.length}</span>{" "}
          {filtered.length === 1 ? "ação" : "ações"}
          {overdueCount > 0 && (
            <span style={{ marginLeft: "0.5rem", color: "var(--sem-danger-fg)" }}>
              {overdueCount} em atraso
            </span>
          )}
        </p>
      )}

      {loading && <LoadingState label="Carregando plano de ação…" />}
      {!loading && error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && filtered.length === 0 && (
        <EmptyState
          title={
            hasFilter
              ? "Nenhuma ação com esses filtros"
              : "Nenhuma ação no plano"
          }
          description="Ações nascem a partir de um risco avaliado, de uma mudança na operação ou de uma ocorrência."
          action={
            hasFilter ? (
              <button
                type="button"
                className="filter-toggle"
                onClick={() => {
                  setMine(false);
                  setOverdueOnly(false);
                  setHighPriority(false);
                  setStatus("");
                }}
              >
                Limpar filtros
              </button>
            ) : undefined
          }
        />
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="data-table-wrap actions-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Ação</th>
                <th>Prioridade</th>
                <th>Situação</th>
                <th>Prazo</th>
                <th>Origem</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((a) => {
                const overdue = isOverdue(a.dueDate, a.status);
                const open = openId === a.id;
                const toggle = () => setOpenId(open ? null : a.id);
                return (
                  <Fragment key={a.id}>
                  <tr
                    className={`action-row is-clickable${open ? " is-open" : ""}`}
                    onClick={toggle}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggle();
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-expanded={open}
                  >
                    <td>
                      <strong>{a.title}</strong>
                      {a.description && (
                        <div className="muted" style={{ marginTop: "0.2rem" }}>
                          {a.description.length > 120
                            ? `${a.description.slice(0, 120)}…`
                            : a.description}
                        </div>
                      )}
                    </td>
                    <td>
                      <Chip tone={priorityTone(a.priority)}>
                        {ACTION_PRIORITY_LABEL[a.priority] ?? a.priority}
                      </Chip>
                    </td>
                    <td>
                      <Chip tone={statusTone(a.status)}>
                        {ACTION_STATUS_LABEL[a.status] ?? a.status}
                      </Chip>
                    </td>
                    <td>
                      {overdue ? (
                        <Chip tone="danger">{formatDay(a.dueDate)} · atraso</Chip>
                      ) : (
                        formatDay(a.dueDate)
                      )}
                    </td>
                    <td className="muted">
                      {a.occurrenceId
                        ? "Ocorrência"
                        : a.riskId
                          ? "Risco"
                          : a.sourceType}
                    </td>
                  </tr>
                  {open && (
                    <tr className="action-expand">
                      <td colSpan={5}>
                        <ActionEvidencePanel
                          action={a}
                          userId={user?.id}
                          canReview={canReview}
                          onReviewed={(updated) =>
                            setActions((prev) =>
                              prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)),
                            )
                          }
                        />
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

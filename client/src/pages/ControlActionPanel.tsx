import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  createControl,
  createRiskAction,
  fetchControls,
  type Control,
} from "@/api/risks";
import { fetchActions, type ActionRow } from "@/api/actions";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { PeoplePicker } from "@/components/PeoplePicker";
import {
  ACTION_PRIORITY_LABEL,
  ACTION_STATUS_LABEL,
  CONTROL_STATUS_LABEL,
  CONTROL_TYPE_LABEL,
  formatDay,
} from "@/lib/labels";
import "@/components/form.css";
import "./control-action.css";

/**
 * A prioridade vem do nível do risco: intolerável não espera. Fica editável,
 * porque quem conhece a operação pode discordar. [S2-M]
 */
const PRIORITY_BY_LEVEL: Record<string, string> = {
  INTOLERABLE: "CRITICAL",
  SUBSTANTIAL: "HIGH",
  MODERATE: "MEDIUM",
  TOLERABLE: "LOW",
  TRIVIAL: "LOW",
};

/** Prazo sugerido: quanto pior o risco, mais curto. */
const DAYS_BY_PRIORITY: Record<string, number> = {
  CRITICAL: 7,
  HIGH: 30,
  MEDIUM: 90,
  LOW: 180,
};

function isoInDays(days: number): string {
  return new Date(Date.now() - 3 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

/** Medidas de prevenção e as ações que as implantam. [S2-A] */
export function ControlActionPanel({
  riskId,
  riskLevel,
  canWrite,
  onChanged,
}: {
  riskId: string;
  riskLevel: string | null;
  canWrite: boolean;
  onChanged?: () => Promise<void> | void;
}) {
  const [controls, setControls] = useState<Control[] | null>(null);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [controlType, setControlType] = useState("ENGINEERING");
  const [controlDescription, setControlDescription] = useState("");
  const [savingControl, setSavingControl] = useState(false);

  const [openAction, setOpenAction] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState("");
  const [priority, setPriority] = useState(PRIORITY_BY_LEVEL[riskLevel ?? ""] ?? "MEDIUM");
  const [dueDate, setDueDate] = useState(
    isoInDays(DAYS_BY_PRIORITY[PRIORITY_BY_LEVEL[riskLevel ?? ""] ?? "MEDIUM"] ?? 90),
  );
  const [criteria, setCriteria] = useState("");
  const [savingAction, setSavingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [c, a] = await Promise.all([fetchControls(riskId), fetchActions(riskId)]);
    setControls(c.controls);
    setActions(a.actions);
  }, [riskId]);

  useEffect(() => {
    reload().catch((err) => setError(err instanceof Error ? err.message : "Falha ao carregar"));
  }, [reload]);

  async function onAddControl(e: FormEvent) {
    e.preventDefault();
    if (!controlDescription.trim()) return;
    setSavingControl(true);
    setError(null);
    try {
      await createControl({ risk_id: riskId, type: controlType, description: controlDescription.trim() });
      setControlDescription("");
      await reload();
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSavingControl(false);
    }
  }

  function startAction(controlId: string | null, suggestion?: string) {
    setOpenAction(controlId ?? "__sem_controle__");
    setTitle(suggestion ?? "");
    setCriteria("");
    setActionError(null);
  }

  async function onAddAction(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      setActionError("Escreva o que precisa ser feito.");
      return;
    }
    if (!assignee) {
      setActionError("Escolha o responsável.");
      return;
    }
    if (!dueDate) {
      setActionError("Informe o prazo.");
      return;
    }
    setSavingAction(true);
    setActionError(null);
    try {
      await createRiskAction({
        title: title.trim(),
        risk_id: riskId,
        control_id: openAction && openAction !== "__sem_controle__" ? openAction : undefined,
        priority,
        assignee_id: assignee,
        due_date: dueDate,
        effectiveness_criteria: criteria.trim() || undefined,
      });
      setOpenAction(null);
      setTitle("");
      setCriteria("");
      await reload();
      await onChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSavingAction(false);
    }
  }

  const actionsOf = (controlId: string) => actions.filter((a) => a.controlId === controlId);

  return (
    <div className="ctrl">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <h4>Medidas de prevenção</h4>
      {controls === null ? (
        <p className="muted">Carregando…</p>
      ) : controls.length === 0 ? (
        <p className="muted">
          Nenhuma medida. Comece pela que elimina o perigo; EPI é a última opção.
        </p>
      ) : (
        <ul className="ctrl-list">
          {controls.map((c) => (
            <li key={c.id}>
              <div className="ctrl-row">
                <strong>{c.description}</strong>
                <Chip>{CONTROL_TYPE_LABEL[c.type] ?? c.type}</Chip>
                <Chip tone={c.status === "IMPLEMENTED" ? "success" : "warning"}>
                  {CONTROL_STATUS_LABEL[c.status] ?? c.status}
                </Chip>
                {canWrite && c.status !== "IMPLEMENTED" && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => startAction(c.id, `Implantar: ${c.description}`)}
                  >
                    Abrir ação
                  </Button>
                )}
              </div>
              {actionsOf(c.id).map((a) => (
                <p key={a.id} className="muted ctrl-action">
                  {a.title} · {ACTION_STATUS_LABEL[a.status] ?? a.status}
                  {a.dueDate ? ` · prazo ${formatDay(a.dueDate)}` : ""}
                </p>
              ))}
              {c.status !== "IMPLEMENTED" && actionsOf(c.id).length === 0 && (
                <p className="muted ctrl-action">Sem ação: ninguém vai implantar esta medida.</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <form className="ctrl-add" onSubmit={onAddControl}>
          <select value={controlType} onChange={(e) => setControlType(e.target.value)} aria-label="Tipo da medida">
            {Object.entries(CONTROL_TYPE_LABEL).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <input
            value={controlDescription}
            onChange={(e) => setControlDescription(e.target.value)}
            placeholder="Ex.: enclausurar o compressor"
            aria-label="Medida de prevenção"
          />
          <Button type="submit" variant="secondary" disabled={savingControl || !controlDescription.trim()}>
            Adicionar medida
          </Button>
        </form>
      )}

      {canWrite && (
        <div className="ctrl-free-action">
          <Button type="button" variant="ghost" onClick={() => startAction(null)}>
            Abrir ação sem medida ligada
          </Button>
        </div>
      )}

      {openAction && canWrite && (
        <form className="ctrl-action-form" onSubmit={onAddAction}>
          <h4>Nova ação</h4>
          <label className="form-field">
            O que precisa ser feito
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <div className="form-grid cols-2">
            <label className="form-field">
              Responsável
              <PeoplePicker value={assignee} onChange={(id) => setAssignee(id)} required />
            </label>
            <label className="form-field">
              Prazo
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} required />
            </label>
            <label className="form-field">
              Prioridade
              <select
                value={priority}
                onChange={(e) => {
                  setPriority(e.target.value);
                  setDueDate(isoInDays(DAYS_BY_PRIORITY[e.target.value] ?? 90));
                }}
              >
                {Object.entries(ACTION_PRIORITY_LABEL).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
              {riskLevel && (
                <span className="form-hint">Sugerida pelo nível do risco; mude se precisar.</span>
              )}
            </label>
            <label className="form-field">
              Como saber se deu certo
              <input
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
                placeholder="Ex.: nova medição abaixo de 80 dB"
              />
            </label>
          </div>
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          <div className="form-actions">
            <Button type="submit" disabled={savingAction}>
              {savingAction ? "Salvando…" : "Abrir ação"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpenAction(null)}>
              Cancelar
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

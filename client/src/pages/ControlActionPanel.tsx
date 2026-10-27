import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  createControl,
  createRiskAction,
  fetchAssessments,
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
  CRITERIO_HINT,
  CRITERIO_LABEL,
  formatDay,
  nivelParaPrazo,
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

const RISK_LEVEL_LABEL: Record<string, string> = {
  INTOLERABLE: "Intolerável",
  SUBSTANTIAL: "Substancial",
  MODERATE: "Moderado",
  TOLERABLE: "Tolerável",
  TRIVIAL: "Trivial",
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

/** Hoje em Brasília: o prazo não pode ser uma data que já passou. [CB-21] */
function hojeIso(): string {
  return isoInDays(0);
}

/** O que o nível do risco pede: prioridade e dias. [B2-2-A] [S2-M] */
function sugestaoDoNivel(nivel: string | null) {
  const prioridade = PRIORITY_BY_LEVEL[nivel ?? ""] ?? "MEDIUM";
  return { prioridade, dias: DAYS_BY_PRIORITY[prioridade] ?? 90 };
}

/** Medidas de prevenção e as ações que as implantam. [S2-A] */
export function ControlActionPanel({
  riskId,
  canWrite,
  onChanged,
}: {
  riskId: string;
  canWrite: boolean;
  onChanged?: () => Promise<void> | void;
}) {
  /*
    O nível vem da avaliação mais recente, validada ou não, e a tela diz de
    onde ele vem. Só o validado valia: logo depois de avaliar, a tela dizia
    "Sem risco avaliado" e aceitava qualquer prazo. [B3-2-A]
  */
  const [avaliado, setAvaliado] = useState<{ nivel: string; validada: boolean } | null>(
    null,
  );
  const riskLevel = avaliado?.nivel ?? null;
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
  /** Só aparece quando o prazo passa do que o nível do risco pede. [S2-M] */
  const [justificativa, setJustificativa] = useState("");
  const [savingAction, setSavingAction] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [c, a, av] = await Promise.all([
      fetchControls(riskId),
      fetchActions(riskId),
      fetchAssessments(riskId),
    ]);
    setControls(c.controls);
    setActions(a.actions);
    setAvaliado(nivelParaPrazo(av.assessments));
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

  /*
    A sugestão era calculada uma vez, ao abrir o painel — e nesse momento o
    risco recém-registrado ainda não tinha nível, então vinha sempre "Média,
    90 dias". Avaliar em seguida não a atualizava. Agora ela é recalculada
    aqui, com o nível que o risco tem neste instante. [B2-2-A]
  */
  async function startAction(controlId: string | null, suggestion?: string) {
    /* A avaliação pode ter acabado de ser feita no painel de cima. [B3-2-A] */
    let atual = avaliado;
    try {
      atual = nivelParaPrazo((await fetchAssessments(riskId)).assessments);
      setAvaliado(atual);
    } catch {
      /* Sem rede, fica o que já se sabia. */
    }
    const { prioridade, dias } = sugestaoDoNivel(atual?.nivel ?? null);
    setOpenAction(controlId ?? "__sem_controle__");
    setTitle(suggestion ?? "");
    setCriteria("");
    setJustificativa("");
    setPriority(prioridade);
    setDueDate(isoInDays(dias));
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
    if (!criteria.trim()) {
      setActionError("Informe o critério de eficácia: como saber se a ação deu certo.");
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
        deadline_justification: justificativa.trim() || undefined,
        effectiveness_criteria: criteria.trim(),
      });
      setOpenAction(null);
      setTitle("");
      setCriteria("");
      setJustificativa("");
      await reload();
      await onChanged?.();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSavingAction(false);
    }
  }

  const actionsOf = (controlId: string) => actions.filter((a) => a.controlId === controlId);

  /*
    O limite é o do nível do risco. A prioridade continua editável e não
    aperta nem afrouxa o prazo: sem risco avaliado, não há limite. [S2-M]
  */
  const limiteDias = riskLevel ? sugestaoDoNivel(riskLevel).dias : null;
  const passouDoLimite =
    limiteDias !== null && Boolean(dueDate) && dueDate > isoInDays(limiteDias);

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
                {/*
                    Os dois botões se chamavam "Abrir ação": o de cima abria o
                    formulário e o de baixo gravava. Clicar de novo no de cima,
                    com o formulário aberto, apagava o que já tinha sido
                    escrito. Agora ele tem nome próprio e some enquanto o
                    formulário daquela medida está aberto. [CB-26]
                  */}
                {canWrite && c.status !== "IMPLEMENTED" && openAction !== c.id && (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => void startAction(c.id, `Implantar: ${c.description}`)}
                  >
                    Planejar esta medida
                  </Button>
                )}
                {openAction === c.id && (
                  <Chip tone="info">Preenchendo a ação abaixo</Chip>
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
          <Button
            type="button"
            variant="ghost"
            disabled={openAction === "__sem_controle__"}
            onClick={() => void startAction(null)}
          >
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
              <input
                type="date"
                value={dueDate}
                /* Data no passado é erro de digitação, não escolha. [CB-21] */
                min={hojeIso()}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
              <span className="form-hint">
                {riskLevel
                  ? `${RISK_LEVEL_LABEL[riskLevel] ?? riskLevel}${
                      avaliado?.validada ? "" : ", aguardando validação"
                    } → ${
                      ACTION_PRIORITY_LABEL[sugestaoDoNivel(riskLevel).prioridade] ??
                      sugestaoDoNivel(riskLevel).prioridade
                    } → até ${sugestaoDoNivel(riskLevel).dias} dias.`
                  : "Risco ainda sem avaliação: o prazo é livre — só não pode ser uma data que já passou."}
              </span>
            </label>
            <label className="form-field">
              Prioridade
              <select
                value={priority}
                onChange={(e) => {
                  setPriority(e.target.value);
                  setDueDate(isoInDays(DAYS_BY_PRIORITY[e.target.value] ?? 90));
                  setJustificativa("");
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
              {CRITERIO_LABEL}
              <input
                value={criteria}
                onChange={(e) => setCriteria(e.target.value)}
                placeholder="Ex.: nova medição abaixo de 80 dB"
                required
              />
              <span className="form-hint">{CRITERIO_HINT}</span>
            </label>
          </div>
          {/* O prazo do nível virou limite: passar dele exige dizer por quê,
              e o motivo fica junto da ação. [S2-M] */}
          {passouDoLimite && (
            <label className="form-field">
              Por que este prazo passa de {limiteDias} dias
              <input
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                placeholder="Ex.: depende da parada de máquina de janeiro"
                required
              />
            </label>
          )}
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
          <div className="form-actions">
            <Button type="submit" disabled={savingAction}>
              {savingAction ? "Salvando…" : "Gravar a ação"}
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

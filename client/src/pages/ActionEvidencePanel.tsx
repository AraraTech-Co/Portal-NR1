import { FormEvent, useEffect, useState } from "react";
import {
  fetchActionEvidences,
  fetchEvidenceBlob,
  reviewAction,
  type ActionRow,
  type EvidenceRow,
} from "@/api/actions";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { formatDay } from "@/lib/labels";
import "@/components/form.css";

const EVIDENCE_STATUS: Record<EvidenceRow["validationStatus"], { label: string; tone: "warning" | "success" | "danger" }> = {
  PENDING: { label: "Aguardando validação", tone: "warning" },
  ACCEPTED: { label: "Aceita", tone: "success" },
  REJECTED: { label: "Recusada", tone: "danger" },
};

/** Tempo para a outra aba terminar de carregar antes de liberar o arquivo da memória. */
const REVOKE_AFTER_MS = 60_000;

function isImage(e: EvidenceRow) {
  return e.mimeType.startsWith("image/");
}

function openLabel(e: EvidenceRow) {
  if (e.mimeType === "application/pdf") return "Abrir PDF";
  if (e.mimeType.startsWith("video/")) return "Ver vídeo";
  return "Ver em tamanho real";
}

/**
 * Abre a evidência numa aba própria. A aba é aberta AGORA, ainda dentro do
 * clique — depois do `await` o navegador a bloquearia como pop-up.
 */
async function openEvidence(e: EvidenceRow) {
  const tab = window.open("", "_blank");
  try {
    const url = URL.createObjectURL(await fetchEvidenceBlob(e.id));
    if (tab) {
      tab.location.href = url;
    } else {
      // Pop-up bloqueado: tenta de novo por link, sem tirar a pessoa do portal.
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  } catch (err) {
    tab?.close();
    window.alert(err instanceof Error ? err.message : "Não foi possível abrir a evidência.");
  }
}

function EvidenceThumb({ evidence }: { evidence: EvidenceRow }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    fetchEvidenceBlob(evidence.id)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setSrc(url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [evidence.id]);

  if (failed) return <div className="evidence-thumb is-empty">Não foi possível carregar a foto</div>;
  if (!src) return <div className="evidence-thumb is-loading" aria-label="Carregando foto" />;
  return (
    <button
      type="button"
      className="evidence-thumb"
      onClick={() => void openEvidence(evidence)}
      aria-label={`Ver ${evidence.fileName} em tamanho real`}
    >
      <img src={src} alt={evidence.description || evidence.fileName} />
    </button>
  );
}

type Props = {
  action: ActionRow;
  userId: string | undefined;
  canReview: boolean;
  onReviewed: (action: ActionRow) => void;
};

/**
 * Evidências da ação, com a foto à vista, e a validação no mesmo lugar:
 * quem valida decide olhando a prova. [S3-L]
 */
export function ActionEvidencePanel({ action, userId, canReview, onReviewed }: Props) {
  const [evidences, setEvidences] = useState<EvidenceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState<"approve" | "reject" | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchActionEvidences(action.id)
      .then((data) => {
        if (!cancelled) setEvidences(data.evidences);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar");
      });
    return () => {
      cancelled = true;
    };
  }, [action.id, action.status]);

  const waiting = action.status === "WAITING_VALIDATION";
  const executorId = action.assigneeId || action.createdById;
  const isExecutor = Boolean(userId && userId === executorId);

  async function decide(e: FormEvent, decision: "approve" | "reject") {
    e.preventDefault();
    setReviewError(null);
    if (decision === "reject" && !note.trim()) {
      setReviewError("Para recusar, escreva o que falta na evidência.");
      return;
    }
    setSending(decision);
    try {
      const { action: updated } = await reviewAction(
        action.id,
        decision === "approve"
          ? { decision, effectiveness_result: note.trim() || undefined }
          : { decision, rejection_reason: note.trim() },
      );
      setNote("");
      onReviewed(updated);
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : "Falha ao registrar a validação");
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="action-panel">
      {/* A linha da tabela corta a descrição em 120 caracteres; aqui vai inteira. */}
      {action.description && action.description.length > 120 && (
        <p className="action-panel-description">{action.description}</p>
      )}

      {action.rejectionReason && action.status === "IN_PROGRESS" && (
        <p className="action-panel-note is-danger">
          <strong>Evidência recusada:</strong> {action.rejectionReason}
        </p>
      )}
      {action.effectivenessResult && action.status === "VALIDATED" && (
        <p className="action-panel-note is-success">
          <strong>Validada:</strong> {action.effectivenessResult}
        </p>
      )}

      <h3 className="action-panel-title">Evidências</h3>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!error && evidences === null && <p className="muted">Carregando evidências…</p>}
      {evidences && evidences.length === 0 && (
        <p className="muted">Nenhuma evidência enviada ainda.</p>
      )}
      {evidences && evidences.length > 0 && (
        <ul className="evidence-list">
          {evidences.map((ev) => {
            const status = EVIDENCE_STATUS[ev.validationStatus];
            const hasFile = ev.sizeBytes > 0;
            return (
              <li key={ev.id} className="evidence-item">
                {hasFile && isImage(ev) ? (
                  <EvidenceThumb evidence={ev} />
                ) : (
                  <div className="evidence-thumb is-empty">
                    {hasFile ? ev.mimeType.split("/")[1]?.toUpperCase() : "Sem arquivo"}
                  </div>
                )}
                <div className="evidence-meta">
                  <strong className="evidence-name">{ev.fileName}</strong>
                  {ev.description && <span>{ev.description}</span>}
                  <span className="muted">
                    Enviada por {ev.uploadedBy.name} em {formatDay(ev.uploadedAt)}
                    {ev.eventDate && ` · fato em ${formatDay(ev.eventDate)}`}
                  </span>
                  <span className="evidence-actions">
                    <Chip tone={status.tone}>{status.label}</Chip>
                    {hasFile && (
                      <Button type="button" variant="ghost" onClick={() => void openEvidence(ev)}>
                        {openLabel(ev)}
                      </Button>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {waiting && canReview && !isExecutor && (
        <form className="action-review" onSubmit={(e) => decide(e, "approve")}>
          <h3 className="action-panel-title">Validar</h3>
          {action.effectivenessCriteria && (
            <p className="action-panel-note">
              <strong>Critério de eficácia:</strong> {action.effectivenessCriteria}
            </p>
          )}
          <label className="form-field">
            O que você conferiu
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ao aprovar: o que confirmou na evidência. Ao recusar: o que falta."
            />
          </label>
          {reviewError && (
            <p className="form-error" role="alert">
              {reviewError}
            </p>
          )}
          <div className="form-actions">
            <Button type="submit" disabled={sending !== null || evidences === null}>
              {sending === "approve" ? "Aprovando…" : "Aprovar"}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={sending !== null}
              onClick={(e) => void decide(e, "reject")}
            >
              {sending === "reject" ? "Recusando…" : "Recusar evidência"}
            </Button>
          </div>
        </form>
      )}
      {waiting && canReview && isExecutor && (
        <p className="action-panel-note">
          Você executou esta ação. A validação precisa ser feita por outra pessoa.
        </p>
      )}
    </div>
  );
}

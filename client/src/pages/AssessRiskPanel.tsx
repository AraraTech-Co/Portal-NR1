import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  createAssessment,
  fetchAssessments,
  fetchMethodologies,
  validateAssessment,
  type Assessment,
  type MethodologyVersion,
} from "@/api/risks";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { formatDay, RISK_LEVEL_LABEL } from "@/lib/labels";
import "@/components/form.css";
import "./assess-risk.css";

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

/** Nome do nível pela própria metodologia; se ela não nomear, o nome padrão. */
function levelName(version: MethodologyVersion | null, id: string): string {
  return version?.levels.find((l) => l.id === id)?.label ?? RISK_LEVEL_LABEL[id] ?? id;
}

/**
 * Avaliar o risco: severidade × probabilidade pela matriz da metodologia, e
 * outra pessoa valida. O nível nunca é digitado — sai da matriz. [S2-A]
 */
export function AssessRiskPanel({
  riskId,
  canWrite,
  onChanged,
}: {
  riskId: string;
  canWrite: boolean;
  onChanged?: () => Promise<void> | void;
}) {
  const { user } = useAuth();
  const [version, setVersion] = useState<MethodologyVersion | null>(null);
  const [methodologyName, setMethodologyName] = useState("");
  const [assessments, setAssessments] = useState<Assessment[] | null>(null);
  const [severity, setSeverity] = useState<number | null>(null);
  const [probability, setProbability] = useState<number | null>(null);
  const [severityReason, setSeverityReason] = useState("");
  const [probabilityReason, setProbabilityReason] = useState("");
  const [controlsConsidered, setControlsConsidered] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const d = await fetchAssessments(riskId);
    setAssessments(d.assessments);
  }, [riskId]);

  useEffect(() => {
    fetchMethodologies()
      .then((d) => {
        const m = d.methodologies.find((x) => x.isDefault) ?? d.methodologies[0];
        setMethodologyName(m?.name ?? "");
        setVersion(m?.versions[0] ?? null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Falha ao carregar"));
  }, []);

  useEffect(() => {
    reload().catch((err) => setError(err instanceof Error ? err.message : "Falha ao carregar"));
  }, [reload]);

  // O nível aparece enquanto a pessoa escolhe, direto da matriz.
  const preview =
    version && severity != null && probability != null
      ? version.matrix[`${severity}-${probability}`] ?? null
      : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!version || severity == null || probability == null) {
      setError("Escolha a severidade e a probabilidade.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await createAssessment({
        risk_id: riskId,
        methodology_version_id: version.id,
        severity,
        probability,
        severity_reason: severityReason.trim() || undefined,
        probability_reason: probabilityReason.trim() || undefined,
        controls_considered: controlsConsidered.trim() || undefined,
      });
      setSeverity(null);
      setProbability(null);
      setSeverityReason("");
      setProbabilityReason("");
      setControlsConsidered("");
      await reload();
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  async function onValidate(id: string) {
    setBusy(true);
    setError(null);
    try {
      await validateAssessment(id);
      await reload();
      await onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao validar");
    } finally {
      setBusy(false);
    }
  }

  const draft = assessments?.find((a) => a.status === "DRAFT") ?? null;
  const validated = assessments?.find((a) => a.status === "VALIDATED") ?? null;

  return (
    <div className="assess">
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {validated && (
        <p className="assess-current">
          Vale hoje:{" "}
          <Chip tone={levelTone(validated.resultingLevel)}>
            {levelName(version, validated.resultingLevel)}
          </Chip>{" "}
          <span className="muted">
            severidade {validated.severity} · probabilidade {validated.probability} · validada em{" "}
            {formatDay(validated.validatedAt)}
          </span>
        </p>
      )}

      {draft && (
        <div className="assess-draft">
          <p>
            Avaliação aguardando validação:{" "}
            <Chip tone={levelTone(draft.resultingLevel)}>{levelName(version, draft.resultingLevel)}</Chip>{" "}
            <span className="muted">
              severidade {draft.severity} · probabilidade {draft.probability} · feita em{" "}
              {formatDay(draft.assessedAt)}
            </span>
          </p>
          {canWrite &&
            (draft.assessorId === user?.id ? (
              <p className="muted">Você fez esta avaliação. Outra pessoa precisa validar.</p>
            ) : (
              <Button type="button" disabled={busy} onClick={() => void onValidate(draft.id)}>
                {busy ? "Validando…" : "Validar avaliação"}
              </Button>
            ))}
        </div>
      )}

      {canWrite && !draft && version && (
        <form className="form-grid" onSubmit={onSubmit}>
          <p className="muted assess-method">
            {methodologyName} · versão {version.version}
          </p>
          <div className="form-grid cols-2">
            <label className="form-field">
              Severidade
              <select
                value={severity ?? ""}
                onChange={(e) => setSeverity(e.target.value === "" ? null : Number(e.target.value))}
                required
              >
                <option value="">Escolha…</option>
                {version.severityScale.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.value} — {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Probabilidade
              <select
                value={probability ?? ""}
                onChange={(e) => setProbability(e.target.value === "" ? null : Number(e.target.value))}
                required
              >
                <option value="">Escolha…</option>
                {version.probabilityScale.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.value} — {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {severity != null && probability != null && (
            <p className="assess-preview">
              {preview ? (
                <>
                  Nível pela matriz:{" "}
                  <Chip tone={levelTone(preview)}>{levelName(version, preview)}</Chip>
                </>
              ) : (
                <span className="form-error">
                  A matriz desta metodologia não define {severity} × {probability}. Escolha outra
                  combinação ou ajuste a metodologia.
                </span>
              )}
            </p>
          )}

          <div className="form-grid cols-2">
            <label className="form-field">
              Por que esta severidade
              <input value={severityReason} onChange={(e) => setSeverityReason(e.target.value)} />
            </label>
            <label className="form-field">
              Por que esta probabilidade
              <input value={probabilityReason} onChange={(e) => setProbabilityReason(e.target.value)} />
            </label>
          </div>
          <label className="form-field">
            Controles considerados
            <input
              value={controlsConsidered}
              onChange={(e) => setControlsConsidered(e.target.value)}
              placeholder="O que já existe hoje e foi levado em conta"
            />
          </label>
          <div className="form-actions">
            <Button type="submit" disabled={busy || !preview}>
              {busy ? "Salvando…" : validated ? "Reavaliar" : "Avaliar risco"}
            </Button>
          </div>
        </form>
      )}

      {canWrite && !draft && !version && <p className="muted">Nenhuma metodologia cadastrada.</p>}
    </div>
  );
}

import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  askPayslipQuestion,
  downloadPayslipFile,
  downloadPayslipVersion,
  fetchPayslip,
  type PayslipDetail,
} from "@/api/payslips";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { PageHeader } from "@/components/PageHeader";
import { formatDay } from "@/lib/labels";
import "@/components/data-table.css";
import "@/components/form.css";
import { LoadingState } from "@/components/LoadingState";

const MONTHS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export function PayslipDetailPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const [payslip, setPayslip] = useState<PayslipDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const data = await fetchPayslip(id);
    setPayslip(data);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    reload()
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
  }, [reload]);

  async function onAsk(e: FormEvent) {
    e.preventDefault();
    if (!question.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      await askPayslipQuestion(id, question.trim());
      setQuestion("");
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao enviar");
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <LoadingState />;
  if (error || !payslip) {
    return (
      <div>
        <p className="page-error" role="alert">
          {error ?? "Holerite não encontrado."}
        </p>
        <Link to="/holerites">Voltar</Link>
      </div>
    );
  }

  if (!user || payslip.userId !== user.id) {
    return (
      <div>
        <p className="page-error" role="alert">
          Só o titular pode abrir o holerite.
        </p>
        <Link to="/holerites">Voltar</Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={`${MONTHS[payslip.referenceMonth - 1] ?? payslip.referenceMonth}/${payslip.referenceYear}`}
        description={payslip.fileName}
        actions={
          <Button
            type="button"
            variant="secondary"
            onClick={() => downloadPayslipFile(payslip.id, payslip.fileName)}
          >
            Baixar arquivo
          </Button>
        }
      />

      <p className="muted">
        <Link to="/holerites">← Holerites</Link>
        {" · "}
        Publicado em {formatDay(payslip.publishedAt)} por{" "}
        {payslip.publishedBy.name}
        {" · "}
        {payslip.viewedAt ? (
          <Chip tone="success">Visto</Chip>
        ) : (
          <Chip tone="warning">Não visto</Chip>
        )}
      </p>

      {payslip.overrideReason && (
        /* Publicado fora do padrão da conferência: quem titular e fiscal
           precisam saber. [CB-28] */
        <p className="form-hint">
          <strong>Publicado fora do padrão de conferência</strong> por{" "}
          {payslip.overriddenBy?.name ?? "quem publicou"}: {payslip.overrideReason}
        </p>
      )}

      {payslip.versions.length > 0 && (
        <section className="form-section">
          {/* A versão de antes deixou de ser apagada: é a prova do que foi
              entregue antes da correção. [S5-F] */}
          <h2>Versões anteriores</h2>
          <ul>
            {payslip.versions.map((v) => (
              <li key={v.id}>
                {v.fileName} · publicada em {formatDay(v.publishedAt)} ·{" "}
                {v.viewedAt
                  ? `você viu em ${formatDay(v.viewedAt)}`
                  : "você não chegou a abrir"}{" "}
                · substituída em {formatDay(v.replacedAt)} por{" "}
                {v.replacedBy.name}{" "}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() =>
                    void downloadPayslipVersion(payslip.id, v.id, v.fileName)
                  }
                >
                  Baixar
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="form-section">
        <h2>Dúvidas</h2>
        {payslip.questions.length === 0 && (
          <p className="muted">Nenhuma dúvida registrada neste holerite.</p>
        )}
        {payslip.questions.map((q) => (
          <div
            key={q.id}
            style={{
              marginBottom: "1rem",
              paddingBottom: "1rem",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <p>
              <strong>{q.askedBy.name}</strong>
              <span className="muted"> · {formatDay(q.createdAt)}</span>
            </p>
            <p>{q.body}</p>
            {q.answer ? (
              <p className="muted">
                Resposta ({q.answeredBy?.name ?? "RH"}): {q.answer}
              </p>
            ) : (
              <Chip tone="warning">Aguardando resposta</Chip>
            )}
          </div>
        ))}

        <form className="form-grid" onSubmit={onAsk}>
          <label className="form-field">
            Perguntar sobre este holerite
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              disabled={busy}
              required
            />
          </label>
          {formError && <p className="form-error">{formError}</p>}
          <div className="form-actions">
            <Button type="submit" disabled={busy}>
              {busy ? "Enviando…" : "Enviar dúvida"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}

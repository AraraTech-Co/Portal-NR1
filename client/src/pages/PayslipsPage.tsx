import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  answerPayslipQuestion,
  downloadPayslipFile,
  fetchOpenPayslipQuestions,
  fetchPayslips,
  fileToBase64,
  publishPayslip,
  type OpenPayslipQuestion,
  type PayslipListItem,
} from "@/api/payslips";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { PeoplePicker } from "@/components/PeoplePicker";
import { formatDay } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import "@/components/data-table.css";
import "@/components/form.css";

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

function competenceLabel(month: number, year: number): string {
  return `${MONTHS[month - 1] ?? month}/${year}`;
}

export function PayslipsPage() {
  const { user } = useAuth();
  const { canWrite: isRh } = useModuleAccess("holerites");
  const [rows, setRows] = useState<PayslipListItem[]>([]);
  const [openQs, setOpenQs] = useState<OpenPayslipQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [questionsError, setQuestionsError] = useState<string | null>(null);

  const now = useMemo(() => new Date(), []);
  const [userId, setUserId] = useState("");
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [file, setFile] = useState<File | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);
  const [downloading, setDownloading] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busyQ, setBusyQ] = useState<string | null>(null);

  const mine = useMemo(
    () => (user ? rows.filter((r) => r.userId === user.id) : []),
    [rows, user],
  );
  const published = useMemo(
    () => (user ? rows.filter((r) => r.userId !== user.id) : rows),
    [rows, user],
  );

  const reload = useCallback(async () => {
    const list = await fetchPayslips();
    setRows(list);
    if (!isRh) {
      setOpenQs([]);
      setQuestionsError(null);
      return;
    }
    try {
      const questions = await fetchOpenPayslipQuestions();
      setOpenQs(questions);
      setQuestionsError(null);
    } catch (err) {
      setOpenQs([]);
      setQuestionsError(
        err instanceof Error ? err.message : "Falha ao carregar dúvidas",
      );
    }
  }, [isRh]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
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

  async function onPublish(e: FormEvent) {
    e.preventDefault();
    if (!file || !userId) {
      setFormError("Escolha o colaborador e o arquivo.");
      return;
    }
    setPublishing(true);
    setFormError(null);
    setFormOk(null);
    try {
      const content_base64 = await fileToBase64(file);
      const result = await publishPayslip({
        user_id: userId,
        reference_month: Number(month),
        reference_year: Number(year),
        file_name: file.name,
        mime_type: file.type || "application/pdf",
        content_base64,
      });
      setFormOk(
        result.replaced
          ? "Holerite substituído para esta competência."
          : "Holerite publicado.",
      );
      setFile(null);
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao publicar");
    } finally {
      setPublishing(false);
    }
  }

  async function onDownload(row: PayslipListItem) {
    setDownloading(row.id);
    try {
      await downloadPayslipFile(row.id, row.fileName);
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha no download");
    } finally {
      setDownloading(null);
    }
  }

  async function onAnswer(q: OpenPayslipQuestion) {
    const answer = answers[q.id]?.trim();
    if (!answer) return;
    setBusyQ(q.id);
    try {
      await answerPayslipQuestion(q.payslip_id, q.id, answer);
      setAnswers((prev) => ({ ...prev, [q.id]: "" }));
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao responder");
    } finally {
      setBusyQ(null);
    }
  }

  function renderRow(r: PayslipListItem, showCollaborator: boolean) {
    const isMine = Boolean(user && r.userId === user.id);
    return (
      <tr key={r.id}>
        {showCollaborator && <td>{r.user.name}</td>}
        <td>
          <strong>
            {competenceLabel(r.referenceMonth, r.referenceYear)}
          </strong>
        </td>
        <td className="muted">{r.fileName}</td>
        <td>
          {r.viewedAt ? (
            <Chip tone="success">Visto</Chip>
          ) : (
            <Chip tone="warning">Não visto</Chip>
          )}
          {r.open_questions > 0 ? (
            <span style={{ marginLeft: "0.35rem" }}>
              <Chip tone="info">
                {r.open_questions} dúvida
                {r.open_questions > 1 ? "s" : ""}
              </Chip>
            </span>
          ) : r._count.questions > 0 ? (
            <span style={{ marginLeft: "0.35rem" }}>
              <Chip>{r._count.questions} dúvida(s)</Chip>
            </span>
          ) : null}
        </td>
        <td className="muted">
          {formatDay(r.publishedAt)}
          {showCollaborator ? (
            <div className="muted">por {r.publishedBy.name}</div>
          ) : null}
        </td>
        <td>
          {isMine ? (
            <div className="form-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={downloading === r.id}
                onClick={() => onDownload(r)}
              >
                {downloading === r.id ? "…" : "Baixar"}
              </Button>
              <Link to={`/holerites/${r.id}`}>
                <Button type="button" variant="ghost">
                  Detalhe
                </Button>
              </Link>
            </div>
          ) : (
            <span className="muted">Só o titular abre</span>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div>
      <PageHeader
        title="Holerites"
        description={
          isRh
            ? "Publique e acompanhe se o colaborador abriu. Só o titular baixa o arquivo."
            : "Consulte seus holerites e tire dúvidas com o RH."
        }
      />

      {isRh && openQs.length > 0 && (
        <p
          className="filter-meta"
          style={{ color: "var(--sem-warning-fg)", fontWeight: 600 }}
        >
          {openQs.length === 1
            ? "1 dúvida aguardando resposta."
            : `${openQs.length} dúvidas aguardando resposta.`}
        </p>
      )}

      {isRh && (
        <section className="form-section">
          <h2>Publicar holerite</h2>
          <p className="muted">
            Após publicar, o arquivo fica acessível apenas ao colaborador. Se já
            existir na mesma competência, o arquivo é substituído.
          </p>
          <form className="form-grid" onSubmit={onPublish}>
            <div className="form-grid cols-2">
              <label className="form-field">
                Colaborador
                <PeoplePicker
                  value={userId}
                  required
                  disabled={publishing}
                  onChange={(id) => setUserId(id)}
                />
              </label>
              <label className="form-field">
                Arquivo (PDF ou imagem)
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  disabled={publishing}
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  required
                />
              </label>
            </div>
            <div className="form-grid cols-2">
              <label className="form-field">
                Mês
                <select
                  value={month}
                  onChange={(e) => setMonth(e.target.value)}
                  disabled={publishing}
                >
                  {MONTHS.map((label, i) => (
                    <option key={label} value={String(i + 1)}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                Ano
                <input
                  type="number"
                  min={2000}
                  max={2100}
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  disabled={publishing}
                  required
                />
              </label>
            </div>
            {formError && <p className="form-error">{formError}</p>}
            {formOk && <p className="muted">{formOk}</p>}
            <div className="form-actions">
              <Button type="submit" disabled={publishing || !userId}>
                {publishing ? "Publicando…" : "Publicar holerite"}
              </Button>
            </div>
          </form>
        </section>
      )}

      {isRh && (
        <section className="form-section">
          <h2>Dúvidas em aberto</h2>
          {questionsError && (
            <p className="form-error" role="alert">
              {questionsError}
            </p>
          )}
          {!questionsError && openQs.length === 0 ? (
            <p className="muted">Nenhuma dúvida pendente.</p>
          ) : (
            openQs.map((q) => (
              <div
                key={q.id}
                style={{
                  marginBottom: "1rem",
                  paddingBottom: "1rem",
                  borderBottom: "1px solid var(--border)",
                }}
              >
                <p>
                  <strong>{q.user.name}</strong>
                  <span className="muted">
                    {" "}
                    · {competenceLabel(q.reference_month, q.reference_year)} ·{" "}
                    {formatDay(q.created_at)}
                  </span>
                </p>
                <p>{q.body}</p>
                <div className="form-grid">
                  <label className="form-field">
                    Resposta
                    <textarea
                      value={answers[q.id] ?? ""}
                      onChange={(e) =>
                        setAnswers((prev) => ({
                          ...prev,
                          [q.id]: e.target.value,
                        }))
                      }
                      disabled={busyQ === q.id}
                    />
                  </label>
                  <div className="form-actions">
                    <Button
                      type="button"
                      disabled={busyQ === q.id || !(answers[q.id] ?? "").trim()}
                      onClick={() => onAnswer(q)}
                    >
                      {busyQ === q.id ? "Enviando…" : "Responder"}
                    </Button>
                  </div>
                </div>
              </div>
            ))
          )}
        </section>
      )}

      {loading && <LoadingState />}
      {!loading && error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && rows.length === 0 && (
        <EmptyState
          title="Nenhum holerite"
          description={
            isRh
              ? "Use o formulário acima para publicar o primeiro."
              : "Quando o RH publicar, seus holerites aparecem aqui."
          }
        />
      )}

      {!loading && !error && mine.length > 0 && (
        <section className="form-section">
          <h2>Meus holerites</h2>
          <p className="muted">Só você pode baixar e abrir estes arquivos.</p>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Competência</th>
                  <th>Arquivo</th>
                  <th>Situação</th>
                  <th>Publicado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>{mine.map((r) => renderRow(r, false))}</tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && !error && isRh && published.length > 0 && (
        <section className="form-section">
          <h2>Publicados na organização</h2>
          <p className="muted">
            Consulte se o colaborador já viu. O arquivo só abre para o titular.
          </p>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Colaborador</th>
                  <th>Competência</th>
                  <th>Arquivo</th>
                  <th>Situação</th>
                  <th>Publicado</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>{published.map((r) => renderRow(r, true))}</tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

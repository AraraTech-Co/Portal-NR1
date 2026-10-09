import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchEthicsReport,
  sendCommitteeMessage,
  updateEthicsStatus,
  type EthicsReportDetail,
} from "@/api/ethics";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EthicsThread } from "@/components/EthicsThread";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { formatDay, REPORT_CATEGORY_LABEL, REPORT_STATUS_LABEL } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import "@/components/form.css";

const CLOSED = new Set(["RESOLVED", "ARCHIVED"]);

function statusTone(status: string): "warning" | "info" | "success" | "neutral" {
  if (status === "RECEIVED") return "warning";
  if (status === "AWAITING_INFO") return "info";
  if (status === "RESOLVED") return "success";
  return "neutral";
}

/** Comitê abre o relato, conversa com quem denunciou e encerra. [S5-L] */
export function EthicsReportDetailPage() {
  const { id = "" } = useParams();
  const { canWrite } = useModuleAccess("comite");
  const [report, setReport] = useState<EthicsReportDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [askInfo, setAskInfo] = useState(false);
  const [closing, setClosing] = useState<"RESOLVED" | "ARCHIVED" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const data = await fetchEthicsReport(id);
    setReport(data.report);
  }, [id]);

  useEffect(() => {
    reload().catch((err) => setError(err instanceof Error ? err.message : "Falha ao carregar"));
  }, [reload]);

  async function onReply(e: FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      await sendCommitteeMessage(id, reply.trim());
      if (askInfo) await updateEthicsStatus(id, { status: "AWAITING_INFO" });
      setReply("");
      setAskInfo(false);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Falha ao enviar");
    } finally {
      setBusy(false);
    }
  }

  async function onClose(e: FormEvent) {
    e.preventDefault();
    if (!closing || !note.trim()) return;
    setBusy(true);
    setActionError(null);
    try {
      await updateEthicsStatus(id, { status: closing, resolution_note: note.trim() });
      setClosing(null);
      setNote("");
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Falha ao encerrar");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div>
        <p className="page-error" role="alert">
          {error}
        </p>
        <Link to="/comite">Voltar aos relatos</Link>
      </div>
    );
  }
  if (!report) return <LoadingState label="Carregando relato…" />;

  const closed = CLOSED.has(report.status);

  return (
    <div>
      <p style={{ margin: "0 0 0.5rem" }}>
        <Link to="/comite" className="muted">
          ← Relatos do comitê
        </Link>
      </p>
      <PageHeader
        title={`Relato ${report.protocol}`}
        description={`${REPORT_CATEGORY_LABEL[report.category] ?? report.category} · recebido em ${formatDay(report.createdAt)}${
          report.establishment ? ` · ${report.establishment.name}` : ""
        }`}
      />

      <section className="form-section">
        <p style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", margin: 0 }}>
          <Chip tone={statusTone(report.status)}>{REPORT_STATUS_LABEL[report.status] ?? report.status}</Chip>
          <Chip>{report.isAnonymous ? "Anônimo" : "Identificado"}</Chip>
        </p>
        <h2 style={{ marginTop: "1rem" }}>O que foi relatado</h2>
        <p style={{ whiteSpace: "pre-wrap", maxWidth: "70ch" }}>{report.description}</p>
        {closed && report.resolutionNote && (
          <p className="muted" style={{ maxWidth: "70ch" }}>
            <strong>Encerramento:</strong> {report.resolutionNote}
          </p>
        )}
      </section>

      <section className="form-section">
        <h2>Conversa</h2>
        <EthicsThread messages={report.messages} viewer="COMMITTEE" />

        {!closed && canWrite && (
          <form className="form-grid" onSubmit={onReply} style={{ marginTop: "1rem" }}>
            <label className="form-field">
              Responder a quem denunciou
              <textarea
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="A pessoa lê pelo protocolo. Não peça dados que a identifiquem se o relato é anônimo."
                required
              />
            </label>
            <label className="muted" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
              <input type="checkbox" checked={askInfo} onChange={(e) => setAskInfo(e.target.checked)} />
              Estou pedindo mais informações (o relato fica “Aguardando o denunciante”)
            </label>
            <div className="form-actions">
              <Button type="submit" disabled={busy || !reply.trim()}>
                {busy ? "Enviando…" : "Enviar resposta"}
              </Button>
            </div>
          </form>
        )}
        {closed && <p className="muted">Relato encerrado: não recebe novas mensagens.</p>}
      </section>

      {!closed && canWrite && (
        <section className="form-section">
          <h2>Encerrar</h2>
          {!closing ? (
            <div className="form-actions">
              <Button type="button" variant="secondary" onClick={() => setClosing("RESOLVED")}>
                Encerrar como resolvido
              </Button>
              <Button type="button" variant="ghost" onClick={() => setClosing("ARCHIVED")}>
                Arquivar
              </Button>
            </div>
          ) : (
            <form className="form-grid" onSubmit={onClose}>
              <label className="form-field">
                {closing === "RESOLVED" ? "O que foi feito" : "Por que arquivar"}
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Quem denunciou vê este texto pelo protocolo."
                  required
                />
              </label>
              <div className="form-actions">
                <Button type="submit" disabled={busy || !note.trim()}>
                  {closing === "RESOLVED" ? "Encerrar como resolvido" : "Arquivar"}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setClosing(null)}>
                  Cancelar
                </Button>
              </div>
            </form>
          )}
        </section>
      )}

      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}
    </div>
  );
}

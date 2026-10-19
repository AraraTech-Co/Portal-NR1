import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchEthicsPeople,
  fetchEthicsReport,
  sendCommitteeMessage,
  setEthicsReportCited,
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
  /** Quem a denúncia envolve — marcar tira a pessoa deste caso. [CB-27] */
  const [people, setPeople] = useState<
    Array<{ id: string; name: string; active: boolean }>
  >([]);
  const [citado, setCitado] = useState("");
  const [citeError, setCiteError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const data = await fetchEthicsReport(id);
    setReport(data.report);
  }, [id]);

  useEffect(() => {
    reload().catch((err) => setError(err instanceof Error ? err.message : "Falha ao carregar"));
  }, [reload]);

  useEffect(() => {
    if (!canWrite) return;
    // Lista só de nomes: o comitê pode não ler Colaboradores. [CB-27]
    fetchEthicsPeople()
      .then(setPeople)
      .catch(() => setPeople([]));
  }, [canWrite]);

  async function marcarCitado(userId: string, cited: boolean) {
    setBusy(true);
    setCiteError(null);
    try {
      await setEthicsReportCited(id, userId, cited);
      setCitado("");
      await reload();
    } catch (err) {
      setCiteError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

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

      {canWrite && (
        <section className="form-section">
          <h2>Quem a denúncia envolve</h2>
          <p className="muted" style={{ maxWidth: "70ch" }}>
            Marcar alguém aqui tira a pessoa <em>deste</em> caso: ela não o vê
            na lista, não o abre e não responde. Serve para quando a denúncia é
            contra alguém do próprio comitê.
          </p>
          {report.cited.length > 0 && (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: "1rem 0",
                display: "grid",
                gap: "0.5rem",
              }}
            >
              {report.cited.map((c) => (
                <li
                  key={c.userId}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "0.5rem",
                  }}
                >
                  <span>
                    <strong>{c.user.name}</strong>{" "}
                    <span className="muted">
                      marcado em {formatDay(c.markedAt)}
                      {c.markedBy ? ` · por ${c.markedBy.name}` : ""}
                    </span>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => marcarCitado(c.userId, false)}
                  >
                    Desmarcar
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <div className="form-grid">
            <label className="form-field">
              Marcar quem a denúncia envolve
              <select
                value={citado}
                onChange={(e) => setCitado(e.target.value)}
              >
                <option value="">Escolha a pessoa</option>
                {people
                  .filter(
                    (p) => !report.cited.some((c) => c.userId === p.id),
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.active ? "" : " (sem acesso)"}
                    </option>
                  ))}
              </select>
            </label>
            <div className="form-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={!citado || busy}
                onClick={() => marcarCitado(citado, true)}
              >
                Marcar
              </Button>
            </div>
          </div>
          {citeError && (
            <p className="form-error" role="alert">
              {citeError}
            </p>
          )}
        </section>
      )}

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

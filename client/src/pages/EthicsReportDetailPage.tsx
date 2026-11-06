import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchEthicsPeople,
  fetchEthicsReport,
  sendCommitteeMessage,
  setEthicsReportCited,
  setEthicsSeverity,
  triarDenuncia,
  updateEthicsStatus,
  type EthicsReportDetail,
} from "@/api/ethics";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EthicsThread } from "@/components/EthicsThread";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import {
  DEADLINE_SITUATION_LABEL,
  deadlineTone,
  formatDay,
  formatInstant,
  REPORT_CATEGORY_LABEL,
  REPORT_SEVERITY_LABEL,
  REPORT_STATUS_LABEL,
} from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import { useAuth } from "@/auth/AuthContext";
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
  /*
    A triagem é de quem é dono da conta, ou do master: é a eles que vai a
    denúncia que diz envolver alguém do comitê. [B3-3-H]
  */
  const { user } = useAuth();
  const podeTriar = Boolean(user?.is_master) || user?.role === "OWNER";
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
  /** Ajuste de gravidade: só com justificativa. [C1-1] */
  const [ajustando, setAjustando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [severityError, setSeverityError] = useState<string | null>(null);

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

  async function devolverAoComite() {
    setBusy(true);
    setActionError(null);
    try {
      await triarDenuncia(id);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Falha ao devolver");
    } finally {
      setBusy(false);
    }
  }

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

  async function onAdjustSeverity(e: FormEvent) {
    e.preventDefault();
    if (!report) return;
    if (!motivo.trim()) {
      setSeverityError("Escreva por que a gravidade está sendo ajustada.");
      return;
    }
    const nova = report.severity === "HIGH" ? "NORMAL" : "HIGH";
    setBusy(true);
    setSeverityError(null);
    try {
      await setEthicsSeverity(id, nova, motivo.trim());
      setAjustando(false);
      setMotivo("");
      await reload();
    } catch (err) {
      setSeverityError(err instanceof Error ? err.message : "Falha ao ajustar");
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
          <Chip tone={report.severity === "HIGH" ? "danger" : "neutral"}>
            Gravidade {REPORT_SEVERITY_LABEL[report.severity]?.toLowerCase() ?? report.severity}
            {report.severitySource === "COMMITTEE" ? " · ajustada pelo comitê" : ""}
          </Chip>
        </p>
        <h2 style={{ marginTop: "1rem" }}>O que foi relatado</h2>
        <p style={{ whiteSpace: "pre-wrap", maxWidth: "70ch" }}>{report.description}</p>
        {closed && report.resolutionNote && (
          <p className="muted" style={{ maxWidth: "70ch" }}>
            <strong>Encerramento:</strong> {report.resolutionNote}
          </p>
        )}
        {/* Se quem denunciou leu o encerramento — ciência, não concordância. [C1-5] */}
        {closed && (
          <p className="muted" style={{ maxWidth: "70ch" }}>
            {report.reporterAckAt ? (
              <>
                <strong>Ciência do denunciante</strong> em {formatInstant(report.reporterAckAt)}
                {report.reporterAckComment ? (
                  <>
                    , comentário: <span style={{ whiteSpace: "pre-wrap" }}>{report.reporterAckComment}</span>
                  </>
                ) : (
                  ", sem comentário."
                )}
              </>
            ) : (
              <>
                <strong>Sem ciência</strong> do denunciante até agora.
              </>
            )}
          </p>
        )}
      </section>

      {/*
        O caso que veio marcado como "alguém do comitê está envolvido" não
        chegou ao comitê: está aqui, e volta quando quem tria confere quem
        ele envolve. A tela precisa dizer isso, senão o estado é invisível.
        [B3-3-H]
      */}
      {report.committeeInvolved && !report.triagedAt && (
        <section className="form-section" role="status">
          <h2>Esperando a triagem</h2>
          <p className="muted" style={{ maxWidth: "70ch" }}>
            Quem relatou disse que alguém do comitê de ética está envolvido.
            Enquanto esta denúncia não for devolvida, ela não aparece para o
            comitê — nem na lista, nem pelo endereço, nem na contagem do
            Início. Marque quem ela envolve abaixo e devolva o caso.
          </p>
          {podeTriar ? (
            <div className="form-actions">
              <Button type="button" disabled={busy} onClick={devolverAoComite}>
                {busy ? "Devolvendo…" : "Devolver ao comitê"}
              </Button>
            </div>
          ) : (
            <p className="muted">
              A devolução é de quem é dono da conta, ou do master.
            </p>
          )}
        </section>
      )}

      {report.committeeInvolved && report.triagedAt && (
        <p className="muted" style={{ maxWidth: "70ch" }}>
          Esta denúncia passou pela triagem e foi devolvida ao comitê em{" "}
          {formatDay(report.triagedAt)}.
        </p>
      )}

      {/* Prazo da primeira providência: conta do recebimento, em dias
          úteis; um ajuste de gravidade refaz a conta com o nível novo. [C1-2] */}
      <section className="form-section">
        <h2>Prazo da primeira providência</h2>
        <p style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center", margin: 0 }}>
          <Chip tone={deadlineTone(report.deadline_situation)}>
            {DEADLINE_SITUATION_LABEL[report.deadline_situation] ?? report.deadline_situation}
          </Chip>
          <span className="muted">
            Vence {formatInstant(report.dueAt)} ({report.severity === "HIGH" ? "1 dia útil" : "3 dias úteis"} a partir do recebimento)
          </span>
        </p>
        <p className="muted" style={{ maxWidth: "70ch" }}>
          {report.firstActionAt
            ? `Primeira providência em ${formatInstant(report.firstActionAt)}.`
            : report.deadline_situation === "NOT_ASSESSED"
              ? "Denúncia anterior ao controle de prazo: não há registro de quando saiu de “Recebido”."
              : "Ainda sem providência: responder ou mudar a situação conta como primeira providência."}
        </p>
      </section>

      {/* A gravidade sai da categoria; o comitê ajusta com justificativa,
          e o ajuste fica à vista com autor e data. [C1-1] */}
      <section className="form-section">
        <h2>Gravidade</h2>
        <p className="muted" style={{ maxWidth: "70ch", marginTop: 0 }}>
          {report.severitySource === "COMMITTEE"
            ? `${REPORT_SEVERITY_LABEL[report.severity]}, ajustada pelo comitê.`
            : `${REPORT_SEVERITY_LABEL[report.severity]}, pela categoria. Assédio sexual e discriminação entram como Alta; as outras, como Normal.`}
        </p>
        {report.severityChanges.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: "0.75rem 0", display: "grid", gap: "0.5rem" }}>
            {report.severityChanges.map((c) => (
              <li key={c.id}>
                <strong>
                  {REPORT_SEVERITY_LABEL[c.fromSeverity]} → {REPORT_SEVERITY_LABEL[c.toSeverity]}
                </strong>{" "}
                <span className="muted">
                  em {formatInstant(c.at)}
                  {c.by ? ` · por ${c.by.name}` : ""}
                </span>
                <div style={{ whiteSpace: "pre-wrap", maxWidth: "70ch" }}>{c.reason}</div>
              </li>
            ))}
          </ul>
        )}
        {canWrite &&
          (!ajustando ? (
            <div className="form-actions">
              <Button type="button" variant="secondary" onClick={() => setAjustando(true)}>
                {report.severity === "HIGH" ? "Ajustar para Normal" : "Ajustar para Alta"}
              </Button>
            </div>
          ) : (
            <form className="form-grid" onSubmit={onAdjustSeverity}>
              <label className="form-field">
                Por que ajustar para {report.severity === "HIGH" ? "Normal" : "Alta"}
                <textarea
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  required
                  placeholder="A justificativa fica registrada com o seu nome e a data."
                />
              </label>
              <div className="form-actions">
                <Button type="submit" disabled={busy || !motivo.trim()}>
                  {busy ? "Salvando…" : "Ajustar gravidade"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setAjustando(false);
                    setMotivo("");
                    setSeverityError(null);
                  }}
                >
                  Cancelar
                </Button>
              </div>
            </form>
          ))}
        {severityError && (
          <p className="form-error" role="alert">
            {severityError}
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

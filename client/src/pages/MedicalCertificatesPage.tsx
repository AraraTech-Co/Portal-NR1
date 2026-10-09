import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  fetchMedicalCertificates,
  markMedicalCertificateRead,
  reviewMedicalCertificate,
  sendMedicalCertificate,
  type MedicalCertificateRow,
} from "@/api/modules";
import { fileToBase64 } from "@/api/payslips";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { CERTIFICATE_STATUS_LABEL, formatDay } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import { openProtectedFile } from "@/lib/protected-file";
import "@/components/data-table.css";
import "@/components/form.css";
import "./atestados.css";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

function todayIso(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
}

/** Último dia do afastamento, contando o primeiro. */
function lastDay(startDate: string, days: number): string {
  const d = new Date(startDate);
  d.setUTCDate(d.getUTCDate() + Math.max(days, 1) - 1);
  return formatDay(d.toISOString());
}

function statusTone(status: MedicalCertificateRow["status"]): "warning" | "success" | "danger" {
  if (status === "APPROVED") return "success";
  if (status === "REJECTED") return "danger";
  return "warning";
}

/** Enviar o próprio atestado — foto do celular ou PDF. [S4-B] */
function SendForm({ onSent }: { onSent: () => Promise<void> }) {
  const [startDate, setStartDate] = useState(todayIso());
  const [days, setDays] = useState("1");
  const [reason, setReason] = useState("");
  const [cid, setCid] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setOk(null);
    const n = Number(days);
    if (!Number.isInteger(n) || n < 1) {
      setError("Informe quantos dias de afastamento (1 ou mais).");
      return;
    }
    if (!file) {
      setError("Anexe a foto ou o PDF do atestado.");
      return;
    }
    setSending(true);
    try {
      await sendMedicalCertificate({
        start_date: startDate,
        days: n,
        reason: reason.trim() || undefined,
        cid: cid.trim() || undefined,
        file_name: file.name,
        mime_type: file.type,
        content_base64: await fileToBase64(file),
      });
      setOk("Atestado enviado. O RH vai analisar e você vê a resposta aqui.");
      setReason("");
      setCid("");
      setDays("1");
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
      await onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="form-section">
      <h2>Enviar atestado</h2>
      <form className="form-grid" onSubmit={onSubmit}>
        <div className="form-grid cols-2">
          <label className="form-field">
            Primeiro dia de afastamento
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </label>
          <label className="form-field">
            Quantos dias
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              required
            />
          </label>
        </div>
        <label className="form-field">
          Foto ou PDF do atestado
          <input
            ref={fileInput}
            type="file"
            accept={ACCEPT}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
          <span className="form-hint">No celular, dá para tirar a foto na hora. Até 20 MB.</span>
        </label>
        <div className="form-grid cols-2">
          <label className="form-field">
            Motivo (opcional)
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </label>
          <label className="form-field">
            CID (opcional)
            <input value={cid} onChange={(e) => setCid(e.target.value)} maxLength={10} />
            <span className="form-hint">Só se quiser informar. É dado de saúde e fica só com o RH.</span>
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {ok && (
          <p className="muted" role="status">
            {ok}
          </p>
        )}
        <div className="form-actions">
          <Button type="submit" disabled={sending}>
            {sending ? "Enviando…" : "Enviar atestado"}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function MedicalCertificatesPage() {
  const { user } = useAuth();
  const { canWrite, canManage } = useModuleAccess("atestados");
  const [rows, setRows] = useState<MedicalCertificateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<{ id: string; reason: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setRows(await fetchMedicalCertificates());
  }, []);

  useEffect(() => {
    reload()
      .catch((err) => setError(err instanceof Error ? err.message : "Falha ao carregar"))
      .finally(() => setLoading(false));
  }, [reload]);

  /** RH decide olhando o arquivo. [S5-B] */
  async function decide(id: string, status: "APPROVED" | "REJECTED", reason?: string) {
    setBusyId(id);
    setActionError(null);
    try {
      await reviewMedicalCertificate(id, {
        status,
        ...(status === "REJECTED" ? { rejection_reason: reason } : {}),
      });
      setRejecting(null);
      await reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Falha ao registrar a decisão");
    } finally {
      setBusyId(null);
    }
  }

  async function acknowledge(id: string) {
    setBusyId(id);
    try {
      await markMedicalCertificateRead(id);
      await reload();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Atestados"
        description={
          canManage
            ? "Atestados enviados pela equipe. Abra o arquivo e aceite ou recuse."
            : "Envie seu atestado e acompanhe a resposta do RH."
        }
      />

      {canWrite && <SendForm onSent={reload} />}

      {loading && <LoadingState />}
      {!loading && error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && rows.length === 0 && (
        <EmptyState
          title="Nenhum atestado"
          description={canManage ? "Atestados enviados pela equipe aparecem aqui." : "Os atestados que você enviar aparecem aqui."}
        />
      )}
      {actionError && (
        <p className="form-error" role="alert">
          {actionError}
        </p>
      )}
      {!loading && !error && rows.length > 0 && (
        <section className="form-section">
          <h2>{canManage ? "Atestados recebidos" : "Meus atestados"}</h2>
          <div className="data-table-wrap atestados-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {canManage && <th>Pessoa</th>}
                  <th>Afastamento</th>
                  <th>Motivo</th>
                  <th>Situação</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const mine = r.user.id === user?.id;
                  const pending = r.status === "PENDING";
                  const unreadRejection = mine && r.status === "REJECTED" && !r.readByWorkerAt;
                  return (
                    <tr key={r.id}>
                      {canManage && (
                        <td>
                          <strong>{r.user.name}</strong>
                        </td>
                      )}
                      <td>
                        {formatDay(r.startDate)} a {lastDay(r.startDate, r.days)}
                        <div className="muted">
                          {r.days === 1 ? "1 dia" : `${r.days} dias`} · enviado em {formatDay(r.createdAt)}
                        </div>
                      </td>
                      <td>
                        {r.reason ?? <span className="muted">—</span>}
                        {r.cid && <div className="muted">CID {r.cid}</div>}
                      </td>
                      <td>
                        <Chip tone={statusTone(r.status)}>{CERTIFICATE_STATUS_LABEL[r.status] ?? r.status}</Chip>
                        {r.status === "REJECTED" && r.rejectionReason && (
                          <div className="atestado-motivo">Motivo: {r.rejectionReason}</div>
                        )}
                        {r.reviewedBy && r.reviewedAt && (
                          <div className="muted">
                            por {r.reviewedBy.name} em {formatDay(r.reviewedAt)}
                          </div>
                        )}
                      </td>
                      <td>
                        <div className="form-actions atestado-actions">
                          {r.has_file && (
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={() => void openProtectedFile(`/api/medical-certificates/${r.id}/file`)}
                            >
                              Abrir arquivo
                            </Button>
                          )}
                          {canManage && pending && !mine && (
                            <>
                              <Button
                                type="button"
                                disabled={busyId === r.id}
                                onClick={() => void decide(r.id, "APPROVED")}
                              >
                                Aceitar
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                disabled={busyId === r.id}
                                onClick={() => setRejecting({ id: r.id, reason: "" })}
                              >
                                Recusar
                              </Button>
                            </>
                          )}
                          {canManage && pending && mine && (
                            <span className="muted">Outra pessoa do RH decide o seu.</span>
                          )}
                          {unreadRejection && (
                            <Button
                              type="button"
                              variant="secondary"
                              disabled={busyId === r.id}
                              onClick={() => void acknowledge(r.id)}
                            >
                              Entendi
                            </Button>
                          )}
                        </div>
                        {rejecting?.id === r.id && (
                          <div className="atestado-recusa">
                            <label className="form-field">
                              O que falta ou está errado
                              <input
                                autoFocus
                                value={rejecting.reason}
                                onChange={(e) => setRejecting({ id: r.id, reason: e.target.value })}
                                placeholder="Ex.: atestado sem assinatura do médico"
                              />
                            </label>
                            <div className="form-actions">
                              <Button
                                type="button"
                                variant="secondary"
                                disabled={busyId === r.id || !rejecting.reason.trim()}
                                onClick={() => void decide(r.id, "REJECTED", rejecting.reason.trim())}
                              >
                                Confirmar recusa
                              </Button>
                              <Button type="button" variant="ghost" onClick={() => setRejecting(null)}>
                                Cancelar
                              </Button>
                            </div>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

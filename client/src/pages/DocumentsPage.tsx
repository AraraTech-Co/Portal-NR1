import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchPgrDocuments,
  issuePgrDocument,
  PGR_TYPE_HINT,
  PGR_TYPE_LABEL,
  type PgrDocument,
} from "@/api/documents";
import { fetchEstablishments, type Establishment } from "@/api/operation";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { PeoplePicker } from "@/components/PeoplePicker";
import "@/components/data-table.css";
import "@/components/form.css";
const DEFAULT_STATEMENT =
  "Declaro, como responsável, que este documento reflete o gerenciamento de riscos ocupacionais da organização nesta data.";

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

export function DocumentsPage() {
  const [documents, setDocuments] = useState<PgrDocument[]>([]);
  const [requiredTypes, setRequiredTypes] = useState<string[]>([]);
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [type, setType] = useState("INVENTORY");
  const [establishmentId, setEstablishmentId] = useState("");
  const [responsibleUserId, setResponsibleUserId] = useState("");
  const [responsibleName, setResponsibleName] = useState("");
  const [responsibleRole, setResponsibleRole] = useState("");
  const [responsibleRegistration, setResponsibleRegistration] = useState("");
  const [statement, setStatement] = useState(DEFAULT_STATEMENT);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [docs, est] = await Promise.all([
      fetchPgrDocuments(),
      fetchEstablishments(),
    ]);
    setDocuments(docs.documents);
    setRequiredTypes(docs.required_types);
    setEstablishments(est.establishments);
    if (docs.required_types[0]) setType(docs.required_types[0]);
  }, []);

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

  const latestByType = useMemo(() => {
    const map = new Map<string, PgrDocument>();
    for (const doc of documents) {
      const current = map.get(doc.type);
      if (!current || doc.version > current.version) map.set(doc.type, doc);
    }
    return map;
  }, [documents]);

  const missing = requiredTypes.filter((t) => !latestByType.has(t));

  async function onIssue(e: FormEvent) {
    e.preventDefault();
    if (!responsibleUserId || !responsibleName.trim()) {
      setFormError("Selecione o responsável.");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      await issuePgrDocument({
        type,
        establishmentId: establishmentId || undefined,
        responsibleName: responsibleName.trim(),
        responsibleRole: responsibleRole.trim() || undefined,
        responsibleRegistration: responsibleRegistration.trim() || undefined,
        signatureStatement: statement.trim() || DEFAULT_STATEMENT,
      });
      setResponsibleUserId("");
      setResponsibleName("");
      setResponsibleRole("");
      setResponsibleRegistration("");
      setStatement(DEFAULT_STATEMENT);
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao emitir");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Documentos do PGR"
        description="Emissão append-only dos três documentos exigidos: inventário, plano de ação e critérios do GRO."
      />

      {missing.length > 0 && (
        <p
          className="filter-meta"
          style={{ color: "var(--sem-warning-fg)", fontWeight: 600 }}
        >
          {missing.length === 1
            ? "Falta emitir 1 documento obrigatório."
            : `Faltam emitir ${missing.length} documentos obrigatórios.`}
        </p>
      )}

      <section className="form-section">
        <h2>Documentos obrigatórios</h2>
        <p className="muted">
          O MTE lista três: inventário de riscos, plano de ação e critérios do
          GRO. Cada emissão gera uma nova versão assinada.
        </p>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Situação</th>
                <th>Última versão</th>
                <th>Emitido em</th>
              </tr>
            </thead>
            <tbody>
              {(requiredTypes.length
                ? requiredTypes
                : Object.keys(PGR_TYPE_LABEL)
              ).map((t) => {
                const latest = latestByType.get(t);
                return (
                  <tr key={t}>
                    <td>
                      <strong>{PGR_TYPE_LABEL[t] ?? t}</strong>
                      <div className="muted" style={{ marginTop: "0.2rem" }}>
                        {PGR_TYPE_HINT[t]}
                      </div>
                    </td>
                    <td>
                      {latest ? (
                        <Chip tone="success">Emitido</Chip>
                      ) : (
                        <Chip tone="warning">Pendente</Chip>
                      )}
                    </td>
                    <td className="muted">
                      {latest ? `v${latest.version}` : "—"}
                    </td>
                    <td className="muted">
                      {latest ? formatDateTime(latest.issuedAt) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="form-section">
        <h2>Emitir nova versão</h2>
        <p className="muted">
          A emissão congela o snapshot atual (inventário vivo, ações ou
          critérios) com responsável e declaração de assinatura.
        </p>
        <form className="form-grid" onSubmit={onIssue}>
          <div className="form-grid cols-2">
            <label className="form-field">
              Tipo
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                disabled={saving}
              >
                {(requiredTypes.length
                  ? requiredTypes
                  : Object.keys(PGR_TYPE_LABEL)
                ).map((t) => (
                  <option key={t} value={t}>
                    {PGR_TYPE_LABEL[t] ?? t}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Estabelecimento (opcional)
              <select
                value={establishmentId}
                onChange={(e) => setEstablishmentId(e.target.value)}
                disabled={saving}
              >
                <option value="">Toda a organização</option>
                {establishments.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="form-grid cols-2">
            <label className="form-field">
              Responsável
              <PeoplePicker
                value={responsibleUserId}
                required
                disabled={saving}
                onChange={(userId, member) => {
                  setResponsibleUserId(userId);
                  setResponsibleName(member?.name ?? "");
                  if (member?.jobRoleName) {
                    setResponsibleRole(member.jobRoleName);
                  }
                  if (member?.registration) {
                    setResponsibleRegistration(member.registration);
                  }
                }}
              />
            </label>
            <label className="form-field">
              Cargo / função
              <input
                value={responsibleRole}
                onChange={(e) => setResponsibleRole(e.target.value)}
                disabled={saving}
              />
            </label>
          </div>
          <label className="form-field">
            Registro profissional (opcional)
            <input
              value={responsibleRegistration}
              onChange={(e) => setResponsibleRegistration(e.target.value)}
              disabled={saving}
            />
          </label>
          <label className="form-field">
            Declaração de assinatura
            <textarea
              value={statement}
              onChange={(e) => setStatement(e.target.value)}
              disabled={saving}
              required
            />
          </label>
          {formError && <p className="form-error">{formError}</p>}
          <div className="form-actions">
            <Button type="submit" disabled={saving}>
              {saving ? "Emitindo…" : "Emitir documento"}
            </Button>
          </div>
        </form>
      </section>

      {loading && <LoadingState label="Carregando documentos…" />}
      {!loading && error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && documents.length === 0 && (
        <EmptyState
          title="Nenhuma emissão ainda"
          description="Use o formulário acima para gerar a primeira versão assinada."
        />
      )}

      {!loading && !error && documents.length > 0 && (
        <section className="form-section">
          <h2>Histórico de emissões</h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Versão</th>
                  <th>Responsável</th>
                  <th>Emitido em</th>
                </tr>
              </thead>
              <tbody>
                {documents.map((d) => (
                  <tr key={d.id}>
                    <td>{PGR_TYPE_LABEL[d.type] ?? d.type}</td>
                    <td>v{d.version}</td>
                    <td>
                      {d.responsibleName}
                      {d.responsibleRole ? (
                        <span className="muted"> · {d.responsibleRole}</span>
                      ) : null}
                    </td>
                    <td className="muted">{formatDateTime(d.issuedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

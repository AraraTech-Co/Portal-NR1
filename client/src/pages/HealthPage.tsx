import { useEffect, useState } from "react";
import {
  fetchJobRoleRequirements,
  fetchOccupationalExams,
  fetchWorkerCertificates,
} from "@/api/modules";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { formatDay } from "@/lib/labels";
import "@/components/data-table.css";
import { LoadingState } from "@/components/LoadingState";

export function HealthPage() {
  const [requirements, setRequirements] = useState<
    Awaited<ReturnType<typeof fetchJobRoleRequirements>>
  >([]);
  const [certificates, setCertificates] = useState<
    Awaited<ReturnType<typeof fetchWorkerCertificates>>
  >([]);
  const [exams, setExams] = useState<
    Awaited<ReturnType<typeof fetchOccupationalExams>>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchJobRoleRequirements(),
      fetchWorkerCertificates(),
      fetchOccupationalExams(),
    ])
      .then(([req, certs, ex]) => {
        if (cancelled) return;
        setRequirements(req);
        setCertificates(certs);
        setExams(ex);
      })
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
  }, []);

  const empty =
    requirements.length === 0 &&
    certificates.length === 0 &&
    exams.length === 0;

  return (
    <div>
      <PageHeader
        title="Saúde e exigências"
        description="Exigências por função, certificados e exames ocupacionais."
      />
      {loading && <LoadingState />}
      {!loading && error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && empty && (
        <EmptyState
          title="Nada cadastrado"
          description="Exigências, certificados e exames ocupacionais aparecem aqui."
        />
      )}

      {!loading && !error && requirements.length > 0 && (
        <section className="form-section">
          <h2>Exigências por função</h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Função</th>
                  <th>Tipo</th>
                  <th>Nome</th>
                </tr>
              </thead>
              <tbody>
                {requirements.map((r) => (
                  <tr key={r.id}>
                    <td>{r.jobRole.name}</td>
                    <td>
                      <Chip>{r.kind}</Chip>
                    </td>
                    <td>
                      <strong>{r.name}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && !error && certificates.length > 0 && (
        <section className="form-section">
          <h2>Certificados</h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Status</th>
                  <th>Validade</th>
                </tr>
              </thead>
              <tbody>
                {certificates.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                    </td>
                    <td>
                      <Chip>{c.status}</Chip>
                    </td>
                    <td className="muted">{formatDay(c.expiresAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {!loading && !error && exams.length > 0 && (
        <section className="form-section">
          <h2>Exames ocupacionais</h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Tipo</th>
                  <th>Realizado</th>
                  <th>Vencimento</th>
                  <th>Apto</th>
                </tr>
              </thead>
              <tbody>
                {exams.map((e) => (
                  <tr key={e.id}>
                    <td>{e.kind}</td>
                    <td className="muted">{formatDay(e.performedAt)}</td>
                    <td className="muted">{formatDay(e.dueAt)}</td>
                    <td>
                      {e.fit == null ? (
                        "—"
                      ) : e.fit ? (
                        <Chip tone="success">Sim</Chip>
                      ) : (
                        <Chip tone="danger">Não</Chip>
                      )}
                    </td>
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

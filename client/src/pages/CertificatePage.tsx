import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchTrainingCertificate,
  type TrainingCertificate,
} from "@/api/certificates";
import { Button } from "@/components/Button";
import { LoadingState } from "@/components/LoadingState";
import { formatDay } from "@/lib/labels";
import "./certificado.css";

function cargaHoraria(minutos: number): string {
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return h === 1 ? "1 hora" : `${h} horas`;
  return `${h} h ${m} min`;
}

/**
 * O certificado do treinamento, para abrir, imprimir e entregar.
 *
 * Antes era só um código na lista: a pessoa não tinha o que guardar e a
 * empresa emitia o certificado fora do portal para mostrar à
 * fiscalização. [B2-3-C]
 */
export function CertificatePage() {
  const { enrollmentId = "" } = useParams();
  const [cert, setCert] = useState<TrainingCertificate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelado = false;
    fetchTrainingCertificate(enrollmentId)
      .then((c) => {
        if (!cancelado) setCert(c);
      })
      .catch((err) => {
        if (!cancelado) {
          setError(err instanceof Error ? err.message : "Falha ao carregar");
        }
      });
    return () => {
      cancelado = true;
    };
  }, [enrollmentId]);

  if (error) {
    return (
      <div>
        <p className="page-error" role="alert">
          {error}
        </p>
        <Link to="/treinamentos">← Treinamentos</Link>
      </div>
    );
  }

  if (!cert) return <LoadingState />;

  const presencial = cert.training.kind === "CLASSROOM";

  return (
    <div>
      <div className="cert-actions">
        <Link to="/treinamentos">← Treinamentos</Link>
        <Button type="button" onClick={() => window.print()}>
          Imprimir
        </Button>
      </div>

      <article className="cert-sheet">
        <p className="cert-org">
          {cert.organization?.name ?? "Certificado"}
          {cert.organization?.taxId ? ` · CNPJ ${cert.organization.taxId}` : ""}
        </p>
        <h1 className="cert-title">Certificado de treinamento</h1>

        <p className="cert-body">
          Certificamos que{" "}
          <span className="cert-name">{cert.person.name}</span>
          {cert.person.registration ? `, matrícula ${cert.person.registration}` : ""}
          {cert.person.job_role ? `, ${cert.person.job_role}` : ""}, concluiu o
          treinamento <strong>{cert.training.title}</strong>
          {cert.session
            ? `, realizado em ${formatDay(cert.session.held_at)}${
                cert.session.location ? ` em ${cert.session.location}` : ""
              }`
            : cert.completed_at
              ? `, concluído em ${formatDay(cert.completed_at)}`
              : ""}
          , com carga horária de {cargaHoraria(cert.training.duration_minutes)}.
        </p>

        {cert.training.summary && (
          <p className="cert-body">
            <strong>Conteúdo:</strong> {cert.training.summary}
          </p>
        )}

        {/* Certificado abaixo da nota de hoje vale até vencer, mas diz
            isso no papel: esconder seria entregar uma prova que não é. [CB-31] */}
        {cert.below_minimum && (
          <p className="cert-warning">
            Emitido antes da nota mínima atual ({cert.passing_score}%). Vale até
            o vencimento; para renovar, refaça o treinamento.
          </p>
        )}

        <dl className="cert-facts">
          {presencial && cert.session && (
            <>
              <div>
                <dt>Instrutor</dt>
                <dd>{cert.session.instructor_name}</dd>
              </div>
              {cert.session.instructor_registration && (
                <div>
                  <dt>Registro do instrutor</dt>
                  <dd>{cert.session.instructor_registration}</dd>
                </div>
              )}
            </>
          )}
          {cert.score !== null && (
            <div>
              <dt>Aproveitamento</dt>
              <dd>{cert.score}%</dd>
            </div>
          )}
          <div>
            <dt>Concluído em</dt>
            <dd>{cert.completed_at ? formatDay(cert.completed_at) : "—"}</dd>
          </div>
          <div>
            <dt>Válido até</dt>
            <dd>
              {cert.expires_at
                ? formatDay(cert.expires_at)
                : "Sem reciclagem obrigatória"}
            </dd>
          </div>
        </dl>

        <p className="cert-code">Certificado nº {cert.code}</p>
      </article>
    </div>
  );
}

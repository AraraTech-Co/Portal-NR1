import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchTrainingCertificate,
  type TrainingCertificate,
} from "@/api/certificates";
import { Button } from "@/components/Button";
import { LoadingState } from "@/components/LoadingState";
import { formatarCnpj, itensDoCertificado } from "@/lib/certificado";
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

  const itens = itensDoCertificado(cert);
  const noCurso = itens.faltando.filter((item) => !itens.faltandoNaTurma.includes(item));
  const cnpj = formatarCnpj(cert.organization?.taxId ?? null);

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
          {cnpj ? ` · CNPJ ${cnpj}` : ""}
        </p>
        <h1 className="cert-title">Certificado de treinamento</h1>

        <p className="cert-body">
          Certificamos que{" "}
          <span className="cert-name">{cert.person.name}</span>
          {cert.person.registration ? `, matrícula ${cert.person.registration}` : ""}
          {cert.person.job_role ? `, ${cert.person.job_role}` : ""}, concluiu o
          treinamento <strong>{cert.training.title}</strong>
          {itens.data ? `, realizado em ${formatDay(itens.data)}` : ""}
          , com carga horária de {cargaHoraria(cert.training.duration_minutes)}.
        </p>

        {/* O 1.7.1.1 pede o conteúdo programático: sem ele, o papel diz que falta. [B3-3-G] */}
        <p className="cert-body">
          <strong>Conteúdo programático:</strong>{" "}
          {itens.conteudo ?? "não informado no cadastro do treinamento."}
        </p>

        {/* Certificado abaixo da nota de hoje vale até vencer, mas diz
            isso no papel: esconder seria entregar uma prova que não é. [CB-31] */}
        {cert.below_minimum && (
          <p className="cert-warning">
            Emitido antes da nota mínima atual ({cert.passing_score}%). Vale até
            o vencimento; para renovar, refaça o treinamento.
          </p>
        )}

        <dl className="cert-facts">
          {/* Quem ministrou e onde, também no curso a distância. [B3-3-G] */}
          <div>
            <dt>Local</dt>
            <dd>{itens.local ?? "não informado"}</dd>
          </div>
          <div>
            <dt>Ministrado por</dt>
            <dd>
              {itens.ministrou.nome ?? "não informado"}
              {itens.ministrou.qualificacao && (
                <span className="cert-sub">{itens.ministrou.qualificacao}</span>
              )}
            </dd>
          </div>
          {itens.ministrou.registro && (
            <div>
              <dt>Registro do instrutor</dt>
              <dd>{itens.ministrou.registro}</dd>
            </div>
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

        {/*
          As duas assinaturas que o 1.7.1.1 pede: no papel, à mão; a cópia
          assinada pode ser guardada no portal (B3-4-F). [B3-3-G]
        */}
        <div className="cert-signatures">
          <div className="cert-signature">
            <span className="cert-signature-line" />
            <span>{cert.person.name}</span>
            <span className="cert-sub">Assinatura do trabalhador</span>
          </div>
          <div className="cert-signature">
            <span className="cert-signature-line" />
            <span>{itens.responsavel.nome ?? " "}</span>
            <span className="cert-sub">
              Assinatura do responsável técnico
              {itens.responsavel.qualificacao
                ? ` · ${itens.responsavel.qualificacao}`
                : ""}
            </span>
          </div>
        </div>

        <p className="cert-code">Certificado nº {cert.code}</p>
      </article>

      {/* Na tela, não no papel: o que o cadastro ainda deve ao certificado.
          Cada item no lugar onde se completa: o do curso na linha do curso,
          o da turma presencial na turma. [B4-B] */}
      {noCurso.length > 0 && (
        <p className="cert-pendente" role="note">
          Falta no cadastro do treinamento: {noCurso.join(", ")}. Quem cuida
          dos treinamentos completa em Treinamentos, na linha do curso, em
          "Completar para o certificado".
        </p>
      )}
      {itens.faltandoNaTurma.length > 0 && cert.session && (
        <p className="cert-pendente" role="note">
          Falta na turma de {formatDay(cert.session.held_at)}:{" "}
          {itens.faltandoNaTurma.join(", ")}. Quem cuida dos treinamentos
          completa em Treinamentos, no curso, em "Turmas presenciais", na
          própria turma.
        </p>
      )}
    </div>
  );
}

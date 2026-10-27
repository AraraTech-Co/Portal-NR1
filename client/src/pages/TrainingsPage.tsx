import { Fragment, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useResourceList } from "@/hooks/useResourceList";
import {
  fetchTrainingEnrollments,
  fetchTrainings,
  type TrainingEnrollmentRow,
} from "@/api/modules";
import { useAuth } from "@/auth/AuthContext";
import { Chip } from "@/components/Chip";
import { ListShell } from "@/components/ListShell";
import {
  TRAINING_KIND_LABEL,
  type DadosDoCertificadoDoTreinamento,
} from "@/api/trainings";
import { NewTrainingForm } from "./NewTrainingForm";
import { TrainingCertificateData } from "./TrainingCertificateData";
import { TrainingSessions } from "./TrainingSessions";
import { ENROLLMENT_STATUS_LABEL, formatDay } from "@/lib/labels";
import { isReadOnlyPermission, useModuleAccess } from "@/lib/module-access";
import "@/components/form.css";
import "./trainings.css";

function statusTone(status: string): "success" | "info" | "neutral" | "warning" {
  if (status === "COMPLETED") return "success";
  if (status === "IN_PROGRESS") return "info";
  if (status === "FAILED") return "warning";
  return "neutral";
}

/** Quem fez o treinamento, quando, com que nota e qual certificado. [S5-J] [S7-G] */
function Enrollments({ trainingId, reloadKey }: { trainingId: string; reloadKey: number }) {
  const [rows, setRows] = useState<TrainingEnrollmentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchTrainingEnrollments(trainingId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar");
      });
    return () => {
      cancelled = true;
    };
  }, [trainingId, reloadKey]);

  if (error) return <p className="form-error" role="alert">{error}</p>;
  if (!rows) return <p className="muted">Carregando…</p>;
  if (rows.length === 0) return <p className="muted">Ninguém se inscreveu ainda.</p>;

  return (
    <table className="training-people">
      <thead>
        <tr>
          <th>Pessoa</th>
          <th>Situação</th>
          <th>Concluído em</th>
          <th>Nota</th>
          <th>Certificado</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((e) => (
          <tr key={e.id}>
            <td>{e.user.name}</td>
            <td>
              <Chip tone={statusTone(e.status)}>{ENROLLMENT_STATUS_LABEL[e.status] ?? e.status}</Chip>
            </td>
            <td>{e.completedAt ? formatDay(e.completedAt) : "—"}</td>
            <td>{e.score != null ? e.score : "—"}</td>
            <td>
              {/* Era só o código na lista: o RH também não tinha o que
                  entregar nem o que mostrar à fiscalização. [B2-3-C] */}
              {/*
                  O número era o link, mas parecia só um código: o testador
                  entendeu que não havia como baixar o certificado. Agora diz
                  o que faz. [S7-G]
              */}
              {e.certificateCode ? (
                <Link to={`/certificados/${e.id}`} className="training-certificado">
                  Abrir certificado
                  <span className="muted training-sub">{e.certificateCode}</span>
                </Link>
              ) : (
                "—"
              )}
              {e.expiresAt && <span className="muted training-sub">vale até {formatDay(e.expiresAt)}</span>}
              {/* Abaixo da nota de hoje: vale até vencer, mas marcado. [CB-31] */}
              {e.below_minimum && (
                <span className="muted training-sub">
                  abaixo da nota mínima de hoje
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TrainingsPage() {
  const { rows, loading, error } = useResourceList(fetchTrainings);
  const { user } = useAuth();
  const { canWrite } = useModuleAccess("treinamentos");
  // Quem cuida dos treinamentos e a fiscalização veem quem fez.
  const seesPeople = canWrite || isReadOnlyPermission(user?.permission);
  const [openId, setOpenId] = useState<string | null>(null);
  // Registrar turma conclui gente: a lista de quem fez precisa recarregar.
  const [reloadKey, setReloadKey] = useState(0);
  /* O que foi salvo agora, por treinamento: a lista não se recarrega. [B3-3-G] */
  const [dadosSalvos, setDadosSalvos] = useState<
    Record<string, DadosDoCertificadoDoTreinamento>
  >({});
  function dadosDo(r: {
    id: string;
    instructorName: string | null;
    instructorQualification: string | null;
    technicalResponsibleName: string | null;
    technicalResponsibleQualification: string | null;
  }): DadosDoCertificadoDoTreinamento {
    return (
      dadosSalvos[r.id] ?? {
        instructor_name: r.instructorName,
        instructor_qualification: r.instructorQualification,
        technical_responsible_name: r.technicalResponsibleName,
        technical_responsible_qualification: r.technicalResponsibleQualification,
      }
    );
  }

  return (
    <ListShell
      title="Treinamentos"
      description={
        seesPeople
          ? "Toque num treinamento para ver quem fez, a nota, o certificado e as turmas presenciais. \"Fazer\" abre o conteúdo e a prova."
          : "Toque em \"Fazer\" para ler o conteúdo, responder a prova e receber o certificado."
      }
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhum treinamento"
      emptyDescription="Treinamentos publicados pelo RH aparecem aqui."
    >
      {/* Não havia tela para cadastrar treinamento: título, tipo, conteúdo,
          prova e nota mínima só entravam pela API. [CB-30] */}
      {canWrite && (
        <NewTrainingForm onCreated={() => window.location.reload()} />
      )}

      <div className="data-table-wrap trainings-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Título</th>
              <th>Tipo</th>
              <th>Duração (min)</th>
              <th>Inscrições</th>
              <th aria-label="Fazer" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const open = seesPeople && openId === r.id;
              const toggle = () => setOpenId(open ? null : r.id);
              return (
                <Fragment key={r.id}>
                  <tr
                    className={seesPeople ? `is-clickable${open ? " is-open" : ""}` : undefined}
                    onClick={seesPeople ? toggle : undefined}
                    onKeyDown={
                      seesPeople
                        ? (e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggle();
                            }
                          }
                        : undefined
                    }
                    tabIndex={seesPeople ? 0 : undefined}
                    role={seesPeople ? "button" : undefined}
                    aria-expanded={seesPeople ? open : undefined}
                  >
                    <td>
                      <strong>{r.title}</strong>
                      <div className="muted training-sub">{r.category}</div>
                    </td>
                    <td>{TRAINING_KIND_LABEL[r.kind] ?? r.kind}</td>
                    <td>{r.durationMinutes}</td>
                    <td>{r._count?.enrollments ?? 0}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {/*
                        "Fazer" convida quem só consulta a começar um curso
                        que o servidor recusa. Para ela, o treinamento se
                        abre para ver, não para fazer. [B2-4-F]
                      */}
                      <Link to={`/treinamentos/${r.id}`}>
                        {isReadOnlyPermission(user?.permission) ||
                        r.kind === "CLASSROOM"
                          ? "Abrir"
                          : "Fazer"}
                      </Link>
                    </td>
                  </tr>
                  {open && (
                    <tr className="training-expand">
                      <td colSpan={5}>
                        <div className="training-panel">
                          <TrainingCertificateData
                            trainingId={r.id}
                            dados={dadosDo(r)}
                            canEdit={canWrite}
                            onSaved={(d) =>
                              setDadosSalvos((atual) => ({ ...atual, [r.id]: d }))
                            }
                          />
                          <Enrollments trainingId={r.id} reloadKey={reloadKey} />
                          <TrainingSessions
                            trainingId={r.id}
                            kind={r.kind}
                            defaultMinutes={r.durationMinutes}
                            defaultInstructor={dadosDo(r).instructor_name ?? ""}
                            defaultQualification={dadosDo(r).instructor_qualification ?? ""}
                            canRecord={canWrite}
                            onRecorded={() => setReloadKey((n) => n + 1)}
                          />
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}

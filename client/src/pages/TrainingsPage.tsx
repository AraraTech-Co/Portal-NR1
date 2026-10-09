import { Fragment, useEffect, useState } from "react";
import { useResourceList } from "@/hooks/useResourceList";
import {
  fetchTrainingEnrollments,
  fetchTrainings,
  type TrainingEnrollmentRow,
} from "@/api/modules";
import { useAuth } from "@/auth/AuthContext";
import { Chip } from "@/components/Chip";
import { ListShell } from "@/components/ListShell";
import { ENROLLMENT_STATUS_LABEL, formatDay } from "@/lib/labels";
import { isReadOnlyPermission, useModuleAccess } from "@/lib/module-access";
import "@/components/form.css";
import "./trainings.css";

function statusTone(status: string): "success" | "info" | "neutral" {
  if (status === "COMPLETED") return "success";
  if (status === "IN_PROGRESS") return "info";
  return "neutral";
}

/** Quem fez o treinamento, quando, com que nota e qual certificado. [S5-J] [S7-G] */
function Enrollments({ trainingId }: { trainingId: string }) {
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
  }, [trainingId]);

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
              {e.certificateCode ?? "—"}
              {e.expiresAt && <span className="muted training-sub">vale até {formatDay(e.expiresAt)}</span>}
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

  return (
    <ListShell
      title="Treinamentos"
      description={
        seesPeople
          ? "Catálogo de treinamentos. Toque num treinamento para ver quem fez, a nota e o certificado."
          : "Catálogo de treinamentos da organização."
      }
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhum treinamento"
      emptyDescription="Treinamentos publicados pelo RH aparecem aqui."
    >
      <div className="data-table-wrap trainings-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Título</th>
              <th>Categoria</th>
              <th>Duração (min)</th>
              <th>Inscrições</th>
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
                    </td>
                    <td>{r.category}</td>
                    <td>{r.durationMinutes}</td>
                    <td>{r._count?.enrollments ?? 0}</td>
                  </tr>
                  {open && (
                    <tr className="training-expand">
                      <td colSpan={4}>
                        <div className="training-panel">
                          <Enrollments trainingId={r.id} />
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

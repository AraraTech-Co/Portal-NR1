import { useState } from "react";
import { useResourceList } from "@/hooks/useResourceList";
import {
  confirmSummonAttendance,
  createSummon,
  fetchSummons,
} from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { NewRecordSection } from "@/components/NewRecordSection";
import { PeoplePicker } from "@/components/PeoplePicker";
import { formatDayTime, SUMMON_ATTENDANCE_LABEL } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import "./summons.css";

function tom(status: string): "success" | "warning" | "danger" | "neutral" {
  if (status === "CONFIRMED" || status === "ATTENDED") return "success";
  if (status === "INVITED") return "warning";
  if (status === "ABSENT") return "danger";
  return "neutral";
}

/**
 * Convocações: convocar e confirmar presença.
 *
 * A tela dizia "Quem é convocado recebe aviso e confirma presença no
 * portal", e confirmar não existia: a coluna "Minha presença" mostrava o
 * código do banco ("INVITED") e nada mais. A rota de confirmar já existia no
 * servidor. [CB-64] [OB-4]
 */
export function SummonsPage() {
  const { rows, loading, error, reload } = useResourceList(fetchSummons);
  const { canWrite } = useModuleAccess("convocacoes");
  const [confirmando, setConfirmando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function confirmar(id: string) {
    setConfirmando(id);
    setErro(null);
    try {
      await confirmSummonAttendance(id);
      reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao confirmar");
    } finally {
      setConfirmando(null);
    }
  }
  const [title, setTitle] = useState("");
  const [quando, setQuando] = useState("");
  const [local, setLocal] = useState("");
  const [description, setDescription] = useState("");
  const [convidados, setConvidados] = useState<string[]>([]);

  return (
    <ListShell
      title="Convocações"
      description="Convocações e confirmação de presença."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhuma convocação"
      emptyDescription="Convocações do RH aparecem nesta lista."
      before={
        <NewRecordSection
          canWrite={canWrite}
          openLabel="Nova convocação"
          title="Convocar para uma reunião"
          description="Quem é convocado recebe aviso e confirma presença no portal."
          submitLabel="Convocar"
          disabled={!title.trim() || !quando}
          onSubmit={async () => {
            await createSummon({
              title: title.trim(),
              scheduled_for: new Date(quando).toISOString(),
              location: local.trim() || undefined,
              description: description.trim() || undefined,
              invitee_ids: convidados,
            });
            setTitle("");
            setQuando("");
            setLocal("");
            setDescription("");
            setConvidados([]);
            await reload();
            return "Convocação criada.";
          }}
        >
          <label className="form-field">
            Assunto
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
          </label>
          <div className="form-grid cols-2">
            <label className="form-field">
              Quando
              <input
                type="datetime-local"
                value={quando}
                onChange={(e) => setQuando(e.target.value)}
                required
              />
            </label>
            <label className="form-field">
              Onde (opcional)
              <input value={local} onChange={(e) => setLocal(e.target.value)} />
            </label>
          </div>
          <label className="form-field">
            Pauta (opcional)
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="form-field">
            Convocar quem (opcional)
            <PeoplePicker
              mode="multiple"
              value={convidados}
              onChange={(userIds) => setConvidados(userIds)}
            />
            <span className="form-hint">
              Dá para convocar mais gente depois, na própria convocação.
            </span>
          </label>
        </NewRecordSection>
      }
    >
      <>
        {erro && (
          <p className="page-error" role="alert">
            {erro}
          </p>
        )}
        <div className="data-table-wrap">
          <table className="data-table summons-table">
            <thead>
              <tr>
                  <th>Assunto</th>
                  <th>Quando e onde</th>
                  <th className="summons-col-extra">Criado por</th>
                  <th className="summons-col-extra">Convocados</th>
                  <th>Minha presença</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                    <td>
                      <strong>{r.title}</strong>
                      {/* A pauta estava guardada e não aparecia. */}
                      {r.description && (
                        <div className="muted">{r.description}</div>
                      )}
                    </td>
                    <td>
                      {formatDayTime(r.scheduledFor)}
                      <div className="muted">{r.location ?? "Sem local"}</div>
                    </td>
                    <td className="summons-col-extra">{r.createdBy.name}</td>
                    <td className="summons-col-extra">
                      {r._count.attendances}
                    </td>
                    <td>
                      {r.my_attendance ? (
                        <Chip tone={tom(r.my_attendance.status)}>
                          {SUMMON_ATTENDANCE_LABEL[r.my_attendance.status] ??
                            r.my_attendance.status}
                        </Chip>
                      ) : (
                        /* Quem não foi convocado não tem presença a dar. */
                        <span className="muted">Não fui convocado</span>
                      )}
                      {/* O botão junto da situação: numa coluna à parte ele
                          ficava fora da tela do celular. */}
                      {r.my_attendance?.status === "INVITED" && (
                        <div className="summons-confirmar">
                          <Button
                            type="button"
                            disabled={confirmando === r.id}
                            onClick={() => void confirmar(r.id)}
                          >
                            {confirmando === r.id
                              ? "Confirmando…"
                              : "Confirmar presença"}
                          </Button>
                        </div>
                      )}
                    </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    </ListShell>
  );
}

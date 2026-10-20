import { useState } from "react";
import { useResourceList } from "@/hooks/useResourceList";
import { createSummon, fetchSummons } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { NewRecordSection } from "@/components/NewRecordSection";
import { PeoplePicker } from "@/components/PeoplePicker";
import { formatDay } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";

export function SummonsPage() {
  const { rows, loading, error, reload } = useResourceList(fetchSummons);
  const { canWrite } = useModuleAccess("convocacoes");
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
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Título</th>
                <th>Quando</th>
                <th>Criado por</th>
                <th>Convocados</th>
                <th>Minha presença</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td><strong>{r.title}</strong></td>
                  <td>{formatDay(r.scheduledFor)}</td>
                  <td>{r.createdBy.name}</td>
                  <td>{r._count.attendances}</td>
                  <td>{r.my_attendance?.status ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}

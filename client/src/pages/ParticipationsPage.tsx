import { useEffect, useState } from "react";
import { useResourceList } from "@/hooks/useResourceList";
import { createParticipation, fetchParticipations } from "@/api/modules";
import { fetchEstablishments, type Establishment } from "@/api/operation";
import { ListShell } from "@/components/ListShell";
import { NewRecordSection } from "@/components/NewRecordSection";
import { formatDay, PARTICIPATION_TYPE_LABEL } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";

export function ParticipationsPage() {
  const { rows, loading, error, reload } = useResourceList(fetchParticipations);
  const { canWrite } = useModuleAccess("participacao");
  const [tipo, setTipo] = useState("CONSULTATION");
  const [assunto, setAssunto] = useState("");
  const [quando, setQuando] = useState("");
  const [unidade, setUnidade] = useState("");
  const [quantos, setQuantos] = useState("");
  const [description, setDescription] = useState("");
  const [unidades, setUnidades] = useState<Establishment[]>([]);

  useEffect(() => {
    if (!canWrite) return;
    fetchEstablishments()
      .then((d) => setUnidades(d.establishments.filter((u) => !u.archivedAt)))
      .catch(() => setUnidades([]));
  }, [canWrite]);

  return (
    <ListShell
      title="Participação"
      description="Registros de participação dos trabalhadores no GRO."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhum registro"
      emptyDescription="DDS, reuniões e consultas aparecem nesta lista."
      before={
        <NewRecordSection
          canWrite={canWrite}
          openLabel="Registrar participação"
          title="Registro de participação"
          description="NR-1 1.5.3.2: é o que demonstra que os trabalhadores foram ouvidos e informados. A evidência (lista de presença, foto, ata) se anexa depois, no registro."
          submitLabel="Registrar"
          disabled={!assunto.trim() || !quando}
          onSubmit={async () => {
            await createParticipation({
              type: tipo,
              subject: assunto.trim(),
              occurred_at: new Date(`${quando}T12:00:00`).toISOString(),
              establishment_id: unidade || undefined,
              participants_count: quantos ? Number(quantos) : undefined,
              description: description.trim() || undefined,
            });
            setAssunto("");
            setQuando("");
            setQuantos("");
            setDescription("");
            await reload();
            return "Participação registrada.";
          }}
        >
          <div className="form-grid cols-2">
            <label className="form-field">
              Tipo
              <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
                {Object.entries(PARTICIPATION_TYPE_LABEL).map(([v, r]) => (
                  <option key={v} value={v}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Quando aconteceu
              <input
                type="date"
                value={quando}
                onChange={(e) => setQuando(e.target.value)}
                required
              />
            </label>
          </div>
          <label className="form-field">
            Assunto
            <input
              value={assunto}
              onChange={(e) => setAssunto(e.target.value)}
              placeholder="Ex.: DDS sobre uso de escada"
              required
            />
          </label>
          <div className="form-grid cols-2">
            <label className="form-field">
              Unidade (opcional)
              <select value={unidade} onChange={(e) => setUnidade(e.target.value)}>
                <option value="">Toda a empresa</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Quantas pessoas (opcional)
              <input
                type="number"
                min={0}
                value={quantos}
                onChange={(e) => setQuantos(e.target.value)}
              />
            </label>
          </div>
          <label className="form-field">
            O que foi tratado (opcional)
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
        </NewRecordSection>
      }
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Tipo</th>
                <th>Assunto</th>
                <th>Estabelecimento</th>
                <th>Data</th>
                <th>Evidências</th>
                <th>Registrado por</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td>{PARTICIPATION_TYPE_LABEL[r.type] ?? r.type}</td>
                  <td><strong>{r.subject}</strong></td>
                  <td>{r.establishment?.name ?? "—"}</td>
                  <td>{formatDay(r.occurredAt)}</td>
                  <td>{r._count.evidences}</td>
                  <td>{r.recordedBy.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}

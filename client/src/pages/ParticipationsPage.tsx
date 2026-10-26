import { Fragment, useEffect, useState } from "react";
import { useResourceList } from "@/hooks/useResourceList";
import {
  addParticipationEvidence,
  createParticipation,
  fetchParticipation,
  fetchParticipations,
  participationEvidenceUrl,
  type ParticipationEvidence,
} from "@/api/modules";
import { baixarArquivoPrivado } from "@/api/arquivo-privado";
import { fetchEstablishments, type Establishment } from "@/api/operation";
import { AnexarPapel } from "@/components/AnexarPapel";
import { ListShell } from "@/components/ListShell";
import { NewRecordSection } from "@/components/NewRecordSection";
import { formatDay, PARTICIPATION_TYPE_LABEL } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import "@/components/data-table.css";

/** O registro aberto: o que foi tratado e o papel anexado. [B3-4-B] [S7-E] */
type Aberto = {
  id: string;
  description: string | null;
  participantsCount: number | null;
  evidences: ParticipationEvidence[];
};

export function ParticipationsPage() {
  const { rows, loading, error, reload } = useResourceList(fetchParticipations);
  const { canWrite } = useModuleAccess("participacao");
  /*
    A lista mostrava só a contagem de evidências, e a tela prometia que a
    evidência "se anexa depois, no registro" — que não abria. [B3-4-B]
  */
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [aberto, setAberto] = useState<Aberto | null>(null);
  const [erroAberto, setErroAberto] = useState<string | null>(null);

  async function carregar(id: string) {
    setErroAberto(null);
    try {
      const d = await fetchParticipation(id);
      setAberto({
        id: d.id,
        description: d.description,
        participantsCount: d.participantsCount,
        evidences: d.evidences,
      });
    } catch (err) {
      setAberto(null);
      setErroAberto(err instanceof Error ? err.message : "Falha ao abrir o registro");
    }
  }

  async function alternar(id: string) {
    if (abertoId === id) {
      setAbertoId(null);
      setAberto(null);
      return;
    }
    setAbertoId(id);
    setAberto(null);
    await carregar(id);
  }
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
          description="NR-1 1.5.3.3: é o que demonstra que os trabalhadores foram consultados sobre os riscos e informados das medidas. A evidência (lista de presença, foto, ata) se anexa no registro, abrindo a linha."
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
            {rows.map((r) => {
              const open = abertoId === r.id;
              return (
                <Fragment key={r.id}>
                  <tr
                    className={`is-clickable${open ? " is-open" : ""}`}
                    onClick={() => void alternar(r.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        void alternar(r.id);
                      }
                    }}
                    tabIndex={0}
                    role="button"
                    aria-expanded={open}
                  >
                    <td>{PARTICIPATION_TYPE_LABEL[r.type] ?? r.type}</td>
                    <td><strong>{r.subject}</strong></td>
                    <td>{r.establishment?.name ?? "—"}</td>
                    <td>{formatDay(r.occurredAt)}</td>
                    <td>{r._count.evidences}</td>
                    <td>{r.recordedBy.name}</td>
                  </tr>
                  {open && (
                    <tr>
                      <td colSpan={6} onClick={(e) => e.stopPropagation()}>
                        {erroAberto && (
                          <p className="form-error" role="alert">
                            {erroAberto}
                          </p>
                        )}
                        {!aberto && !erroAberto && (
                          <p className="muted">Abrindo…</p>
                        )}
                        {aberto && (
                          <div className="registro-aberto">
                            <p>
                              <strong>O que foi tratado:</strong>{" "}
                              {aberto.description ?? (
                                <span className="muted">não registrado</span>
                              )}
                            </p>
                            <p className="muted">
                              {aberto.participantsCount != null
                                ? `${aberto.participantsCount} pessoa(s)`
                                : "Número de pessoas não registrado"}
                            </p>
                            <AnexarPapel
                              canWrite={canWrite}
                              label="Lista de presença, foto ou ata"
                              hint="Opcional: o registro no portal já é a prova. Até 20 MB."
                              anexos={aberto.evidences}
                              onSend={async (input) => {
                                await addParticipationEvidence(aberto.id, input);
                                await carregar(aberto.id);
                                await reload();
                              }}
                              onOpen={(anexo) =>
                                baixarArquivoPrivado(
                                  participationEvidenceUrl(aberto.id, anexo.id),
                                  anexo.fileName ?? "evidencia",
                                )
                              }
                            />
                          </div>
                        )}
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

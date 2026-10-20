import { useEffect, useState } from "react";
import { useResourceList } from "@/hooks/useResourceList";
import { concludeAep, createAep, fetchAeps } from "@/api/modules";
import { fetchEstablishments, type Establishment } from "@/api/operation";
import { Button } from "@/components/Button";
import { Dialog } from "@/components/Dialog";
import { NewRecordSection } from "@/components/NewRecordSection";
import { useModuleAccess } from "@/lib/module-access";
import { ListShell } from "@/components/ListShell";
import { Chip } from "@/components/Chip";
import { AEP_METHOD_LABEL, AEP_STATUS_LABEL, formatDay } from "@/lib/labels";
import { ErgonomicComplaints } from "./ErgonomicComplaints";

export function AepPage() {
  const { rows, loading, error, reload } = useResourceList(fetchAeps);
  /* Abrir avaliação é de quem responde tecnicamente. [CB-45] [P1] */
  const { canManage } = useModuleAccess("aep");
  const [unidade, setUnidade] = useState("");
  const [escopo, setEscopo] = useState("");
  const [metodo, setMetodo] = useState("OBSERVATION");
  const [porque, setPorque] = useState("");
  const [anonimato, setAnonimato] = useState("");
  const [ouvidos, setOuvidos] = useState("");
  const [unidades, setUnidades] = useState<Establishment[]>([]);
  /*
    O painel pede avaliação CONCLUÍDA, e concluir não tinha tela: dava para
    abrir e nunca fechar. [B2-4-C]
  */
  const [concluindo, setConcluindo] = useState<string | null>(null);
  const [constatacoes, setConstatacoes] = useState("");
  const [precisaAet, setPrecisaAet] = useState(false);
  const [porQueAet, setPorQueAet] = useState("");
  const [fechando, setFechando] = useState(false);
  const [erroAoFechar, setErroAoFechar] = useState<string | null>(null);

  useEffect(() => {
    if (!canManage) return;
    fetchEstablishments()
      .then((d) => {
        const ativas = d.establishments.filter((u) => !u.archivedAt);
        setUnidades(ativas);
        setUnidade((atual) => atual || ativas[0]?.id || "");
      })
      .catch(() => setUnidades([]));
  }, [canManage]);

  return (
    <ListShell
      title="Avaliação ergonômica"
      description="AEP e fatores psicossociais por estabelecimento e setor."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhuma AEP registrada"
      emptyDescription="Quando houver avaliações ergonômicas, elas aparecem aqui."
      /* Quem trabalha diz onde dói; o SST decide o que vira avaliação. [P1] */
      before={
        <>
          <ErgonomicComplaints onEvaluated={reload} />
          <NewRecordSection
            canWrite={canManage}
            openLabel="Nova avaliação"
            title="Nova avaliação ergonômica"
            description="Nasce em andamento: os perigos e as constatações entram depois. Para avaliar a partir de uma queixa, use o botão da própria queixa."
            submitLabel="Abrir avaliação"
            disabled={!unidade || !escopo.trim()}
            onSubmit={async () => {
              await createAep({
                establishment_id: unidade,
                scope_description: escopo.trim(),
                method: metodo,
                method_rationale: porque.trim() || undefined,
                anonymity_measures: anonimato.trim() || undefined,
                workers_consulted: ouvidos ? Number(ouvidos) : undefined,
              });
              setEscopo("");
              setPorque("");
              setAnonimato("");
              setOuvidos("");
              await reload();
              return "Avaliação aberta.";
            }}
          >
            <div className="form-grid cols-2">
              <label className="form-field">
                Unidade
                <select value={unidade} onChange={(e) => setUnidade(e.target.value)} required>
                  <option value="">Escolha a unidade</option>
                  {unidades.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                Como vai ser feita
                <select value={metodo} onChange={(e) => setMetodo(e.target.value)}>
                  {Object.entries(AEP_METHOD_LABEL).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="form-field">
              O que será avaliado
              <input
                value={escopo}
                onChange={(e) => setEscopo(e.target.value)}
                placeholder="Atividade, posto, função, setor ou grupo"
                required
              />
            </label>
            <label className="form-field">
              Por que este método (opcional)
              <textarea value={porque} onChange={(e) => setPorque(e.target.value)} />
              <span className="form-hint">
                A norma não impõe ferramenta, mas cobra coerência com o que
                está sendo avaliado.
              </span>
            </label>
            {metodo === "QUESTIONNAIRE" && (
              <label className="form-field">
                Como o anonimato das respostas foi garantido
                <textarea
                  value={anonimato}
                  onChange={(e) => setAnonimato(e.target.value)}
                  required
                />
              </label>
            )}
            <label className="form-field">
              Quantos trabalhadores foram ouvidos (opcional)
              <input
                type="number"
                min={0}
                value={ouvidos}
                onChange={(e) => setOuvidos(e.target.value)}
              />
            </label>
          </NewRecordSection>
        </>
      }
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Estabelecimento</th>
                <th>Setor</th>
                <th>Método</th>
                <th>Status</th>
                <th>Data</th>
                <th>Perigos</th>
                <th>Responsável</th>
                <th aria-label="Concluir" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td>{r.establishment.name}</td>
                  <td>{r.sector?.name ?? "—"}</td>
                  <td>{AEP_METHOD_LABEL[r.method] ?? r.method}</td>
                  <td>
                    <Chip tone={r.status === "CONCLUDED" ? "success" : "warning"}>
                      {AEP_STATUS_LABEL[r.status] ?? r.status}
                    </Chip>
                  </td>
                  <td>{formatDay(r.conductedAt)}</td>
                  <td>{r._count.hazards}</td>
                  <td>{r.conductedBy.name}</td>
                  <td>
                    {canManage && r.status !== "CONCLUDED" && (
                      <Button
                        type="button"
                        size="compact"
                        variant="secondary"
                        onClick={() => {
                          setConcluindo(r.id);
                          setConstatacoes("");
                          setPrecisaAet(false);
                          setPorQueAet("");
                          setErroAoFechar(null);
                        }}
                      >
                        Concluir
                      </Button>
                    )}
                  </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Concluir a avaliação: é a concluída que o painel procura. [B2-4-C] */}
      {concluindo && (
        <Dialog
          title="Concluir a avaliação ergonômica"
          description="Depois de concluída, a avaliação não volta a rascunho: uma mudança pede avaliação nova."
          onClose={() => setConcluindo(null)}
        >
          <form
            className="form-grid"
            onSubmit={async (e) => {
              e.preventDefault();
              setFechando(true);
              setErroAoFechar(null);
              try {
                await concludeAep(concluindo, {
                  findings: constatacoes.trim() || undefined,
                  needs_aet: precisaAet,
                  aet_reason: precisaAet ? porQueAet.trim() : undefined,
                });
                setConcluindo(null);
                reload();
              } catch (err) {
                setErroAoFechar(
                  err instanceof Error ? err.message : "Falha ao concluir",
                );
              } finally {
                setFechando(false);
              }
            }}
          >
            <label className="form-field">
              O que foi constatado
              <textarea
                value={constatacoes}
                onChange={(e) => setConstatacoes(e.target.value)}
                placeholder="O que a avaliação encontrou no posto de trabalho."
              />
            </label>
            <label className="muted" style={{ display: "flex", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={precisaAet}
                onChange={(e) => setPrecisaAet(e.target.checked)}
              />
              Precisa de AET — análise ergonômica do trabalho (NR-17 17.3.2)
            </label>
            {precisaAet && (
              <label className="form-field">
                Por que precisa
                <textarea
                  value={porQueAet}
                  onChange={(e) => setPorQueAet(e.target.value)}
                  required
                />
              </label>
            )}
            {erroAoFechar && (
              <p className="form-error" role="alert">
                {erroAoFechar}
              </p>
            )}
            <div className="form-actions">
              <Button type="submit" disabled={fechando}>
                {fechando ? "Concluindo…" : "Concluir"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setConcluindo(null)}
              >
                Cancelar
              </Button>
            </div>
          </form>
        </Dialog>
      )}
    </ListShell>
  );
}

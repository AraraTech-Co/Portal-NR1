import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  archiveContractor,
  createContractor,
  fetchContractorList,
  markDocumentsReceived,
  markRisksInformed,
  updateContractor,
  CONTRACTOR_RELATION_LABEL,
  type ContractorRow,
} from "@/api/contractors";
import { fetchEstablishments, type Establishment } from "@/api/operation";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { formatDay } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import "@/components/data-table.css";
import "@/components/form.css";
import "./contractors.css";

function hojeIso(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
}

type Form = {
  id: string | null;
  name: string;
  tax_id: string;
  relation: string;
  establishment_id: string;
  services_scope: string;
  interaction_measures: string;
};

const VAZIO: Form = {
  id: null,
  name: "",
  tax_id: "",
  relation: "WE_HIRE",
  establishment_id: "",
  services_scope: "",
  interaction_measures: "",
};

/**
 * Empresas contratadas (NR-1 1.5.8).
 *
 * A tela era só uma tabela: não havia como cadastrar a contratada, e por isso
 * a pessoa marcada como "Terceirizado" na ficha ficava sem empresa. [S1-R] [CB-8]
 */
export function ContractorsPage() {
  const { canWrite } = useModuleAccess("terceiros");
  const [rows, setRows] = useState<ContractorRow[] | null>(null);
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setRows(await fetchContractorList());
  }, []);

  useEffect(() => {
    reload().catch((err) =>
      setErro(err instanceof Error ? err.message : "Falha ao carregar"),
    );
    fetchEstablishments()
      .then((d) => setEstablishments(d.establishments))
      .catch(() => setEstablishments([]));
  }, [reload]);

  function editar(c: ContractorRow) {
    setErro(null);
    setForm({
      id: c.id,
      name: c.name,
      tax_id: c.taxId ?? "",
      relation: c.relation,
      establishment_id: c.establishment?.id ?? "",
      services_scope: c.servicesScope ?? "",
      interaction_measures: c.interactionMeasures ?? "",
    });
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSalvando(true);
    setErro(null);
    try {
      const corpo = {
        name: form.name.trim(),
        tax_id: form.tax_id.trim() || undefined,
        relation: form.relation,
        establishment_id: form.establishment_id || undefined,
        services_scope: form.services_scope.trim() || undefined,
        interaction_measures: form.interaction_measures.trim() || undefined,
      };
      if (form.id) await updateContractor(form.id, corpo);
      else await createContractor(corpo);
      setForm(null);
      await reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  async function acao(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setErro(null);
    try {
      await fn();
      await reload();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível concluir");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div>
      <PageHeader
        title="Terceiros"
        description="Empresas contratadas que trabalham no mesmo ambiente. A NR-1 1.5.8 pede os documentos delas e a informação recíproca dos riscos."
      />

      {erro && (
        <p className="page-error" role="alert">
          {erro}
        </p>
      )}

      {canWrite && !form && (
        <div className="form-actions">
          <Button type="button" onClick={() => setForm({ ...VAZIO })}>
            Cadastrar empresa contratada
          </Button>
        </div>
      )}

      {form && (
        <section className="form-section">
          <h2>{form.id ? "Editar empresa" : "Nova empresa contratada"}</h2>
          <form className="form-grid" onSubmit={salvar}>
            <div className="form-grid cols-2">
              <label className="form-field">
                Razão social
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  maxLength={160}
                  autoFocus
                />
              </label>
              <label className="form-field">
                CNPJ (opcional)
                <input
                  value={form.tax_id}
                  onChange={(e) => setForm({ ...form, tax_id: e.target.value })}
                  placeholder="00.000.000/0000-00"
                />
              </label>
            </div>
            <div className="form-grid cols-2">
              <label className="form-field">
                Relação
                <select
                  value={form.relation}
                  onChange={(e) => setForm({ ...form, relation: e.target.value })}
                >
                  {Object.entries(CONTRACTOR_RELATION_LABEL).map(([v, r]) => (
                    <option key={v} value={v}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                Onde trabalha (opcional)
                <select
                  value={form.establishment_id}
                  onChange={(e) =>
                    setForm({ ...form, establishment_id: e.target.value })
                  }
                >
                  <option value="">Toda a organização</option>
                  {establishments.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="form-field">
              Serviço contratado (opcional)
              <input
                value={form.services_scope}
                onChange={(e) =>
                  setForm({ ...form, services_scope: e.target.value })
                }
                placeholder="Ex.: limpeza industrial, manutenção elétrica"
              />
            </label>
            <label className="form-field">
              Riscos de interação e como são tratados (opcional)
              <textarea
                rows={2}
                value={form.interaction_measures}
                onChange={(e) =>
                  setForm({ ...form, interaction_measures: e.target.value })
                }
              />
              <span className="form-hint">
                NR-1 1.5.8.4: os riscos que uma empresa cria para a outra são
                tratados em conjunto, sob coordenação da contratante.
              </span>
            </label>
            <div className="form-actions">
              <Button type="submit" disabled={salvando}>
                {salvando ? "Salvando…" : "Salvar"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setForm(null)}>
                Cancelar
              </Button>
            </div>
          </form>
        </section>
      )}

      {!rows && <LoadingState label="Carregando terceiros…" />}
      {rows && rows.length === 0 && (
        <EmptyState
          title="Nenhum terceiro cadastrado"
          description="Cadastre as empresas contratadas para ligar as pessoas terceirizadas a elas e acompanhar documentos e riscos."
        />
      )}

      {rows && rows.length > 0 && (
        <section className="form-section">
          <h2>Empresas contratadas</h2>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Empresa</th>
                  <th>Relação</th>
                  <th>Onde</th>
                  <th>Documentos (1.5.8.1.1)</th>
                  <th>Riscos informados (1.5.8.2)</th>
                  <th aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <strong>{c.name}</strong>
                      {c.servicesScope && <div className="muted">{c.servicesScope}</div>}
                      {c.workers != null && c.workers > 0 && (
                        <div className="muted">
                          {c.workers === 1
                            ? "1 pessoa no portal"
                            : `${c.workers} pessoas no portal`}
                        </div>
                      )}
                    </td>
                    <td>{CONTRACTOR_RELATION_LABEL[c.relation] ?? c.relation}</td>
                    <td>{c.establishment?.name ?? <span className="muted">toda a organização</span>}</td>
                    <td>
                      {c.documentsReceivedAt ? (
                        <Chip tone="success">{formatDay(c.documentsReceivedAt)}</Chip>
                      ) : canWrite ? (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={busyId === c.id}
                          onClick={() =>
                            void acao(c.id, () =>
                              markDocumentsReceived(c.id, hojeIso()),
                            )
                          }
                        >
                          Marcar recebidos
                        </Button>
                      ) : (
                        <Chip tone="warning">Pendente</Chip>
                      )}
                    </td>
                    <td>
                      {c.risksInformedAt ? (
                        <Chip tone="success">{formatDay(c.risksInformedAt)}</Chip>
                      ) : canWrite ? (
                        <Button
                          type="button"
                          variant="ghost"
                          disabled={busyId === c.id}
                          onClick={() =>
                            void acao(c.id, () => markRisksInformed(c.id, hojeIso()))
                          }
                        >
                          Marcar informados
                        </Button>
                      ) : (
                        <Chip tone="warning">Pendente</Chip>
                      )}
                    </td>
                    <td>
                      {canWrite && (
                        <div className="form-actions">
                          <Button type="button" variant="ghost" onClick={() => editar(c)}>
                            Editar
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={busyId === c.id}
                            onClick={() => void acao(c.id, () => archiveContractor(c.id))}
                          >
                            Arquivar
                          </Button>
                        </div>
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

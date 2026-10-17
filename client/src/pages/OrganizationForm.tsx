import { FormEvent, useEffect, useState } from "react";
import {
  fetchOrganization,
  updateOrganization,
  type Organization,
} from "@/api/organization";
import { Button } from "@/components/Button";
import { LoadingState } from "@/components/LoadingState";
import "@/components/form.css";

function formatCnpj(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 14);
  if (d.length !== 14) return value;
  return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
}

/**
 * Dados da empresa e quem responde pelo PGR.
 *
 * Eram os únicos dados do portal sem nenhum caminho: o cartão "Responsável
 * pelo PGR" ficava para sempre com três pendências, inclusive na frente do
 * fiscal, e a ordem de serviço não tinha responsável padrão. [B2-1-M] [CB-42]
 */
export function OrganizationForm() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [podeEditar, setPodeEditar] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchOrganization()
      .then((d) => {
        if (cancelled) return;
        setOrg(d.organization);
        setPodeEditar(d.can_edit);
      })
      .catch((err) => {
        if (!cancelled) setErro(err instanceof Error ? err.message : "Falha ao carregar");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function campo<K extends keyof Organization>(chave: K, valor: Organization[K]) {
    setOrg((atual) => (atual ? { ...atual, [chave]: valor } : atual));
    setOk(false);
  }

  async function salvar(e: FormEvent) {
    e.preventDefault();
    if (!org) return;
    setSalvando(true);
    setErro(null);
    setOk(false);
    try {
      const { organization } = await updateOrganization({
        name: org.name,
        tax_id: org.taxId ?? "",
        responsible_name: org.responsibleName ?? "",
        responsible_role: org.responsibleRole ?? "",
        responsible_registration: org.responsibleRegistration ?? "",
        assessment_review_months: org.assessmentReviewMonths,
        has_sst_certification: org.hasSstCertification,
      });
      setOrg(organization);
      setOk(true);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setSalvando(false);
    }
  }

  if (erro && !org) {
    return (
      <p className="page-error" role="alert">
        {erro}
      </p>
    );
  }
  if (!org) return <LoadingState label="Carregando os dados da empresa…" />;

  return (
    <section className="form-section">
      <h2>Dados da empresa</h2>
      <p className="muted">
        É daqui que saem o cabeçalho dos documentos do PGR, o responsável que
        assina e o prazo de revisão das avaliações.
      </p>
      <form className="form-grid" onSubmit={salvar}>
        <div className="form-grid cols-2">
          <label className="form-field">
            Razão social
            <input
              value={org.name}
              onChange={(e) => campo("name", e.target.value)}
              disabled={!podeEditar || salvando}
              required
              maxLength={160}
            />
          </label>
          <label className="form-field">
            CNPJ
            <input
              value={org.taxId ? formatCnpj(org.taxId) : ""}
              onChange={(e) => campo("taxId", e.target.value)}
              disabled={!podeEditar || salvando}
              placeholder="00.000.000/0000-00"
            />
            <span className="form-hint">
              É o CNPJ da empresa, não o do estabelecimento — esse fica em
              Operação.
            </span>
          </label>
        </div>

        <h3 className="org-sub">Responsável pelo PGR</h3>
        <p className="muted">
          NR-1 1.5.7.2: os documentos são datados e assinados sob
          responsabilidade da organização. Fica como padrão na emissão e na
          ordem de serviço.
        </p>
        <div className="form-grid cols-2">
          <label className="form-field">
            Nome
            <input
              value={org.responsibleName ?? ""}
              onChange={(e) => campo("responsibleName", e.target.value)}
              disabled={!podeEditar || salvando}
              maxLength={120}
            />
          </label>
          <label className="form-field">
            Cargo ou função
            <input
              value={org.responsibleRole ?? ""}
              onChange={(e) => campo("responsibleRole", e.target.value)}
              disabled={!podeEditar || salvando}
              maxLength={120}
            />
          </label>
        </div>
        <label className="form-field">
          Registro profissional
          <input
            value={org.responsibleRegistration ?? ""}
            onChange={(e) => campo("responsibleRegistration", e.target.value)}
            disabled={!podeEditar || salvando}
            maxLength={60}
          />
          <span className="form-hint">
            Quando a profissão tiver conselho (CREA, CRM). Deixe em branco se
            não houver — a NR-1 não exige profissional habilitado.
          </span>
        </label>

        <h3 className="org-sub">Revisão das avaliações</h3>
        <div className="form-grid cols-2">
          <label className="form-field">
            A cada quantos meses
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={org.hasSstCertification ? 36 : 24}
              value={org.assessmentReviewMonths}
              onChange={(e) => campo("assessmentReviewMonths", Number(e.target.value))}
              disabled={!podeEditar || salvando}
            />
            <span className="form-hint">
              NR-1 1.5.4.4.6: até 24 meses. Com certificação em sistema de
              gestão de SST declarada, até 36.
            </span>
          </label>
          <label className="org-check">
            <input
              type="checkbox"
              checked={org.hasSstCertification}
              onChange={(e) => campo("hasSstCertification", e.target.checked)}
              disabled={!podeEditar || salvando}
            />
            Temos certificação em sistema de gestão de SST
          </label>
        </div>

        {erro && (
          <p className="form-error" role="alert">
            {erro}
          </p>
        )}
        {ok && (
          <p className="muted" role="status">
            Dados salvos.
          </p>
        )}
        {podeEditar ? (
          <div className="form-actions">
            <Button type="submit" disabled={salvando}>
              {salvando ? "Salvando…" : "Salvar"}
            </Button>
          </div>
        ) : (
          <p className="muted">
            Só quem cuida de Configurações altera estes dados.
          </p>
        )}
      </form>
    </section>
  );
}

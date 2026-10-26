import { Fragment, useCallback, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  fetchInventory,
  type InventoryItem,
  type InventorySnapshot,
} from "@/api/inventory";
import { fetchEstablishments, type Establishment } from "@/api/operation";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { RISK_LEVEL_LABEL } from "@/lib/labels";
import "./inventory.css";
import { LoadingState } from "@/components/LoadingState";
import { useModuleAccess } from "@/lib/module-access";
import { RiskHistoryPanel } from "./RiskHistoryPanel";

type RiskTone =
  | "risk-trivial"
  | "risk-tolerable"
  | "risk-moderate"
  | "risk-substantial"
  | "risk-intolerable"
  | "neutral";

const LEVEL_LABEL = RISK_LEVEL_LABEL;

function riskTone(level: string | null): RiskTone {
  if (!level) return "neutral";
  const key = `risk-${level.toLowerCase()}` as RiskTone;
  if (
    key === "risk-trivial" ||
    key === "risk-tolerable" ||
    key === "risk-moderate" ||
    key === "risk-substantial" ||
    key === "risk-intolerable"
  ) {
    return key;
  }
  return "neutral";
}

function controlStatus(item: InventoryItem): string {
  const statuses = item.risks.flatMap((r) => r.controls.map((c) => c.status));
  if (statuses.length === 0) return "Sem controle";
  if (statuses.every((s) => s === "IMPLEMENTED" || s === "ACTIVE")) {
    return "Controles ok";
  }
  if (statuses.some((s) => s === "PENDING" || s === "PLANNED")) {
    return "Em andamento";
  }
  return statuses[0] ?? "—";
}

function flattenRows(items: InventoryItem[]) {
  const rows: {
    key: string;
    riskId: string | null;
    /** Para avaliar sem procurar a atividade na mão. [CB-22] */
    activityId: string | null;
    hazard: string;
    risk: string;
    level: string | null;
    status: string;
    place: string;
    /** De onde vem o perigo e quanta gente fica exposta. [S2-H] */
    activity: string | null;
    exposed: number | null;
  }[] = [];

  for (const item of items) {
    if (item.risks.length === 0) {
      rows.push({
        key: item.hazard_id,
        riskId: null,
        activityId: item.activity_id ?? null,
        hazard: item.description,
        risk: "—",
        level: null,
        status: controlStatus(item),
        place: `${item.establishment} · ${item.sector}`,
        activity: item.activity ?? null,
        exposed: item.exposed_workers_count ?? null,
      });
      continue;
    }
    for (const risk of item.risks) {
      rows.push({
        key: `${item.hazard_id}-${risk.risk_id}`,
        activityId: item.activity_id ?? null,
        riskId: risk.risk_id,
        hazard: item.description,
        risk: risk.description,
        level: risk.level,
        status: risk.needs_reassessment
          ? "Reavaliar"
          : controlStatus({ ...item, risks: [risk] }),
        place: `${item.establishment} · ${item.sector}`,
        activity: item.activity ?? null,
        exposed: item.exposed_workers_count ?? null,
      });
    }
  }
  return rows;
}

export function InventoryPage() {
  const [snapshot, setSnapshot] = useState<InventorySnapshot | null>(null);
  const [establishments, setEstablishments] = useState<Establishment[]>([]);
  // Cada unidade tem o seu inventário; misturar tudo confunde quem fiscaliza. [S6-D]
  const [establishmentId, setEstablishmentId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openRiskId, setOpenRiskId] = useState<string | null>(null);
  const { canWrite } = useModuleAccess("inventario");
  /*
    Quem chega da ocorrência vem atrás de um risco certo: abre o histórico
    dele já, em vez de procurar a linha na lista inteira. [B3-4-C]
  */
  const [searchParams] = useSearchParams();
  const riscoPedido = searchParams.get("risco");

  useEffect(() => {
    fetchEstablishments()
      .then((d) => setEstablishments(d.establishments))
      .catch(() => setEstablishments([]));
  }, []);

  const load = useCallback((estId: string) => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    /*
      Carregar fechava o histórico aberto — inclusive o que veio pedido no
      endereço, que é por ele que a pessoa chegou aqui. Trocar de unidade
      continua fechando o que foi aberto à mão. [B3-4-C]
    */
    setOpenRiskId(riscoPedido ?? null);
    fetchInventory(estId || undefined)
      .then((data) => {
        if (!cancelled) setSnapshot(data.inventory);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Falha ao carregar");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [riscoPedido]);

  useEffect(() => load(establishmentId), [load, establishmentId]);

  const rows = snapshot ? flattenRows(snapshot.items) : [];

  return (
    <div>
      <PageHeader
        title="Inventário de riscos"
        description="Perigos e riscos com nível da última avaliação validada."
        actions={
          <>
            {canWrite && (
              <Link to="/inventario/registrar" className="inventory-add">
                Registrar perigo
              </Link>
            )}
            {snapshot && (
              <Chip tone="info">
                {new Date(snapshot.generated_at).toLocaleString("pt-BR")}
              </Chip>
            )}
          </>
        }
      />

      {establishments.length > 1 && (
        <label className="inventory-filter">
          Estabelecimento
          <select value={establishmentId} onChange={(e) => setEstablishmentId(e.target.value)}>
            <option value="">Todos</option>
            {establishments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {loading && <LoadingState label="Carregando inventário…" />}

      {!loading && error && (
        <p className="inventory-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && rows.length === 0 && (
        <EmptyState
          title="Nenhum perigo cadastrado"
          description="Comece registrando um perigo a partir de uma atividade da operação."
          action={
            canWrite ? (
              <Link to="/inventario/registrar" className="inventory-add">
                Registrar perigo
              </Link>
            ) : undefined
          }
        />
      )}

      {!loading && !error && rows.length > 0 && (
        <div className="inventory-table-wrap">
          <table className="inventory-table">
            <thead>
              <tr>
                <th>Perigo</th>
                <th>Risco</th>
                <th>Nível</th>
                <th>Status</th>
                {/* De onde vem e quanta gente pega. [S2-H] */}
                <th>Atividade</th>
                <th>Expostos</th>
                <th>Local</th>
                <th aria-label="Histórico" />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = row.riskId !== null && openRiskId === row.riskId;
                return (
                  <Fragment key={row.key}>
                    <tr className={open ? "is-open" : undefined}>
                      <td>{row.hazard}</td>
                      <td>{row.risk}</td>
                      <td>
                        {row.level ? (
                          <Chip tone={riskTone(row.level)}>
                            {LEVEL_LABEL[row.level] ?? row.level}
                          </Chip>
                        ) : (
                          <span className="muted">Sem avaliação</span>
                        )}
                      </td>
                      <td>{row.status}</td>
                      <td className="muted">{row.activity ?? "—"}</td>
                      <td className="muted">
                        {row.exposed === null ? "—" : row.exposed}
                      </td>
                      <td className="muted">{row.place}</td>
                      <td className="inventory-actions">
                        {/* Avaliar só se fazia pela tela de registro, perigo
                            a perigo. O Inventário é onde o técnico olha os
                            riscos: daqui ele chega direto. [CB-22] */}
                        {canWrite && row.activityId && (
                          <Link
                            to={`/inventario/registrar?atividade=${encodeURIComponent(row.activityId)}`}
                            className="inventory-history-btn"
                          >
                            {row.level ? "Reavaliar" : "Avaliar"}
                          </Link>
                        )}
                        {row.riskId && (
                          <button
                            type="button"
                            className="inventory-history-btn"
                            aria-expanded={open}
                            onClick={() => setOpenRiskId(open ? null : row.riskId)}
                          >
                            {open ? "Fechar" : "Histórico"}
                          </button>
                        )}
                      </td>
                    </tr>
                    {open && row.riskId && (
                      <tr className="inventory-expand">
                        <td
                          colSpan={8}
                          ref={(el) => {
                            // Vindo da ocorrência, a linha pedida entra na vista.
                            if (el && row.riskId === riscoPedido) {
                              el.scrollIntoView({ block: "center" });
                            }
                          }}
                        >
                          <RiskHistoryPanel riskId={row.riskId} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        /*
          O fiscal olha nível e situação antes do detalhe, e nenhum dos dois
          se explicava: "Controles ok" ao lado de um risco Substancial parecia
          contradição. São duas coisas diferentes — o tamanho do risco e o
          andamento das medidas. [S7-C] [S2-H] [B2-1-K]
        */
        <section className="inventory-legend">
          <h2>Como ler esta tabela</h2>
          <p>
            <strong>Nível</strong> é o tamanho do risco na última avaliação
            validada, da matriz da empresa: {Object.values(LEVEL_LABEL).join(" · ")}.
            Quanto mais alto, mais cedo a medida precisa sair do papel.
          </p>
          <p>
            <strong>Status</strong> fala das medidas de prevenção, não do
            nível. <em>Sem controle</em>: nenhuma medida registrada.{" "}
            <em>Em andamento</em>: há medida planejada, ainda não implantada.{" "}
            <em>Controles ok</em>: todas as medidas registradas estão
            implantadas. <em>Reavaliar</em>: algo mudou (ocorrência, nova
            medida, prazo de revisão) e a avaliação precisa ser refeita.
          </p>
          <p>
            Por isso um risco <em>Substancial</em> pode aparecer como{" "}
            <em>Controles ok</em>: o risco continua grande, e o que está em dia
            é o cumprimento das medidas escolhidas para ele.
          </p>
          <p>
            <strong>Sem avaliação</strong> no lugar do nível quer dizer que o
            perigo foi registrado e ainda ninguém avaliou o risco.
          </p>
        </section>
      )}
    </div>
  );
}

import { Fragment, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
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
    hazard: string;
    risk: string;
    level: string | null;
    status: string;
    place: string;
  }[] = [];

  for (const item of items) {
    if (item.risks.length === 0) {
      rows.push({
        key: item.hazard_id,
        riskId: null,
        hazard: item.description,
        risk: "—",
        level: null,
        status: controlStatus(item),
        place: `${item.establishment} · ${item.sector}`,
      });
      continue;
    }
    for (const risk of item.risks) {
      rows.push({
        key: `${item.hazard_id}-${risk.risk_id}`,
        riskId: risk.risk_id,
        hazard: item.description,
        risk: risk.description,
        level: risk.level,
        status: risk.needs_reassessment
          ? "Reavaliar"
          : controlStatus({ ...item, risks: [risk] }),
        place: `${item.establishment} · ${item.sector}`,
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

  useEffect(() => {
    fetchEstablishments()
      .then((d) => setEstablishments(d.establishments))
      .catch(() => setEstablishments([]));
  }, []);

  const load = useCallback((estId: string) => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setOpenRiskId(null);
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
  }, []);

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
                      <td className="muted">{row.place}</td>
                      <td>
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
                        <td colSpan={6}>
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
    </div>
  );
}

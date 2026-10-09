import { useEffect, useState } from "react";
import {
  fetchInventory,
  type InventoryItem,
  type InventorySnapshot,
} from "@/api/inventory";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { RISK_LEVEL_LABEL } from "@/lib/labels";
import "./inventory.css";
import { LoadingState } from "@/components/LoadingState";

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchInventory()
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

  const rows = snapshot ? flattenRows(snapshot.items) : [];

  return (
    <div>
      <PageHeader
        title="Inventário de riscos"
        description="Perigos e riscos com nível da última avaliação validada."
        actions={
          snapshot ? (
            <Chip tone="info">
              {new Date(snapshot.generated_at).toLocaleString("pt-BR")}
            </Chip>
          ) : undefined
        }
      />

      {loading && <LoadingState label="Carregando inventário…" />}

      {!loading && error && (
        <p className="inventory-error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && rows.length === 0 && (
        <EmptyState
          title="Nenhum perigo cadastrado"
          description="Quando houver perigos e riscos na operação, eles aparecem aqui."
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
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

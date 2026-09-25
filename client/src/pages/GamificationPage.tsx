import { useEffect, useState } from "react";
import { fetchPointsBalance, fetchRewards } from "@/api/modules";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import "@/components/data-table.css";

export function GamificationPage() {
  const [balance, setBalance] = useState(0);
  const [rewards, setRewards] = useState<
    Awaited<ReturnType<typeof fetchRewards>>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([fetchPointsBalance(), fetchRewards()])
      .then(([bal, list]) => {
        if (cancelled) return;
        setBalance(bal);
        setRewards(list);
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

  return (
    <div>
      <PageHeader
        title="Gamificação"
        description="Pontos e recompensas disponíveis para resgate."
        actions={
          !loading && !error ? (
            <Chip tone="ouro">{balance} pts</Chip>
          ) : undefined
        }
      />
      {loading && <p className="muted">Carregando…</p>}
      {!loading && error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && rewards.length === 0 && (
        <EmptyState
          title="Nenhuma recompensa"
          description="Quando o RH publicar recompensas, elas aparecem aqui."
        />
      )}
      {!loading && !error && rewards.length > 0 && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Recompensa</th>
                <th>Custo</th>
                <th>Estoque</th>
              </tr>
            </thead>
            <tbody>
              {rewards.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.name}</strong>
                  </td>
                  <td>{r.cost} pts</td>
                  <td className="muted">
                    {r.stock == null ? "Ilimitado" : r.stock}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

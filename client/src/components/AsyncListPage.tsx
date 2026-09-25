import { ReactNode, useEffect, useState } from "react";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import "@/components/data-table.css";

type Props<T> = {
  title: string;
  description: string;
  load: () => Promise<T[]>;
  emptyTitle: string;
  emptyDescription: string;
  actions?: ReactNode;
  children: (rows: T[]) => ReactNode;
  /** Conteúdo acima da tabela (filtros / formulário). */
  before?: ReactNode;
};

export function AsyncListPage<T>({
  title,
  description,
  load,
  emptyTitle,
  emptyDescription,
  actions,
  children,
  before,
}: Props<T>) {
  const [rows, setRows] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    load()
      .then((data) => {
        if (!cancelled) setRows(data);
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
  }, [load, tick]);

  return (
    <div>
      <PageHeader title={title} description={description} actions={actions} />
      {before}
      {loading && <p className="muted">Carregando…</p>}
      {!loading && error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && rows.length === 0 && (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      )}
      {!loading && !error && rows.length > 0 && children(rows)}
      {/* expose refresh via data attribute for forms that call setTick - unused for now */}
      <button
        type="button"
        className="sr-only"
        data-refresh={tick}
        onClick={() => setTick((t) => t + 1)}
        tabIndex={-1}
        aria-hidden
      />
    </div>
  );
}

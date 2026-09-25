import { ReactNode } from "react";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import "@/components/data-table.css";

type Props = {
  title: string;
  description: string;
  loading: boolean;
  error: string | null;
  empty: boolean;
  emptyTitle: string;
  emptyDescription: string;
  actions?: ReactNode;
  before?: ReactNode;
  children: ReactNode;
};

export function ListShell({
  title,
  description,
  loading,
  error,
  empty,
  emptyTitle,
  emptyDescription,
  actions,
  before,
  children,
}: Props) {
  return (
    <div>
      <PageHeader title={title} description={description} actions={actions} />
      {before}
      {loading && <LoadingState />}
      {!loading && error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && empty && (
        <EmptyState title={emptyTitle} description={emptyDescription} />
      )}
      {!loading && !error && !empty && children}
    </div>
  );
}

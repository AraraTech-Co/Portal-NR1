import { useState } from "react";
import { useResourceList } from "@/hooks/useResourceList";
import { fetchHrDocuments } from "@/api/modules";
import { baixarArquivoPrivado } from "@/api/arquivo-privado";
import { ListShell } from "@/components/ListShell";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { formatDay, HR_DOCUMENT_KIND_LABEL } from "@/lib/labels";

export function HrDocumentsPage() {
  const { rows, loading, error } = useResourceList(fetchHrDocuments);
  const [baixando, setBaixando] = useState<string | null>(null);
  const [erroDoArquivo, setErroDoArquivo] = useState<string | null>(null);

  /* O arquivo sai para a pessoa destinatária e para o RH. */
  async function baixar(id: string, fileName: string) {
    setBaixando(id);
    setErroDoArquivo(null);
    try {
      await baixarArquivoPrivado(`/api/hr-documents/${id}/arquivo`, fileName);
    } catch (err) {
      setErroDoArquivo(err instanceof Error ? err.message : "Falha ao baixar o arquivo");
    } finally {
      setBaixando(null);
    }
  }

  return (
    <ListShell
      title="Documentos"
      description="Políticas e documentos de RH com ciência do colaborador."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhum documento"
      emptyDescription="Documentos publicados pelo RH aparecem aqui."
    >
      {erroDoArquivo && (
        <p className="form-error" role="alert">
          {erroDoArquivo}
        </p>
      )}
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
                <th>Título</th>
                <th>Tipo</th>
                <th>Destino</th>
                <th>Publicado por</th>
                <th>Ciências</th>
                <th>Minha ciência</th>
                <th>Criado em</th>
                <th>Arquivo</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                  <td><strong>{r.title}</strong></td>
                  <td>{HR_DOCUMENT_KIND_LABEL[r.kind] ?? r.kind}</td>
                  <td>{r.target?.name ?? "Todos"}</td>
                  <td>{r.publishedBy.name}</td>
                  <td>{r._count.acks}</td>
                  <td>{r.my_ack?.acknowledgedAt ? <Chip tone="success">OK</Chip> : <Chip tone="warning">Pendente</Chip>}</td>
                  <td>{formatDay(r.createdAt)}</td>
                  <td>
                    {r.can_download ? (
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => void baixar(r.id, r.fileName)}
                        disabled={baixando !== null}
                      >
                        {baixando === r.id ? "…" : "Baixar"}
                      </Button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}

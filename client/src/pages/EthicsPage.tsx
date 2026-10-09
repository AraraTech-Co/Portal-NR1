import { useNavigate } from "react-router-dom";
import { useResourceList } from "@/hooks/useResourceList";
import { fetchEthicsReports } from "@/api/modules";
import { ListShell } from "@/components/ListShell";
import { Chip } from "@/components/Chip";
import { formatDay, REPORT_CATEGORY_LABEL, REPORT_STATUS_LABEL } from "@/lib/labels";
import "@/components/ethics-thread.css";

function statusTone(status: string): "warning" | "info" | "success" | "neutral" {
  if (status === "RECEIVED") return "warning";
  if (status === "AWAITING_INFO") return "info";
  if (status === "RESOLVED") return "success";
  return "neutral";
}

/** Relatos do canal de denúncia. Cada linha abre o relato e a conversa. [S5-L] */
export function EthicsPage() {
  const { rows, loading, error } = useResourceList(fetchEthicsReports);
  const navigate = useNavigate();

  return (
    <ListShell
      title="Comitê de ética"
      description="Relatos recebidos pelo comitê. Toque num relato para ler, responder e encerrar."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle="Nenhum relato"
      emptyDescription="Relatos do canal de denúncia aparecem para o comitê."
    >
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Protocolo</th>
              <th>Categoria</th>
              <th>Situação</th>
              <th>Quem</th>
              <th>Estabelecimento</th>
              <th>Mensagens</th>
              <th>Recebido em</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const open = () => navigate(`/comite/${r.id}`);
              return (
                <tr
                  key={r.id}
                  className="is-clickable"
                  onClick={open}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      open();
                    }
                  }}
                  tabIndex={0}
                  role="link"
                >
                  <td>
                    <strong>{r.protocol}</strong>
                  </td>
                  <td>{REPORT_CATEGORY_LABEL[r.category] ?? r.category}</td>
                  <td>
                    <Chip tone={statusTone(r.status)}>{REPORT_STATUS_LABEL[r.status] ?? r.status}</Chip>
                  </td>
                  <td>{r.isAnonymous ? "Anônimo" : "Identificado"}</td>
                  <td>{r.establishment?.name ?? "—"}</td>
                  <td>
                    {r._count.messages}
                    {r.unread_from_reporter > 0 && (
                      <Chip tone="warning" className="ethics-unread">
                        {r.unread_from_reporter === 1 ? "1 nova" : `${r.unread_from_reporter} novas`}
                      </Chip>
                    )}
                  </td>
                  <td>{formatDay(r.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </ListShell>
  );
}

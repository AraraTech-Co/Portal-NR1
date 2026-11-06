import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fetchEthicsList, fetchEthicsMeta, type EthicsListRow } from "@/api/ethics";
import { ListShell } from "@/components/ListShell";
import { Chip } from "@/components/Chip";
import { Button } from "@/components/Button";
import {
  DEADLINE_SITUATION_LABEL,
  deadlineTone,
  formatDay,
  formatInstant,
  REPORT_CATEGORY_LABEL,
  REPORT_SEVERITY_LABEL,
  REPORT_STATUS_LABEL,
} from "@/lib/labels";
import { filtersQuery } from "@/lib/ethics-filters";
import "@/components/ethics-thread.css";
import "./denuncia.css";

function statusTone(status: string): "warning" | "info" | "success" | "neutral" {
  if (status === "RECEIVED") return "warning";
  if (status === "AWAITING_INFO") return "info";
  if (status === "RESOLVED") return "success";
  return "neutral";
}

/**
 * Relatos do canal de denúncia. Cada linha abre o relato e a conversa. [S5-L]
 *
 * Os filtros ficam na query string: voltar do detalhe mantém o filtro, e o
 * PDF imprime exatamente o que a lista mostra. Filtro e paginação são do
 * servidor, sempre dentro do recorte de quem está olhando. [C1-6]
 */
export function EthicsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [rows, setRows] = useState<EthicsListRow[]>([]);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [units, setUnits] = useState<Array<{ id: string; name: string }>>([]);
  const [protocolo, setProtocolo] = useState(params.get("protocolo") ?? "");

  const query = params.toString();
  const page = Math.max(1, Number.parseInt(params.get("pagina") ?? "1", 10) || 1);
  const statuses = (params.get("status") ?? "").split(",").filter(Boolean);
  const temFiltro = filtersQuery(params) !== "";

  useEffect(() => {
    fetchEthicsMeta()
      .then((m) => setUnits(m.establishments ?? []))
      .catch(() => setUnits([]));
  }, []);

  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    setError(null);
    fetchEthicsList(query)
      .then((d) => {
        if (cancelado) return;
        setRows(d.reports);
        setTotal(d.total);
        setPageSize(d.page_size);
      })
      .catch((err) => {
        if (!cancelado) setError(err instanceof Error ? err.message : "Falha ao carregar");
      })
      .finally(() => {
        if (!cancelado) setLoading(false);
      });
    return () => {
      cancelado = true;
    };
  }, [query]);

  /** Mudar um filtro volta para a primeira página. */
  function setFiltro(chave: string, valor: string) {
    const next = new URLSearchParams(params);
    if (valor) next.set(chave, valor);
    else next.delete(chave);
    next.delete("pagina");
    setParams(next);
  }

  function toggleStatus(s: string) {
    const set = new Set(statuses);
    if (set.has(s)) set.delete(s);
    else set.add(s);
    setFiltro("status", [...set].join(","));
  }

  function irPara(p: number) {
    const next = new URLSearchParams(params);
    if (p > 1) next.set("pagina", String(p));
    else next.delete("pagina");
    setParams(next);
  }

  function onBuscar(e: FormEvent) {
    e.preventDefault();
    setFiltro("protocolo", protocolo.trim());
  }

  const ultima = Math.max(1, Math.ceil(total / pageSize));
  const de = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const ate = Math.min(total, page * pageSize);

  return (
    <ListShell
      title="Comitê de ética"
      description="Relatos recebidos pelo comitê. Toque num relato para ler, responder e encerrar."
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyTitle={temFiltro ? "Nenhum relato com estes filtros" : "Nenhum relato"}
      emptyDescription={
        temFiltro
          ? "Mude ou limpe os filtros para ver outros relatos."
          : "Relatos do canal de denúncia aparecem para o comitê."
      }
      actions={
        <Button
          type="button"
          variant="secondary"
          disabled={total === 0}
          onClick={() => {
            const q = filtersQuery(params);
            navigate(`/comite/relatorio${q ? `?${q}` : ""}`);
          }}
        >
          Exportar PDF
        </Button>
      }
      before={
        <div className="filter-bar ethics-filters" role="search">
          <select
            aria-label="Unidade"
            value={params.get("unidade") ?? ""}
            onChange={(e) => setFiltro("unidade", e.target.value)}
          >
            <option value="">Todas as unidades</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Gravidade"
            value={params.get("gravidade") ?? ""}
            onChange={(e) => setFiltro("gravidade", e.target.value)}
          >
            <option value="">Toda gravidade</option>
            {Object.entries(REPORT_SEVERITY_LABEL).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Categoria"
            value={params.get("categoria") ?? ""}
            onChange={(e) => setFiltro("categoria", e.target.value)}
          >
            <option value="">Toda categoria</option>
            {Object.entries(REPORT_CATEGORY_LABEL).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Prazo da primeira providência"
            value={params.get("prazo") ?? ""}
            onChange={(e) => setFiltro("prazo", e.target.value)}
          >
            <option value="">Todo prazo</option>
            {Object.entries(DEADLINE_SITUATION_LABEL).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="Ciência do denunciante"
            value={params.get("ciencia") ?? ""}
            onChange={(e) => setFiltro("ciencia", e.target.value)}
          >
            <option value="">Com ou sem ciência</option>
            <option value="com">Com ciência</option>
            <option value="sem">Sem ciência</option>
          </select>
          <label className="ethics-filter-date">
            Recebidas de
            <input
              type="date"
              value={params.get("de") ?? ""}
              onChange={(e) => setFiltro("de", e.target.value)}
            />
          </label>
          <label className="ethics-filter-date">
            até
            <input
              type="date"
              value={params.get("ate") ?? ""}
              onChange={(e) => setFiltro("ate", e.target.value)}
            />
          </label>
          <form className="ethics-filter-search" onSubmit={onBuscar}>
            <input
              aria-label="Buscar por protocolo"
              placeholder="Protocolo (CX-1234)"
              value={protocolo}
              onChange={(e) => setProtocolo(e.target.value)}
            />
            <Button type="submit" variant="ghost">
              Buscar
            </Button>
          </form>
          <div className="ethics-filter-statuses" role="group" aria-label="Situação">
            {Object.entries(REPORT_STATUS_LABEL).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={`filter-toggle${statuses.includes(id) ? " is-active" : ""}`}
                aria-pressed={statuses.includes(id)}
                onClick={() => toggleStatus(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {temFiltro && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setProtocolo("");
                setParams(new URLSearchParams());
              }}
            >
              Limpar filtros
            </Button>
          )}
        </div>
      }
    >
      <p className="filter-meta muted">
        {total === 1 ? "1 relato" : `${total} relatos`}
        {total > pageSize ? ` · mostrando ${de}–${ate}` : ""}
      </p>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Protocolo</th>
              <th>Categoria</th>
              <th>Gravidade</th>
              <th>Situação</th>
              <th>Primeira providência</th>
              <th>Quem</th>
              <th>Estabelecimento</th>
              <th>Mensagens</th>
              <th>Recebido em</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              /* O detalhe volta para esta lista com o mesmo filtro. [C1-6] */
              const open = () => navigate(`/comite/${r.id}`, { state: { voltar: `/comite${query ? `?${query}` : ""}` } });
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
                    {/* A lista não mostrava uma linha sequer do relato: com
                        duas denúncias parecidas, o comitê respondeu na
                        errada e a pergunta foi parar com outra pessoa.
                        [B2-3-D] [CB-35] */}
                    <div className="ethics-excerpt">
                      {r.description.length > 110
                        ? `${r.description.slice(0, 110)}…`
                        : r.description}
                    </div>
                  </td>
                  <td>{REPORT_CATEGORY_LABEL[r.category] ?? r.category}</td>
                  <td>
                    <Chip tone={r.severity === "HIGH" ? "danger" : "neutral"}>
                      {REPORT_SEVERITY_LABEL[r.severity] ?? r.severity}
                    </Chip>
                    {/* O comitê mudou a gravidade da categoria. [C1-1] */}
                    {r.severitySource === "COMMITTEE" && (
                      <div className="muted ethics-excerpt">ajustada pelo comitê</div>
                    )}
                  </td>
                  <td>
                    <Chip tone={statusTone(r.status)}>{REPORT_STATUS_LABEL[r.status] ?? r.status}</Chip>
                    {/* Quem tria vê o caso que ainda não foi ao comitê. [B3-3-H] */}
                    {r.committeeInvolved && !r.triagedAt && (
                      <Chip tone="danger" className="ethics-unread">
                        Esperando triagem
                      </Chip>
                    )}
                    {/* Ciência de quem denunciou no encerramento. [C1-5] */}
                    {r.reporterAckAt && (
                      <div className="muted ethics-excerpt">ciência em {formatDay(r.reporterAckAt)}</div>
                    )}
                  </td>
                  {/* Prazo da primeira providência: 1 dia útil (Alta) ou
                      3 (Normal), contado do recebimento. [C1-2] */}
                  <td>
                    <Chip tone={deadlineTone(r.deadline_situation)}>
                      {DEADLINE_SITUATION_LABEL[r.deadline_situation] ?? r.deadline_situation}
                    </Chip>
                    <div className="muted ethics-excerpt">vence {formatInstant(r.dueAt)}</div>
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
                    {/* Quem ainda não ouviu nada do comitê fica à vista. */}
                    {r.committee_messages === 0 && (
                      <Chip tone="danger" className="ethics-unread">
                        Sem resposta
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
      {ultima > 1 && (
        <nav className="ethics-pages" aria-label="Páginas">
          <Button type="button" variant="ghost" disabled={page <= 1} onClick={() => irPara(page - 1)}>
            ← Anterior
          </Button>
          <span className="muted">
            Página {page} de {ultima}
          </span>
          <Button type="button" variant="ghost" disabled={page >= ultima} onClick={() => irPara(page + 1)}>
            Próxima →
          </Button>
        </nav>
      )}
    </ListShell>
  );
}

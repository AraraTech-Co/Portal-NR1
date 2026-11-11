import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  TIPOS_DO_HISTORICO,
  TIPO_DO_HISTORICO_LABEL,
  classificarHistorico,
  fetchHistoricoSemUnidade,
  type HistoricoSemUnidade,
  type TipoDoHistorico,
} from "@/api/historico";
import { Button } from "@/components/Button";
import { ListShell } from "@/components/ListShell";

/** A escolha de cada linha: marcada para gravar, e com qual unidade. */
type Escolha = { marcado: boolean; unidade: string };

/**
 * Histórico sem unidade: os registros individuais de antes da unidade
 * gravada, com a unidade proposta pela ficha atual da pessoa. O RH confere,
 * corrige o que precisar e grava as linhas marcadas. Até lá, só Master, Dono
 * e RH veem esses registros. [C3-7]
 */
export function HistoricoSemUnidadePage() {
  const [tipo, setTipo] = useState<TipoDoHistorico>("holerite");
  const [offset, setOffset] = useState(0);
  const [dados, setDados] = useState<HistoricoSemUnidade | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [escolhas, setEscolhas] = useState<Record<string, Escolha>>({});
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [acaoErro, setAcaoErro] = useState<string | null>(null);
  /** Na primeira carga, abre no primeiro tipo que tem pendência. */
  const primeira = useRef(true);
  /** Só a resposta do último pedido vale: trocar de tipo depressa não mistura listas. */
  const pedido = useRef(0);

  const carregar = useCallback((t: TipoDoHistorico, o: number) => {
    const meu = ++pedido.current;
    setError(null);
    fetchHistoricoSemUnidade(t, o)
      .then((d) => {
        if (meu !== pedido.current) return;
        if (primeira.current) {
          primeira.current = false;
          const comPendencia = TIPOS_DO_HISTORICO.find((x) => d.totais[x] > 0);
          if (d.totais[t] === 0 && comPendencia) {
            setTipo(comPendencia);
            return;
          }
        }
        setDados(d);
        setEscolhas(
          Object.fromEntries(
            d.itens.map((i) => [
              i.id,
              { marcado: Boolean(i.proposta), unidade: i.proposta?.id ?? "" },
            ]),
          ),
        );
      })
      .catch((err) => {
        if (meu === pedido.current)
          setError(err instanceof Error ? err.message : "Falha ao carregar");
      });
  }, []);

  useEffect(() => carregar(tipo, offset), [carregar, tipo, offset]);

  const marcados = useMemo(
    () => (dados?.itens ?? []).filter((i) => escolhas[i.id]?.marcado && escolhas[i.id]?.unidade),
    [dados, escolhas],
  );

  function escolher(id: string, mudanca: Partial<Escolha>) {
    setEscolhas((atual) => ({ ...atual, [id]: { ...atual[id], ...mudanca } }));
  }

  function marcarTodos(marcar: boolean) {
    setEscolhas((atual) =>
      Object.fromEntries(
        Object.entries(atual).map(([id, e]) => [
          id,
          { ...e, marcado: marcar && Boolean(e.unidade) },
        ]),
      ),
    );
  }

  async function gravar() {
    if (!marcados.length) return;
    setBusy(true);
    setAviso(null);
    setAcaoErro(null);
    try {
      const r = await classificarHistorico(
        tipo,
        marcados.map((i) => ({ id: i.id, establishment_id: escolhas[i.id].unidade })),
      );
      setAviso(
        (r.classificados === 1
          ? "1 registro classificado."
          : `${r.classificados} registros classificados.`) +
          (r.ignorados.length === 1
            ? " 1 já tinha unidade, gravada por outra pessoa, e não mudou."
            : r.ignorados.length > 1
              ? ` ${r.ignorados.length} já tinham unidade, gravada por outra pessoa, e não mudaram.`
              : ""),
      );
      carregar(tipo, offset);
    } catch (err) {
      setAcaoErro(err instanceof Error ? err.message : "Falha ao classificar");
    } finally {
      setBusy(false);
    }
  }

  const total = dados ? dados.totais[tipo] : 0;
  const itens = dados?.itens ?? [];

  return (
    <ListShell
      title="Histórico sem unidade"
      description="Registros de antes da unidade gravada. Até serem classificados, só Master, Dono e RH os veem. A unidade proposta é a da ficha atual da pessoa: confira antes de gravar, porque quem mudou de loja leva a proposta da loja nova."
      loading={!dados && !error}
      error={error}
      empty={dados !== null && itens.length === 0}
      emptyTitle="Nada a classificar"
      emptyDescription="Todos os registros deste tipo já têm unidade."
      before={
        dados && (
          <>
            <div className="filter-bar">
              <select
                aria-label="Tipo de registro"
                value={tipo}
                onChange={(e) => {
                  setTipo(e.target.value as TipoDoHistorico);
                  setOffset(0);
                  setAviso(null);
                  setAcaoErro(null);
                }}
              >
                {TIPOS_DO_HISTORICO.map((t) => (
                  <option key={t} value={t}>
                    {TIPO_DO_HISTORICO_LABEL[t]} ({dados.totais[t]})
                  </option>
                ))}
              </select>
              {itens.length > 0 && (
                <>
                  <Button type="button" variant="ghost" onClick={() => marcarTodos(true)}>
                    Marcar todos com unidade
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => marcarTodos(false)}>
                    Desmarcar todos
                  </Button>
                </>
              )}
            </div>
            {/* Fora da lista: depois de gravar o último, a lista vazia some, e o aviso fica. */}
            {aviso && (
              <p className="muted" role="status">
                {aviso}
              </p>
            )}
            {acaoErro && (
              <p className="form-error" role="alert">
                {acaoErro}
              </p>
            )}
          </>
        )
      }
    >
      <p className="filter-meta muted">
        {total === 1 ? "1 registro sem unidade" : `${total} registros sem unidade`}
        {total > itens.length && ` · mostrando ${offset + 1} a ${offset + itens.length}`}
      </p>
      <div className="data-table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>
                <span className="sr-only">Gravar</span>
              </th>
              <th>Pessoa</th>
              <th>Registro</th>
              <th>Unidade</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => {
              const e = escolhas[i.id] ?? { marcado: false, unidade: "" };
              const corrigida = Boolean(e.unidade) && e.unidade !== (i.proposta?.id ?? "");
              return (
                <tr key={i.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Gravar ${i.descricao} de ${i.pessoa.nome}`}
                      checked={e.marcado}
                      disabled={!e.unidade}
                      onChange={(ev) => escolher(i.id, { marcado: ev.target.checked })}
                    />
                  </td>
                  <td>
                    <strong>{i.pessoa.nome}</strong>
                  </td>
                  <td>{i.descricao}</td>
                  <td>
                    <select
                      aria-label={`Unidade de ${i.descricao} de ${i.pessoa.nome}`}
                      value={e.unidade}
                      onChange={(ev) =>
                        escolher(i.id, {
                          unidade: ev.target.value,
                          marcado: Boolean(ev.target.value),
                        })
                      }
                    >
                      <option value="">Escolher…</option>
                      {dados?.unidades.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                    <div className="muted ethics-excerpt">
                      {i.proposta
                        ? corrigida
                          ? `Corrigida (a ficha diz ${i.proposta.name})`
                          : "Proposta pela ficha"
                        : "Sem proposta: a pessoa está sem ficha ativa ou sem filial"}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="form-actions" style={{ marginTop: "1rem" }}>
        <Button type="button" disabled={busy || marcados.length === 0} onClick={gravar}>
          {busy
            ? "Gravando…"
            : marcados.length === 1
              ? "Gravar a unidade de 1 registro"
              : `Gravar a unidade de ${marcados.length} registros`}
        </Button>
        {dados && offset > 0 && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOffset(Math.max(0, offset - dados.por_pagina))}
          >
            Anteriores
          </Button>
        )}
        {dados && offset + itens.length < total && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOffset(offset + dados.por_pagina)}
          >
            Próximos
          </Button>
        )}
      </div>
    </ListShell>
  );
}

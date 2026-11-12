import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  criarFeriado,
  excluirFeriado,
  fetchFeriados,
  mudarFeriadosDaFilial,
  type Feriado,
  type FilialDosFeriados,
} from "@/api/feriados";
import { Button } from "@/components/Button";
import { formatDay } from "@/lib/labels";

/**
 * Feriados da empresa e de cada filial no prazo da primeira providência da
 * denúncia. Os nacionais já contam e não aparecem aqui. Cadastrar não muda
 * o prazo de denúncia já aberta. [C4-11]
 */
export function FeriadosDoPrazo() {
  const [feriados, setFeriados] = useState<Feriado[] | null>(null);
  const [filiais, setFiliais] = useState<FilialDosFeriados[]>([]);
  const [data, setData] = useState("");
  const [nome, setNome] = useState("");
  const [repete, setRepete] = useState(false);
  const [onde, setOnde] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetchFeriados();
    setFeriados(r.feriados);
    setFiliais(r.filiais);
  }, []);

  useEffect(() => {
    carregar().catch((e) => setErro(e instanceof Error ? e.message : "Falha ao carregar os feriados"));
  }, [carregar]);

  async function incluir(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErro(null);
    try {
      await criarFeriado({ date: data, name: nome.trim(), recurring: repete, establishment_id: onde || null });
      setData("");
      setNome("");
      setRepete(false);
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao incluir o feriado");
    } finally {
      setBusy(false);
    }
  }

  async function agir(fn: () => Promise<unknown>) {
    setBusy(true);
    setErro(null);
    try {
      await fn();
      await carregar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  const nomeDaFilial = (id: string | null) => (id ? filiais.find((f) => f.id === id)?.name ?? "Filial" : "Toda a empresa");

  return (
    <section className="form-section">
      <h2>Feriados do prazo da denúncia</h2>
      <p className="muted">
        O prazo da primeira providência conta dias úteis. Os feriados nacionais já contam. Inclua aqui os da
        empresa e os de cada filial (estaduais e municipais). Denúncia já aberta não muda de prazo.
      </p>

      {erro && (
        <p className="form-error" role="alert">
          {erro}
        </p>
      )}

      <form className="form-grid cols-2" onSubmit={incluir}>
        <label className="form-field">
          Data
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} required />
        </label>
        <label className="form-field">
          Nome
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Aniversário da cidade" required />
        </label>
        <label className="form-field">
          Onde vale
          <select value={onde} onChange={(e) => setOnde(e.target.value)}>
            <option value="">Toda a empresa</option>
            {filiais.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>
            <input type="checkbox" checked={repete} onChange={(e) => setRepete(e.target.checked)} /> Repete todo ano
          </span>
        </label>
        <div className="form-actions">
          <Button type="submit" disabled={busy}>
            {busy ? "Salvando…" : "Incluir feriado"}
          </Button>
        </div>
      </form>

      {feriados && feriados.length > 0 && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Data</th>
                <th>Feriado</th>
                <th>Onde vale</th>
                <th>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {feriados.map((f) => (
                <tr key={f.id}>
                  <td>{f.recurring ? `${formatDay(f.date).slice(0, 5)}, todo ano` : formatDay(f.date)}</td>
                  <td>{f.name}</td>
                  <td>{nomeDaFilial(f.establishment_id)}</td>
                  <td>
                    <Button
                      type="button"
                      size="compact"
                      variant="ghost"
                      disabled={busy}
                      aria-label={`Excluir o feriado ${f.name}`}
                      onClick={() => void agir(() => excluirFeriado(f.id))}
                    >
                      Excluir
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {feriados && feriados.length === 0 && <p className="muted">Nenhum feriado da empresa ou das filiais cadastrado.</p>}

      {filiais.length > 0 && (
        <>
          <h3>Sexta-feira Santa e Corpus Christi, por filial</h3>
          <p className="muted">
            Dependem de lei municipal. A Sexta-feira Santa começa ligada, e o Corpus Christi, desligado.
          </p>
          <ul className="people-list">
            {filiais.map((f) => (
              <li key={f.id}>
                <strong>{f.name}</strong>{" "}
                <label>
                  <input
                    type="checkbox"
                    checked={f.good_friday}
                    disabled={busy}
                    onChange={(e) => void agir(() => mudarFeriadosDaFilial(f.id, { good_friday: e.target.checked }))}
                  />{" "}
                  Sexta-feira Santa é feriado aqui
                </label>{" "}
                <label>
                  <input
                    type="checkbox"
                    checked={f.corpus_christi}
                    disabled={busy}
                    onChange={(e) => void agir(() => mudarFeriadosDaFilial(f.id, { corpus_christi: e.target.checked }))}
                  />{" "}
                  Corpus Christi é feriado aqui
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

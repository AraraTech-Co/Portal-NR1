import { useEffect, useState } from "react";
import { fetchEstablishments, type Establishment } from "@/api/operation";
import { fetchManagedUnits, saveManagedUnits, type ManagedUnit } from "@/api/managed-units";
import { Button } from "@/components/Button";
import "@/components/form.css";

/** Papéis que recebem unidades sob responsabilidade. [C2-13] */
export const PAPEIS_COM_UNIDADE = ["GERENTE", "SUPERVISOR", "ADM_LOJA", "ADMIN"];

/**
 * Unidades pelas quais um gerente, supervisor ou ADM loja responde. Ele vê e
 * age sobre registros de terceiros só nelas; sem nenhuma, só os seus.
 * Atribuição expressa, feita aqui por Master, Dono ou RH. [C2-13]
 */
export function UnidadesSobResponsabilidade({ userId, name }: { userId: string; name: string }) {
  const [aberto, setAberto] = useState(false);
  const [atuais, setAtuais] = useState<ManagedUnit[] | null>(null);
  const [todas, setTodas] = useState<Establishment[]>([]);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto || atuais !== null) return;
    Promise.all([fetchManagedUnits(userId), fetchEstablishments()])
      .then(([vinculo, unidades]) => {
        setAtuais(vinculo.units);
        setMarcadas(vinculo.units.filter((u) => !u.archived).map((u) => u.id));
        setTodas(unidades.establishments.filter((u) => !u.archivedAt));
      })
      .catch((err) => setErro(err instanceof Error ? err.message : "Falha ao carregar as unidades"));
  }, [aberto, atuais, userId]);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    setAviso(null);
    try {
      const r = await saveManagedUnits(userId, marcadas);
      setAtuais(r.units);
      setAviso("Unidades salvas. Vale na próxima tela que a pessoa abrir.");
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao salvar as unidades");
    } finally {
      setSalvando(false);
    }
  }

  const resumo =
    atuais === null
      ? ""
      : atuais.length === 0
        ? " — nenhuma"
        : ` — ${atuais.map((u) => u.name).join(", ")}`;

  return (
    <details className="people-units" onToggle={(e) => setAberto((e.target as HTMLDetailsElement).open)}>
      <summary>
        Unidades sob responsabilidade{resumo}
      </summary>
      <p className="muted">
        {name} vê e cuida dos registros das pessoas destas unidades, dentro do que o papel já permite.
        Sem nenhuma marcada, vê só os próprios.
      </p>
      {atuais === null && !erro && <p className="muted">Carregando…</p>}
      {atuais !== null && (
        <fieldset className="form-grid">
          <legend className="sr-only">Unidades</legend>
          {todas.length === 0 && <p className="muted">Nenhuma unidade cadastrada.</p>}
          {todas.map((u) => (
            <label key={u.id} className="people-unit-check">
              <input
                type="checkbox"
                checked={marcadas.includes(u.id)}
                onChange={(e) =>
                  setMarcadas((m) => (e.target.checked ? [...m, u.id] : m.filter((x) => x !== u.id)))
                }
              />
              {u.name}
            </label>
          ))}
          <div className="form-actions">
            <Button type="button" size="compact" disabled={salvando} onClick={() => void salvar()}>
              {salvando ? "Salvando…" : "Salvar unidades"}
            </Button>
          </div>
        </fieldset>
      )}
      {aviso && (
        <p className="muted" role="status">
          {aviso}
        </p>
      )}
      {erro && (
        <p className="form-error" role="alert">
          {erro}
        </p>
      )}
    </details>
  );
}

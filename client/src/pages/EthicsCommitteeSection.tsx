import { useCallback, useEffect, useState } from "react";
import {
  fetchEthicsCommittee,
  setEthicsCommitteeMember,
  type CommitteeMember,
} from "@/api/ethics";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { formatDay } from "@/lib/labels";
import "@/components/form.css";

type Pessoa = { id: string; name: string; active: boolean };

/**
 * Quem é o comitê de ética desta empresa.
 *
 * Antes, quem via as denúncias era qualquer pessoa com acesso ao módulo —
 * cargo, não designação. A empresa precisa dizer quem é o comitê, e quem não
 * está nele não lê os relatos. [CB-27]
 */
export function EthicsCommitteeSection() {
  const [members, setMembers] = useState<CommitteeMember[]>([]);
  const [people, setPeople] = useState<Pessoa[]>([]);
  const [fallingBack, setFallingBack] = useState(false);
  const [escolhido, setEscolhido] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);

  const reload = useCallback(async () => {
    const data = await fetchEthicsCommittee();
    setMembers(data.members);
    setPeople(data.people);
    setFallingBack(data.falling_back);
  }, []);

  useEffect(() => {
    reload()
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Falha ao carregar"),
      )
      .finally(() => setCarregando(false));
  }, [reload]);

  async function alterar(userId: string, member: boolean) {
    setBusy(userId);
    setError(null);
    try {
      await setEthicsCommitteeMember(userId, member);
      setEscolhido("");
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setBusy(null);
    }
  }

  const noComite = new Set(members.map((m) => m.userId));
  const disponiveis = people.filter((p) => p.active && !noComite.has(p.id));

  return (
    <section className="form-section">
      <h2>Comitê de ética</h2>
      <p className="muted" style={{ maxWidth: "70ch" }}>
        Só quem está nesta lista abre as denúncias e responde a quem denunciou.
        Quem a denúncia envolve sai daquele caso, mesmo sendo do comitê.
      </p>

      {carregando && <p className="muted">Carregando…</p>}

      {!carregando && fallingBack && (
        <p className="muted" style={{ maxWidth: "70ch" }}>
          <strong>Ninguém designado ainda.</strong> Por enquanto, as denúncias
          ficam visíveis a quem tem acesso ao módulo Comitê — como era antes.
          Ao designar a primeira pessoa, passa a valer a lista.
        </p>
      )}

      {members.length > 0 && (
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: "1rem 0",
            display: "grid",
            gap: "0.5rem",
          }}
        >
          {members.map((m) => (
            <li
              key={m.userId}
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "0.5rem",
              }}
            >
              <span>
                <strong>{m.user.name}</strong>{" "}
                <span className="muted">
                  desde {formatDay(m.addedAt)}
                  {m.addedBy ? ` · por ${m.addedBy.name}` : ""}
                </span>
              </span>
              <Button
                type="button"
                variant="ghost"
                disabled={busy === m.userId}
                onClick={() => alterar(m.userId, false)}
              >
                {busy === m.userId ? "Salvando…" : "Tirar do comitê"}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="form-grid">
        <label className="form-field">
          Designar alguém
          <select
            value={escolhido}
            onChange={(e) => setEscolhido(e.target.value)}
          >
            <option value="">Escolha a pessoa</option>
            {disponiveis.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <div className="form-actions">
          <Button
            type="button"
            disabled={!escolhido || busy !== null}
            onClick={() => alterar(escolhido, true)}
          >
            Designar
          </Button>
        </div>
      </div>
      {disponiveis.length === 0 && !carregando && (
        <p className="muted">
          <Chip>Todos já estão no comitê</Chip>
        </p>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

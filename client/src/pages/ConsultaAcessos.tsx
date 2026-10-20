import { useCallback, useEffect, useState } from "react";
import { request } from "@/api/client";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";

type Acesso = {
  id: string;
  kind: "entrada" | "tela";
  screen: string;
  /** O registro aberto, quando a tela abre um. */
  record: string | null;
  path: string;
  at: string;
  until: string;
  /** Quantas vezes seguidas a mesma tela foi aberta. */
  times: number;
  user: { id: string; name: string } | null;
};

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

function formatTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDia(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR");
}

/**
 * O que o fiscal (acesso só de consulta) abriu no portal.
 *
 * Era uma linha por requisição — 147 numa sessão, com o endereço interno
 * embaixo e o Painel da fiscalização aparecendo como "Outra consulta".
 * Agora é uma linha por tela, com o nome do registro aberto, a entrada no
 * portal, e escolha de dia e de fiscal. [B2-4-H]
 *
 * Fica com quem dá o acesso: Conta e usuários. [S7-A]
 */
export function ConsultaAcessos() {
  const [rows, setRows] = useState<Acesso[] | null>(null);
  const [dias, setDias] = useState<string[]>([]);
  const [dia, setDia] = useState<string>("");
  const [quem, setQuem] = useState<string>("");
  const [tudo, setTudo] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (dia) params.set("day", dia);
    if (quem) params.set("user_id", quem);
    if (tudo) params.set("tudo", "true");
    const qs = params.toString();
    setRows(null);
    request<{ acessos: Acesso[]; day: string | null; days: string[] }>(
      `/api/consulta-acessos${qs ? `?${qs}` : ""}`,
    )
      .then((data) => {
        if (cancelled) return;
        setRows(data.acessos);
        setDias(data.days);
        if (!dia && data.day) setDia(data.day);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Falha ao carregar");
      });
    return () => {
      cancelled = true;
    };
  }, [dia, quem, tudo]);

  /** Os fiscais que aparecem no dia escolhido, para filtrar por pessoa. */
  const pessoas = [
    ...new Map(
      (rows ?? [])
        .filter((r) => r.user)
        .map((r) => [r.user!.id, r.user!] as const),
    ).values(),
  ];

  return (
    <section className="form-section">
      <h2>O que o fiscal consultou</h2>
      <p className="muted">
        Quem tem acesso de fiscal só lê, e cada tela que abre fica registrada
        aqui — uma linha por tela, na ordem em que foram abertas.
      </p>

      <div className="form-grid cols-2">
        <label className="form-field">
          Dia
          <select value={dia} onChange={(e) => setDia(e.target.value)}>
            {dias.length === 0 && <option value="">Sem consultas</option>}
            {dias.map((d) => (
              <option key={d} value={d}>
                {formatDia(d)}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          Fiscal
          <select value={quem} onChange={(e) => setQuem(e.target.value)}>
            <option value="">Todos</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="muted" style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        <input
          type="checkbox"
          checked={tudo}
          onChange={(e) => setTudo(e.target.checked)}
        />
        Mostrar também as consultas que a tela faz sozinha
      </label>

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!error && rows === null && <p className="muted">Carregando…</p>}
      {rows && rows.length === 0 && (
        <p className="muted">Nenhuma consulta registrada neste dia.</p>
      )}
      {rows && rows.length > 0 && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>O que abriu</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="muted">
                    {formatDateTime(r.at)}
                    {r.times > 1 && (
                      <div style={{ fontSize: "0.78rem" }}>
                        até {formatTime(r.until)} · {r.times} vezes
                      </div>
                    )}
                  </td>
                  <td>{r.user?.name ?? "—"}</td>
                  <td>
                    {r.kind === "entrada" ? (
                      <Chip tone="info">Entrou no portal</Chip>
                    ) : (
                      <>
                        {r.screen}
                        {r.record && (
                          <div className="muted" style={{ fontSize: "0.85rem" }}>
                            {r.record}
                          </div>
                        )}
                        {/*
                          O endereço interno só no modo que mostra tudo: ali
                          é o que distingue uma consulta de apoio da outra.
                          [B2-4-H]
                        */}
                        {tudo && (
                          <div
                            className="muted"
                            style={{ fontSize: "0.78rem", wordBreak: "break-all" }}
                          >
                            {r.path}
                          </div>
                        )}
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type Fiscal = {
  id: string;
  user: { id: string; name: string; email: string | null };
  access_expires_at: string | null;
  active: boolean;
};

function todayIso(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
}

function isoDay(value: string | null): string {
  if (!value) return "";
  return new Date(new Date(value).getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

function formatDayOf(value: string | null): string {
  if (!value) return "sem prazo";
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/**
 * Quem tem acesso de fiscal e até quando. O acesso cai sozinho no fim do
 * dia marcado; aqui se renova ou se encerra na hora. [S7-A]
 */
export function FiscaisComAcesso() {
  const [rows, setRows] = useState<Fiscal[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const data = await request<{ fiscais: Fiscal[] }>("/api/fiscais");
    setRows(data.fiscais);
  }, []);

  useEffect(() => {
    reload().catch((err) => setError(err instanceof Error ? err.message : "Falha ao carregar"));
  }, [reload]);

  async function change(id: string, body: { access_until?: string; end_now?: boolean }) {
    setBusy(id);
    setError(null);
    try {
      await request(`/api/fiscais/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="form-section">
      <h2>Fiscais com acesso</h2>
      <p className="muted">
        O fiscal só consulta e perde o acesso sozinho no fim do dia marcado. Para dar o
        acesso, aprove o pedido de entrada com o papel “Fiscal (só consulta)”.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!error && rows === null && <p className="muted">Carregando…</p>}
      {rows && rows.length === 0 && <p className="muted">Nenhum fiscal cadastrado.</p>}
      {rows && rows.length > 0 && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fiscal</th>
                <th>Situação</th>
                <th>Acesso até</th>
                <th aria-label="Ações" />
              </tr>
            </thead>
            <tbody>
              {rows.map((f) => {
                const value = dates[f.id] ?? isoDay(f.access_expires_at);
                return (
                  <tr key={f.id}>
                    <td>
                      <strong>{f.user.name}</strong>
                      {f.user.email && <div className="muted">{f.user.email}</div>}
                    </td>
                    <td>
                      {f.active ? (
                        <Chip tone="success">Com acesso</Chip>
                      ) : (
                        <Chip tone="neutral">Encerrado</Chip>
                      )}
                      <div className="muted" style={{ marginTop: "0.2rem" }}>
                        {f.active ? "até" : "em"} {formatDayOf(f.access_expires_at)}
                      </div>
                    </td>
                    <td>
                      <input
                        type="date"
                        aria-label={`Novo fim do acesso de ${f.user.name}`}
                        min={todayIso()}
                        value={value}
                        onChange={(e) => setDates((prev) => ({ ...prev, [f.id]: e.target.value }))}
                      />
                    </td>
                    <td>
                      <div className="form-actions">
                        <Button
                          type="button"
                          variant="secondary"
                          disabled={busy === f.id || !value || value === isoDay(f.access_expires_at)}
                          onClick={() => void change(f.id, { access_until: value })}
                        >
                          {f.active ? "Mudar prazo" : "Renovar"}
                        </Button>
                        {f.active && (
                          <Button
                            type="button"
                            variant="ghost"
                            disabled={busy === f.id}
                            onClick={() => void change(f.id, { end_now: true })}
                          >
                            Encerrar agora
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

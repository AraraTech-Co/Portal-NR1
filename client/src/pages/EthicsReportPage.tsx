import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  createEthicsReport,
  fetchEthicsMeta,
  trackEthicsReport,
} from "@/api/ethics";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { REPORT_CATEGORY_LABEL } from "@/lib/labels";
import "@/components/form.css";

type Mode = "new" | "track";

export function EthicsReportPage() {
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>("new");
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    protocol: string;
    access_code: string;
  } | null>(null);

  const [trackProtocol, setTrackProtocol] = useState("");
  const [trackCode, setTrackCode] = useState("");
  const [tracked, setTracked] = useState<{
    protocol: string;
    status: string;
    category: string;
    description: string;
    isAnonymous: boolean;
    messages: Array<{ id: string; side: string; body: string; createdAt: string }>;
  } | null>(null);

  useEffect(() => {
    fetchEthicsMeta()
      .then((meta) => {
        const ids = meta.categories.map((c) => c.id);
        setCategories(ids);
        if (ids[0]) setCategory(ids[0]);
      })
      .catch(() => setCategories(Object.keys(REPORT_CATEGORY_LABEL)));
  }, []);

  async function onSubmitNew(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (!isAnonymous) {
      const ok = window.confirm(
        `Atenção: a denúncia será vinculada ao seu nome (${user?.name ?? "seu usuário"}).\n\n` +
          "O comitê de ética poderá identificar você como autor deste relato.\n\n" +
          "Deseja continuar com a denúncia identificada?",
      );
      if (!ok) return;
    }

    setSaving(true);
    try {
      const data = await createEthicsReport({
        category,
        description,
        is_anonymous: isAnonymous,
      });
      setResult({
        protocol: data.report.protocol,
        access_code: data.access_code,
      });
      setDescription("");
      setIsAnonymous(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao enviar");
    } finally {
      setSaving(false);
    }
  }

  async function onTrack(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);
    setTracked(null);
    try {
      const data = await trackEthicsReport({
        protocol: trackProtocol,
        access_code: trackCode,
      });
      setTracked(data.report);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não encontrado");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Fazer denúncia"
        description="Canal confidencial. Por padrão o relato é anônimo."
        actions={
          <div className="form-actions">
            <Button
              variant={mode === "new" ? "primary" : "secondary"}
              onClick={() => {
                setMode("new");
                setError(null);
              }}
            >
              Nova denúncia
            </Button>
            <Button
              variant={mode === "track" ? "primary" : "secondary"}
              onClick={() => {
                setMode("track");
                setError(null);
              }}
            >
              Acompanhar
            </Button>
          </div>
        }
      />

      {mode === "new" && result && (
        <section className="form-section" role="status">
          <h2>Denúncia registrada</h2>
          <p className="muted">
            Guarde o protocolo e o código — o código não será mostrado de novo.
          </p>
          <p>
            <strong>Protocolo:</strong> {result.protocol}
          </p>
          <p>
            <strong>Código de acesso:</strong> {result.access_code}
          </p>
          <div className="form-actions">
            <Button
              type="button"
              onClick={() => {
                setResult(null);
                setMode("track");
                setTrackProtocol(result.protocol);
              }}
            >
              Acompanhar este protocolo
            </Button>
            <Button type="button" variant="secondary" onClick={() => setResult(null)}>
              Nova denúncia
            </Button>
          </div>
        </section>
      )}

      {mode === "new" && !result && (
        <section className="form-section">
          <h2>Novo relato</h2>
          <p className="muted">
            Descreva o fato com o máximo de detalhes possível. Você pode optar
            por se identificar ou permanecer anônimo.
          </p>
          <form className="form-grid" onSubmit={onSubmitNew}>
            <label className="form-field">
              Categoria
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                required
              >
                {categories.map((id) => (
                  <option key={id} value={id}>
                    {REPORT_CATEGORY_LABEL[id] ?? id}
                  </option>
                ))}
              </select>
            </label>
            <label className="form-field">
              Descrição
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                minLength={20}
                placeholder="O que aconteceu, quando, onde e quem estava envolvido…"
              />
            </label>
            <label className="form-field" style={{ flexDirection: "row", alignItems: "center", gap: "0.55rem" }}>
              <input
                type="checkbox"
                checked={isAnonymous}
                onChange={(e) => setIsAnonymous(e.target.checked)}
              />
              <span>Enviar de forma anônima (recomendado)</span>
            </label>
            {!isAnonymous && (
              <p className="form-hint" role="note">
                Se desmarcar o anonimato, a denúncia será vinculada ao seu nome
                ({user?.name}). Uma confirmação será pedida antes do envio.
              </p>
            )}
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <Button type="submit" disabled={saving}>
                {saving ? "Enviando…" : "Enviar denúncia"}
              </Button>
              <Link to="/" className="muted">
                Voltar
              </Link>
            </div>
          </form>
        </section>
      )}

      {mode === "track" && (
        <section className="form-section">
          <h2>Acompanhar denúncia</h2>
          <p className="muted">
            Use o protocolo e o código de acesso gerados no envio.
          </p>
          <form className="form-grid cols-2" onSubmit={onTrack}>
            <label className="form-field">
              Protocolo
              <input
                value={trackProtocol}
                onChange={(e) => setTrackProtocol(e.target.value)}
                required
                placeholder="CX-1234"
              />
            </label>
            <label className="form-field">
              Código de acesso
              <input
                value={trackCode}
                onChange={(e) => setTrackCode(e.target.value)}
                required
                autoComplete="off"
              />
            </label>
            {error && <p className="form-error">{error}</p>}
            <div className="form-actions">
              <Button type="submit" disabled={saving}>
                {saving ? "Buscando…" : "Consultar"}
              </Button>
            </div>
          </form>

          {tracked && (
            <div style={{ marginTop: "1.25rem" }}>
              <p>
                <strong>{tracked.protocol}</strong> · {REPORT_CATEGORY_LABEL[tracked.category] ?? tracked.category} ·{" "}
                {tracked.status}
                {tracked.isAnonymous ? " · Anônimo" : " · Identificado"}
              </p>
              <p className="muted">{tracked.description}</p>
              {tracked.messages.length > 0 && (
                <ul>
                  {tracked.messages.map((m) => (
                    <li key={m.id}>
                      <strong>{m.side === "COMMITTEE" ? "Comitê" : "Relator"}:</strong>{" "}
                      {m.body}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

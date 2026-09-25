import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  createAnnouncement,
  fetchAnnouncements,
  type AnnouncementKind,
  type AnnouncementListItem,
} from "@/api/announcements";
import { useAuth } from "@/auth/AuthContext";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { EmptyState } from "@/components/EmptyState";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { ANNOUNCEMENT_KIND_LABEL, formatDay } from "@/lib/labels";
import "@/components/data-table.css";
import "@/components/form.css";

function canPublishAnnouncements(
  permission: string,
  role: string | undefined,
): boolean {
  return (
    permission === "master" ||
    permission === "owner" ||
    permission === "admin" ||
    permission === "rh" ||
    role === "RH"
  );
}

export function AnnouncementsPage() {
  const { user } = useAuth();
  const canPublish = canPublishAnnouncements(
    user?.permission ?? "user",
    user?.role,
  );
  const [rows, setRows] = useState<AnnouncementListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<AnnouncementKind>("NOTICE");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [happensAt, setHappensAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formOk, setFormOk] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const list = await fetchAnnouncements();
    setRows(list);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    reload()
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Falha ao carregar");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  async function onPublish(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setFormOk(null);
    setShareUrl(null);
    setPublishing(true);
    try {
      const created = await createAnnouncement({
        kind,
        title,
        body,
        happens_at: happensAt || null,
        expires_at: expiresAt || null,
      });
      const url = `${window.location.origin}/mural/${created.id}`;
      setShareUrl(url);
      setFormOk("Aviso publicado.");
      setTitle("");
      setBody("");
      setHappensAt("");
      setExpiresAt("");
      setKind("NOTICE");
      await reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Falha ao publicar");
    } finally {
      setPublishing(false);
    }
  }

  async function copyShareUrl() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setFormOk("Link de acesso copiado.");
    } catch {
      setFormOk(`Link: ${shareUrl}`);
    }
  }

  return (
    <div>
      <PageHeader
        title="Mural de avisos"
        description="Comunicados internos da organização. Abra o aviso para ler e confirmar a leitura."
      />

      {canPublish && (
        <section className="form-section">
          <h2>Publicar aviso</h2>
          <p className="muted">
            Após publicar, compartilhe o link de acesso com a equipe.
          </p>
          <form className="form-grid" onSubmit={onPublish}>
            <div className="form-grid cols-2">
              <label className="form-field">
                Tipo
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as AnnouncementKind)}
                >
                  {Object.entries(ANNOUNCEMENT_KIND_LABEL).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                Título
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  maxLength={200}
                />
              </label>
            </div>
            <label className="form-field">
              Conteúdo
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                required
                minLength={10}
                placeholder="Texto do aviso…"
              />
            </label>
            <div className="form-grid cols-2">
              <label className="form-field">
                Data do evento (opcional)
                <input
                  type="date"
                  value={happensAt}
                  onChange={(e) => setHappensAt(e.target.value)}
                />
              </label>
              <label className="form-field">
                Expira em (opcional)
                <input
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </label>
            </div>
            {formError && <p className="form-error">{formError}</p>}
            {formOk && <p className="muted">{formOk}</p>}
            {shareUrl && (
              <div className="form-actions">
                <code style={{ fontSize: "0.85rem", wordBreak: "break-all" }}>
                  {shareUrl}
                </code>
                <Button type="button" variant="secondary" onClick={copyShareUrl}>
                  Copiar link
                </Button>
                <Link to={shareUrl.replace(window.location.origin, "")}>
                  Abrir aviso
                </Link>
              </div>
            )}
            <div className="form-actions">
              <Button type="submit" disabled={publishing}>
                {publishing ? "Publicando…" : "Publicar"}
              </Button>
            </div>
          </form>
        </section>
      )}

      {loading && <LoadingState />}
      {!loading && error && (
        <p className="page-error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && rows.length === 0 && (
        <EmptyState
          title="Nenhum aviso"
          description="Avisos publicados pelo RH ou gestores aparecem aqui."
        />
      )}
      {!loading && !error && rows.length > 0 && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Tipo</th>
                <th>Publicado por</th>
                <th>Leituras</th>
                <th>Lido</th>
                <th>Publicado em</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/mural/${r.id}`}>
                      <strong>{r.title}</strong>
                    </Link>
                  </td>
                  <td>
                    <Chip>{ANNOUNCEMENT_KIND_LABEL[r.kind] ?? r.kind}</Chip>
                  </td>
                  <td>{r.publishedBy.name}</td>
                  <td>{r._count.reads}</td>
                  <td>
                    {r.read_at ? (
                      <Chip tone="success">Sim</Chip>
                    ) : (
                      <Chip tone="warning">Não</Chip>
                    )}
                  </td>
                  <td>{formatDay(r.createdAt)}</td>
                  <td>
                    <Link to={`/mural/${r.id}`}>Abrir</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

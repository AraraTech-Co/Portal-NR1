import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  fetchAnnouncement,
  markAnnouncementRead,
  type AnnouncementListItem,
} from "@/api/announcements";
import { Button } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { LoadingState } from "@/components/LoadingState";
import { PageHeader } from "@/components/PageHeader";
import { ANNOUNCEMENT_KIND_LABEL, formatDay } from "@/lib/labels";
import "@/components/form.css";

export function AnnouncementDetailPage() {
  const { id = "" } = useParams();
  const [item, setItem] = useState<AnnouncementListItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAnnouncement(id)
      .then(async (announcement) => {
        if (cancelled) return;
        setItem(announcement);
        if (!announcement.read_at) {
          try {
            await markAnnouncementRead(id);
            if (!cancelled) {
              setItem({
                ...announcement,
                read_at: new Date().toISOString(),
              });
            }
          } catch {
            /* leitura opcional — não bloqueia a visualização */
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Aviso não encontrado");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  async function copyLink() {
    const url = `${window.location.origin}/mural/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
      window.prompt("Copie o link de acesso:", url);
    }
  }

  async function confirmRead() {
    setMarking(true);
    try {
      await markAnnouncementRead(id);
      setItem((prev) =>
        prev ? { ...prev, read_at: new Date().toISOString() } : prev,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao confirmar leitura");
    } finally {
      setMarking(false);
    }
  }

  if (loading) return <LoadingState />;
  if (error || !item) {
    return (
      <div>
        <PageHeader title="Aviso" description={error ?? "Não encontrado."} />
        <p>
          <Link to="/mural">Voltar ao mural</Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={item.title}
        description={`${ANNOUNCEMENT_KIND_LABEL[item.kind] ?? item.kind} · ${item.publishedBy.name} · ${formatDay(item.createdAt)}`}
        actions={
          <div className="form-actions">
            <Button type="button" variant="secondary" onClick={copyLink}>
              {copied ? "Link copiado" : "Copiar link"}
            </Button>
            <Link to="/mural">Voltar</Link>
          </div>
        }
      />

      <section className="form-section">
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          <Chip>{ANNOUNCEMENT_KIND_LABEL[item.kind] ?? item.kind}</Chip>
          {item.read_at ? (
            <Chip tone="success">Lido</Chip>
          ) : (
            <Chip tone="warning">Não lido</Chip>
          )}
          {item.happensAt && (
            <Chip>Evento: {formatDay(item.happensAt)}</Chip>
          )}
          {item.expiresAt && (
            <Chip>Expira: {formatDay(item.expiresAt)}</Chip>
          )}
        </div>
        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.55 }}>{item.body}</div>
        <p className="muted" style={{ marginTop: "1rem" }}>
          Leituras confirmadas: {item._count.reads}
        </p>
        {!item.read_at && (
          <div className="form-actions" style={{ marginTop: "1rem" }}>
            <Button type="button" onClick={confirmRead} disabled={marking}>
              {marking ? "Confirmando…" : "Confirmar leitura"}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

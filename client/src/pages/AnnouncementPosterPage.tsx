import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { fetchAnnouncement } from "@/api/announcements";
import { Button } from "@/components/Button";
import { LoadingState } from "@/components/LoadingState";
import { MarkdownBody } from "@/components/MarkdownBody";
import { ANNOUNCEMENT_KIND_LABEL, formatDay } from "@/lib/labels";
import { useModuleAccess } from "@/lib/module-access";
import "./document-view.css";
import "./cartaz.css";

type Aviso = Awaited<ReturnType<typeof fetchAnnouncement>>;

/**
 * O aviso do mural impresso como cartaz A4, para o quadro da loja. Só para
 * quem publica avisos; o aviso retirado do mural não imprime. Texto longo
 * passa para outra página com o cabeçalho repetido. [C1-8]
 */
export function AnnouncementPosterPage() {
  const { id = "" } = useParams();
  const { canWrite: podePublicar } = useModuleAccess("mural");
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAnnouncement(id)
      .then(setAviso)
      .catch((err) => setError(err instanceof Error ? err.message : "Falha ao carregar"));
  }, [id]);

  const voltar = `/mural?open=${encodeURIComponent(id)}`;
  const recusa = !podePublicar
    ? "Imprimir o cartaz é de quem publica avisos no mural."
    : aviso?.withdrawnAt
      ? "Este aviso foi retirado do mural e não pode ser impresso."
      : error;

  if (recusa) {
    return (
      <div className="doc-view">
        <p className="page-error" role="alert">
          {recusa}
        </p>
        <Link to={voltar}>← Voltar ao mural</Link>
      </div>
    );
  }
  if (!aviso) return <LoadingState label="Montando o cartaz…" />;

  const unidades = aviso.establishments.length
    ? aviso.establishments.map((e) => e.name).join(", ")
    : "Todas as unidades";

  return (
    <div className="doc-view cartaz-print">
      <div className="doc-toolbar">
        <Link to={voltar} className="doc-back">
          ← Voltar ao mural
        </Link>
        <Button type="button" onClick={() => window.print()}>
          Imprimir cartaz
        </Button>
      </div>

      <table className="cartaz">
        <thead>
          <tr>
            <td>
              <div className="cartaz-head">
                <span>
                  <strong>{aviso.organization?.name ?? ""}</strong> · {unidades}
                </span>
                <span className="cartaz-kind">
                  {ANNOUNCEMENT_KIND_LABEL[aviso.kind] ?? aviso.kind}
                </span>
              </div>
            </td>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <h1 className="cartaz-title">{aviso.title}</h1>
              <div className="cartaz-body">
                <MarkdownBody>{aviso.body}</MarkdownBody>
              </div>
              {(aviso.happensAt || aviso.expiresAt) && (
                <p className="cartaz-dates">
                  {aviso.happensAt && <span>Data do evento: {formatDay(aviso.happensAt)}</span>}
                  {aviso.expiresAt && <span>Válido até: {formatDay(aviso.expiresAt)}</span>}
                </p>
              )}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr>
            <td>
              <div className="cartaz-foot">
                <span>
                  Publicado em {formatDay(aviso.createdAt)}
                  {aviso.editedAt ? ` · Atualizado em ${formatDay(aviso.editedAt)}` : ""}
                </span>
                <span>Este aviso também está no Portal NR-1, no Mural</span>
              </div>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

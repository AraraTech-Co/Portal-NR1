import { FormEvent, ReactNode, useState } from "react";
import { Button } from "@/components/Button";
import "@/components/form.css";

/**
 * A porta de entrada das telas que só listavam.
 *
 * Dez telas mostravam a lista e nenhum botão de criar, embora o servidor
 * sempre tenha aceitado o registro. O formulário fica recolhido até alguém
 * querer escrever — a lista continua sendo o que se vê primeiro. [OB-4]
 */
export function NewRecordSection({
  title,
  openLabel,
  description,
  submitLabel,
  canWrite,
  disabled,
  onSubmit,
  children,
}: {
  title: string;
  /** Texto do botão que abre o formulário. */
  openLabel: string;
  description?: string;
  submitLabel: string;
  canWrite: boolean;
  /** Verdadeiro enquanto os campos obrigatórios não estiverem preenchidos. */
  disabled?: boolean;
  /** Grava e devolve a mensagem que a tela mostra. */
  onSubmit: () => Promise<string>;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  if (!canWrite) return null;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      setOk(await onSubmit());
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao salvar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="form-section">
      <div className="form-actions">
        <Button
          type="button"
          variant={open ? "ghost" : "secondary"}
          onClick={() => {
            setOpen((v) => !v);
            setOk(null);
            setError(null);
          }}
        >
          {open ? "Fechar" : openLabel}
        </Button>
      </div>
      {ok && <p className="muted">{ok}</p>}
      {open && (
        <>
          <h2>{title}</h2>
          {description && (
            <p className="muted" style={{ maxWidth: "70ch" }}>
              {description}
            </p>
          )}
          <form className="form-grid" onSubmit={enviar}>
            {children}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <Button type="submit" disabled={busy || disabled}>
                {busy ? "Salvando…" : submitLabel}
              </Button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}

import { FormEvent, useRef, useState } from "react";
import { fileToBase64 } from "@/api/payslips";
import { Button } from "./Button";
import "./anexos.css";

export type PapelAnexado = {
  id: string;
  fileName: string | null;
  description: string | null;
  uploadedAt: string;
};

/**
 * Anexar o papel assinado a um registro, e listar o que já foi anexado.
 *
 * A Participação pedia a evidência na própria tela — "a lista de presença, a
 * foto, a ata se anexam depois, no registro" — e não havia onde; o simulado,
 * idem. Anexar é opcional: pela decisão B3-4-F, o registro do portal é a
 * prova e o papel é anexo. [B3-4-B] [S7-E] [B3-4-F]
 */
export function AnexarPapel({
  canWrite,
  label,
  hint,
  anexos,
  onSend,
  onOpen,
}: {
  canWrite: boolean;
  label: string;
  hint: string;
  anexos: PapelAnexado[];
  onSend: (input: {
    file_name: string;
    mime_type: string;
    content_base64: string;
    description?: string;
  }) => Promise<void>;
  onOpen: (anexo: PapelAnexado) => Promise<void>;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [descricao, setDescricao] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [abrindo, setAbrindo] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setEnviando(true);
    setErro(null);
    try {
      await onSend({
        file_name: file.name,
        mime_type: file.type || "application/pdf",
        content_base64: await fileToBase64(file),
        description: descricao.trim() || undefined,
      });
      setFile(null);
      setDescricao("");
      if (input.current) input.current.value = "";
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao anexar");
    } finally {
      setEnviando(false);
    }
  }

  async function abrir(anexo: PapelAnexado) {
    setAbrindo(anexo.id);
    setErro(null);
    try {
      await onOpen(anexo);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao abrir");
    } finally {
      setAbrindo(null);
    }
  }

  return (
    <div className="anexos">
      {/* O nome do papel vale para quem só consulta: o rótulo aparecia só
          no formulário de envio, e a fiscal via um botão com o nome do
          arquivo sem saber que era a ata. [B4-E] */}
      <p className="anexos-titulo">{label}</p>
      {anexos.length > 0 ? (
        <ul className="anexos-lista">
          {anexos.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className="anexos-abrir"
                disabled={abrindo !== null}
                onClick={() => abrir(a)}
              >
                {abrindo === a.id ? "Abrindo…" : (a.fileName ?? "arquivo")}
              </button>
              {a.description && <span className="muted"> · {a.description}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted anexos-vazio">Nenhum papel anexado.</p>
      )}

      {canWrite && (
        <form className="anexos-form" onSubmit={enviar}>
          <label className="form-field">
            Arquivo
            <input
              ref={input}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              disabled={enviando}
            />
            <span className="form-hint">{hint}</span>
          </label>
          <label className="form-field">
            O que o arquivo é (opcional)
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              placeholder="Ex.: ata assinada pelos participantes"
              disabled={enviando}
            />
          </label>
          <div className="form-actions">
            <Button type="submit" size="compact" disabled={!file || enviando}>
              {enviando ? "Anexando…" : "Anexar"}
            </Button>
          </div>
        </form>
      )}

      {erro && (
        <p className="form-error" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}

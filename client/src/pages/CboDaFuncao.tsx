import { useState } from "react";
import { Button } from "@/components/Button";

/**
 * O CBO do cargo, na lista de funções da Operação. Vem da planilha da folha
 * quando a função ainda não tem; o SST corrige aqui. [PF-2]
 */
export function CboDaFuncao({
  nome,
  cbo2002,
  cbo94,
  canEdit,
  onSave,
}: {
  nome: string;
  cbo2002: string | null | undefined;
  cbo94: string | null | undefined;
  canEdit: boolean;
  onSave: (cbo: { cbo_2002: string | null; cbo_94: string | null }) => Promise<void>;
}) {
  const [editando, setEditando] = useState(false);
  const [c2002, setC2002] = useState(cbo2002 ?? "");
  const [c94, setC94] = useState(cbo94 ?? "");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!editando) {
    if (!cbo2002 && !cbo94 && !canEdit) return null;
    return (
      <div className="op-job-cbo muted">
        {cbo2002 || cbo94 ? (
          <span>
            {cbo2002 ? `CBO 2002 ${cbo2002}` : ""}
            {cbo2002 && cbo94 ? " · " : ""}
            {cbo94 ? `CBO 94 ${cbo94}` : ""}
          </span>
        ) : (
          <span>Sem CBO</span>
        )}
        {canEdit && (
          <Button
            type="button"
            size="compact"
            variant="ghost"
            aria-label={`Editar o CBO de ${nome}`}
            onClick={() => {
              setC2002(cbo2002 ?? "");
              setC94(cbo94 ?? "");
              setErro(null);
              setEditando(true);
            }}
          >
            {cbo2002 || cbo94 ? "Editar CBO" : "Informar CBO"}
          </Button>
        )}
      </div>
    );
  }

  return (
    <form
      className="op-job-cbo-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErro(null);
        try {
          await onSave({ cbo_2002: c2002.trim() || null, cbo_94: c94.trim() || null });
          setEditando(false);
        } catch (err) {
          setErro(err instanceof Error ? err.message : "Falha ao salvar o CBO");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="form-field">
        CBO 2002
        <input value={c2002} onChange={(e) => setC2002(e.target.value)} placeholder="Ex.: 5211-25" />
      </label>
      <label className="form-field">
        CBO 94
        <input value={c94} onChange={(e) => setC94(e.target.value)} placeholder="Ex.: 0.11-05" />
      </label>
      {erro && (
        <p className="form-error" role="alert">
          {erro}
        </p>
      )}
      <div className="form-actions">
        <Button type="submit" size="compact" disabled={busy}>
          {busy ? "Salvando…" : "Salvar CBO"}
        </Button>
        <Button type="button" size="compact" variant="ghost" onClick={() => setEditando(false)}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}

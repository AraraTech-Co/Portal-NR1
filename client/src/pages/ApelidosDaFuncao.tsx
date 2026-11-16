import { useState } from "react";
import { Button } from "@/components/Button";

/**
 * Os cargos da folha juntados a esta função: a próxima planilha casa por
 * eles. Remover devolve o cargo a "Cargos sem função". [C6-4]
 */
export function ApelidosDaFuncao({
  funcao,
  apelidos,
  podeRemover,
  onRemover,
}: {
  funcao: string;
  apelidos: { id: string; grafia: string }[];
  podeRemover: boolean;
  onRemover: (aliasId: string) => Promise<void>;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [removendo, setRemovendo] = useState<string | null>(null);
  if (apelidos.length === 0) return null;

  async function remover(a: { id: string; grafia: string }) {
    if (
      !window.confirm(
        `Remover "${a.grafia}" de ${funcao}? Na próxima planilha, esse cargo volta a aparecer em Cargos sem função.`,
      )
    ) {
      return;
    }
    setRemovendo(a.id);
    setErro(null);
    try {
      await onRemover(a.id);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Falha ao remover");
    } finally {
      setRemovendo(null);
    }
  }

  return (
    <div className="op-aliases">
      <span className="muted">Também chamada na folha de:</span>
      <ul>
        {apelidos.map((a) => (
          <li key={a.id}>
            {a.grafia}
            {podeRemover && (
              <Button
                type="button"
                size="compact"
                variant="ghost"
                disabled={removendo !== null}
                aria-label={`Remover o apelido ${a.grafia}`}
                onClick={() => void remover(a)}
              >
                Remover
              </Button>
            )}
          </li>
        ))}
      </ul>
      {erro && (
        <p className="form-error" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}

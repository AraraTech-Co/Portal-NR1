import { useState } from "react";
import {
  CAMPO_DA_COPIA_LABEL,
  NIVEIS_DA_COPIA,
  NIVEL_DA_COPIA_LABEL,
  copiarEntreFiliais,
  previaDaCopia,
  type PreviaDaCopia,
  type ResultadoDaCopia,
} from "@/api/copia-entre-filiais";
import type { Establishment } from "@/api/operation";
import { Button } from "@/components/Button";
import { Dialog } from "@/components/Dialog";

function valor(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  return String(v);
}

function somar(r: ResultadoDaCopia, campo: "criados" | "atualizados"): number {
  return NIVEIS_DA_COPIA.reduce((t, n) => t + r.contagem[n][campo], 0);
}

/**
 * Copiar a estrutura de outra filial para esta: setores, funções,
 * atividades, perigos, riscos, medidas e avaliações. Primeiro a prévia, que
 * diz o que será criado e atualizado e mostra o que esta filial mudou depois
 * da última cópia; só se sobrescreve o que for marcado. [C3-8]
 */
export function CopiarDeOutraFilial({
  destino,
  filiais,
  onCopied,
}: {
  destino: Establishment;
  filiais: Establishment[];
  onCopied: () => Promise<void>;
}) {
  const origens = filiais.filter((f) => f.id !== destino.id && !f.archivedAt);
  const [aberto, setAberto] = useState(false);
  const [origem, setOrigem] = useState("");
  const [previa, setPrevia] = useState<PreviaDaCopia | null>(null);
  const [aceitos, setAceitos] = useState<string[]>([]);
  const [resultado, setResultado] = useState<ResultadoDaCopia | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!origens.length) return null;

  function fechar() {
    setAberto(false);
    setOrigem("");
    setPrevia(null);
    setAceitos([]);
    setResultado(null);
    setError(null);
  }

  async function verPrevia(de: string) {
    setBusy(true);
    setError(null);
    setPrevia(null);
    setResultado(null);
    setAceitos([]);
    try {
      setPrevia(await previaDaCopia(destino.id, de));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao montar a prévia");
    } finally {
      setBusy(false);
    }
  }

  async function copiar() {
    if (!previa) return;
    setBusy(true);
    setError(null);
    try {
      const r = await copiarEntreFiliais(destino.id, previa.origem.id, aceitos);
      setResultado(r);
      setPrevia(null);
      await onCopied();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao copiar");
    } finally {
      setBusy(false);
    }
  }

  const aFazer = previa
    ? NIVEIS_DA_COPIA.reduce((t, n) => t + previa.niveis[n].criar + previa.niveis[n].atualizar, 0) +
      aceitos.length
    : 0;

  return (
    <>
      <div className="op-row-actions">
        <Button type="button" variant="secondary" size="compact" onClick={() => setAberto(true)}>
          Copiar de outra filial
        </Button>
      </div>
      {aberto && (
        <Dialog
          title={`Copiar para ${destino.name}`}
          description="Copia setores, funções, atividades, perigos, riscos, medidas e a avaliação vigente. É uma cópia: depois dela, cada filial segue sozinha."
          onClose={fechar}
        >
          <div className="form-grid">
            <label className="form-field">
              Copiar de
              <select
                value={origem}
                onChange={(e) => {
                  setOrigem(e.target.value);
                  if (e.target.value) void verPrevia(e.target.value);
                  else setPrevia(null);
                }}
              >
                <option value="">Escolha a filial de origem</option>
                {origens.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>

            {busy && !previa && !resultado && <p className="muted">Conferindo…</p>}

            {previa && (
              <>
                <div className="data-table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>O quê</th>
                        <th>Novos</th>
                        <th>Atualizados</th>
                        <th>Já iguais</th>
                      </tr>
                    </thead>
                    <tbody>
                      {NIVEIS_DA_COPIA.map((n) => (
                        <tr key={n}>
                          <td>{NIVEL_DA_COPIA_LABEL[n]}</td>
                          <td>{previa.niveis[n].criar}</td>
                          <td>{n === "vinculos" || n === "avaliacoes" ? "—" : previa.niveis[n].atualizar}</td>
                          <td>{n === "vinculos" || n === "avaliacoes" ? "—" : previa.niveis[n].iguais}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {previa.conflitos.length > 0 && (
                  <fieldset className="form-field">
                    <legend>
                      {previa.destino.name} mudou {previa.conflitos.length === 1 ? "um item" : `${previa.conflitos.length} itens`}{" "}
                      depois da última cópia. Marque o que deve receber o texto de {previa.origem.name}; o que não for
                      marcado fica como está.
                    </legend>
                    {previa.conflitos.map((c) => (
                      <label key={c.id} className="op-copy-conflict">
                        <input
                          type="checkbox"
                          aria-label={`Receber o texto de ${previa.origem.name} em ${c.nome}`}
                          checked={aceitos.includes(c.id)}
                          onChange={(e) =>
                            setAceitos((a) => (e.target.checked ? [...a, c.id] : a.filter((x) => x !== c.id)))
                          }
                        />
                        <span>
                          <strong>
                            {NIVEL_DA_COPIA_LABEL[c.nivel]}: {c.nome}
                          </strong>
                          {c.campos.map((d) => (
                            <span key={d.campo} className="muted ethics-excerpt" style={{ display: "block" }}>
                              {CAMPO_DA_COPIA_LABEL[d.campo] ?? d.campo}: aqui “{valor(d.destino)}”, na origem “
                              {valor(d.origem)}”
                            </span>
                          ))}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                )}

                <p className="muted" style={{ margin: 0 }}>
                  A medida chega planejada e a avaliação chega em revisão. Quem copia não pode validar as avaliações
                  copiadas: outro SST ou o Master valida, e eles recebem um aviso.
                </p>
              </>
            )}

            {resultado && (
              <p role="status">
                Cópia feita: {somar(resultado, "criados")} item(ns) novo(s) e {somar(resultado, "atualizados")}{" "}
                atualizado(s).
                {resultado.ignorados.length > 0 &&
                  ` ${resultado.ignorados.length} item(ns) que esta filial mudou ficaram como estavam.`}
              </p>
            )}

            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}

            <div className="form-actions">
              {previa && (
                <Button type="button" disabled={busy || aFazer === 0} onClick={() => void copiar()}>
                  {busy ? "Copiando…" : aFazer === 0 ? "Nada a copiar" : "Copiar"}
                </Button>
              )}
              {error && origem && (
                <Button type="button" variant="secondary" disabled={busy} onClick={() => void verPrevia(origem)}>
                  Ver a prévia de novo
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={fechar}>
                {resultado ? "Fechar" : "Cancelar"}
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

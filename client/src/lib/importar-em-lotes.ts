/**
 * O servidor recebe até 200 linhas por envio, e a planilha da folha com
 * todas as lojas passa disso (300 a 400 por loja). A tela manda em lotes,
 * um depois do outro, e soma tudo num relatório só, com o número da linha
 * do Excel em cada resultado. [PF-1]
 */

export const LINHAS_POR_LOTE = 200;

type Resultado = { line: number };
type Relatorio<R extends Resultado> = {
  dry_run: boolean;
  rows: number;
  created: number;
  completed: number;
  skipped: number;
  errors: number;
  results: R[];
};

export async function importarEmLotes<L, R extends Resultado>(
  linhas: L[],
  numeros: number[],
  enviar: (lote: L[]) => Promise<Relatorio<R>>,
  porLote = LINHAS_POR_LOTE,
  aoAvancar?: (feitas: number, total: number) => void,
): Promise<Relatorio<R>> {
  const soma: Relatorio<R> = {
    dry_run: false,
    rows: 0,
    created: 0,
    completed: 0,
    skipped: 0,
    errors: 0,
    results: [],
  };
  for (let inicio = 0; inicio < linhas.length; inicio += porLote) {
    const lote = linhas.slice(inicio, inicio + porLote);
    const r = await enviar(lote);
    soma.dry_run = r.dry_run;
    soma.rows += r.rows;
    soma.created += r.created;
    soma.completed += r.completed;
    soma.skipped += r.skipped;
    soma.errors += r.errors;
    for (const item of r.results) {
      /* O servidor numera de 1 dentro do lote; a tela mostra a linha do Excel. */
      soma.results.push({ ...item, line: numeros[inicio + item.line - 1] ?? inicio + item.line });
    }
    aoAvancar?.(Math.min(inicio + porLote, linhas.length), linhas.length);
  }
  return soma;
}

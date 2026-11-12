/**
 * Data de calendário vinda de planilha ou formulário: dia real, gravado à
 * meia-noite UTC como as outras datas sem hora. [C4-3]
 *
 * Aceita dd/mm/aaaa (também d/m/aaaa), aaaa-mm-dd e aaaa/mm/dd. A mensagem
 * pede dd/mm/aaaa, o formato do modelo. Dia que não existe ("31/02") é
 * recusado: antes, "2020-02-31" virava 02/03/2020 sem aviso.
 */
export function lerDataDeCalendario(raw: unknown, rotulo: string): Date | null {
  if (raw === undefined || raw === null) return null;
  const valor = String(raw).trim();
  if (valor === "") return null;
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(valor);
  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ].*)?$/.exec(valor);
  let y: number, m: number, d: number;
  if (br) [y, m, d] = [Number(br[3]), Number(br[2]), Number(br[1])];
  else if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else throw Object.assign(new Error(`${rotulo} inválida — use dd/mm/aaaa.`), { status: 400 });
  const data = new Date(Date.UTC(y, m - 1, d));
  if (data.getUTCFullYear() !== y || data.getUTCMonth() !== m - 1 || data.getUTCDate() !== d) {
    throw Object.assign(new Error(`${rotulo} inválida — esse dia não existe. Use dd/mm/aaaa.`), { status: 400 });
  }
  return data;
}

/**
 * Data sem hora (prazo, competência, dia do afastamento) é gravada à
 * meia-noite UTC. Convertê-la para o fuso de Brasília joga o dia para trás:
 * 2026-12-20 vira 19/12. Então formatamos as PARTES da data, sem fuso. [S3-B]
 */
export function formatCalendarDay(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return "—";

  // Meia-noite UTC exata = data de calendário: lê as partes em UTC.
  const exatamenteMeiaNoite =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;

  if (exatamenteMeiaNoite) {
    const dia = String(d.getUTCDate()).padStart(2, "0");
    const mes = String(d.getUTCMonth() + 1).padStart(2, "0");
    return `${dia}/${mes}/${d.getUTCFullYear()}`;
  }
  // Com hora, é um instante: aí o fuso da empresa vale.
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

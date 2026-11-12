/**
 * Dias úteis e prazo da primeira providência da denúncia. [C1-2]
 *
 * Função pura: não lê banco nem relógio. Quem chama passa o instante do
 * recebimento, a gravidade e o calendário — hoje o nacional; os feriados
 * estaduais e municipais de cada unidade entram depois sem mudar o cálculo.
 *
 * Convenção de contagem (especificação da Correção 1, item 2):
 * - recebida em dia útil: o dia do recebimento é o dia 0; avançam-se N dias
 *   úteis e o vencimento mantém o horário do recebimento;
 * - recebida em sábado, domingo ou feriado: o próximo dia útil é o dia 1;
 *   avançam-se N-1 dias úteis e o vencimento é 23:59:59 desse dia.
 *
 * Tudo no fuso de Brasília.
 */

export const TIME_ZONE = "America/Sao_Paulo";

export type Severity = "HIGH" | "NORMAL";

/** Prazo da primeira providência, em dias úteis. Alta = 1; Normal = 3. */
export const BUSINESS_DAYS_BY_SEVERITY: Record<Severity, number> = {
  HIGH: 1,
  NORMAL: 3,
};

/** Dia de calendário, sem hora. `month` de 1 a 12. */
export type CalendarDate = { year: number; month: number; day: number };

/**
 * O calendário de uma empresa ou unidade.
 *
 * - `goodFriday` e `corpusChristi` dependem de lei municipal (Lei 9.093/1995,
 *   art. 2º) e ficam desligados até a cidade e a lei estarem confirmadas.
 * - `extraDates` recebe feriados estaduais e municipais já resolvidos
 *   ("AAAA-MM-DD").
 */
export type HolidayCalendar = {
  goodFriday?: boolean;
  corpusChristi?: boolean;
  extraDates?: string[];
  /** Feriados que repetem todo ano, "MM-DD". [C4-11] */
  recurringDays?: string[];
};

/**
 * Feriados nacionais fixos (Lei 662/1949 com a redação da Lei 10.607/2002;
 * 12/10 pela Lei 6.802/1980; 20/11 pela Lei 14.759/2023). Ponto de partida,
 * não lista necessariamente esgotada.
 */
export const NATIONAL_FIXED_HOLIDAYS: ReadonlyArray<readonly [number, number]> = [
  [1, 1],
  [4, 21],
  [5, 1],
  [9, 7],
  [10, 12],
  [11, 2],
  [11, 15],
  [11, 20],
  [12, 25],
];

export const NATIONAL_CALENDAR: HolidayCalendar = {
  goodFriday: false,
  corpusChristi: false,
  extraDates: [],
};

/** Domingo de Páscoa (algoritmo anônimo gregoriano, "Meeus/Jones/Butcher"). */
export function easterSunday(year: number): CalendarDate {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

function key(d: CalendarDate): string {
  return `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** Soma dias de calendário (aritmética em UTC, sem fuso). */
export function addCalendarDays(d: CalendarDate, days: number): CalendarDate {
  const t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate() };
}

function weekday(d: CalendarDate): number {
  return new Date(Date.UTC(d.year, d.month - 1, d.day)).getUTCDay();
}

export function isHoliday(d: CalendarDate, calendar: HolidayCalendar = NATIONAL_CALENDAR): boolean {
  if (NATIONAL_FIXED_HOLIDAYS.some(([m, day]) => m === d.month && day === d.day)) return true;
  if (calendar.goodFriday || calendar.corpusChristi) {
    const easter = easterSunday(d.year);
    if (calendar.goodFriday && key(addCalendarDays(easter, -2)) === key(d)) return true;
    if (calendar.corpusChristi && key(addCalendarDays(easter, 60)) === key(d)) return true;
  }
  if ((calendar.recurringDays ?? []).includes(key(d).slice(5))) return true;
  return (calendar.extraDates ?? []).includes(key(d));
}

export function isBusinessDay(d: CalendarDate, calendar: HolidayCalendar = NATIONAL_CALENDAR): boolean {
  const w = weekday(d);
  return w !== 0 && w !== 6 && !isHoliday(d, calendar);
}

function addBusinessDays(d: CalendarDate, n: number, calendar: HolidayCalendar): CalendarDate {
  let cur = d;
  let left = n;
  while (left > 0) {
    cur = addCalendarDays(cur, 1);
    if (isBusinessDay(cur, calendar)) left -= 1;
  }
  return cur;
}

type ZonedParts = CalendarDate & { hour: number; minute: number; second: number; ms: number };

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

/** As partes de um instante no fuso de Brasília. */
export function zonedParts(instant: Date): ZonedParts {
  const p: Record<string, number> = {};
  for (const part of partsFormatter.formatToParts(instant)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return {
    year: p.year,
    month: p.month,
    day: p.day,
    hour: p.hour,
    minute: p.minute,
    second: p.second,
    ms: instant.getUTCMilliseconds(),
  };
}

/** O instante que, no fuso de Brasília, tem estas partes. */
export function fromZoned(p: ZonedParts): Date {
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, p.ms);
  // Duas voltas acertam o deslocamento mesmo perto de uma mudança de horário.
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const seen = zonedParts(new Date(guess));
    const seenUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second, seen.ms);
    guess += asUtc - seenUtc;
  }
  return new Date(guess);
}

/** Dia de calendário (no fuso de Brasília) de um instante. */
export function zonedDate(instant: Date): CalendarDate {
  const { year, month, day } = zonedParts(instant);
  return { year, month, day };
}

/**
 * Quando vence a primeira providência de uma denúncia recebida em
 * `receivedAt`. O prazo sempre conta do recebimento, também depois de um
 * ajuste de gravidade.
 */
export function computeDueAt(
  receivedAt: Date,
  severity: Severity,
  calendar: HolidayCalendar = NATIONAL_CALENDAR,
): Date {
  const n = BUSINESS_DAYS_BY_SEVERITY[severity];
  const recebido = zonedParts(receivedAt);
  const dia: CalendarDate = { year: recebido.year, month: recebido.month, day: recebido.day };

  if (isBusinessDay(dia, calendar)) {
    const vence = addBusinessDays(dia, n, calendar);
    return fromZoned({ ...recebido, ...vence });
  }

  // Fora de dia útil: o próximo dia útil é o dia 1.
  const dia1 = addBusinessDays(dia, 1, calendar);
  const vence = addBusinessDays(dia1, n - 1, calendar);
  return fromZoned({ ...vence, hour: 23, minute: 59, second: 59, ms: 0 });
}

/**
 * A situação do prazo — uma só por denúncia, avaliada nesta ordem:
 * atendida (no prazo ou com atraso), atrasada, vence hoje, no prazo.
 * `NOT_ASSESSED` é a denúncia antiga que saiu de "Recebido" sem registro
 * de quando: não se inventa nem atraso nem cumprimento.
 */
export type DeadlineSituation =
  | "MET_ON_TIME"
  | "MET_LATE"
  | "OVERDUE"
  | "DUE_TODAY"
  | "ON_TIME"
  | "NOT_ASSESSED";

export const DEADLINE_SITUATIONS: DeadlineSituation[] = [
  "OVERDUE",
  "DUE_TODAY",
  "ON_TIME",
  "MET_ON_TIME",
  "MET_LATE",
  "NOT_ASSESSED",
];

export function deadlineSituation(input: {
  status: string;
  dueAt: Date;
  firstActionAt: Date | null;
  now: Date;
}): DeadlineSituation {
  const { status, dueAt, firstActionAt, now } = input;
  if (firstActionAt) {
    return firstActionAt.getTime() <= dueAt.getTime() ? "MET_ON_TIME" : "MET_LATE";
  }
  if (status !== "RECEIVED") return "NOT_ASSESSED";
  if (now.getTime() > dueAt.getTime()) return "OVERDUE";
  if (key(zonedDate(dueAt)) === key(zonedDate(now))) return "DUE_TODAY";
  return "ON_TIME";
}

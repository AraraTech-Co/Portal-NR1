import {
  computeDueAt,
  deadlineSituation,
  NATIONAL_CALENDAR,
  type DeadlineSituation,
  type HolidayCalendar,
  type Severity,
} from "./business-days";

/**
 * O calendário de feriados de uma empresa. Hoje é o nacional para todas; os
 * feriados estaduais e municipais por unidade entram depois, aqui, sem mudar
 * o cálculo. [C1-2]
 */
export function holidayCalendarFor(_organizationId: string): HolidayCalendar {
  return NATIONAL_CALENDAR;
}

/**
 * Vencimento e situação do prazo de uma denúncia.
 *
 * As denúncias anteriores ao prazo não têm `dueAt` gravado: o vencimento
 * delas sai do `createdAt`, com o mesmo cálculo. [C1-2]
 */
export function ethicsDeadline(
  report: {
    organizationId: string;
    status: string;
    severity: Severity;
    createdAt: Date;
    dueAt: Date | null;
    firstActionAt: Date | null;
  },
  now: Date = new Date(),
): { dueAt: Date; situation: DeadlineSituation } {
  const dueAt =
    report.dueAt ??
    computeDueAt(report.createdAt, report.severity, holidayCalendarFor(report.organizationId));
  return {
    dueAt,
    situation: deadlineSituation({
      status: report.status,
      dueAt,
      firstActionAt: report.firstActionAt,
      now,
    }),
  };
}

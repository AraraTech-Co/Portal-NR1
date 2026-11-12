import prisma from "../model/prisma";
import {
  computeDueAt,
  deadlineSituation,
  NATIONAL_CALENDAR,
  type DeadlineSituation,
  type HolidayCalendar,
  type Severity,
} from "./business-days";

type Leitor = Pick<typeof prisma, "holiday" | "establishment">;

/**
 * O calendário de feriados de uma denúncia: os nacionais, os da empresa e os
 * da filial da denúncia, com a Sexta-feira Santa e o Corpus Christi como a
 * filial diz. Sem filial (só as anteriores à Correção 1): os nacionais e os
 * da empresa, com a Sexta-feira Santa ligada, que é o padrão. [C1-2] [C4-11]
 *
 * Só a chegada da denúncia e o ajuste de gravidade leem isto: o vencimento
 * fica gravado, e cadastrar feriado não muda prazo já aberto.
 */
export async function holidayCalendarFor(
  organizationId: string,
  establishmentId: string | null,
  db: Leitor = prisma,
): Promise<HolidayCalendar> {
  const [feriados, filial] = await Promise.all([
    db.holiday.findMany({
      where: {
        organizationId,
        OR: [{ establishmentId: null }, ...(establishmentId ? [{ establishmentId }] : [])],
      },
      select: { date: true, recurring: true },
    }),
    establishmentId
      ? db.establishment.findFirst({
          where: { id: establishmentId, organizationId },
          select: { goodFridayHoliday: true, corpusChristiHoliday: true },
        })
      : null,
  ]);
  const dia = (d: Date) => d.toISOString().slice(0, 10);
  return {
    goodFriday: filial ? filial.goodFridayHoliday : true,
    corpusChristi: filial ? filial.corpusChristiHoliday : false,
    extraDates: feriados.filter((f) => !f.recurring).map((f) => dia(f.date)),
    recurringDays: feriados.filter((f) => f.recurring).map((f) => dia(f.date).slice(5)),
  };
}

/**
 * Vencimento e situação do prazo de uma denúncia.
 *
 * As denúncias anteriores ao prazo não têm `dueAt` gravado: o vencimento
 * delas sai do `createdAt`, com o calendário nacional, como sempre saiu, para
 * não mudar o que já estava aberto. [C1-2] [C4-11]
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
  const dueAt = report.dueAt ?? computeDueAt(report.createdAt, report.severity, NATIONAL_CALENDAR);
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

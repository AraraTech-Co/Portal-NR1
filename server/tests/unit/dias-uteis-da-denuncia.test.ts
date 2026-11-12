import { describe, expect, it } from "vitest";
import {
  computeDueAt,
  deadlineSituation,
  easterSunday,
  isBusinessDay,
  zonedParts,
} from "../../src/helper/business-days";

/**
 * Prazo da primeira providência da denúncia, em dias úteis. [C1-2]
 *
 * Os horários abaixo estão no fuso de Brasília (-03:00).
 */
const em = (iso: string) => new Date(iso);

function local(d: Date) {
  const p = zonedParts(d);
  const dd = String(p.day).padStart(2, "0");
  const mm = String(p.month).padStart(2, "0");
  const hh = String(p.hour).padStart(2, "0");
  const mi = String(p.minute).padStart(2, "0");
  const ss = String(p.second).padStart(2, "0");
  return `${dd}/${mm}/${p.year} ${hh}:${mi}:${ss}`;
}

describe("vencimento [C1-2]", () => {
  it("Alta na sexta 17h vence segunda 17h", () => {
    // 06/11/2026 é sexta.
    expect(local(computeDueAt(em("2026-11-06T17:00:00-03:00"), "HIGH"))).toBe(
      "09/11/2026 17:00:00",
    );
  });

  it("Normal na quarta 10h vence segunda 10h", () => {
    // 04/11/2026 é quarta.
    expect(local(computeDueAt(em("2026-11-04T10:00:00-03:00"), "NORMAL"))).toBe(
      "09/11/2026 10:00:00",
    );
  });

  it("Alta no sábado vence segunda 23:59:59", () => {
    expect(local(computeDueAt(em("2026-11-07T14:30:00-03:00"), "HIGH"))).toBe(
      "09/11/2026 23:59:59",
    );
  });

  it("Normal no sábado vence quarta 23:59:59, sem feriado no meio", () => {
    expect(local(computeDueAt(em("2026-11-07T08:00:00-03:00"), "NORMAL"))).toBe(
      "11/11/2026 23:59:59",
    );
  });

  it("feriado no meio pula o dia: Alta na quinta 19/11 10h vence segunda 23/11 10h", () => {
    expect(local(computeDueAt(em("2026-11-19T10:00:00-03:00"), "HIGH"))).toBe(
      "23/11/2026 10:00:00",
    );
  });

  it("recebida num feriado conta como fora de dia útil", () => {
    // 20/11/2026 (sexta) é feriado: segunda 23/11 é o dia 1.
    expect(local(computeDueAt(em("2026-11-20T09:00:00-03:00"), "HIGH"))).toBe(
      "23/11/2026 23:59:59",
    );
  });

  it("a hora de Brasília decide o dia, não a de Greenwich", () => {
    // Sábado 22h em Brasília já é domingo em UTC; continua sendo sábado aqui.
    expect(local(computeDueAt(em("2026-11-07T22:00:00-03:00"), "HIGH"))).toBe(
      "09/11/2026 23:59:59",
    );
    // Sexta 22h em Brasília (sábado em UTC) é dia útil: vence segunda 22h.
    expect(local(computeDueAt(em("2026-11-06T22:00:00-03:00"), "HIGH"))).toBe(
      "09/11/2026 22:00:00",
    );
  });
});

describe("calendário [C1-2]", () => {
  it("Páscoa de 2026 e de 2027", () => {
    expect(easterSunday(2026)).toEqual({ year: 2026, month: 4, day: 5 });
    expect(easterSunday(2027)).toEqual({ year: 2027, month: 3, day: 28 });
  });

  it("Sexta-feira Santa só conta quando a unidade a liga", () => {
    const sexta = { year: 2026, month: 4, day: 3 };
    expect(isBusinessDay(sexta)).toBe(true);
    expect(isBusinessDay(sexta, { goodFriday: true })).toBe(false);
  });

  it("Corpus Christi só conta quando a unidade o liga", () => {
    // 2026: Páscoa 05/04 + 60 = 04/06 (quinta).
    const corpus = { year: 2026, month: 6, day: 4 };
    expect(isBusinessDay(corpus)).toBe(true);
    expect(isBusinessDay(corpus, { corpusChristi: true })).toBe(false);
  });

  it("feriado local resolvido entra pela lista da unidade", () => {
    const dia = { year: 2026, month: 11, day: 10 };
    expect(isBusinessDay(dia)).toBe(true);
    expect(isBusinessDay(dia, { extraDates: ["2026-11-10"] })).toBe(false);
  });

  it("os feriados nacionais fixos não são dia útil", () => {
    for (const [m, d] of [
      [1, 1],
      [4, 21],
      [5, 1],
      [9, 7],
      [10, 12],
      [11, 2],
      [11, 15],
      [11, 20],
      [12, 25],
    ]) {
      expect(isBusinessDay({ year: 2030, month: m, day: d }), `${d}/${m}`).toBe(false);
    }
  });
});

describe("situação do prazo [C1-2]", () => {
  const dueAt = em("2026-11-09T17:00:00-03:00");

  it("atendida no prazo e com atraso, pela primeira providência", () => {
    expect(
      deadlineSituation({
        status: "IN_ANALYSIS",
        dueAt,
        firstActionAt: em("2026-11-09T16:59:00-03:00"),
        now: em("2026-11-20T00:00:00-03:00"),
      }),
    ).toBe("MET_ON_TIME");
    expect(
      deadlineSituation({
        status: "RESOLVED",
        dueAt,
        firstActionAt: em("2026-11-09T17:01:00-03:00"),
        now: em("2026-11-20T00:00:00-03:00"),
      }),
    ).toBe("MET_LATE");
  });

  it("em Recebido: atrasada, vence hoje, no prazo", () => {
    const base = { status: "RECEIVED", dueAt, firstActionAt: null };
    expect(deadlineSituation({ ...base, now: em("2026-11-09T17:00:01-03:00") })).toBe("OVERDUE");
    expect(deadlineSituation({ ...base, now: em("2026-11-09T08:00:00-03:00") })).toBe("DUE_TODAY");
    expect(deadlineSituation({ ...base, now: em("2026-11-08T23:59:00-03:00") })).toBe("ON_TIME");
  });

  it("antiga, fora de Recebido e sem registro de quando: não apurada", () => {
    expect(
      deadlineSituation({
        status: "IN_ANALYSIS",
        dueAt,
        firstActionAt: null,
        now: em("2026-11-08T00:00:00-03:00"),
      }),
    ).toBe("NOT_ASSESSED");
  });

  it("uma situação só por denúncia, em qualquer instante", () => {
    const vistas = new Set<string>();
    for (let h = -48; h <= 48; h += 1) {
      const now = new Date(dueAt.getTime() + h * 3600_000);
      for (const firstActionAt of [null, em("2026-11-08T10:00:00-03:00")]) {
        for (const status of ["RECEIVED", "IN_ANALYSIS"]) {
          const s = deadlineSituation({ status, dueAt, firstActionAt, now });
          expect(typeof s).toBe("string");
          vistas.add(s);
        }
      }
    }
    expect([...vistas].sort()).toEqual(
      ["DUE_TODAY", "MET_ON_TIME", "NOT_ASSESSED", "ON_TIME", "OVERDUE"].sort(),
    );
  });
});

describe("feriado que repete todo ano [C4-11]", () => {
  it("conta em qualquer ano pelo dia e mês", async () => {
    const { isHoliday } = await import("../../src/helper/business-days");
    const cal = { recurringDays: ["08-27"] };
    expect(isHoliday({ year: 2026, month: 8, day: 27 }, cal)).toBe(true);
    expect(isHoliday({ year: 2031, month: 8, day: 27 }, cal)).toBe(true);
    expect(isHoliday({ year: 2026, month: 8, day: 28 }, cal)).toBe(false);
  });
});

import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { lerDataDeCalendario } from "../helper/data-de-calendario";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

const dia = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Feriados da empresa e da filial no prazo da denúncia, e a Sexta-feira
 * Santa e o Corpus Christi de cada filial. Master, Dono e RH, pela guarda
 * do módulo "conta". Cadastrar não muda prazo já aberto: o vencimento da
 * denúncia fica gravado na chegada. [C4-11]
 */
class HolidayController {
  async list(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const [feriados, filiais] = await Promise.all([
        prisma.holiday.findMany({
          where: { organizationId: orgId },
          orderBy: [{ date: "asc" }, { name: "asc" }],
          select: { id: true, date: true, name: true, recurring: true, establishmentId: true },
        }),
        prisma.establishment.findMany({
          where: { organizationId: orgId, archivedAt: null },
          orderBy: { name: "asc" },
          select: { id: true, name: true, goodFridayHoliday: true, corpusChristiHoliday: true },
        }),
      ]);
      res.json({
        feriados: feriados.map((f) => ({
          id: f.id,
          date: dia(f.date),
          name: f.name,
          recurring: f.recurring,
          establishment_id: f.establishmentId,
        })),
        filiais: filiais.map((f) => ({
          id: f.id,
          name: f.name,
          good_friday: f.goodFridayHoliday,
          corpus_christi: f.corpusChristiHoliday,
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async create(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const nome = typeof body.name === "string" ? body.name.trim() : "";
      if (!nome || nome.length > 120) {
        res.status(400).json({ message: "Informe o nome do feriado (até 120 caracteres)." });
        return;
      }
      const data = lerDataDeCalendario(body.date, "Data do feriado");
      if (!data) {
        res.status(400).json({ message: "Informe a data do feriado." });
        return;
      }
      const filial = typeof body.establishment_id === "string" && body.establishment_id ? body.establishment_id : null;
      if (filial) {
        const existe = await prisma.establishment.findFirst({
          where: { id: filial, organizationId: orgId, archivedAt: null },
          select: { id: true },
        });
        if (!existe) {
          res.status(400).json({ message: "Filial inválida." });
          return;
        }
      }
      const feriado = await prisma.holiday.create({
        data: {
          organizationId: orgId,
          establishmentId: filial,
          date: data,
          name: nome,
          recurring: body.recurring === true,
          createdById: actorUserId(req as AuthRequest),
        },
      });
      await writeAudit({
        organizationId: orgId,
        actorId: actorUserId(req as AuthRequest),
        action: "holiday.create",
        entityType: "Holiday",
        entityId: feriado.id,
        after: { date: dia(feriado.date), name: feriado.name, recurring: feriado.recurring, establishmentId: filial },
      });
      res.status(201).json({
        feriado: { id: feriado.id, date: dia(feriado.date), name: feriado.name, recurring: feriado.recurring, establishment_id: filial },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async remove(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const feriado = await prisma.holiday.findFirst({ where: { id: req.params.id, organizationId: orgId } });
      if (!feriado) {
        res.status(404).json({ message: "Feriado não encontrado." });
        return;
      }
      await prisma.holiday.delete({ where: { id: feriado.id } });
      await writeAudit({
        organizationId: orgId,
        actorId: actorUserId(req as AuthRequest),
        action: "holiday.delete",
        entityType: "Holiday",
        entityId: feriado.id,
        before: { date: dia(feriado.date), name: feriado.name, recurring: feriado.recurring, establishmentId: feriado.establishmentId },
      });
      res.status(204).end();
    } catch (err) {
      fail(res, err);
    }
  }

  /** Sexta-feira Santa e Corpus Christi da filial. */
  async updateUnit(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const filial = await prisma.establishment.findFirst({
        where: { id: req.params.id, organizationId: orgId, archivedAt: null },
        select: { id: true, goodFridayHoliday: true, corpusChristiHoliday: true },
      });
      if (!filial) {
        res.status(404).json({ message: "Filial não encontrada." });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const dados: { goodFridayHoliday?: boolean; corpusChristiHoliday?: boolean } = {};
      for (const [campo, chave] of [["good_friday", "goodFridayHoliday"], ["corpus_christi", "corpusChristiHoliday"]] as const) {
        if (body[campo] === undefined) continue;
        if (typeof body[campo] !== "boolean") {
          res.status(400).json({ message: `${campo} deve ser verdadeiro ou falso.` });
          return;
        }
        dados[chave] = body[campo] as boolean;
      }
      const depois = await prisma.establishment.update({
        where: { id: filial.id },
        data: dados,
        select: { id: true, name: true, goodFridayHoliday: true, corpusChristiHoliday: true },
      });
      await writeAudit({
        organizationId: orgId,
        actorId: actorUserId(req as AuthRequest),
        action: "establishment.holidays",
        entityType: "Establishment",
        entityId: filial.id,
        before: { goodFridayHoliday: filial.goodFridayHoliday, corpusChristiHoliday: filial.corpusChristiHoliday },
        after: { goodFridayHoliday: depois.goodFridayHoliday, corpusChristiHoliday: depois.corpusChristiHoliday },
      });
      res.json({
        filial: { id: depois.id, name: depois.name, good_friday: depois.goodFridayHoliday, corpus_christi: depois.corpusChristiHoliday },
      });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new HolidayController();

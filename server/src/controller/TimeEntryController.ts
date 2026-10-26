import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { canManageModule } from "../helper/module-access";
import { writeAudit } from "../helper/audit";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

function isRh(req: AuthRequest) {
  return Boolean(req.actor && canManageModule(req.actor.permission, "ponto"));
}

function dayOnly(iso: string): Date {
  const d = new Date(iso);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

class TimeEntryController {
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const rows = await prisma.timeEntry.findMany({
        where: {
          organizationId: orgId,
          ...(!isRh(auth) ? { userId } : {}),
          ...(req.query.user_id && isRh(auth)
            ? { userId: String(req.query.user_id) }
            : {}),
        },
        /*
          Vários movimentos podem cair no mesmo dia: o mais recente primeiro,
          para a tela contar a história na ordem em que aconteceu. [CB-66]
        */
        orderBy: [{ day: "desc" }, { createdAt: "desc" }],
        take: 180,
        include: { createdBy: { select: { id: true, name: true } } },
      });
      res.json({ entries: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Lança UM movimento do banco de horas.
   *
   * Era `upsert` por pessoa e dia: lançar de novo no mesmo dia substituía as
   * horas e o motivo do anterior, sem aviso e sem guardar o que havia — uma
   * hora extra de manhã e outra à tarde apagavam uma à outra. A decisão S5-M
   * fala em cada movimento com histórico. [CB-66] [S5-M]
   */
  async create(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const lancadoPor = actorUserId(auth);
      const {
        user_id,
        day,
        in1,
        out1,
        in2,
        out2,
        balance_minutes,
        note,
      } = req.body as Record<string, unknown>;

      if (!day) {
        res.status(400).json({ message: "Informe day." });
        return;
      }
      /*
        O lançamento é sempre de alguém, dito por quem lança: não existe mais
        o caminho em que a pessoa grava o próprio saldo porque não disse de
        quem era. [S5-O]
      */
      if (!isRh(auth)) {
        res.status(403).json({
          message: "O lançamento de ponto é de quem cuida do Banco de horas.",
          code: "TIME_ENTRY_MANAGED_ONLY",
        });
        return;
      }
      if (!user_id) {
        res.status(400).json({ message: "Informe de quem é o lançamento (user_id)." });
        return;
      }
      const targetUserId = String(user_id);
      const dayDate = dayOnly(String(day));

      // A pessoa precisa ser desta empresa.
      const alvo = await prisma.membership.findFirst({
        where: { organizationId: orgId, userId: targetUserId },
        select: { id: true },
      });
      if (!alvo) {
        res.status(400).json({ message: "Pessoa não encontrada nesta empresa." });
        return;
      }

      const entry = await prisma.timeEntry.create({
        data: {
          organizationId: orgId,
          userId: targetUserId,
          day: dayDate,
          in1: blank(in1 as string),
          out1: blank(out1 as string),
          in2: blank(in2 as string),
          out2: blank(out2 as string),
          balanceMinutes: (balance_minutes as number) ?? 0,
          note: blank(note as string),
          createdById: lancadoPor,
        },
        include: { createdBy: { select: { id: true, name: true } } },
      });

      /*
        O lançamento não entrava no histórico de auditoria: numa reclamação
        trabalhista não havia como mostrar quem lançou nem o que havia antes.
        [CB-66] [CB-67]
      */
      await writeAudit({
        organizationId: orgId,
        actorId: lancadoPor,
        action: "time_entry.create",
        entityType: "TimeEntry",
        entityId: entry.id,
        after: {
          userId: entry.userId,
          day: entry.day,
          balanceMinutes: entry.balanceMinutes,
          note: entry.note,
        },
      });

      res.status(201).json({ entry });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new TimeEntryController();

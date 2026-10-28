import { Request, Response } from "express";
import { AepMethod, ErgonomicComplaintStatus, NotificationKind } from "@prisma/client";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { notify, notifyMany } from "../helper/notify";
import { canHandleErgonomicComplaint } from "../helper/module-access";
import { usersWhoHandleErgonomicComplaints } from "../helper/module-managers";
import { AEP_METHOD_DEFAULT, AEP_STATUSES, BODY_PART_MAX } from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null): string | null {
  return v && v.trim() !== "" ? v.trim() : null;
}

/**
 * Quem responde tecnicamente pelo SST lê e responde as queixas de todos.
 *
 * Escrita no módulo não basta: o supervisor e o gerente escrevem em
 * Avaliação ergonômica, e queixa de dor não é assunto da chefia. [P1]
 */
function cuidaDoModulo(req: AuthRequest): boolean {
  return Boolean(req.actor && canHandleErgonomicComplaint(req.actor.permission));
}

const PARA_A_TELA = {
  id: true,
  bodyPart: true,
  description: true,
  jobRoleName: true,
  status: true,
  aepId: true,
  handledAt: true,
  handlingNote: true,
  createdAt: true,
  user: { select: { id: true, name: true } },
  establishment: { select: { id: true, name: true } },
  handledBy: { select: { id: true, name: true } },
} as const;

/**
 * A queixa ergonômica de quem faz o trabalho.
 *
 * Quem sente a dor é quem trabalha, e não tinha onde dizer isso: a Avaliação
 * ergonômica era, para ele, uma lista sem nenhum botão. Agora registra a
 * queixa. Transformá-la em avaliação continua sendo do SST. [P1]
 */
class ErgonomicComplaintController {
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const status = req.query.status as string | undefined;

      /*
        Queixa de dor é informação de saúde: quem não cuida do módulo vê
        apenas as próprias.
      */
      const rows = await prisma.ergonomicComplaint.findMany({
        where: {
          organizationId: orgId,
          ...(cuidaDoModulo(auth) ? {} : { userId }),
          ...(status && status in ErgonomicComplaintStatus
            ? { status: status as ErgonomicComplaintStatus }
            : {}),
        },
        orderBy: { createdAt: "desc" },
        select: PARA_A_TELA,
      });

      res.json({ complaints: rows, manages: cuidaDoModulo(auth) });
    } catch (err) {
      fail(res, err);
    }
  }

  async create(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const { description, body_part } = req.body as {
        description?: string;
        body_part?: string;
      };

      if (!blank(description)) {
        res.status(400).json({
          message: "Escreva o que incomoda e em que tarefa.",
        });
        return;
      }

      /*
        "Onde incomoda" é o lugar do corpo, em poucas palavras; a frase vai
        em "O que incomoda". O cartão da queixa mostra o lugar numa linha.
        [B3-3-D]
      */
      const onde = blank(body_part);
      if (onde && onde.length > BODY_PART_MAX) {
        res.status(400).json({
          code: "BODY_PART_TOO_LONG",
          message: `Em "Onde incomoda", escreva só o lugar do corpo, em até ${BODY_PART_MAX} caracteres. O resto vai em "O que incomoda".`,
          limit: BODY_PART_MAX,
        });
        return;
      }

      /*
        A unidade e a função ficam gravadas como estão hoje: a pessoa pode
        mudar de função, e a queixa continua sendo sobre o trabalho que ela
        fazia quando doeu.
      */
      const ficha = await prisma.employeeProfile.findFirst({
        where: { organizationId: orgId, userId },
        select: {
          jobRole: {
            select: {
              name: true,
              sector: { select: { establishmentId: true } },
            },
          },
        },
      });

      const queixa = await prisma.ergonomicComplaint.create({
        data: {
          organizationId: orgId,
          userId,
          description: blank(description)!,
          bodyPart: onde,
          jobRoleName: ficha?.jobRole?.name ?? null,
          establishmentId: ficha?.jobRole?.sector.establishmentId ?? null,
        },
        select: PARA_A_TELA,
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "ergonomic_complaint.create",
        entityType: "ErgonomicComplaint",
        entityId: queixa.id,
        after: { status: queixa.status },
      });

      // Quem cuida do módulo fica sabendo sem precisar procurar.
      const quemCuida = await usersWhoHandleErgonomicComplaints(orgId);
      await notifyMany(
        quemCuida.filter((id) => id !== userId),
        {
          organizationId: orgId,
          kind: NotificationKind.ERGONOMIC_COMPLAINT_OPENED,
          title: "Queixa ergonômica registrada",
          body: queixa.jobRoleName
            ? `De quem trabalha como ${queixa.jobRoleName}.`
            : "Alguém registrou desconforto no trabalho.",
          link: "/aep",
          entityType: "ErgonomicComplaint",
          entityId: queixa.id,
        },
      );

      res.status(201).json({ complaint: queixa });
    } catch (err) {
      fail(res, err);
    }
  }

  /** O SST transforma a queixa em avaliação ergonômica. [P1] */
  async evaluate(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      if (!cuidaDoModulo(auth)) {
        res.status(403).json({
          message:
            "Responder a queixa ergonômica é de quem responde tecnicamente pelo SST.",
          code: "ERGONOMIC_COMPLAINT_SST_ONLY",
        });
        return;
      }
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const queixa = await prisma.ergonomicComplaint.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        select: { id: true, userId: true, status: true, description: true },
      });
      if (!queixa) {
        res.status(404).json({ message: "Queixa não encontrada." });
        return;
      }
      if (queixa.status !== ErgonomicComplaintStatus.OPEN) {
        res.status(409).json({
          message: "Esta queixa já foi respondida.",
          code: "ALREADY_HANDLED",
        });
        return;
      }

      const { establishment_id, scope_description, sector_id, note } =
        req.body as {
          establishment_id?: string;
          scope_description?: string;
          sector_id?: string;
          note?: string;
        };
      if (!establishment_id || !blank(scope_description)) {
        res.status(400).json({
          message: "Informe a unidade e o que será avaliado.",
        });
        return;
      }
      const unidade = await prisma.establishment.findFirst({
        where: { id: establishment_id, organizationId: orgId, archivedAt: null },
        select: { id: true },
      });
      if (!unidade) {
        res.status(400).json({ message: "Escolha uma unidade desta empresa." });
        return;
      }
      if (sector_id) {
        const setor = await prisma.sector.findFirst({
          where: { id: sector_id, organizationId: orgId, establishmentId: unidade.id },
          select: { id: true },
        });
        if (!setor) {
          res.status(400).json({ message: "Escolha um setor desta unidade." });
          return;
        }
      }

      const avaliacao = await prisma.$transaction(async (tx) => {
        const aep = await tx.aep.create({
          data: {
            organizationId: orgId,
            establishmentId: unidade.id,
            sectorId: sector_id ?? null,
            scopeDescription: blank(scope_description)!,
            method: AEP_METHOD_DEFAULT as AepMethod,
            status: AEP_STATUSES.DRAFT,
            conductedById: userId,
            findings: `Aberta a partir de uma queixa de quem trabalha: ${queixa.description}`,
          },
          select: { id: true },
        });
        await tx.ergonomicComplaint.update({
          where: { id: queixa.id },
          data: {
            status: ErgonomicComplaintStatus.IN_EVALUATION,
            aepId: aep.id,
            handledById: userId,
            handledAt: new Date(),
            handlingNote: blank(note),
          },
        });
        return aep;
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "ergonomic_complaint.evaluate",
        entityType: "ErgonomicComplaint",
        entityId: queixa.id,
        after: { aepId: avaliacao.id },
      });

      /*
        Quem registrou precisa saber que foi ouvido: a queixa que some é a
        queixa que não se faz de novo.
      */
      await notify({
        organizationId: orgId,
        userId: queixa.userId,
        kind: NotificationKind.ERGONOMIC_COMPLAINT_HANDLED,
        title: "Sua queixa virou uma avaliação ergonômica",
        body: blank(note) ?? "O SST vai avaliar o posto de trabalho.",
        link: "/aep",
        entityType: "ErgonomicComplaint",
        entityId: queixa.id,
      });

      res.json({ aep_id: avaliacao.id });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Encerrar sem avaliação — com o motivo escrito para quem registrou. [P1] */
  async close(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      if (!cuidaDoModulo(auth)) {
        res.status(403).json({
          message:
            "Responder a queixa ergonômica é de quem responde tecnicamente pelo SST.",
          code: "ERGONOMIC_COMPLAINT_SST_ONLY",
        });
        return;
      }
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const { note } = req.body as { note?: string };
      if (!blank(note)) {
        res.status(400).json({
          message: "Escreva o motivo: é o que a pessoa vai ler.",
        });
        return;
      }

      const queixa = await prisma.ergonomicComplaint.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        select: { id: true, userId: true, status: true },
      });
      if (!queixa) {
        res.status(404).json({ message: "Queixa não encontrada." });
        return;
      }
      if (queixa.status !== ErgonomicComplaintStatus.OPEN) {
        res.status(409).json({
          message: "Esta queixa já foi respondida.",
          code: "ALREADY_HANDLED",
        });
        return;
      }

      await prisma.ergonomicComplaint.update({
        where: { id: queixa.id },
        data: {
          status: ErgonomicComplaintStatus.CLOSED,
          handledById: userId,
          handledAt: new Date(),
          handlingNote: blank(note),
        },
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "ergonomic_complaint.close",
        entityType: "ErgonomicComplaint",
        entityId: queixa.id,
        after: { status: ErgonomicComplaintStatus.CLOSED },
      });

      await notify({
        organizationId: orgId,
        userId: queixa.userId,
        kind: NotificationKind.ERGONOMIC_COMPLAINT_HANDLED,
        title: "Resposta à sua queixa ergonômica",
        body: blank(note)!,
        link: "/aep",
        entityType: "ErgonomicComplaint",
        entityId: queixa.id,
      });

      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new ErgonomicComplaintController();

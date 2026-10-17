import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { canWriteModule } from "../helper/module-access";
import { cnpjOrNull } from "../helper/cnpj";
import { ASSESSMENT_REVIEW_MONTHS_DEFAULT } from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Prazo máximo sem certificação em sistema de gestão (NR-1 1.5.4.4.6). */
const MESES_SEM_CERTIFICACAO = ASSESSMENT_REVIEW_MONTHS_DEFAULT;
/** 1.5.4.4.6.1: até 3 anos com certificação declarada. */
const MESES_COM_CERTIFICACAO = 36;

/**
 * Dados da empresa e quem responde pelo PGR.
 *
 * Eram os únicos dados do portal sem nenhum caminho: só mudavam direto no
 * banco. Sem eles o cartão "Responsável pelo PGR" nunca sai do painel, e a
 * ordem de serviço não tem de onde tirar o responsável padrão. [B2-1-M] [CB-42]
 */
class OrganizationController {
  async get(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const org = await prisma.organization.findFirst({
        where: { id: orgId },
        select: {
          id: true,
          name: true,
          taxId: true,
          responsibleName: true,
          responsibleRole: true,
          responsibleRegistration: true,
          assessmentReviewMonths: true,
          hasSstCertification: true,
        },
      });
      if (!org) {
        res.status(404).json({ message: "Organização não encontrada." });
        return;
      }
      res.json({
        organization: org,
        can_edit: Boolean(
          auth.actor && canWriteModule(auth.actor.permission, "configuracoes"),
        ),
        review_months_max: org.hasSstCertification
          ? MESES_COM_CERTIFICACAO
          : MESES_SEM_CERTIFICACAO,
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async update(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const body = req.body as Record<string, unknown>;

      const current = await prisma.organization.findFirst({ where: { id: orgId } });
      if (!current) {
        res.status(404).json({ message: "Organização não encontrada." });
        return;
      }

      const name = body.name !== undefined ? texto(body.name) : undefined;
      if (name !== undefined && !name) {
        res.status(400).json({ message: "A empresa precisa de um nome." });
        return;
      }

      let taxId: string | null | undefined;
      if (body.tax_id !== undefined) {
        taxId = cnpjOrNull(body.tax_id as string);
      }

      const hasSstCertification =
        body.has_sst_certification !== undefined
          ? Boolean(body.has_sst_certification)
          : current.hasSstCertification;

      let assessmentReviewMonths = current.assessmentReviewMonths;
      if (body.assessment_review_months !== undefined) {
        const meses = Number(body.assessment_review_months);
        if (!Number.isInteger(meses) || meses < 1) {
          res.status(400).json({ message: "O prazo de revisão vai em meses inteiros." });
          return;
        }
        /*
          NR-1 1.5.4.4.6: a avaliação se revisa a cada 2 anos; 1.5.4.4.6.1
          estica para 3 anos só com certificação em sistema de gestão de SST.
        */
        const limite = hasSstCertification
          ? MESES_COM_CERTIFICACAO
          : MESES_SEM_CERTIFICACAO;
        if (meses > limite) {
          res.status(400).json({
            message: hasSstCertification
              ? `Com certificação declarada, o prazo vai até ${MESES_COM_CERTIFICACAO} meses.`
              : `Sem certificação em sistema de gestão de SST, o prazo vai até ${MESES_SEM_CERTIFICACAO} meses.`,
          });
          return;
        }
        assessmentReviewMonths = meses;
      }

      // Baixar a certificação não pode deixar para trás um prazo que ela
      // sustentava.
      if (!hasSstCertification && assessmentReviewMonths > MESES_SEM_CERTIFICACAO) {
        res.status(400).json({
          message: `Sem a certificação, ajuste antes o prazo de revisão para no máximo ${MESES_SEM_CERTIFICACAO} meses.`,
        });
        return;
      }

      const organization = await prisma.organization.update({
        where: { id: orgId },
        data: {
          ...(name !== undefined ? { name } : {}),
          ...(taxId !== undefined ? { taxId } : {}),
          ...(body.responsible_name !== undefined
            ? { responsibleName: texto(body.responsible_name) }
            : {}),
          ...(body.responsible_role !== undefined
            ? { responsibleRole: texto(body.responsible_role) }
            : {}),
          ...(body.responsible_registration !== undefined
            ? { responsibleRegistration: texto(body.responsible_registration) }
            : {}),
          assessmentReviewMonths,
          hasSstCertification,
        },
        select: {
          id: true,
          name: true,
          taxId: true,
          responsibleName: true,
          responsibleRole: true,
          responsibleRegistration: true,
          assessmentReviewMonths: true,
          hasSstCertification: true,
        },
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "organization.update",
        entityType: "Organization",
        entityId: orgId,
        before: {
          name: current.name,
          responsibleName: current.responsibleName,
          assessmentReviewMonths: current.assessmentReviewMonths,
        },
        after: {
          name: organization.name,
          responsibleName: organization.responsibleName,
          assessmentReviewMonths: organization.assessmentReviewMonths,
        },
      });

      res.json({ organization });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new OrganizationController();

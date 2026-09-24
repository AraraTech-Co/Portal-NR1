import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Contractor } from "../model/schema/Contractor/Contractor";
import { Establishment } from "../model/schema/Establishment/Establishment";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import {
  CONTRACTOR_RELATION_DEFAULT,
  CONTRACTOR_RELATION_VALUES,
  isContractorRelation,
} from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

function parseOptionalDate(v?: string | null): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    throw Object.assign(new Error("Data inválida."), { status: 400 });
  }
  return d;
}

class ContractorController {
  async list(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const establishmentId = req.query.establishment_id as string | undefined;
      const relation = req.query.relation as string | undefined;
      const includeArchived = req.query.include_archived === "true";

      const rows = await prisma.contractor.findMany({
        where: {
          organizationId: orgId,
          ...(establishmentId ? { establishmentId } : {}),
          ...(relation && isContractorRelation(relation) ? { relation } : {}),
          ...(includeArchived ? {} : { archivedAt: null }),
        },
        orderBy: { name: "asc" },
        include: {
          establishment: { select: { id: true, name: true } },
        },
      });
      res.json({ contractors: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async get(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const contractor = await prisma.contractor.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          establishment: { select: { id: true, name: true } },
        },
      });
      if (!contractor) {
        res.status(404).json({ message: "Terceiro não encontrado." });
        return;
      }
      res.json({ contractor });
    } catch (err) {
      fail(res, err);
    }
  }

  async create(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const {
        name,
        tax_id,
        relation,
        establishment_id,
        services_scope,
        documents_received_at,
        documents_notes,
        risks_informed_at,
        interaction_measures,
      } = req.body as {
        name?: string;
        tax_id?: string;
        relation?: string;
        establishment_id?: string;
        services_scope?: string;
        documents_received_at?: string;
        documents_notes?: string;
        risks_informed_at?: string;
        interaction_measures?: string;
      };

      if (!name?.trim()) {
        res.status(400).json({ message: "Informe o name do terceiro." });
        return;
      }

      const resolvedRelation = relation
        ? isContractorRelation(relation)
          ? relation
          : null
        : CONTRACTOR_RELATION_DEFAULT;
      if (!resolvedRelation) {
        res.status(400).json({
          message: `relation inválida. Use: ${CONTRACTOR_RELATION_VALUES.join(", ")}.`,
        });
        return;
      }

      if (establishment_id) {
        const est = await new Establishment().read.one({
          id: establishment_id,
          organizationId: orgId,
          archivedAt: null,
        });
        if (!est) {
          res.status(400).json({ message: "Estabelecimento inválido." });
          return;
        }
      }

      const contractor = await new Contractor().create.new({
        organizationId: orgId,
        name: name.trim(),
        taxId: blank(tax_id),
        relation: resolvedRelation,
        establishmentId: establishment_id ?? null,
        servicesScope: blank(services_scope),
        documentsReceivedAt: parseOptionalDate(documents_received_at) ?? null,
        documentsNotes: blank(documents_notes),
        risksInformedAt: parseOptionalDate(risks_informed_at) ?? null,
        interactionMeasures: blank(interaction_measures),
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "contractor.create",
        entityType: "Contractor",
        entityId: contractor.id,
        after: { name: contractor.name, relation: contractor.relation },
      });

      res.status(201).json({ contractor });
    } catch (err) {
      fail(res, err);
    }
  }

  async update(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const current = await new Contractor().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!current) {
        res.status(404).json({ message: "Terceiro não encontrado." });
        return;
      }
      if (current.archivedAt) {
        res.status(409).json({
          message: "Terceiro arquivado — reative ou cadastre outro.",
        });
        return;
      }

      const body = req.body as Record<string, unknown>;

      if (body.relation !== undefined) {
        if (!isContractorRelation(String(body.relation))) {
          res.status(400).json({
            message: `relation inválida. Use: ${CONTRACTOR_RELATION_VALUES.join(", ")}.`,
          });
          return;
        }
      }

      if (body.establishment_id) {
        const est = await new Establishment().read.one({
          id: body.establishment_id as string,
          organizationId: orgId,
          archivedAt: null,
        });
        if (!est) {
          res.status(400).json({ message: "Estabelecimento inválido." });
          return;
        }
      }

      const contractor = await new Contractor().update.one(
        { id: current.id, organizationId: orgId },
        {
          ...(body.name !== undefined
            ? { name: String(body.name).trim() }
            : {}),
          ...(body.tax_id !== undefined
            ? { taxId: blank(body.tax_id as string) }
            : {}),
          ...(body.relation !== undefined
            ? { relation: body.relation as never }
            : {}),
          ...(body.establishment_id !== undefined
            ? { establishmentId: (body.establishment_id as string) || null }
            : {}),
          ...(body.services_scope !== undefined
            ? { servicesScope: blank(body.services_scope as string) }
            : {}),
          ...(body.documents_notes !== undefined
            ? { documentsNotes: blank(body.documents_notes as string) }
            : {}),
          ...(body.interaction_measures !== undefined
            ? {
                interactionMeasures: blank(
                  body.interaction_measures as string,
                ),
              }
            : {}),
          ...(body.documents_received_at !== undefined
            ? {
                documentsReceivedAt: parseOptionalDate(
                  body.documents_received_at as string | null,
                ),
              }
            : {}),
          ...(body.risks_informed_at !== undefined
            ? {
                risksInformedAt: parseOptionalDate(
                  body.risks_informed_at as string | null,
                ),
              }
            : {}),
        },
      );

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "contractor.update",
        entityType: "Contractor",
        entityId: current.id,
      });

      res.json({ contractor });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * 1.5.8.1.1 — registra recebimento do inventário/plano de ação da contratada
   * (aplicável sobretudo quando relation = WE_HIRE).
   */
  async markDocumentsReceived(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const current = await new Contractor().read.one({
        id: req.params.id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!current) {
        res.status(404).json({ message: "Terceiro não encontrado." });
        return;
      }

      const { received_at, notes } = req.body as {
        received_at?: string;
        notes?: string;
      };

      const contractor = await new Contractor().update.one(
        { id: current.id, organizationId: orgId },
        {
          documentsReceivedAt: received_at
            ? new Date(received_at)
            : new Date(),
          ...(notes !== undefined
            ? { documentsNotes: blank(notes) }
            : {}),
        },
      );

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "contractor.documents_received",
        entityType: "Contractor",
        entityId: current.id,
      });

      res.json({ contractor });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * 1.5.8.2 / 1.5.8.3 — informação recíproca dos riscos que impactam o outro.
   */
  async markRisksInformed(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const current = await new Contractor().read.one({
        id: req.params.id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!current) {
        res.status(404).json({ message: "Terceiro não encontrado." });
        return;
      }

      const { informed_at, interaction_measures } = req.body as {
        informed_at?: string;
        interaction_measures?: string;
      };

      const contractor = await new Contractor().update.one(
        { id: current.id, organizationId: orgId },
        {
          risksInformedAt: informed_at ? new Date(informed_at) : new Date(),
          ...(interaction_measures !== undefined
            ? {
                interactionMeasures: blank(interaction_measures),
              }
            : {}),
        },
      );

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "contractor.risks_informed",
        entityType: "Contractor",
        entityId: current.id,
      });

      res.json({ contractor });
    } catch (err) {
      fail(res, err);
    }
  }

  async archive(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const current = await new Contractor().read.one({
        id: req.params.id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!current) {
        res.status(404).json({ message: "Terceiro não encontrado." });
        return;
      }

      const contractor = await new Contractor().update.one(
        { id: current.id, organizationId: orgId },
        { archivedAt: new Date() },
      );

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "contractor.archive",
        entityType: "Contractor",
        entityId: current.id,
      });

      res.json({ contractor });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new ContractorController();

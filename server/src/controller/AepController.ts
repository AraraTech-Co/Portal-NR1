import { AepMethod } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Aep } from "../model/schema/Aep/Aep";
import { Establishment } from "../model/schema/Establishment/Establishment";
import { Sector } from "../model/schema/Sector/Sector";
import { Activity } from "../model/schema/Activity/Activity";
import { Hazard } from "../model/schema/Hazard/Hazard";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { canManageModule } from "../helper/module-access";
import {
  findPsychosocialFactor,
  psychosocialFactorNote,
  PSYCHOSOCIAL_FACTORS,
} from "../helper/psychosocial-factors";
import {
  assertSize,
  buildEvidenceStoragePath,
  writeEvidenceFile,
} from "../helper/uploads";
import {
  AEP_METHOD_DEFAULT,
  AEP_METHOD_TO_HAZARD_ORIGIN,
  AEP_METHODS,
  AEP_STATUSES,
  HAZARD_CATEGORIES,
} from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

function assertMethodConsistency(
  method: AepMethod,
  anonymityMeasures: string | null,
) {
  if (method === AEP_METHODS.QUESTIONNAIRE && !anonymityMeasures) {
    throw Object.assign(
      new Error(
        "Método por questionário exige registrar como o anonimato das respostas foi garantido.",
      ),
      { status: 400 },
    );
  }
}

function originFromMethod(method: AepMethod) {
  return AEP_METHOD_TO_HAZARD_ORIGIN[method];
}

/**
 * Quem tem escrita sem administrar o módulo (o colaborador) mexe só na
 * avaliação que ele conduz. [S4-A]
 */
function ownsOrManages(req: AuthRequest, conductedById: string | null): boolean {
  if (req.actor && canManageModule(req.actor.permission, "aep")) return true;
  return conductedById === actorUserId(req);
}

async function resolveScope(
  organizationId: string,
  establishmentId: string,
  input: { sector_id?: string | null; activity_id?: string | null },
) {
  const establishment = await new Establishment().read.one({
    id: establishmentId,
    organizationId,
    archivedAt: null,
  });
  if (!establishment) {
    throw Object.assign(new Error("Estabelecimento não encontrado."), {
      status: 404,
    });
  }

  let sectorId: string | null = null;
  if (input.sector_id) {
    const sector = await new Sector().read.one({
      id: input.sector_id,
      organizationId,
      establishmentId,
      archivedAt: null,
    });
    if (!sector) {
      throw Object.assign(
        new Error("Setor não encontrado neste estabelecimento."),
        { status: 404 },
      );
    }
    sectorId = sector.id;
  }

  let activityId: string | null = null;
  if (input.activity_id) {
    const activity = await new Activity().read.one({
      id: input.activity_id,
      organizationId,
      establishmentId,
      archivedAt: null,
      ...(sectorId ? { sectorId } : {}),
    });
    if (!activity) {
      throw Object.assign(new Error("Atividade não encontrada neste escopo."), {
        status: 404,
      });
    }
    activityId = activity.id;
    sectorId = sectorId ?? activity.sectorId;
  }

  return { establishmentId, sectorId, activityId };
}

class AepController {
  async listFactors(_req: Request, res: Response) {
    res.json({ factors: PSYCHOSOCIAL_FACTORS });
  }

  async list(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const status = req.query.status as string | undefined;
      const establishmentId = req.query.establishment_id as string | undefined;
      const rows = await prisma.aep.findMany({
        where: {
          organizationId: orgId,
          ...(status === "DRAFT" || status === "CONCLUDED"
            ? { status }
            : {}),
          ...(establishmentId ? { establishmentId } : {}),
        },
        orderBy: [{ status: "asc" }, { conductedAt: "desc" }],
        include: {
          establishment: { select: { id: true, name: true } },
          sector: { select: { id: true, name: true } },
          activity: { select: { id: true, name: true } },
          conductedBy: { select: { id: true, name: true } },
          _count: { select: { hazards: true, evidences: true } },
        },
      });
      res.json({ aeps: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async get(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const aep = await prisma.aep.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          establishment: { select: { id: true, name: true } },
          sector: { select: { id: true, name: true } },
          activity: { select: { id: true, name: true } },
          conductedBy: { select: { id: true, name: true } },
          hazards: {
            where: { archivedAt: null },
            orderBy: { createdAt: "asc" },
            include: {
              activity: { select: { id: true, name: true } },
              risks: {
                where: { archivedAt: null },
                select: { id: true, description: true },
              },
            },
          },
          evidences: { orderBy: { uploadedAt: "desc" } },
        },
      });
      if (!aep) {
        res.status(404).json({ message: "Avaliação não encontrada." });
        return;
      }
      res.json({ aep });
    } catch (err) {
      fail(res, err);
    }
  }

  async create(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const body = req.body as Record<string, unknown>;
      const establishmentId = body.establishment_id as string | undefined;
      const scopeDescription = body.scope_description as string | undefined;
      const method = (body.method as AepMethod) || AEP_METHOD_DEFAULT;

      if (!establishmentId || !scopeDescription?.trim()) {
        res.status(400).json({
          message: "Informe establishment_id e scope_description.",
        });
        return;
      }

      const scope = await resolveScope(orgId, establishmentId, {
        sector_id: body.sector_id as string | undefined,
        activity_id: body.activity_id as string | undefined,
      });
      const anonymityMeasures = blank(body.anonymity_measures as string);
      assertMethodConsistency(method, anonymityMeasures);

      const aep = await new Aep().create.new({
        organizationId: orgId,
        establishmentId: scope.establishmentId,
        sectorId: scope.sectorId,
        activityId: scope.activityId,
        scopeDescription: scopeDescription.trim(),
        method,
        methodRationale: blank(body.method_rationale as string),
        anonymityMeasures,
        workersConsulted: (body.workers_consulted as number) ?? null,
        findings: blank(body.findings as string),
        conductedById: userId,
        status: AEP_STATUSES.DRAFT,
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "aep.create",
        entityType: "Aep",
        entityId: aep.id,
        after: { method: aep.method, scopeDescription: aep.scopeDescription },
      });

      res.status(201).json({ aep });
    } catch (err) {
      fail(res, err);
    }
  }

  async update(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const current = await new Aep().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!current) {
        res.status(404).json({ message: "Avaliação não encontrada." });
        return;
      }
      if (!ownsOrManages(req as AuthRequest, current.conductedById)) {
        res.status(403).json({ message: "Só quem conduz a avaliação pode editá-la." });
        return;
      }
      if (current.status !== AEP_STATUSES.DRAFT) {
        res.status(409).json({
          message:
            "Avaliação concluída não pode ser editada — registre uma nova AEP.",
        });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const scope =
        body.sector_id !== undefined || body.activity_id !== undefined
          ? await resolveScope(orgId, current.establishmentId, {
              sector_id: body.sector_id as string | undefined,
              activity_id: body.activity_id as string | undefined,
            })
          : null;

      const method = (body.method as AepMethod) ?? current.method;
      const anonymityMeasures =
        body.anonymity_measures !== undefined
          ? blank(body.anonymity_measures as string)
          : current.anonymityMeasures;
      assertMethodConsistency(method, anonymityMeasures);

      const aep = await new Aep().update.one(
        { id: current.id, organizationId: orgId },
        {
          ...(scope
            ? { sectorId: scope.sectorId, activityId: scope.activityId }
            : {}),
          ...(body.scope_description !== undefined
            ? { scopeDescription: String(body.scope_description).trim() }
            : {}),
          method,
          ...(body.method_rationale !== undefined
            ? { methodRationale: blank(body.method_rationale as string) }
            : {}),
          anonymityMeasures,
          ...(body.workers_consulted !== undefined
            ? { workersConsulted: body.workers_consulted }
            : {}),
          ...(body.findings !== undefined
            ? { findings: blank(body.findings as string) }
            : {}),
        },
      );

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "aep.update",
        entityType: "Aep",
        entityId: current.id,
      });

      res.json({ aep });
    } catch (err) {
      fail(res, err);
    }
  }

  async conclude(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const { findings, needs_aet, aet_reason } = req.body as {
        findings?: string;
        needs_aet?: boolean;
        aet_reason?: string;
      };

      const result = await prisma.$transaction(async (tx) => {
        const aep = await tx.aep.findFirst({
          where: { id: req.params.id, organizationId: orgId },
        });
        if (!aep) {
          throw Object.assign(new Error("Avaliação não encontrada."), {
            status: 404,
          });
        }
        if (aep.status === AEP_STATUSES.CONCLUDED) {
          throw Object.assign(new Error("Avaliação já concluída."), {
            status: 409,
          });
        }

        const findingsValue =
          findings !== undefined ? blank(findings) : aep.findings;
        const aetReason = blank(aet_reason);
        const needsAet = Boolean(needs_aet);

        const hazardCount = await tx.hazard.count({
          where: { aepId: aep.id, archivedAt: null },
        });
        if (hazardCount === 0 && !findingsValue) {
          throw Object.assign(
            new Error(
              "Para concluir sem fator identificado, registre a justificativa técnica (findings).",
            ),
            { status: 400 },
          );
        }
        if (needsAet && !aetReason) {
          throw Object.assign(
            new Error("Informe por que a AET é necessária (NR-17 17.3.2)."),
            { status: 400 },
          );
        }

        return tx.aep.update({
          where: { id: aep.id },
          data: {
            status: AEP_STATUSES.CONCLUDED,
            concludedAt: new Date(),
            findings: findingsValue,
            needsAet,
            aetReason: needsAet ? aetReason : null,
          },
        });
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "aep.conclude",
        entityType: "Aep",
        entityId: result.id,
        after: { needsAet: result.needsAet },
      });

      res.json({ aep: result });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Fator identificado → Hazard PSYCHOSOCIAL ligado à AEP (entra no inventário). */
  async addHazard(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const aep = await new Aep().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!aep) {
        res.status(404).json({ message: "Avaliação não encontrada." });
        return;
      }
      if (aep.status !== AEP_STATUSES.DRAFT) {
        res.status(409).json({
          message: "Avaliação concluída não recebe novos fatores.",
        });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const description = body.description as string | undefined;
      if (!description?.trim()) {
        res.status(400).json({ message: "Descreva o fator identificado." });
        return;
      }

      const targetActivityId =
        aep.activityId ?? (body.activity_id as string | undefined);
      if (!targetActivityId) {
        res.status(400).json({
          message: "Escolha a atividade a que este fator se refere.",
        });
        return;
      }
      const activity = await new Activity().read.one({
        id: targetActivityId,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!activity) {
        res.status(404).json({ message: "Atividade não encontrada." });
        return;
      }

      const factorId = body.factor_id as string | undefined;
      const factor = factorId ? findPsychosocialFactor(factorId) : undefined;

      const hazard = await new Hazard().create.new({
        organizationId: orgId,
        activityId: activity.id,
        aepId: aep.id,
        description: description.trim(),
        source: blank(body.source as string),
        consequences: blank(body.consequences as string),
        exposedGroup: blank(body.exposed_group as string),
        exposedWorkersCount: (body.exposed_workers_count as number) ?? null,
        monitoringData: psychosocialFactorNote(factor),
        category: HAZARD_CATEGORIES.PSYCHOSOCIAL,
        origin: originFromMethod(aep.method),
        createdById: userId,
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "aep.hazard.create",
        entityType: "Hazard",
        entityId: hazard.id,
        after: {
          aepId: aep.id,
          factorId: factor?.id ?? factorId ?? null,
          fromCatalog: !!factor,
        },
      });

      res.status(201).json({ hazard });
    } catch (err) {
      fail(res, err);
    }
  }

  async addEvidence(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const aep = await new Aep().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!aep) {
        res.status(404).json({ message: "Avaliação não encontrada." });
        return;
      }
      if (!ownsOrManages(req as AuthRequest, aep.conductedById)) {
        res.status(403).json({ message: "Só quem conduz a avaliação anexa evidência." });
        return;
      }
      if (aep.status !== AEP_STATUSES.DRAFT) {
        res.status(409).json({
          message: "Avaliação concluída não recebe novas evidências.",
        });
        return;
      }

      const {
        file_name,
        mime_type,
        description,
        event_date,
        content_base64,
      } = req.body as {
        file_name?: string;
        mime_type?: string;
        description?: string;
        event_date?: string;
        content_base64?: string;
      };

      if (!file_name?.trim() || !mime_type) {
        res.status(400).json({ message: "Informe file_name e mime_type." });
        return;
      }

      const data = content_base64
        ? Buffer.from(content_base64, "base64")
        : Buffer.alloc(0);
      assertSize(data.length);
      const { storagePath, absolutePath } = buildEvidenceStoragePath(
        orgId,
        mime_type,
      );
      writeEvidenceFile(absolutePath, data);

      const evidence = await prisma.evidence.create({
        data: {
          organizationId: orgId,
          type: "DOCUMENT",
          storagePath,
          fileName: file_name.trim(),
          mimeType: mime_type,
          sizeBytes: data.length,
          description: description ?? null,
          eventDate: event_date ? new Date(event_date) : null,
          uploadedById: userId,
          aepId: aep.id,
        },
      });

      res.status(201).json({ evidence });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new AepController();

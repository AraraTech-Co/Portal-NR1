import { AssessmentStatus, PgrDocumentType } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Establishment } from "../model/schema/Establishment/Establishment";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { REQUIRED_PGR_DOCUMENTS } from "../helper/compliance";
import { writeAudit } from "../helper/audit";
import { isPgrDocumentType } from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

const DEFAULT_SIGNATURE =
  "Declaro, sob minha responsabilidade, que o conteúdo deste documento reflete o estado do gerenciamento de riscos ocupacionais na data da emissão.";

async function buildInventorySnapshot(
  organizationId: string,
  establishmentId?: string | null,
) {
  const hazards = await prisma.hazard.findMany({
    where: {
      organizationId,
      archivedAt: null,
      ...(establishmentId
        ? { activity: { establishmentId } }
        : {}),
    },
    include: {
      activity: {
        include: { sector: true, establishment: true },
      },
      risks: {
        where: { archivedAt: null },
        include: {
          assessments: {
            where: { status: AssessmentStatus.VALIDATED },
            orderBy: { validatedAt: "desc" },
            take: 1,
          },
          controls: { where: { archivedAt: null } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    generated_at: new Date().toISOString(),
    /*
      Os critérios de avaliação e de decisão são conteúdo do inventário
      (NR-1 1.5.7.3.2 "f"), e iam num terceiro documento que a norma não
      pede. [B3-4-J]
    */
    criteria: await buildCriteriaSnapshot(organizationId),
    items: hazards.map((h) => ({
      hazard_id: h.id,
      description: h.description,
      source: h.source,
      consequences: h.consequences,
      exposed_group: h.exposedGroup,
      exposed_workers_count: h.exposedWorkersCount,
      exposure_time: h.exposureTime,
      exposure_frequency: h.exposureFrequency,
      exposure_intensity: h.exposureIntensity,
      monitoring_data: h.monitoringData,
      category: h.category,
      activity: h.activity.name,
      sector: h.activity.sector.name,
      establishment: h.activity.establishment.name,
      risks: h.risks.map((r) => ({
        risk_id: r.id,
        description: r.description,
        needs_reassessment: r.needsReassessment,
        level: r.assessments[0]?.resultingLevel ?? null,
        severity: r.assessments[0]?.severity ?? null,
        probability: r.assessments[0]?.probability ?? null,
        controls: r.controls.map((c) => ({
          id: c.id,
          type: c.type,
          description: c.description,
          status: c.status,
        })),
      })),
    })),
  };
}

async function buildActionPlanSnapshot(
  organizationId: string,
  establishmentId?: string | null,
) {
  const actions = await prisma.action.findMany({
    where: {
      organizationId,
      /*
        O plano por unidade levava junto toda ação sem risco da organização:
        o documento de uma unidade descrevia ação de outra. Ação sem risco
        não pertence a unidade nenhuma e fica no documento da organização.
        [S2-F] [S6-D]
      */
      ...(establishmentId
        ? { risk: { hazard: { activity: { establishmentId } } } }
        : {}),
    },
    include: {
      risk: true,
      control: true,
      evidences: true,
      assignee: { select: { id: true, name: true } },
      validatedBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return {
    generated_at: new Date().toISOString(),
    actions: actions.map((a) => ({
      id: a.id,
      title: a.title,
      description: a.description,
      status: a.status,
      priority: a.priority,
      due_date: a.dueDate,
      effectiveness_criteria: a.effectivenessCriteria,
      effectiveness_result: a.effectivenessResult,
      assignee: a.assignee?.name ?? null,
      /// A separação "quem faz não valida" precisa aparecer no papel. [B2-4-D]
      validated_by: a.validatedBy?.name ?? null,
      validated_at: a.validatedAt,
      risk_id: a.riskId,
      control_id: a.controlId,
      evidence_count: a.evidences.length,
    })),
  };
}

async function buildCriteriaSnapshot(organizationId: string) {
  const methodologies = await prisma.riskMethodology.findMany({
    where: {
      archivedAt: null,
      OR: [{ organizationId: null }, { organizationId }],
    },
    include: {
      versions: { orderBy: { version: "desc" }, take: 1 },
    },
  });

  return {
    generated_at: new Date().toISOString(),
    note: "Critérios de severidade, probabilidade, níveis e matriz (1.5.4.4.2.2).",
    methodologies: methodologies.map((m) => ({
      id: m.id,
      name: m.name,
      is_default: m.isDefault,
      version: m.versions[0]
        ? {
            id: m.versions[0].id,
            version: m.versions[0].version,
            severity_scale: m.versions[0].severityScale,
            probability_scale: m.versions[0].probabilityScale,
            matrix: m.versions[0].matrix,
            levels: m.versions[0].levels,
          }
        : null,
    })),
  };
}

/**
 * Ações que mudam o inventário e o plano de ação. Um documento emitido antes
 * de qualquer uma delas não descreve mais o que a empresa tem hoje. [B2-4-A]
 */
const MUDA_O_PGR = [
  "hazard.",
  "risk.",
  "assessment.",
  "control.",
  "action.",
  "activity.",
  "sector.",
  "establishment.",
  "change_event.",
];

/**
 * O documento emitido envelhece: o que vale é o retrato do dia da emissão, e
 * o portal precisa dizer quando o inventário andou depois disso. Sem isso, a
 * empresa mostra ao fiscal um papel que não corresponde ao que existe. [B2-4-A]
 */
async function changesSince(organizationId: string, since: Date): Promise<number> {
  return prisma.auditEvent.count({
    where: {
      organizationId,
      createdAt: { gt: since },
      OR: MUDA_O_PGR.map((prefixo) => ({ action: { startsWith: prefixo } })),
    },
  });
}

/** Quantos itens o retrato guarda — é o que diz se o documento saiu vazio. */
function snapshotSize(type: string, content: unknown): number {
  const c = (content ?? {}) as Record<string, unknown[]>;
  if (type === PgrDocumentType.INVENTORY) return c.items?.length ?? 0;
  if (type === PgrDocumentType.ACTION_PLAN) return c.actions?.length ?? 0;
  if (type === PgrDocumentType.CRITERIA) return c.methodologies?.length ?? 0;
  return 0;
}

class DocumentController {
  /** Inventário vivo (projeção) — não é documento assinado. */
  async getInventory(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const establishmentId = req.query.establishment_id as string | undefined;
      const snapshot = await buildInventorySnapshot(orgId, establishmentId);

      /*
        Avaliar e reavaliar só se fazia pela tela de registro, perigo a
        perigo; a tabela do Inventário, que é onde o SST de fato olha os
        riscos, só tinha "Histórico". O id da atividade sai daqui para a
        tela levar a pessoa direto ao lugar certo.

        Vai só na projeção, nunca no documento emitido: o que é assinado e
        arquivado continua tendo fatos legíveis, não identificadores de
        banco. [CB-22]
      */
      const ids = await prisma.hazard.findMany({
        where: { id: { in: snapshot.items.map((i) => i.hazard_id) } },
        select: { id: true, activityId: true },
      });
      const porPerigo = new Map(ids.map((h) => [h.id, h.activityId]));

      res.json({
        inventory: {
          ...snapshot,
          items: snapshot.items.map((i) => ({
            ...i,
            activity_id: porPerigo.get(i.hazard_id) ?? null,
          })),
        },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async listDocuments(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const type = req.query.type as string | undefined;
      const rows = await prisma.pgrDocument.findMany({
        where: {
          organizationId: orgId,
          ...(type ? { type: type as PgrDocumentType } : {}),
        },
        orderBy: [{ type: "asc" }, { version: "desc" }],
        include: { establishment: { select: { id: true, name: true } } },
      });

      // Só a versão mais nova de cada tipo precisa do aviso: as anteriores
      // já foram substituídas de propósito.
      const vigentes = new Map<string, string>();
      for (const d of rows) {
        const chave = `${d.type}|${d.establishmentId ?? ""}`;
        if (!vigentes.has(chave)) vigentes.set(chave, d.id);
      }
      const mudancas = new Map<string, number>();
      for (const d of rows) {
        if (vigentes.get(`${d.type}|${d.establishmentId ?? ""}`) === d.id) {
          mudancas.set(d.id, await changesSince(orgId, d.issuedAt));
        }
      }

      res.json({
        documents: rows.map(({ content, ...d }) => ({
          ...d,
          items: snapshotSize(d.type, content),
          is_current: vigentes.get(`${d.type}|${d.establishmentId ?? ""}`) === d.id,
          changes_since: mudancas.get(d.id) ?? 0,
          outdated: (mudancas.get(d.id) ?? 0) > 0,
        })),
        required_types: REQUIRED_PGR_DOCUMENTS,
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Um documento emitido, inteiro, para abrir, imprimir e salvar em PDF:
   * o retrato assinado mais quem emitiu, a empresa e o estabelecimento. [S2-C]
   */
  async getDocument(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const doc = await prisma.pgrDocument.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          issuedBy: { select: { id: true, name: true } },
          establishment: { select: { id: true, name: true } },
          organization: { select: { name: true, taxId: true } },
        },
      });
      if (!doc) {
        res.status(404).json({ message: "Documento não encontrado." });
        return;
      }
      const maisNovo = await prisma.pgrDocument.findFirst({
        where: {
          organizationId: orgId,
          type: doc.type,
          establishmentId: doc.establishmentId,
        },
        orderBy: { version: "desc" },
        select: { id: true, version: true },
      });
      const atual = maisNovo?.id === doc.id;
      const mudancas = atual ? await changesSince(orgId, doc.issuedAt) : 0;
      res.json({
        document: {
          ...doc,
          is_current: atual,
          current_version: maisNovo?.version ?? doc.version,
          changes_since: mudancas,
          outdated: atual && mudancas > 0,
        },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Emite documento PGR append-only (BR-22/23).
   * type: INVENTORY | ACTION_PLAN | CRITERIA
   */
  async issueDocument(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const {
        type,
        establishment_id,
        responsible_name,
        responsible_role,
        responsible_registration,
        signature_statement,
      } = req.body as {
        type?: string;
        establishment_id?: string | null;
        responsible_name?: string;
        responsible_role?: string;
        responsible_registration?: string;
        signature_statement?: string;
      };

      /* Os critérios vão dentro do inventário: não se emitem mais à parte. [B3-4-J] */
      if (type === PgrDocumentType.CRITERIA) {
        res.status(400).json({
          message:
            "Os critérios de avaliação vão dentro do inventário de riscos (NR-1 1.5.7.3.2 \"f\"). Emita o inventário.",
          code: "CRITERIA_IN_INVENTORY",
        });
        return;
      }
      if (!type || !isPgrDocumentType(type) || !REQUIRED_PGR_DOCUMENTS.includes(type as never)) {
        res.status(400).json({
          message: `type deve ser um de: ${REQUIRED_PGR_DOCUMENTS.join(", ")}`,
        });
        return;
      }

      const org = await prisma.organization.findFirst({ where: { id: orgId } });
      if (!org) {
        res.status(404).json({ message: "Organização não encontrada." });
        return;
      }

      const responsibleName =
        responsible_name?.trim() || org.responsibleName || null;
      if (!responsibleName) {
        res.status(400).json({
          message:
            "Informe responsible_name (ou cadastre o responsável na organização).",
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

      let content: unknown;
      if (type === PgrDocumentType.INVENTORY) {
        content = await buildInventorySnapshot(orgId, establishment_id);
      } else {
        content = await buildActionPlanSnapshot(orgId, establishment_id);
      }

      /*
        Documento vazio assinado é pior que documento nenhum: a obrigação
        aparece como cumprida e o papel declara que reflete o gerenciamento
        de riscos da organização. [S2-B] [B2-4-A]
      */
      if (snapshotSize(type, content) === 0) {
        const falta: Record<string, string> = {
          [PgrDocumentType.INVENTORY]:
            "Não há nenhum perigo registrado para emitir o inventário. Levante os perigos antes de assinar.",
          [PgrDocumentType.ACTION_PLAN]:
            "Não há nenhuma ação para emitir o plano de ação. Abra as ações antes de assinar.",
        };
        res.status(400).json({
          message: falta[type] ?? "Não há conteúdo para emitir este documento.",
          code: "EMPTY_DOCUMENT",
        });
        return;
      }

      const last = await prisma.pgrDocument.findFirst({
        where: {
          organizationId: orgId,
          type,
          establishmentId: establishment_id ?? null,
        },
        orderBy: { version: "desc" },
      });
      const version = (last?.version ?? 0) + 1;

      const doc = await prisma.pgrDocument.create({
        data: {
          organizationId: orgId,
          establishmentId: establishment_id ?? null,
          type,
          version,
          content: content as never,
          issuedById: userId,
          responsibleName,
          responsibleRole:
            responsible_role ?? org.responsibleRole ?? null,
          responsibleRegistration:
            responsible_registration ?? org.responsibleRegistration ?? null,
          signatureStatement:
            signature_statement?.trim() || DEFAULT_SIGNATURE,
        },
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "pgr_document.issue",
        entityType: "PgrDocument",
        entityId: doc.id,
        after: { type: doc.type, version: doc.version },
      });

      res.status(201).json({ document: doc });
    } catch (err) {
      fail(res, err);
    }
  }

  // —— Change events ——
  async listChangeEvents(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const rows = await prisma.changeEvent.findMany({
        where: { organizationId: orgId },
        orderBy: { occurredAt: "desc" },
      });
      res.json({ change_events: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async createChangeEvent(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const {
        type,
        description,
        establishment_id,
        occurred_at,
        flag_risk_ids,
      } = req.body as {
        type?: string;
        description?: string;
        establishment_id?: string;
        occurred_at?: string;
        flag_risk_ids?: string[];
      };

      if (!type || !description?.trim()) {
        res.status(400).json({ message: "Informe type e description." });
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

      const event = await prisma.$transaction(async (tx) => {
        const created = await tx.changeEvent.create({
          data: {
            organizationId: orgId,
            establishmentId: establishment_id ?? null,
            type: type as never,
            description: description.trim(),
            occurredAt: occurred_at ? new Date(occurred_at) : new Date(),
            reportedById: userId,
          },
        });

        if (flag_risk_ids?.length) {
          await tx.risk.updateMany({
            where: {
              id: { in: flag_risk_ids },
              organizationId: orgId,
              archivedAt: null,
            },
            data: {
              needsReassessment: true,
              reassessmentReason: `Mudança registrada: ${created.description}`,
            },
          });
        }

        await tx.auditEvent.create({
          data: {
            organizationId: orgId,
            actorId: userId,
            action: "change_event.create",
            entityType: "ChangeEvent",
            entityId: created.id,
            after: { type: created.type, flag_risk_ids: flag_risk_ids ?? [] },
          },
        });

        return created;
      });

      res.status(201).json({ change_event: event });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new DocumentController();

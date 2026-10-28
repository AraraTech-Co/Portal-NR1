import { Request, Response } from "express";
import prisma from "../model/prisma";
import { EmergencyProcedure } from "../model/schema/EmergencyProcedure/EmergencyProcedure";
import { EmergencyDrill } from "../model/schema/EmergencyDrill/EmergencyDrill";
import { Establishment } from "../model/schema/Establishment/Establishment";
import { Evidence } from "../model/schema/Evidence/Evidence";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import {
  assertSize,
  buildEvidenceStoragePath,
  writeEvidenceFile,
} from "../helper/uploads";
import {
  EMERGENCY_DRILL_FREQUENCY_MONTHS_DEFAULT,
  EVIDENCE_TYPES,
  EVIDENCE_VALIDATION_STATUSES,
} from "../constants";
import { sendPrivateFile } from "../helper/send-private-file";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string; code?: string };
  res
    .status(e.status || 500)
    .json({ message: e.message || "Erro interno.", ...(e.code ? { code: e.code } : {}) });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

function httpError(status: number, message: string, code?: string): Error {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

/*
  Os responsáveis da empresa ficam ligados ao cadastro: gravados como texto,
  o nome de quem foi desligado continuava no plano sem aviso. O texto fica
  para quem é de fora (brigada terceirizada, bombeiros). [B3-4-B]
*/
async function responsaveisValidos(orgId: string, bruto: unknown): Promise<string[] | undefined> {
  if (bruto === undefined) return undefined;
  if (!Array.isArray(bruto) || bruto.some((x) => typeof x !== "string")) {
    throw httpError(400, "responsible_user_ids deve ser uma lista de pessoas.");
  }
  const ids = [...new Set(bruto as string[])];
  if (ids.length === 0) return [];
  const ativos = await prisma.membership.findMany({
    where: {
      organizationId: orgId,
      userId: { in: ids },
      suspendedAt: null,
      user: { active: true },
    },
    select: { userId: true },
  });
  if (ativos.length !== ids.length) {
    throw httpError(
      400,
      "Responsável tem de ser pessoa da empresa com acesso ativo. Quem foi desligado ou está sem acesso não entra no plano.",
      "RESPONSIBLE_NOT_ACTIVE",
    );
  }
  return ids;
}

type SituacaoDoResponsavel = "ativo" | "desligado" | "sem_acesso";

/** A situação de cada responsável ligado, para a tela avisar de quem saiu. */
async function situacaoDosResponsaveis(orgId: string, userIds: string[]) {
  const mapa = new Map<string, { situacao: SituacaoDoResponsavel; desde: Date | null }>();
  if (userIds.length === 0) return mapa;
  const [membros, fichas] = await Promise.all([
    prisma.membership.findMany({
      where: { organizationId: orgId, userId: { in: userIds } },
      select: { userId: true, suspendedAt: true, suspensionReason: true, user: { select: { active: true } } },
    }),
    prisma.employeeProfile.findMany({
      where: { organizationId: orgId, userId: { in: userIds } },
      select: { userId: true, dismissedAt: true },
    }),
  ]);
  const desligamento = new Map(fichas.map((f) => [f.userId, f.dismissedAt]));
  for (const id of userIds) {
    const m = membros.find((x) => x.userId === id);
    const saiu = desligamento.get(id) ?? null;
    if (saiu || m?.suspensionReason === "DISMISSAL") {
      mapa.set(id, { situacao: "desligado", desde: saiu ?? m?.suspendedAt ?? null });
    } else if (!m || m.suspendedAt || !m.user.active) {
      mapa.set(id, { situacao: "sem_acesso", desde: m?.suspendedAt ?? null });
    } else {
      mapa.set(id, { situacao: "ativo", desde: null });
    }
  }
  return mapa;
}

class EmergencyController {
  async listProcedures(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const establishmentId = req.query.establishment_id as string | undefined;
      const includeArchived = req.query.include_archived === "true";
      const rows = await prisma.emergencyProcedure.findMany({
        where: {
          organizationId: orgId,
          ...(establishmentId ? { establishmentId } : {}),
          ...(includeArchived ? {} : { archivedAt: null }),
        },
        orderBy: { updatedAt: "desc" },
        include: {
          establishment: { select: { id: true, name: true } },
          responsiblePeople: { select: { userId: true } },
          _count: { select: { drills: true } },
          drills: {
            orderBy: { performedAt: "desc" },
            take: 1,
            select: { id: true, performedAt: true },
          },
        },
      });
      const situacoes = await situacaoDosResponsaveis(
        orgId,
        [...new Set(rows.flatMap((p) => p.responsiblePeople.map((r) => r.userId)))],
      );
      res.json({
        procedures: rows.map(({ responsiblePeople, ...p }) => ({
          ...p,
          /** Quantos responsáveis ligados saíram ou estão sem acesso. [B3-4-B] */
          responsibles_out: responsiblePeople.filter(
            (r) => situacoes.get(r.userId)?.situacao !== "ativo",
          ).length,
          last_drill_at: p.drills[0]?.performedAt ?? null,
          drill_frequency_months:
            p.drillFrequencyMonths ?? EMERGENCY_DRILL_FREQUENCY_MONTHS_DEFAULT,
          drills: undefined,
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async getProcedure(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const procedure = await prisma.emergencyProcedure.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          establishment: { select: { id: true, name: true } },
          responsiblePeople: {
            orderBy: { createdAt: "asc" },
            select: { user: { select: { id: true, name: true } } },
          },
          drills: {
            orderBy: { performedAt: "desc" },
            include: {
              recordedBy: { select: { id: true, name: true } },
              /* A tela de detalhe lista e baixa a ata. [B3-4-B] */
              evidences: {
                orderBy: { uploadedAt: "desc" },
                select: {
                  id: true,
                  fileName: true,
                  description: true,
                  mimeType: true,
                  sizeBytes: true,
                  uploadedAt: true,
                },
              },
              _count: { select: { evidences: true } },
            },
          },
        },
      });
      if (!procedure) {
        res.status(404).json({ message: "Procedimento não encontrado." });
        return;
      }
      const { responsiblePeople, ...resto } = procedure;
      const situacoes = await situacaoDosResponsaveis(
        orgId,
        responsiblePeople.map((r) => r.user.id),
      );
      res.json({
        procedure: {
          ...resto,
          responsible_people: responsiblePeople.map((r) => ({
            id: r.user.id,
            name: r.user.name,
            situacao: situacoes.get(r.user.id)?.situacao ?? "sem_acesso",
            desde: situacoes.get(r.user.id)?.desde ?? null,
          })),
          drill_frequency_months:
            procedure.drillFrequencyMonths ??
            EMERGENCY_DRILL_FREQUENCY_MONTHS_DEFAULT,
        },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async createProcedure(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const {
        establishment_id,
        scenario,
        first_aid_means,
        responsibles,
        evacuation_plan,
        large_scale_measures,
        drill_frequency_months,
        responsible_user_ids,
      } = req.body as {
        establishment_id?: string;
        scenario?: string;
        first_aid_means?: string;
        responsibles?: string;
        evacuation_plan?: string;
        large_scale_measures?: string;
        drill_frequency_months?: number;
        responsible_user_ids?: unknown;
      };

      if (!establishment_id || !scenario?.trim()) {
        res.status(400).json({
          message: "Informe establishment_id e scenario.",
        });
        return;
      }

      // 1.5.6.2 "a": meios, responsáveis e abandono do local.
      const firstAidMeans = blank(first_aid_means);
      const responsiblesText = blank(responsibles);
      const evacuationPlan = blank(evacuation_plan);
      const pessoas = (await responsaveisValidos(orgId, responsible_user_ids)) ?? [];
      if (!firstAidMeans || (!responsiblesText && pessoas.length === 0) || !evacuationPlan) {
        res.status(400).json({
          message:
            "Informe os primeiros socorros, os responsáveis (pessoas da empresa ou, para quem é de fora, o texto) e o abandono do local (NR-1 1.5.6.2 a).",
        });
        return;
      }

      const establishment = await new Establishment().read.one({
        id: establishment_id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!establishment) {
        res.status(404).json({ message: "Estabelecimento não encontrado." });
        return;
      }

      if (
        drill_frequency_months !== undefined &&
        (typeof drill_frequency_months !== "number" ||
          drill_frequency_months < 1)
      ) {
        res.status(400).json({
          message: "drill_frequency_months deve ser um inteiro ≥ 1.",
        });
        return;
      }

      const procedure = await new EmergencyProcedure().create.new({
        organizationId: orgId,
        establishmentId: establishment_id,
        scenario: scenario.trim(),
        firstAidMeans,
        responsibles: responsiblesText,
        evacuationPlan,
        largeScaleMeasures: blank(large_scale_measures),
        drillFrequencyMonths:
          drill_frequency_months ?? EMERGENCY_DRILL_FREQUENCY_MONTHS_DEFAULT,
      });

      if (pessoas.length > 0) {
        await prisma.emergencyProcedureResponsible.createMany({
          data: pessoas.map((id) => ({ procedureId: procedure.id, userId: id })),
        });
      }

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "emergency_procedure.create",
        entityType: "EmergencyProcedure",
        entityId: procedure.id,
        after: { scenario: procedure.scenario, responsible_user_ids: pessoas },
      });

      res.status(201).json({ procedure });
    } catch (err) {
      fail(res, err);
    }
  }

  async updateProcedure(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const current = await new EmergencyProcedure().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!current) {
        res.status(404).json({ message: "Procedimento não encontrado." });
        return;
      }
      if (current.archivedAt) {
        res.status(409).json({
          message: "Procedimento arquivado — reative ou crie outro.",
        });
        return;
      }

      const body = req.body as Record<string, unknown>;
      if (
        body.drill_frequency_months !== undefined &&
        (typeof body.drill_frequency_months !== "number" ||
          (body.drill_frequency_months as number) < 1)
      ) {
        res.status(400).json({
          message: "drill_frequency_months deve ser um inteiro ≥ 1.",
        });
        return;
      }

      const pessoas = await responsaveisValidos(orgId, body.responsible_user_ids);
      const textoDepois =
        body.responsibles !== undefined ? blank(body.responsibles as string) : current.responsibles;
      const pessoasDepois =
        pessoas ??
        (
          await prisma.emergencyProcedureResponsible.findMany({
            where: { procedureId: current.id },
            select: { userId: true },
          })
        ).map((r) => r.userId);
      if (!textoDepois && pessoasDepois.length === 0) {
        res.status(400).json({
          message: "O plano precisa de ao menos um responsável: uma pessoa da empresa ou, para quem é de fora, o texto.",
        });
        return;
      }

      const procedure = await new EmergencyProcedure().update.one(
        { id: current.id, organizationId: orgId },
        {
          ...(body.scenario !== undefined
            ? { scenario: String(body.scenario).trim() }
            : {}),
          ...(body.first_aid_means !== undefined
            ? { firstAidMeans: blank(body.first_aid_means as string) }
            : {}),
          ...(body.responsibles !== undefined
            ? { responsibles: blank(body.responsibles as string) }
            : {}),
          ...(body.evacuation_plan !== undefined
            ? { evacuationPlan: blank(body.evacuation_plan as string) }
            : {}),
          ...(body.large_scale_measures !== undefined
            ? { largeScaleMeasures: blank(body.large_scale_measures as string) }
            : {}),
          ...(body.drill_frequency_months !== undefined
            ? { drillFrequencyMonths: body.drill_frequency_months as number }
            : {}),
        },
      );

      if (pessoas !== undefined) {
        await prisma.$transaction([
          prisma.emergencyProcedureResponsible.deleteMany({ where: { procedureId: current.id } }),
          prisma.emergencyProcedureResponsible.createMany({
            data: pessoas.map((id) => ({ procedureId: current.id, userId: id })),
          }),
        ]);
      }

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "emergency_procedure.update",
        entityType: "EmergencyProcedure",
        entityId: current.id,
        ...(pessoas !== undefined ? { after: { responsible_user_ids: pessoas } } : {}),
      });

      res.json({ procedure });
    } catch (err) {
      fail(res, err);
    }
  }

  async archiveProcedure(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const current = await new EmergencyProcedure().read.one({
        id: req.params.id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!current) {
        res.status(404).json({ message: "Procedimento não encontrado." });
        return;
      }

      const procedure = await new EmergencyProcedure().update.one(
        { id: current.id, organizationId: orgId },
        { archivedAt: new Date() },
      );

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "emergency_procedure.archive",
        entityType: "EmergencyProcedure",
        entityId: current.id,
      });

      res.json({ procedure });
    } catch (err) {
      fail(res, err);
    }
  }

  /** 1.5.6.3 / 1.5.6.3.1 — exercício simulado; evidências via addDrillEvidence. */
  async addDrill(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const procedure = await new EmergencyProcedure().read.one({
        id: req.params.id,
        organizationId: orgId,
        archivedAt: null,
      });
      if (!procedure) {
        res.status(404).json({ message: "Procedimento não encontrado." });
        return;
      }

      const { performed_at, participants, findings } = req.body as {
        performed_at?: string;
        participants?: number;
        findings?: string;
      };

      if (!performed_at) {
        res.status(400).json({ message: "Informe performed_at." });
        return;
      }

      const drill = await new EmergencyDrill().create.new({
        procedureId: procedure.id,
        performedAt: new Date(performed_at),
        participants:
          typeof participants === "number" ? participants : null,
        findings: blank(findings),
        recordedById: userId,
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "emergency_drill.create",
        entityType: "EmergencyDrill",
        entityId: drill.id,
        after: { procedureId: procedure.id },
      });

      res.status(201).json({ drill });
    } catch (err) {
      fail(res, err);
    }
  }

  async getDrill(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const drill = await prisma.emergencyDrill.findFirst({
        where: {
          id: req.params.drillId,
          procedureId: req.params.id,
          procedure: { organizationId: orgId },
        },
        include: {
          recordedBy: { select: { id: true, name: true } },
          evidences: { orderBy: { uploadedAt: "desc" } },
          procedure: {
            select: { id: true, scenario: true, establishmentId: true },
          },
        },
      });
      if (!drill) {
        res.status(404).json({ message: "Exercício não encontrado." });
        return;
      }
      res.json({ drill });
    } catch (err) {
      fail(res, err);
    }
  }

  /** 1.5.6.3.1: evidências do exercício simulado. */
  /**
   * Baixar a evidência do simulado (ata assinada, foto).
   *
   * A rota que serve arquivo de evidência só atende evidência de ação, então
   * a ata entrava e não saía — e é o fiscal quem pede para ver. [B3-4-B]
   * [S7-E]
   */
  async drillEvidenceFile(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const evidence = await prisma.evidence.findFirst({
        where: {
          id: req.params.evidenceId,
          organizationId: orgId,
          drillId: req.params.drillId,
          drill: { procedureId: req.params.id },
        },
        select: { storagePath: true, fileName: true, mimeType: true },
      });
      if (!evidence) {
        res.status(404).json({ message: "Evidência não encontrada." });
        return;
      }
      sendPrivateFile(res, evidence, "Esta evidência foi registrada sem arquivo.");
    } catch (err) {
      fail(res, err);
    }
  }

  async addDrillEvidence(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const drill = await prisma.emergencyDrill.findFirst({
        where: {
          id: req.params.drillId,
          procedureId: req.params.id,
          procedure: { organizationId: orgId },
        },
      });
      if (!drill) {
        res.status(404).json({ message: "Exercício não encontrado." });
        return;
      }

      const {
        file_name,
        mime_type,
        content_base64,
        description,
        event_date,
        type,
      } = req.body as {
        file_name?: string;
        mime_type?: string;
        content_base64?: string;
        description?: string;
        event_date?: string;
        type?: string;
      };

      if (!file_name?.trim() || !mime_type) {
        res.status(400).json({ message: "Informe file_name e mime_type." });
        return;
      }

      const data = content_base64
        ? Buffer.from(content_base64, "base64")
        : Buffer.alloc(0);
      assertSize(data.length || 0);

      const { storagePath, absolutePath } = buildEvidenceStoragePath(
        orgId,
        mime_type,
      );
      writeEvidenceFile(absolutePath, data);

      const evidence = await new Evidence().create.new({
        organizationId: orgId,
        type: (type as never) || EVIDENCE_TYPES.DOCUMENT,
        storagePath,
        fileName: file_name.trim(),
        mimeType: mime_type,
        sizeBytes: data.length,
        description: blank(description),
        eventDate: event_date ? new Date(event_date) : drill.performedAt,
        uploadedById: userId,
        drillId: drill.id,
        validationStatus: EVIDENCE_VALIDATION_STATUSES.PENDING,
      });

      res.status(201).json({ evidence });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new EmergencyController();

import { Request, Response } from "express";
import prisma from "../model/prisma";
import { formatCalendarDay } from "../helper/calendar-day";
import { Occurrence } from "../model/schema/Occurrence/Occurrence";
import { Establishment } from "../model/schema/Establishment/Establishment";
import { Risk } from "../model/schema/Risk/Risk";
import { Action } from "../model/schema/Action/Action";
import { Evidence } from "../model/schema/Evidence/Evidence";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { notify } from "../helper/notify";
import {
  canCloseOccurrenceAnalysis,
  canManageModule,
} from "../helper/module-access";
import {
  assertSize,
  buildEvidenceStoragePath,
  writeEvidenceFile,
} from "../helper/uploads";
import {
  ACTION_PRIORITIES,
  ACTION_SOURCE_TYPES,
  ACTION_STATUSES,
  EVIDENCE_TYPES,
  EVIDENCE_VALIDATION_STATUSES,
  OCCURRENCE_TYPE_VALUES,
  isOccurrenceType,
} from "../constants";
import {
  deadlineLimit,
  hojeEmBrasilia,
  PRIORITY_BY_LEVEL,
  RISK_LEVEL_LABEL,
  type RiskLevel,
} from "../helper/action-deadline";
import { nivelDoRisco } from "../helper/nivel-do-risco";
import type { AuthRequest } from "../types/auth";
import {
  actionReadScope,
  collectiveReadScope,
  collectiveView,
  managesCollective,
  peopleInScope,
  scopeOfRequest,
  seesCollective,
  type UnitScope,
} from "../helper/unit-scope";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

/**
 * Quem tem escrita sem administrar o módulo (o colaborador) mexe só na
 * ocorrência que ele registrou. [S4-A]
 */
function ownsOrManages(req: AuthRequest, reportedById: string | null): boolean {
  if (req.actor && canManageModule(req.actor.permission, "ocorrencias")) return true;
  return reportedById === actorUserId(req);
}

/** Resposta de "não existe" — a mesma para o que está fora do escopo. [C2-13] */
function naoEncontrada(res: Response) {
  res.status(404).json({ message: "Ocorrência não encontrada." });
}

/**
 * Como o ator mexe na ocorrência. Na unidade gerida (ou sem recorte), como
 * gestor; fora dela, só na que ele mesmo registrou, como colaborador. A de
 * terceiro na unidade em que só trabalha responde como inexistente. [C2-13]
 */
function editaOcorrencia(
  req: AuthRequest,
  escopo: UnitScope,
  occurrence: { establishmentId: string | null; reportedById: string },
): "gestor" | "proprio" | null {
  if (managesCollective(escopo, occurrence.establishmentId) && ownsOrManages(req, occurrence.reportedById)) {
    return "gestor";
  }
  if (occurrence.reportedById === escopo.userId) return "proprio";
  return null;
}

/**
 * Unidade nova da ocorrência, para quem tem recorte: a gerida (como gestor),
 * ou também a de trabalho (como colaborador que registra). Sem unidade, só
 * a central. Fora disso, igual a unidade inexistente. [C2-13]
 */
function unidadePermitida(escopo: UnitScope, establishmentId: string | null, comoColaborador: boolean): boolean {
  if (escopo.wholeOrg) return true;
  if (!establishmentId) return false;
  const visao = collectiveView(escopo, establishmentId);
  return visao === "manager" || (comoColaborador && visao === "worker");
}

/** Risco escolhido por quem tem recorte: só de unidade no escopo dele; fora, igual a inexistente. */
async function riscoNoEscopo(escopo: UnitScope, riskId: string): Promise<boolean> {
  if (escopo.wholeOrg) return true;
  const risco = await prisma.risk.findFirst({
    where: { id: riskId, organizationId: escopo.organizationId, archivedAt: null },
    select: { hazard: { select: { activity: { select: { establishmentId: true } } } } },
  });
  return Boolean(risco) && collectiveView(escopo, risco!.hazard.activity.establishmentId) !== "none";
}

/**
 * O risco da ocorrência tem de ser da mesma unidade.
 *
 * Antes se conferia só a organização: um quase-acidente de uma unidade podia
 * ficar ligado ao risco de outra — e, como a análise marca o risco escolhido
 * para reavaliação, a escolha errada mexia no inventário da outra. [S3-D] [S2-F]
 */
async function riskOfEstablishment(
  organizationId: string,
  riskId: string,
  establishmentId: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const risk = await prisma.risk.findFirst({
    where: { id: riskId, organizationId, archivedAt: null },
    select: {
      hazard: {
        select: {
          activity: {
            select: { establishmentId: true, establishment: { select: { name: true } } },
          },
        },
      },
    },
  });
  if (!risk) return { ok: false, message: "Risco inválido." };
  if (!establishmentId) return { ok: true };
  if (risk.hazard.activity.establishmentId !== establishmentId) {
    return {
      ok: false,
      message: `Este risco é de ${risk.hazard.activity.establishment.name}. Escolha um risco da mesma unidade da ocorrência.`,
    };
  }
  return { ok: true };
}

class OccurrenceController {
  async list(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const establishmentId = req.query.establishment_id as string | undefined;
      const type = req.query.type as string | undefined;
      /* Gestor: unidades geridas e a de trabalho; colaborador: a dele; e as próprias. [C2-13] */
      const escopo = await scopeOfRequest(req as AuthRequest);
      const rows = await prisma.occurrence.findMany({
        where: {
          organizationId: orgId,
          ...(establishmentId ? { establishmentId } : {}),
          ...(type && isOccurrenceType(type) ? { type } : {}),
          AND: [collectiveReadScope(escopo, "reportedById")],
        },
        orderBy: { occurredAt: "desc" },
        include: {
          establishment: { select: { id: true, name: true } },
          risk: { select: { id: true, description: true } },
          reportedBy: { select: { id: true, name: true } },
          analyzedBy: { select: { id: true, name: true } },
          _count: { select: { actions: true, evidences: true } },
        },
      });
      res.json({ occurrences: rows });
    } catch (err) {
      fail(res, err);
    }
  }

  async get(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const occurrence = await prisma.occurrence.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          establishment: { select: { id: true, name: true } },
          risk: {
            select: {
              id: true,
              description: true,
              hazard: { select: { id: true, description: true } },
            },
          },
          reportedBy: { select: { id: true, name: true } },
          analyzedBy: { select: { id: true, name: true } },
          evidences: { orderBy: { uploadedAt: "desc" } },
        },
      });
      const escopo = await scopeOfRequest(req as AuthRequest);
      if (!occurrence || !seesCollective(escopo, occurrence.establishmentId, occurrence.reportedById)) {
        naoEncontrada(res);
        return;
      }

      /*
        "Ações vinculadas" mostrava só o que nasceu DA ocorrência, e nenhuma
        tela criava ação a partir dela: ficava sempre vazia. A ação do mesmo
        risco, aberta antes do quase-acidente, existia e não aparecia ali —
        e a pergunta do fiscal é "o que mudou depois". Agora a lista é a do
        risco ligado, de antes e de depois, dizendo o que veio da
        ocorrência. [B3-4-C] [S7-D]
      */
      const acoes = await prisma.action.findMany({
        where: {
          organizationId: orgId,
          OR: [
            { occurrenceId: occurrence.id },
            ...(occurrence.riskId ? [{ riskId: occurrence.riskId }] : []),
          ],
          /* Só as ações que o ator já vê no plano. [C2-13] */
          AND: [actionReadScope(escopo)],
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          status: true,
          priority: true,
          dueDate: true,
          completedAt: true,
          validatedAt: true,
          occurrenceId: true,
          createdAt: true,
          assignee: { select: { id: true, name: true } },
          validatedBy: { select: { id: true, name: true } },
        },
      });

      res.json({
        occurrence: {
          ...occurrence,
          actions: acoes.map((a) => ({
            ...a,
            /** Nasceu desta ocorrência, ou já era do risco. */
            from_occurrence: a.occurrenceId === occurrence.id,
          })),
        },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async create(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const {
        type,
        description,
        occurred_at,
        establishment_id,
        risk_id,
        generating_situation,
        organizational_data,
        prevention_review,
      } = req.body as {
        type?: string;
        description?: string;
        occurred_at?: string;
        establishment_id?: string;
        risk_id?: string;
        generating_situation?: string;
        organizational_data?: string;
        prevention_review?: string;
      };

      if (!type || !description?.trim() || !occurred_at) {
        res.status(400).json({
          message: "Informe type, description e occurred_at.",
        });
        return;
      }
      if (!isOccurrenceType(type)) {
        res.status(400).json({
          message: `type inválido. Use: ${OCCURRENCE_TYPE_VALUES.join(", ")}.`,
        });
        return;
      }

      const escopo = await scopeOfRequest(req as AuthRequest);
      if (establishment_id) {
        const est = await new Establishment().read.one({
          id: establishment_id,
          organizationId: orgId,
          archivedAt: null,
        });
        /* Registra na unidade gerida ou na de trabalho; outra, igual a inexistente. [C2-13] */
        if (!est || !unidadePermitida(escopo, establishment_id, true)) {
          res.status(400).json({ message: "Estabelecimento inválido." });
          return;
        }
      }

      if (risk_id) {
        if (!(await riscoNoEscopo(escopo, risk_id))) {
          res.status(400).json({ message: "Risco inválido." });
          return;
        }
        const conferido = await riskOfEstablishment(
          orgId,
          risk_id,
          establishment_id ?? null,
        );
        if (!conferido.ok) {
          res.status(400).json({ message: conferido.message });
          return;
        }
      }

      const occurrence = await new Occurrence().create.new({
        organizationId: orgId,
        type,
        description: description.trim(),
        occurredAt: new Date(occurred_at),
        establishmentId: establishment_id ?? null,
        riskId: risk_id ?? null,
        generatingSituation: blank(generating_situation),
        organizationalData: blank(organizational_data),
        preventionReview: blank(prevention_review),
        reportedById: userId,
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "occurrence.create",
        entityType: "Occurrence",
        entityId: occurrence.id,
        /* O que aconteceu, não só o tipo: o Histórico do risco mostra. [B4-A] */
        after: {
          type: occurrence.type,
          description: occurrence.description,
          occurredAt: occurrence.occurredAt,
        },
      });

      res.status(201).json({ occurrence });
    } catch (err) {
      fail(res, err);
    }
  }

  async update(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const current = await new Occurrence().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      const escopo = await scopeOfRequest(req as AuthRequest);
      const como = current ? editaOcorrencia(req as AuthRequest, escopo, current) : null;
      if (!current || !seesCollective(escopo, current.establishmentId, current.reportedById)) {
        naoEncontrada(res);
        return;
      }
      if (!como) {
        /* Vê (sem recorte, ou gestor sem administrar o módulo): recusa dizendo por quê. */
        if (managesCollective(escopo, current.establishmentId)) {
          res.status(403).json({ message: "Só quem registrou a ocorrência pode editá-la." });
        } else {
          naoEncontrada(res);
        }
        return;
      }

      const body = req.body as Record<string, unknown>;

      if (body.type !== undefined) {
        if (!isOccurrenceType(String(body.type))) {
          res.status(400).json({
            message: `type inválido. Use: ${OCCURRENCE_TYPE_VALUES.join(", ")}.`,
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
        if (!est || !unidadePermitida(escopo, body.establishment_id as string, como === "proprio")) {
          res.status(400).json({ message: "Estabelecimento inválido." });
          return;
        }
      } else if (
        body.establishment_id !== undefined &&
        current.establishmentId !== null &&
        !escopo.wholeOrg
      ) {
        /* Tirar a unidade leva a ocorrência para a central: só a central faz. [C2-13] */
        res.status(400).json({ message: "Estabelecimento inválido." });
        return;
      }

      if (body.risk_id) {
        if (!(await riscoNoEscopo(escopo, body.risk_id as string))) {
          res.status(400).json({ message: "Risco inválido." });
          return;
        }
        const unidade =
          body.establishment_id !== undefined
            ? ((body.establishment_id as string) || null)
            : current.establishmentId;
        const conferido = await riskOfEstablishment(
          orgId,
          body.risk_id as string,
          unidade,
        );
        if (!conferido.ok) {
          res.status(400).json({ message: conferido.message });
          return;
        }
      }

      const occurrence = await new Occurrence().update.one(
        { id: current.id, organizationId: orgId },
        {
          ...(body.type !== undefined ? { type: body.type as never } : {}),
          ...(body.description !== undefined
            ? { description: String(body.description).trim() }
            : {}),
          ...(body.occurred_at !== undefined
            ? { occurredAt: new Date(String(body.occurred_at)) }
            : {}),
          ...(body.establishment_id !== undefined
            ? { establishmentId: (body.establishment_id as string) || null }
            : {}),
          ...(body.risk_id !== undefined
            ? { riskId: (body.risk_id as string) || null }
            : {}),
          ...(body.generating_situation !== undefined
            ? { generatingSituation: blank(body.generating_situation as string) }
            : {}),
          ...(body.organizational_data !== undefined
            ? { organizationalData: blank(body.organizational_data as string) }
            : {}),
          ...(body.prevention_review !== undefined
            ? { preventionReview: blank(body.prevention_review as string) }
            : {}),
        },
      );

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "occurrence.update",
        entityType: "Occurrence",
        entityId: current.id,
      });

      res.json({ occurrence });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Registra a análise exigida pela NR-1 1.5.5.5.2:
   * (a) situações geradoras, (b) dados organizacionais/epidemiológicos,
   * (c) evidências para revisar medidas de prevenção.
   */
  async analyze(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      /*
        Quem viu registra; quem responde tecnicamente analisa e encerra. O
        supervisor relatava e encerrava sozinho o próprio quase-acidente, e a
        ocorrência passava a "Analisada" sem o técnico olhar. [S3-E]
      */
      if (!auth.actor || !canCloseOccurrenceAnalysis(auth.actor.permission)) {
        res.status(403).json({
          message:
            "A análise da ocorrência é de quem responde tecnicamente pelo SST.",
          code: "OCCURRENCE_ANALYSIS_SST_ONLY",
        });
        return;
      }
      const current = await new Occurrence().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      const escopo = await scopeOfRequest(auth);
      if (!current || !managesCollective(escopo, current.establishmentId)) {
        naoEncontrada(res);
        return;
      }

      const {
        generating_situation,
        organizational_data,
        prevention_review,
      } = req.body as {
        generating_situation?: string;
        organizational_data?: string;
        prevention_review?: string;
      };

      const generatingSituation =
        blank(generating_situation) ?? current.generatingSituation;
      const organizationalData =
        blank(organizational_data) ?? current.organizationalData;
      const preventionReview =
        blank(prevention_review) ?? current.preventionReview;

      if (!generatingSituation || !organizationalData || !preventionReview) {
        res.status(400).json({
          message:
            "Análise exige generating_situation, organizational_data e prevention_review (NR-1 1.5.5.5.2).",
        });
        return;
      }

      const occurrence = await new Occurrence().update.one(
        { id: current.id, organizationId: orgId },
        {
          generatingSituation,
          organizationalData,
          preventionReview,
          analyzedById: userId,
          analyzedAt: new Date(),
        },
      );

      // Marca risco vinculado para reassessment quando a análise aponta revisão.
      if (current.riskId) {
        await prisma.risk.updateMany({
          where: { id: current.riskId, organizationId: orgId },
          data: {
            needsReassessment: true,
            /* O motivo aparece na tela e no inventário: sem o identificador interno. [B2-4-E] */
            reassessmentReason: `Ocorrência de ${formatCalendarDay(current.occurredAt)} analisada — revisar medidas (1.5.5.5.2 c).`,
          },
        });
      }

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "occurrence.analyze",
        entityType: "Occurrence",
        entityId: current.id,
      });

      res.json({ occurrence });
    } catch (err) {
      fail(res, err);
    }
  }

  async addAction(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const occurrence = await new Occurrence().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      /* Abrir ação é de gestor: unidade gerida ou sem recorte. [C2-13] */
      const escopo = await scopeOfRequest(req as AuthRequest);
      if (!occurrence || !managesCollective(escopo, occurrence.establishmentId)) {
        naoEncontrada(res);
        return;
      }

      const {
        title,
        description,
        priority,
        assignee_id,
        due_date,
        deadline_justification,
        effectiveness_criteria,
      } = req.body as {
        title?: string;
        description?: string;
        priority?: string;
        assignee_id?: string;
        due_date?: string;
        deadline_justification?: string;
        effectiveness_criteria?: string;
      };

      if (!title?.trim()) {
        res.status(400).json({ message: "Informe o título da ação." });
        return;
      }
      /*
        Ação sem responsável e sem prazo é o S2-M, já decidido: aqui a rota
        aceitava os dois vazios, e abrir ação pela ocorrência traria de volta
        o que o portal já conserta no plano de ação. [S2-M]
      */
      if (!assignee_id) {
        res.status(400).json({ message: "Informe quem é o responsável pela ação." });
        return;
      }
      /*
        O responsável é pessoa da empresa com acesso ativo e, para quem tem
        recorte, ele mesmo ou alguém das unidades geridas — a mesma lista do
        seletor. Fora disso, igual a inexistente. [C2-13]
      */
      if (!(await peopleInScope(escopo, [assignee_id]))) {
        res.status(400).json({ message: "Responsável não é da organização." });
        return;
      }
      if (!due_date) {
        res.status(400).json({ message: "Informe o prazo da ação." });
        return;
      }
      /* O mesmo do plano de ação: sem critério, a ação não abre. [B3-4-A] */
      const criterio = blank(effectiveness_criteria);
      if (!criterio) {
        res.status(400).json({
          message: "Informe o critério de eficácia: como saber se a ação deu certo.",
          code: "CRITERIA_REQUIRED",
        });
        return;
      }

      /*
        A mesma regra do plano de ação aberto pelo Inventário: data no passado
        é recusada, e o prazo do nível do risco da ocorrência é limite — passar
        dele exige dizer por quê. A ação pela ocorrência não conferia o prazo
        e saía sempre com prioridade Alta. [CB-72] [S2-M] [B3-2-A]
      */
      const prazo = new Date(`${String(due_date).slice(0, 10)}T00:00:00.000Z`);
      if (Number.isNaN(prazo.getTime())) {
        res.status(400).json({ message: "Prazo inválido. Use AAAA-MM-DD." });
        return;
      }
      const hoje = hojeEmBrasilia();
      if (prazo < hoje) {
        res.status(400).json({
          message: "O prazo não pode ser uma data que já passou.",
          code: "DEADLINE_IN_THE_PAST",
        });
        return;
      }
      const avaliado = occurrence.riskId ? await nivelDoRisco(orgId, occurrence.riskId) : null;
      const nivel = avaliado?.nivel ?? null;
      const justificativa = blank(deadline_justification);
      const { days, limit } = deadlineLimit(nivel, hoje);
      const passouDoLimite = Boolean(nivel) && prazo > limit;
      if (passouDoLimite && !justificativa) {
        const deOnde = avaliado?.validada ? "" : ", aguardando validação,";
        res.status(400).json({
          message: `Risco ${RISK_LEVEL_LABEL[nivel as never] ?? nivel}${deOnde} pede prazo de até ${days} dias (${formatCalendarDay(limit)}). Para ir além, diga por quê.`,
          code: "DEADLINE_NEEDS_JUSTIFICATION",
          limit_days: days,
          limit_date: limit.toISOString().slice(0, 10),
        });
        return;
      }
      /* Sem prioridade escolhida, a do nível do risco; sem nível, Média. */
      const prioridade =
        (priority as never) ||
        (nivel ? PRIORITY_BY_LEVEL[nivel as RiskLevel] : undefined) ||
        ACTION_PRIORITIES.MEDIUM;

      const action = await new Action().create.new({
        organizationId: orgId,
        title: title.trim(),
        description: blank(description),
        sourceType: ACTION_SOURCE_TYPES.OCCURRENCE,
        occurrenceId: occurrence.id,
        riskId: occurrence.riskId,
        priority: prioridade,
        status: ACTION_STATUSES.OPEN,
        assigneeId: assignee_id ?? null,
        dueDate: prazo,
        // Só guarda o motivo quando ele foi de fato necessário.
        deadlineJustification: passouDoLimite ? justificativa : null,
        riskLevelAtOpening: nivel,
        effectivenessCriteria: criterio,
        createdById: userId,
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "occurrence.add_action",
        entityType: "Action",
        entityId: action.id,
        after: { occurrenceId: occurrence.id },
      });

      // Quem vai executar precisa saber que a ação é dele. [S3-A]
      if (action.assigneeId && action.assigneeId !== userId) {
        await notify({
          organizationId: orgId,
          userId: action.assigneeId,
          kind: "ACTION_ASSIGNED",
          title: action.title,
          body: "Ação sua, aberta a partir de uma ocorrência.",
          link: "/acoes",
          entityType: "Action",
          entityId: action.id,
        });
      }

      res.status(201).json({ action });
    } catch (err) {
      fail(res, err);
    }
  }

  async addEvidence(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      const occurrence = await new Occurrence().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      const escopo = await scopeOfRequest(req as AuthRequest);
      if (!occurrence || !seesCollective(escopo, occurrence.establishmentId, occurrence.reportedById)) {
        naoEncontrada(res);
        return;
      }
      if (!editaOcorrencia(req as AuthRequest, escopo, occurrence)) {
        if (managesCollective(escopo, occurrence.establishmentId)) {
          res.status(403).json({ message: "Só quem registrou a ocorrência anexa evidência." });
        } else {
          naoEncontrada(res);
        }
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
        eventDate: event_date ? new Date(event_date) : null,
        uploadedById: userId,
        occurrenceId: occurrence.id,
        validationStatus: EVIDENCE_VALIDATION_STATUSES.PENDING,
      });

      res.status(201).json({ evidence });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new OccurrenceController();

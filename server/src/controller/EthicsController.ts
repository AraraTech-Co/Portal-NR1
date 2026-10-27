import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { NotificationKind } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import {
  ethicsReportScope,
  podeTriarDenuncia,
  reportIsHidden,
  usersInEthicsCommittee,
  usersWhoTriageReports,
} from "../helper/ethics-access";
import { notify, notifyMany } from "../helper/notify";
import { EthicsReport } from "../model/schema/EthicsReport/EthicsReport";
import { EthicsReportMessage } from "../model/schema/EthicsReportMessage/EthicsReportMessage";
import { Establishment } from "../model/schema/Establishment/Establishment";
import { Hazard } from "../model/schema/Hazard/Hazard";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { canReadModule } from "../helper/module-access";
import { effectivePermission } from "../helper/auth";
import { writeAudit } from "../helper/audit";
import {
  ETHICS_ACCESS_CODE_BCRYPT_ROUNDS,
  ETHICS_ACCESS_CODE_LENGTH,
  ETHICS_PROTOCOL_PREFIX,
  REPORT_AUTHOR_SIDES,
  REPORT_CATEGORY_VALUES,
  REPORT_STATUSES,
  REPORT_STATUS_VALUES,
  isReportCategory,
  isReportStatus,
} from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

function generateAccessCode(): string {
  // Base64url sem padding — legível para copiar uma vez.
  return randomBytes(Math.ceil((ETHICS_ACCESS_CODE_LENGTH * 3) / 4))
    .toString("base64url")
    .slice(0, ETHICS_ACCESS_CODE_LENGTH)
    .toUpperCase();
}

async function allocateProtocol(organizationId: string): Promise<string> {
  for (let i = 0; i < 12; i++) {
    const n = 1000 + Math.floor(Math.random() * 9000);
    const protocol = `${ETHICS_PROTOCOL_PREFIX}-${n}`;
    const exists = await prisma.ethicsReport.findFirst({
      where: { organizationId, protocol },
      select: { id: true },
    });
    if (!exists) return protocol;
  }
  throw Object.assign(new Error("Não foi possível gerar protocolo único."), {
    status: 500,
  });
}

/** Resposta segura para quem acompanha por protocolo (sem hash, sem autor do comitê). */
function publicReportView(report: {
  id: string;
  protocol: string;
  category: string;
  description: string;
  isAnonymous: boolean;
  status: string;
  resolutionNote: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  messages?: Array<{
    id: string;
    side: string;
    body: string;
    createdAt: Date;
  }>;
}) {
  return {
    id: report.id,
    protocol: report.protocol,
    category: report.category,
    description: report.description,
    isAnonymous: report.isAnonymous,
    status: report.status,
    resolutionNote: report.resolutionNote,
    resolvedAt: report.resolvedAt,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
    messages: report.messages?.map((m) => ({
      id: m.id,
      side: m.side,
      body: m.body,
      createdAt: m.createdAt,
    })),
  };
}

async function findByProtocolAndCode(
  organizationId: string | undefined,
  protocol: string,
  accessCode: string,
) {
  const where = {
    protocol: protocol.trim().toUpperCase(),
    ...(organizationId ? { organizationId } : {}),
  };
  const candidates = await prisma.ethicsReport.findMany({
    where,
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
  for (const report of candidates) {
    const ok = await bcrypt.compare(accessCode, report.accessCodeHash);
    if (ok) return report;
  }
  return null;
}

/**
 * A denúncia está fora do alcance de quem abriu?
 *
 * É o caso de quem a denúncia cita [CB-27] e, para quem não tria, do caso
 * que ainda está na triagem [B3-3-H].
 */
async function estouImpedido(req: Request, reportId: string): Promise<boolean> {
  const auth = req as AuthRequest;
  return reportIsHidden(actorOrgId(auth), auth.actor!, reportId);
}

class EthicsController {
  /**
   * Abre relato. Anônimo por padrão: não grava reporterUserId.
   * Auth opcional (verify public). Sem auth, exige organization_id.
   * Devolve access_code em claro UMA vez.
   */
  async create(req: Request, res: Response) {
    try {
      const authReq = req as AuthRequest;
      const {
        organization_id,
        category,
        description,
        is_anonymous,
        establishment_id,
        committee_involved,
      } = req.body as {
        organization_id?: string;
        category?: string;
        description?: string;
        is_anonymous?: boolean;
        establishment_id?: string;
        /** "Alguém do comitê de ética está envolvido?" [B3-3-H] */
        committee_involved?: boolean;
      };

      const orgId =
        authReq.actor?.organizationId ?? organization_id ?? null;
      if (!orgId) {
        res.status(400).json({
          message: "Informe organization_id (ou autentique-se).",
        });
        return;
      }

      if (!category || !description?.trim()) {
        res.status(400).json({
          message: "Informe category e description.",
        });
        return;
      }
      if (!isReportCategory(category)) {
        res.status(400).json({
          message: `category inválida. Use: ${REPORT_CATEGORY_VALUES.join(", ")}.`,
        });
        return;
      }

      const org = await prisma.organization.findFirst({
        where: { id: orgId, active: true },
      });
      if (!org) {
        res.status(404).json({ message: "Organização não encontrada." });
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

      const anonymous = is_anonymous !== false;
      if (!anonymous && !authReq.actor) {
        res.status(401).json({
          message:
            "Para denúncia identificada, autentique-se no portal.",
        });
        return;
      }
      const reporterUserId =
        !anonymous && authReq.actor ? authReq.actor.userId : null;

      const protocol = await allocateProtocol(orgId);
      const accessCode = generateAccessCode();
      const accessCodeHash = await bcrypt.hash(
        accessCode,
        ETHICS_ACCESS_CODE_BCRYPT_ROUNDS,
      );

      const report = await new EthicsReport().create.new({
        organizationId: orgId,
        protocol,
        category,
        description: description.trim(),
        isAnonymous: anonymous,
        reporterUserId,
        accessCodeHash,
        status: REPORT_STATUSES.RECEIVED,
        establishmentId: establishment_id ?? null,
        committeeInvolved: committee_involved === true,
      });

      // Auditoria sem revelar identidade do denunciante anônimo.
      await writeAudit({
        organizationId: orgId,
        actorId: anonymous ? null : reporterUserId,
        action: "ethics_report.create",
        entityType: "EthicsReport",
        entityId: report.id,
        after: {
          protocol: report.protocol,
          category: report.category,
          isAnonymous: report.isAnonymous,
        },
      });

      /*
        A denúncia chegava e ficava esperando alguém do comitê abrir a tela
        por conta própria. O aviso diz que entrou e qual é o protocolo — não
        diz quem relatou, nem no caso identificado: quem precisa saber abre
        o relato. [CB-29]

        Quando quem relatou disse que alguém do comitê está envolvido, o
        aviso não vai ao comitê: vai a quem faz a triagem. O comitê inteiro
        saber que existe um caso contra um dos seus já é o aviso de alerta
        que a decisão B3-3-H quis evitar. [B3-3-H]
      */
      const naTriagem = report.committeeInvolved;
      const quemRecebe = naTriagem
        ? await usersWhoTriageReports(orgId)
        : await usersInEthicsCommittee(orgId);
      await notifyMany(
        quemRecebe.filter((quem) => quem !== reporterUserId),
        {
          organizationId: orgId,
          kind: NotificationKind.ETHICS_REPORT_OPENED,
          title: naTriagem
            ? "Denúncia nova esperando triagem"
            : "Denúncia nova no canal",
          body: naTriagem
            ? `Protocolo ${report.protocol}. Quem relatou diz que alguém do comitê está envolvido.`
            : `Protocolo ${report.protocol}.`,
          link: "/comite",
          entityType: "EthicsReport",
          entityId: report.id,
        },
      );

      res.status(201).json({
        report: publicReportView(report),
        access_code: accessCode,
        message:
          "Guarde o protocolo e o código de acesso — o código não será mostrado de novo.",
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Acompanhamento público por protocolo + código (ADR-16). */
  async track(req: Request, res: Response) {
    try {
      const { protocol, access_code, organization_id } = req.body as {
        protocol?: string;
        access_code?: string;
        organization_id?: string;
      };
      if (!protocol?.trim() || !access_code?.trim()) {
        res.status(400).json({
          message: "Informe protocol e access_code.",
        });
        return;
      }

      const report = await findByProtocolAndCode(
        organization_id,
        protocol,
        access_code,
      );
      if (!report) {
        res.status(404).json({ message: "Protocolo ou código inválido." });
        return;
      }

      await prisma.ethicsReportMessage.updateMany({
        where: {
          reportId: report.id,
          side: REPORT_AUTHOR_SIDES.COMMITTEE,
          readByReporterAt: null,
        },
        data: { readByReporterAt: new Date() },
      });

      res.json({ report: publicReportView(report) });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Mensagem do denunciante (sem gravar authorUserId). */
  async addReporterMessage(req: Request, res: Response) {
    try {
      const { protocol, access_code, organization_id, body } = req.body as {
        protocol?: string;
        access_code?: string;
        organization_id?: string;
        body?: string;
      };
      if (!protocol?.trim() || !access_code?.trim() || !body?.trim()) {
        res.status(400).json({
          message: "Informe protocol, access_code e body.",
        });
        return;
      }

      const report = await findByProtocolAndCode(
        organization_id,
        protocol,
        access_code,
      );
      if (!report) {
        res.status(404).json({ message: "Protocolo ou código inválido." });
        return;
      }
      if (
        report.status === REPORT_STATUSES.RESOLVED ||
        report.status === REPORT_STATUSES.ARCHIVED
      ) {
        res.status(409).json({
          message: "Relato encerrado — não recebe novas mensagens.",
        });
        return;
      }

      const message = await new EthicsReportMessage().create.new({
        reportId: report.id,
        side: REPORT_AUTHOR_SIDES.REPORTER,
        body: body.trim(),
        authorUserId: null,
      });

      if (report.status === REPORT_STATUSES.AWAITING_INFO) {
        await new EthicsReport().update.one(
          { id: report.id },
          { status: REPORT_STATUSES.IN_ANALYSIS },
        );
      }

      res.status(201).json({
        message: {
          id: message.id,
          side: message.side,
          body: message.body,
          createdAt: message.createdAt,
        },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  // —— Comitê ——

  async list(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const status = req.query.status as string | undefined;
      /*
        Quem é citado numa denúncia sai do caso: nem na lista ela aparece.
        Era a denúncia contra alguém do RH indo parar na mesa dele. [CB-27]
        E o caso que diz envolver o comitê só aparece depois da triagem, para
        quem não a faz. [B3-3-H]
      */
      const recorte = await ethicsReportScope(orgId, (req as AuthRequest).actor!);

      const rows = await prisma.ethicsReport.findMany({
        where: {
          organizationId: orgId,
          ...recorte,
          ...(status && isReportStatus(status) ? { status } : {}),
        },
        orderBy: { createdAt: "desc" },
        include: {
          establishment: { select: { id: true, name: true } },
          _count: { select: { messages: true } },
        },
      });
      // Mensagens do denunciante que o comitê ainda não abriu. [S5-L]
      const unread = await prisma.ethicsReportMessage.groupBy({
        by: ["reportId"],
        where: {
          reportId: { in: rows.map((r) => r.id) },
          side: REPORT_AUTHOR_SIDES.REPORTER,
          readByCommitteeAt: null,
        },
        _count: { _all: true },
      });
      const unreadBy = new Map(unread.map((u) => [u.reportId, u._count._all]));

      /*
        Quantas vezes o comitê já falou nesta denúncia. Sem isso, a lista não
        distingue a que nunca teve resposta da que já foi tratada — e foi
        respondendo na denúncia errada que a pergunta foi parar com outra
        pessoa. [B2-3-D]
      */
      const doComite = await prisma.ethicsReportMessage.groupBy({
        by: ["reportId"],
        where: {
          reportId: { in: rows.map((r) => r.id) },
          side: REPORT_AUTHOR_SIDES.COMMITTEE,
        },
        _count: { _all: true },
      });
      const respondidas = new Map(doComite.map((u) => [u.reportId, u._count._all]));
      // Nunca devolver accessCodeHash nem reporter em listagens anônimas.
      res.json({
        reports: rows.map((r) => ({
          id: r.id,
          protocol: r.protocol,
          category: r.category,
          description: r.description,
          isAnonymous: r.isAnonymous,
          reporterUserId: r.isAnonymous ? null : r.reporterUserId,
          status: r.status,
          establishmentId: r.establishmentId,
          establishment: r.establishment,
          linkedHazardId: r.linkedHazardId,
          resolutionNote: r.resolutionNote,
          resolvedAt: r.resolvedAt,
          /** O caso que passou pela triagem, e quando voltou. [B3-3-H] */
          committeeInvolved: r.committeeInvolved,
          triagedAt: r.triagedAt,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          _count: r._count,
          unread_from_reporter: unreadBy.get(r.id) ?? 0,
          /** Zero = o comitê nunca falou nesta denúncia. [B2-3-D] */
          committee_messages: respondidas.get(r.id) ?? 0,
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Nomes da empresa, para o comitê marcar quem a denúncia envolve.
   *
   * O comitê não necessariamente lê Colaboradores nem Conta; a lista é só
   * id e nome, o suficiente para marcar. [CB-27]
   */
  async listPeople(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const rows = await prisma.membership.findMany({
        where: { organizationId: orgId },
        orderBy: { user: { name: "asc" } },
        select: {
          suspendedAt: true,
          user: { select: { id: true, name: true } },
        },
      });
      res.json({
        people: rows.map((m) => ({
          id: m.user.id,
          name: m.user.name,
          active: m.suspendedAt === null,
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Quem é o comitê de ética desta empresa. [CB-27] */
  async listCommittee(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const rows = await prisma.ethicsCommitteeMember.findMany({
        where: { organizationId: orgId },
        orderBy: { addedAt: "asc" },
        select: {
          userId: true,
          addedAt: true,
          user: {
            select: {
              id: true,
              name: true,
              memberships: {
                where: { organizationId: orgId },
                select: { role: true },
                take: 1,
              },
            },
          },
          addedBy: { select: { id: true, name: true } },
        },
      });
      /*
        Os nomes vêm junto: quem administra a conta pode não estar no comitê
        designado, e aí a lista de pessoas do comitê (que é fechada ao
        comitê) não abriria para ele.
      */
      const pessoas = await prisma.membership.findMany({
        where: { organizationId: orgId },
        orderBy: { user: { name: "asc" } },
        select: {
          suspendedAt: true,
          role: true,
          user: { select: { id: true, name: true } },
        },
      });
      res.json({
        /*
          Designações antigas podem ter ficado com quem perdeu o módulo: a
          tela precisa mostrar quem, de fato, não abre as denúncias. [CB-62]
        */
        members: rows.map((m) => ({
          ...m,
          can_open: canReadModule(
            effectivePermission(m.user.memberships[0]?.role),
            "comite",
          ),
        })),
        /*
          Só quem tem o módulo do comitê: designar os outros os punha na
          lista sem que abrissem denúncia nenhuma. [CB-62]
        */
        people: pessoas
          .filter((m) => canReadModule(effectivePermission(m.role), "comite"))
          .map((m) => ({
            id: m.user.id,
            name: m.user.name,
            active: m.suspendedAt === null,
          })),
        /*
          Sem ninguém designado, vale a regra antiga (quem lê o módulo
          comite). A tela precisa dizer isso, senão parece que ninguém vê as
          denúncias.
        */
        falling_back: rows.length === 0,
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Designar ou tirar alguém do comitê. [CB-27] */
  async setCommittee(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const actorId = actorUserId(auth);
      const { user_id, member } = req.body as {
        user_id?: string;
        member?: boolean;
      };
      if (!user_id) {
        res.status(400).json({ message: "Informe de quem é a decisão (user_id)." });
        return;
      }
      const daEmpresa = await prisma.membership.findFirst({
        where: { organizationId: orgId, userId: user_id, suspendedAt: null },
        select: { id: true, role: true },
      });
      if (!daEmpresa) {
        res.status(400).json({ message: "Pessoa não encontrada nesta empresa." });
        return;
      }

      /*
        Designar quem não tem o módulo do comitê punha a pessoa na lista sem
        que ela abrisse denúncia nenhuma — e a tela dizia "só quem está nesta
        lista abre as denúncias", o que deixava de ser verdade. [CB-62]
      */
      if (
        member !== false &&
        !canReadModule(effectivePermission(daEmpresa.role), "comite")
      ) {
        res.status(400).json({
          message:
            "Essa pessoa não tem acesso ao módulo do comitê e não abriria " +
            "as denúncias. Mude o papel dela antes de designá-la.",
        });
        return;
      }

      /*
        E tirar o último que abre as denúncias deixaria os casos sem
        ninguém, em silêncio. [CB-62]
      */
      if (member === false) {
        const restantes = await prisma.ethicsCommitteeMember.findMany({
          where: { organizationId: orgId, userId: { not: user_id } },
          select: { user: { select: { memberships: { where: { organizationId: orgId }, select: { role: true } } } } },
        });
        const algumAbre = restantes.some((m) =>
          m.user.memberships.some((v) =>
            canReadModule(effectivePermission(v.role), "comite"),
          ),
        );
        const designados = await prisma.ethicsCommitteeMember.count({
          where: { organizationId: orgId },
        });
        if (designados > 1 && !algumAbre) {
          res.status(400).json({
            message:
              "Tirar essa pessoa deixaria as denúncias sem ninguém que as " +
              "abra. Designe outra pessoa com acesso ao comitê primeiro.",
          });
          return;
        }
      }

      if (member === false) {
        await prisma.ethicsCommitteeMember
          .delete({
            where: { organizationId_userId: { organizationId: orgId, userId: user_id } },
          })
          .catch(() => {
            /* já não era do comitê */
          });
      } else {
        await prisma.ethicsCommitteeMember.upsert({
          where: { organizationId_userId: { organizationId: orgId, userId: user_id } },
          create: { organizationId: orgId, userId: user_id, addedById: actorId },
          update: {},
        });
      }

      await writeAudit({
        organizationId: orgId,
        actorId,
        action: "ethics_committee.set",
        entityType: "User",
        entityId: user_id,
        after: { member: member !== false },
      });

      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Marcar quem a denúncia envolve — e tirar essa pessoa do caso.
   *
   * Quem relata escreve texto livre e pode ser anônimo: quem marca é o
   * comitê, ao triar. A partir daqui, quem é citado não vê a denúncia na
   * lista, não a abre e não responde. [CB-27]
   */
  async setCited(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const actorId = actorUserId(auth);

      if (await estouImpedido(req, req.params.id)) {
        res.status(404).json({ message: "Relato não encontrado." });
        return;
      }
      const report = await prisma.ethicsReport.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        select: { id: true },
      });
      if (!report) {
        res.status(404).json({ message: "Relato não encontrado." });
        return;
      }

      const { user_id, cited } = req.body as {
        user_id?: string;
        cited?: boolean;
      };
      if (!user_id) {
        res.status(400).json({ message: "Informe quem a denúncia envolve (user_id)." });
        return;
      }
      const daEmpresa = await prisma.membership.findFirst({
        where: { organizationId: orgId, userId: user_id },
        select: { id: true },
      });
      if (!daEmpresa) {
        res.status(400).json({ message: "Pessoa não encontrada nesta empresa." });
        return;
      }
      if (user_id === actorId && cited !== false) {
        /*
          Marcar a si mesmo tiraria a pessoa do caso que ela está tratando —
          sem querer, e sem volta pela tela. Melhor dizer.
        */
        res.status(400).json({
          message:
            "Você sairia deste caso ao se marcar. Peça a outra pessoa do comitê.",
          code: "CITED_SELF",
        });
        return;
      }

      if (cited === false) {
        await prisma.ethicsReportCited
          .delete({ where: { reportId_userId: { reportId: report.id, userId: user_id } } })
          .catch(() => {
            /* já não estava marcado */
          });
      } else {
        await prisma.ethicsReportCited.upsert({
          where: { reportId_userId: { reportId: report.id, userId: user_id } },
          create: { reportId: report.id, userId: user_id, markedById: actorId },
          update: {},
        });
      }

      await writeAudit({
        organizationId: orgId,
        actorId,
        action: "ethics_report.cited",
        entityType: "EthicsReport",
        entityId: report.id,
        after: { userId: user_id, cited: cited !== false },
      });

      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Devolver ao comitê a denúncia que dizia envolver alguém dele.
   *
   * Quem tria confere "Quem a denúncia envolve" e libera o caso: a partir
   * daí o comitê o vê, menos quem ficou citado. Até aqui, o comitê não
   * soube que ele existia. [B3-3-H]
   */
  async triar(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const actorId = actorUserId(auth);
      /*
        Fora do alcance de quem abriu: 404 antes de qualquer outra coisa,
        para não confirmar que o caso existe a quem está fora dele. [CB-27]
      */
      if (await estouImpedido(req, req.params.id)) {
        res.status(404).json({ message: "Relato não encontrado." });
        return;
      }
      if (!podeTriarDenuncia(auth.actor!)) {
        res.status(403).json({
          message: "A triagem é de quem é dono da conta, ou do master.",
        });
        return;
      }
      const report = await prisma.ethicsReport.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        select: { id: true, protocol: true, committeeInvolved: true, triagedAt: true },
      });
      if (!report) {
        res.status(404).json({ message: "Relato não encontrado." });
        return;
      }
      if (!report.committeeInvolved) {
        res.status(400).json({
          message: "Esta denúncia não passou pela triagem: o comitê já a vê.",
        });
        return;
      }
      if (report.triagedAt) {
        res.status(409).json({ message: "Esta denúncia já foi devolvida ao comitê." });
        return;
      }

      await prisma.ethicsReport.update({
        where: { id: report.id },
        data: { triagedAt: new Date(), triagedById: actorId },
      });

      await writeAudit({
        organizationId: orgId,
        actorId,
        action: "ethics_report.triage",
        entityType: "EthicsReport",
        entityId: report.id,
      });

      /*
        Agora sim o comitê precisa saber — menos quem a denúncia cita, que
        já está fora do caso. [B3-3-H] [CB-27]
      */
      const citados = await prisma.ethicsReportCited.findMany({
        where: { reportId: report.id },
        select: { userId: true },
      });
      const fora = new Set(citados.map((c) => c.userId));
      await notifyMany(
        (await usersInEthicsCommittee(orgId)).filter((quem) => !fora.has(quem)),
        {
          organizationId: orgId,
          kind: NotificationKind.ETHICS_REPORT_OPENED,
          title: "Denúncia nova no canal",
          body: `Protocolo ${report.protocol}.`,
          link: "/comite",
          entityType: "EthicsReport",
          entityId: report.id,
        },
      );

      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  }

  async get(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      /*
        Citado na denúncia é parte, não julgador: 404 e não 403, para não
        confirmar a existência do caso a quem está fora dele. [CB-27]
      */
      if (await estouImpedido(req, req.params.id)) {
        res.status(404).json({ message: "Relato não encontrado." });
        return;
      }
      const report = await prisma.ethicsReport.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          establishment: { select: { id: true, name: true } },
          /** Quem a denúncia envolve — e por isso está fora do caso. [CB-27] */
          cited: {
            orderBy: { markedAt: "asc" },
            select: {
              userId: true,
              markedAt: true,
              user: { select: { id: true, name: true } },
              markedBy: { select: { id: true, name: true } },
            },
          },
          messages: {
            orderBy: { createdAt: "asc" },
            include: {
              author: { select: { id: true, name: true } },
            },
          },
        },
      });
      if (!report) {
        res.status(404).json({ message: "Relato não encontrado." });
        return;
      }

      await prisma.ethicsReportMessage.updateMany({
        where: {
          reportId: report.id,
          side: REPORT_AUTHOR_SIDES.REPORTER,
          readByCommitteeAt: null,
        },
        data: { readByCommitteeAt: new Date() },
      });

      const { accessCodeHash: _hash, ...safe } = report;
      res.json({
        report: {
          ...safe,
          reporterUserId: report.isAnonymous ? null : report.reporterUserId,
          reporter: undefined,
        },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async updateStatus(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      /*
        Citado na denúncia é parte, não julgador: 404 e não 403, para não
        confirmar a existência do caso a quem está fora dele. [CB-27]
      */
      if (await estouImpedido(req, req.params.id)) {
        res.status(404).json({ message: "Relato não encontrado." });
        return;
      }
      const current = await new EthicsReport().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!current) {
        res.status(404).json({ message: "Relato não encontrado." });
        return;
      }

      const {
        status,
        resolution_note,
        linked_hazard_id,
      } = req.body as {
        status?: string;
        resolution_note?: string;
        linked_hazard_id?: string | null;
      };

      if (!status || !isReportStatus(status)) {
        res.status(400).json({
          message: `status inválido. Use: ${REPORT_STATUS_VALUES.join(", ")}.`,
        });
        return;
      }

      if (
        (status === REPORT_STATUSES.RESOLVED ||
          status === REPORT_STATUSES.ARCHIVED) &&
        !blank(resolution_note) &&
        !current.resolutionNote
      ) {
        res.status(400).json({
          message: "Informe resolution_note ao encerrar o relato.",
        });
        return;
      }

      if (linked_hazard_id) {
        const hazard = await new Hazard().read.one({
          id: linked_hazard_id,
          organizationId: orgId,
          archivedAt: null,
        });
        if (!hazard) {
          res.status(400).json({ message: "Perigo vinculado inválido." });
          return;
        }
      }

      const report = await new EthicsReport().update.one(
        { id: current.id, organizationId: orgId },
        {
          status,
          ...(resolution_note !== undefined
            ? { resolutionNote: blank(resolution_note) }
            : {}),
          ...(linked_hazard_id !== undefined
            ? { linkedHazardId: linked_hazard_id || null }
            : {}),
          ...(status === REPORT_STATUSES.RESOLVED ||
          status === REPORT_STATUSES.ARCHIVED
            ? { resolvedAt: new Date() }
            : {}),
        },
      );

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "ethics_report.update_status",
        entityType: "EthicsReport",
        entityId: current.id,
        after: { status },
      });

      if (!report) {
        res.status(500).json({ message: "Falha ao atualizar relato." });
        return;
      }

      const { accessCodeHash: _h, ...safe } = report;
      res.json({ report: safe });
    } catch (err) {
      fail(res, err);
    }
  }

  async addCommitteeMessage(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const userId = actorUserId(req as AuthRequest);
      /*
        Citado na denúncia é parte, não julgador: 404 e não 403, para não
        confirmar a existência do caso a quem está fora dele. [CB-27]
      */
      if (await estouImpedido(req, req.params.id)) {
        res.status(404).json({ message: "Relato não encontrado." });
        return;
      }
      const report = await new EthicsReport().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!report) {
        res.status(404).json({ message: "Relato não encontrado." });
        return;
      }
      if (
        report.status === REPORT_STATUSES.RESOLVED ||
        report.status === REPORT_STATUSES.ARCHIVED
      ) {
        res.status(409).json({
          message: "Relato encerrado — não recebe novas mensagens.",
        });
        return;
      }

      const { body } = req.body as { body?: string };
      if (!body?.trim()) {
        res.status(400).json({ message: "Informe body." });
        return;
      }

      const message = await new EthicsReportMessage().create.new({
        reportId: report.id,
        side: REPORT_AUTHOR_SIDES.COMMITTEE,
        body: body.trim(),
        authorUserId: userId,
      });

      if (report.status === REPORT_STATUSES.RECEIVED) {
        await new EthicsReport().update.one(
          { id: report.id, organizationId: orgId },
          { status: REPORT_STATUSES.IN_ANALYSIS },
        );
      }

      /*
        A pergunta do comitê ficava esperando a pessoa voltar sozinha ao
        acompanhamento. Relato anônimo não tem a quem avisar, e continua
        assim: o anonimato é real. [CB-29]
      */
      if (report.reporterUserId) {
        await notify({
          organizationId: orgId,
          userId: report.reporterUserId,
          kind: NotificationKind.ETHICS_MESSAGE,
          title: "O comitê respondeu a sua denúncia",
          body: "Abra o acompanhamento para ler e responder.",
          link: "/denuncia",
          entityType: "EthicsReport",
          entityId: report.id,
        });
      }

      res.status(201).json({ message });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Catálogo de categorias para a UI pública. */
  /**
   * O que a tela do canal precisa saber antes de alguém relatar.
   *
   * Com `organization_id`, devolve também o nome da empresa: o canal passou
   * a ser público, e quem abre o link precisa ver de que empresa é antes de
   * escrever. O id vem no link que a empresa divulga — não é segredo, como
   * o do convite. [S4-L]
   */
  async listCategories(req: Request, res: Response) {
    const orgId = (req.query.organization_id as string | undefined) ?? null;
    const organization = orgId
      ? await prisma.organization.findFirst({
          where: { id: orgId, active: true },
          select: { id: true, name: true },
        })
      : null;

    /*
      Sem empresa no endereço, a entrada do canal tem uma pergunta a fazer:
      há escolha de empresa? Quando a instalação atende uma só, ela leva
      direto ao formulário; quando atende mais de uma, não há como adivinhar
      de quem é quem está olhando, e a tela pede o endereço que a empresa
      divulgou. Duas bastam para responder "mais de uma" — e nesse caso
      nenhum nome sai daqui, que esta rota responde sem sessão. [CB-63]
    */
    const ativas = orgId
      ? []
      : await prisma.organization.findMany({
          where: { active: true },
          select: { id: true, name: true },
          take: 2,
        });

    res.json({
      categories: REPORT_CATEGORY_VALUES.map((id) => ({ id })),
      statuses: REPORT_STATUS_VALUES.map((id) => ({ id })),
      organization,
      single_organization: ativas.length === 1 ? ativas[0] : null,
    });
  }
}

export default new EthicsController();

import { AssessmentStatus, NotificationKind } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { notifyMany } from "../helper/notify";
import { canSeeAllInModule } from "../helper/module-access";
import { mudancasDesdeAEmissao } from "../helper/ordem-desatualizada";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

/** Vê a lista de ciência (dado de pessoa): quem emite e a fiscalização. */
function veCiencias(req: AuthRequest): boolean {
  return Boolean(
    req.actor && canSeeAllInModule(req.actor.permission, "documentos_pgr"),
  );
}

/**
 * O retrato que vai na ordem de serviço: o que a função faz, a que está
 * exposta, o que já existe para proteger e o que a função exige.
 *
 * Sai do inventário vivo no instante da emissão — depois disso não muda mais,
 * porque é o que foi dado a conhecer ao trabalhador.
 */
async function buildServiceOrderContent(organizationId: string, jobRoleId: string) {
  const role = await prisma.jobRole.findFirst({
    where: { id: jobRoleId, organizationId, archivedAt: null },
    include: {
      sector: { include: { establishment: true } },
      requirements: {
        include: { training: { select: { id: true, title: true } } },
      },
      activities: {
        include: {
          activity: {
            include: {
              hazards: {
                where: { archivedAt: null },
                include: {
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
              },
            },
          },
        },
      },
    },
  });

  if (!role) {
    throw Object.assign(new Error("Função não encontrada."), { status: 404 });
  }

  return {
    role,
    content: {
      generated_at: new Date().toISOString(),
      job_role: {
        id: role.id,
        name: role.name,
        description: role.description,
        sector: role.sector.name,
        establishment: role.sector.establishment.name,
        establishment_address: role.sector.establishment.address,
      },
      activities: role.activities.map(({ activity }) => ({
        id: activity.id,
        name: activity.name,
        description: activity.description,
        hazards: activity.hazards.map((h) => ({
          id: h.id,
          description: h.description,
          category: h.category,
          source: h.source,
          consequences: h.consequences,
          exposure_time: h.exposureTime,
          exposure_frequency: h.exposureFrequency,
          exposure_intensity: h.exposureIntensity,
          risks: h.risks.map((r) => ({
            id: r.id,
            description: r.description,
            level: r.assessments[0]?.resultingLevel ?? null,
            controls: r.controls.map((c) => ({
              id: c.id,
              type: c.type,
              description: c.description,
              status: c.status,
            })),
          })),
        })),
      })),
      requirements: role.requirements.map((q) => ({
        id: q.id,
        kind: q.kind,
        name: q.name,
        description: q.description,
        validity_months: q.validityMonths,
        training: q.training,
      })),
    },
  };
}

/** Trabalhadores ativos na função — é a quem a ordem precisa ser dada. */
async function peopleInRole(organizationId: string, jobRoleId: string) {
  const rows = await prisma.employeeProfile.findMany({
    where: {
      organizationId,
      jobRoleId,
      dismissedAt: null,
      user: { active: true },
    },
    /*
      A matrícula vai junto: é ela que identifica a pessoa no comprovante
      que sai no papel, onde dois homônimos não se distinguem. [B2-4-G]
    */
    select: { registration: true, user: { select: { id: true, name: true } } },
  });
  return rows.map((r) => ({ ...r.user, registration: r.registration }));
}

class ServiceOrderController {
  /**
   * Uma linha por função: a ordem vigente, quantos deram ciência e quantos
   * faltam. Função sem ordem aparece como pendente — é o que a fiscalização
   * cobra, e esconder a lacuna é o defeito. [S7-F]
   */
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const establishmentId = texto(req.query.establishment_id);

      const roles = await prisma.jobRole.findMany({
        where: {
          organizationId: orgId,
          archivedAt: null,
          ...(establishmentId
            ? { sector: { establishmentId } }
            : {}),
        },
        include: {
          sector: { select: { name: true, establishment: { select: { id: true, name: true } } } },
          serviceOrders: {
            orderBy: { version: "desc" },
            include: {
              issuedBy: { select: { id: true, name: true } },
              _count: { select: { acks: true } },
              acks: { where: { userId }, select: { acknowledgedAt: true } },
            },
          },
          _count: {
            select: {
              employees: { where: { dismissedAt: null, user: { active: true } } },
            },
          },
        },
        orderBy: { name: "asc" },
      });

      const meuPerfil = await prisma.employeeProfile.findFirst({
        where: { organizationId: orgId, userId, dismissedAt: null },
        select: { jobRoleId: true },
      });

      /*
        A ordem fica para trás quando o inventário da função muda depois da
        emissão, e nada dizia: a lista seguia mostrando "Emitida · v1". É a
        mesma comparação que os documentos do PGR já fazem. [CB-69]
      */
      const desatualizadas = new Map<string, number>();
      for (const role of roles) {
        const vigente = role.serviceOrders[0];
        if (!vigente) continue;
        desatualizadas.set(
          role.id,
          await mudancasDesdeAEmissao(orgId, role.id, vigente.issuedAt),
        );
      }

      res.json({
        my_job_role_id: meuPerfil?.jobRoleId ?? null,
        job_roles: roles.map((role) => {
          const vigente = role.serviceOrders[0] ?? null;
          return {
            id: role.id,
            name: role.name,
            sector: role.sector.name,
            establishment: role.sector.establishment,
            people: role._count.employees,
            is_mine: meuPerfil?.jobRoleId === role.id,
            current: vigente
              ? {
                  id: vigente.id,
                  version: vigente.version,
                  issued_at: vigente.issuedAt,
                  issued_by: vigente.issuedBy,
                  responsible_name: vigente.responsibleName,
                  acknowledged: vigente._count.acks,
                  pending: Math.max(role._count.employees - vigente._count.acks, 0),
                  my_ack_at: vigente.acks[0]?.acknowledgedAt ?? null,
                  /** Mudanças no inventário da função depois da emissão. [CB-69] */
                  changes_since: desatualizadas.get(role.id) ?? 0,
                }
              : null,
            versions: role.serviceOrders.length,
          };
        }),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /** A ordem inteira, para ler, imprimir e dar ciência. */
  async get(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);

      const order = await prisma.serviceOrder.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          issuedBy: { select: { id: true, name: true } },
          jobRole: {
            select: {
              id: true,
              name: true,
              sector: { select: { name: true, establishment: { select: { id: true, name: true } } } },
            },
          },
          organization: { select: { name: true, taxId: true } },
          acks: { where: { userId }, select: { acknowledgedAt: true } },
        },
      });
      if (!order) {
        res.status(404).json({ message: "Ordem de serviço não encontrada." });
        return;
      }

      const [maisNova, meuPerfil] = await Promise.all([
        prisma.serviceOrder.findFirst({
          where: { organizationId: orgId, jobRoleId: order.jobRoleId },
          orderBy: { version: "desc" },
          select: { id: true, version: true },
        }),
        prisma.employeeProfile.findFirst({
          where: { organizationId: orgId, userId, dismissedAt: null },
          select: { jobRoleId: true },
        }),
      ]);

      const { acks, ...rest } = order;
      res.json({
        service_order: {
          ...rest,
          my_ack_at: acks[0]?.acknowledgedAt ?? null,
          is_current: maisNova?.id === order.id,
          current_version: maisNova?.version ?? order.version,
          /// Só quem é da função dá ciência — ciência de outra função não prova nada.
          can_acknowledge:
            maisNova?.id === order.id &&
            meuPerfil?.jobRoleId === order.jobRoleId &&
            !acks[0],
        },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Quem deu ciência e quem falta — a prova que a fiscalização pede. [S7-D] */
  async acknowledgements(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      if (!veCiencias(auth)) {
        res.status(403).json({ message: "Sem permissão para ver a lista de ciência." });
        return;
      }
      const order = await prisma.serviceOrder.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        select: { id: true, version: true, jobRoleId: true },
      });
      if (!order) {
        res.status(404).json({ message: "Ordem de serviço não encontrada." });
        return;
      }

      const [pessoas, ciencias] = await Promise.all([
        peopleInRole(orgId, order.jobRoleId),
        prisma.serviceOrderAck.findMany({
          where: { serviceOrderId: order.id },
          select: { userId: true, acknowledgedAt: true },
        }),
      ]);
      const quando = new Map(ciencias.map((c) => [c.userId, c.acknowledgedAt]));
      const linhas = pessoas
        .map((p) => ({
          id: p.id,
          name: p.name,
          registration: p.registration,
          acknowledged_at: quando.get(p.id) ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

      res.json({
        service_order: { id: order.id, version: order.version },
        people: linhas,
        acknowledged: linhas.filter((l) => l.acknowledged_at).length,
        pending: linhas.filter((l) => !l.acknowledged_at).length,
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Emite a ordem de serviço da função. Append-only: nunca edita a assinada,
   * sempre cria a versão seguinte — e a versão nova pede ciência nova.
   */
  async issue(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const body = req.body as Record<string, unknown>;

      const jobRoleId = texto(body.job_role_id);
      if (!jobRoleId) {
        res.status(400).json({ message: "Informe job_role_id." });
        return;
      }
      const duties = texto(body.duties);
      if (!duties) {
        res.status(400).json({
          message:
            "Escreva as obrigações do trabalhador: é o que a ordem de serviço dá a conhecer.",
        });
        return;
      }

      const org = await prisma.organization.findFirst({ where: { id: orgId } });
      if (!org) {
        res.status(404).json({ message: "Organização não encontrada." });
        return;
      }
      const responsibleName = texto(body.responsible_name) ?? org.responsibleName;
      if (!responsibleName) {
        res.status(400).json({
          message:
            "Informe responsible_name (ou cadastre o responsável na organização).",
        });
        return;
      }

      const { role, content } = await buildServiceOrderContent(orgId, jobRoleId);

      const ultima = await prisma.serviceOrder.findFirst({
        where: { organizationId: orgId, jobRoleId },
        orderBy: { version: "desc" },
        select: { version: true },
      });

      const order = await prisma.serviceOrder.create({
        data: {
          organizationId: orgId,
          jobRoleId,
          version: (ultima?.version ?? 0) + 1,
          content: content as never,
          duties,
          emergencyInstructions: texto(body.emergency_instructions),
          issuedById: userId,
          responsibleName,
          responsibleRole: texto(body.responsible_role) ?? org.responsibleRole,
          responsibleRegistration:
            texto(body.responsible_registration) ?? org.responsibleRegistration,
        },
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "service_order.issue",
        entityType: "ServiceOrder",
        entityId: order.id,
        after: { job_role: role.name, version: order.version },
      });

      // Dar conhecimento é parte da obrigação, não cortesia: quem está na
      // função é avisado de que tem ordem nova para ler e dar ciência.
      const pessoas = await peopleInRole(orgId, jobRoleId);
      await notifyMany(
        pessoas.map((p) => p.id),
        {
          organizationId: orgId,
          kind: NotificationKind.SERVICE_ORDER_ISSUED,
          title: `Ordem de serviço de ${role.name}`,
          body: "Leia e dê ciência: é o documento que diz a que você está exposto e como se proteger.",
          link: `/ordens-servico/${order.id}`,
          entityType: "ServiceOrder",
          entityId: order.id,
        },
      );

      res.status(201).json({ service_order: order, notified: pessoas.length });
    } catch (err) {
      fail(res, err);
    }
  }

  /** A ciência é ato do trabalhador: ninguém dá ciência no lugar de outro. */
  async acknowledge(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);

      const order = await prisma.serviceOrder.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        select: { id: true, jobRoleId: true, version: true },
      });
      if (!order) {
        res.status(404).json({ message: "Ordem de serviço não encontrada." });
        return;
      }

      const perfil = await prisma.employeeProfile.findFirst({
        where: { organizationId: orgId, userId, dismissedAt: null },
        select: { jobRoleId: true },
      });
      if (!perfil || perfil.jobRoleId !== order.jobRoleId) {
        res.status(403).json({
          message: "Só quem está na função dá ciência da ordem de serviço dela.",
        });
        return;
      }

      const maisNova = await prisma.serviceOrder.findFirst({
        where: { organizationId: orgId, jobRoleId: order.jobRoleId },
        orderBy: { version: "desc" },
        select: { id: true, version: true },
      });
      if (maisNova && maisNova.id !== order.id) {
        res.status(409).json({
          message: `Esta versão foi substituída. Dê ciência da v${maisNova.version}.`,
        });
        return;
      }

      const ja = await prisma.serviceOrderAck.findFirst({
        where: { serviceOrderId: order.id, userId },
      });
      if (ja) {
        res.status(409).json({ message: "Você já deu ciência desta versão." });
        return;
      }

      const ack = await prisma.serviceOrderAck.create({
        data: { organizationId: orgId, serviceOrderId: order.id, userId },
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "service_order.acknowledge",
        entityType: "ServiceOrder",
        entityId: order.id,
        after: { version: order.version },
      });

      res.status(201).json({ acknowledgement: ack });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new ServiceOrderController();

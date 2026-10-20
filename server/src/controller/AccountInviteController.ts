import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { AccountRole, InviteRoleMode, Role } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import {
  allocateUniqueLogin,
  loginCandidateFromEmail,
  loginCandidateFromName,
} from "../helper/login-name";
import { writeAudit } from "../helper/audit";
import { orgRoleToAccountRole } from "../helper/auth";
import {
  assertInviteLinkUsable,
  assignableOrgRoles,
  canAssignOrgRole,
  canDecideJoinRequests,
  canManageInviteLinks,
} from "../helper/invite-access";
import { resolveAccessUntil } from "../helper/access-period";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

function httpError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * Em que pé está o link, de verdade.
 *
 * Todos nasciam "Ativo" e continuavam "Ativo" depois de esgotados ou
 * vencidos: a lista não dizia qual ainda servia. [S1-N] [S5-I] [CB-13]
 */
/** Até 1º de janeiro de 2100 — serve para dizer "sem validade". */
const SEM_VALIDADE = null;

/**
 * Validade do link a partir do que veio do formulário (`AAAA-MM-DD`).
 *
 * Vazio: sem validade, como era antes. Data que já passou é recusada — um
 * link que nasce vencido só confunde quem recebe. [S1-L]
 */
function resolveInviteExpiry(raw: unknown): Date | null {
  if (raw === undefined || raw === null || raw === "") return SEM_VALIDADE;
  const value = String(raw).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw httpError(400, "Validade do link inválida. Use AAAA-MM-DD.");
  }
  const fim = new Date(`${value}T23:59:59.999-03:00`);
  if (Number.isNaN(fim.getTime())) {
    throw httpError(400, "Validade do link inválida. Use AAAA-MM-DD.");
  }
  if (fim.getTime() <= Date.now()) {
    throw httpError(400, "A validade do link não pode ser uma data que já passou.");
  }
  return fim;
}

function situacaoDoLink(link: {
  active: boolean;
  expiresAt: Date | null;
  maxUses: number | null;
  usedCount: number;
}): "active" | "off" | "expired" | "exhausted" {
  if (!link.active) return "off";
  if (link.expiresAt && link.expiresAt.getTime() <= Date.now()) return "expired";
  if (link.maxUses !== null && link.usedCount >= link.maxUses) return "exhausted";
  return "active";
}

function serializeLink(
  link: {
    id: string;
    token: string;
    label: string | null;
    roleMode: InviteRoleMode;
    role: AccountRole;
    orgRole: Role;
    active: boolean;
    expiresAt: Date | null;
    maxUses: number | null;
    usedCount: number;
    createdAt: Date;
  },
  /** Quem entrou (ou pediu para entrar) por este link. [S5-I] */
  usadoPor: { name: string; status: string; at: Date }[] = [],
) {
  return {
    id: link.id,
    token: link.token,
    path: `/convite/${link.token}`,
    label: link.label,
    role_mode: link.roleMode,
    role: link.role,
    org_role: link.orgRole,
    active: link.active,
    situation: situacaoDoLink(link),
    expires_at: link.expiresAt,
    max_uses: link.maxUses,
    used_count: link.usedCount,
    used_by: usadoPor.map((u) => ({ name: u.name, status: u.status, at: u.at })),
    created_at: link.createdAt,
  };
}

class AccountInviteController {
  async listLinks(req: Request, res: Response) {
    try {
      const actor = (req as AuthRequest).actor!;
      if (!canManageInviteLinks(actor)) {
        throw httpError(403, "Sem permissão para gerenciar convites.");
      }
      const links = await prisma.accountInviteLink.findMany({
        where: { accountId: actor.accountId },
        orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      });
      /*
        A lista parecia uma lista de pessoas e não dizia quem tinha usado
        cada link. Quem usou vem dos pedidos de entrada feitos por ele.
        [S5-I]
      */
      const pedidos = await prisma.accountJoinRequest.findMany({
        where: { inviteLinkId: { in: links.map((l) => l.id) } },
        orderBy: { createdAt: "asc" },
        select: {
          inviteLinkId: true,
          name: true,
          status: true,
          createdAt: true,
        },
      });
      const porLink = new Map<string, { name: string; status: string; at: Date }[]>();
      for (const p of pedidos) {
        if (!p.inviteLinkId) continue;
        porLink.set(p.inviteLinkId, [
          ...(porLink.get(p.inviteLinkId) ?? []),
          { name: p.name, status: p.status, at: p.createdAt },
        ]);
      }
      res.json({
        links: links.map((l) => serializeLink(l, porLink.get(l.id) ?? [])),
        assignable: { org_roles: assignableOrgRoles(actor) },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async createLink(req: Request, res: Response) {
    try {
      const actor = (req as AuthRequest).actor!;
      if (!canManageInviteLinks(actor)) {
        throw httpError(403, "Sem permissão para gerenciar convites.");
      }

      const body = req.body as {
        label?: string;
        max_uses?: number | null;
        role_mode?: string;
        role?: string;
        org_role?: string;
        /** Último dia em que o link funciona (AAAA-MM-DD). [S1-L] [S5-I] */
        expires_at?: string | null;
      };

      const roleMode =
        body.role_mode === "FIXED" ? InviteRoleMode.FIXED : InviteRoleMode.ON_APPROVE;

      /*
        Só se escolhe o papel na empresa; o da conta acompanha. Eram dois
        seletores, e um anulava o outro em silêncio. [OB-3] [S1-C]
      */
      let orgRole: Role = Role.COLABORADOR;

      if (roleMode === InviteRoleMode.FIXED) {
        if (!body.org_role) {
          throw httpError(400, "Com papel fixo, org_role é obrigatório.");
        }
        if (!Object.values(Role).includes(body.org_role as Role)) {
          throw httpError(400, "org_role inválido.");
        }
        orgRole = body.org_role as Role;
        if (!canAssignOrgRole(actor, orgRole)) {
          throw httpError(403, "Você só pode conceder papéis abaixo do seu.");
        }
      }
      const role: AccountRole = orgRoleToAccountRole(orgRole);

      const maxUses =
        typeof body.max_uses === "number" && body.max_uses > 0
          ? Math.floor(body.max_uses)
          : null;

      /*
        O portal já recusava link vencido, mas nem a tela nem a criação
        deixavam informar a validade: todo link nascia para sempre. [S1-L]
      */
      const expiresAt = resolveInviteExpiry(body.expires_at);

      const token = randomBytes(24).toString("base64url");
      const link = await prisma.accountInviteLink.create({
        data: {
          accountId: actor.accountId,
          token,
          roleMode,
          role,
          orgRole,
          label: blank(body.label),
          maxUses,
          expiresAt,
          createdById: actor.userId,
        },
      });

      await writeAudit({
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: "ACCOUNT_INVITE_LINK_CREATED",
        entityType: "AccountInviteLink",
        entityId: link.id,
        after: {
          accountId: actor.accountId,
          label: link.label,
          roleMode: link.roleMode,
          role: link.role,
          orgRole: link.orgRole,
          expiresAt: link.expiresAt,
        },
      });

      res.status(201).json({ link: serializeLink(link) });
    } catch (err) {
      fail(res, err);
    }
  }

  async deactivateLink(req: Request, res: Response) {
    try {
      const actor = (req as AuthRequest).actor!;
      if (!canManageInviteLinks(actor)) {
        throw httpError(403, "Sem permissão para gerenciar convites.");
      }
      const link = await prisma.accountInviteLink.findFirst({
        where: { id: req.params.id, accountId: actor.accountId },
      });
      if (!link) throw httpError(404, "Link de convite não encontrado.");
      if (!link.active) {
        res.json({ ok: true, id: link.id, active: false });
        return;
      }
      const updated = await prisma.accountInviteLink.update({
        where: { id: link.id },
        data: { active: false },
      });
      await writeAudit({
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: "ACCOUNT_INVITE_LINK_DEACTIVATED",
        entityType: "AccountInviteLink",
        entityId: link.id,
        after: { accountId: actor.accountId, label: link.label },
      });
      res.json({ ok: true, id: updated.id, active: updated.active });
    } catch (err) {
      fail(res, err);
    }
  }

  async getPublic(req: Request, res: Response) {
    try {
      const link = await prisma.accountInviteLink.findUnique({
        where: { token: req.params.token },
        include: {
          account: {
            select: {
              name: true,
              active: true,
              organization: { select: { name: true } },
            },
          },
        },
      });
      if (!link || !link.account.active) {
        throw httpError(404, "Convite não encontrado.");
      }
      assertInviteLinkUsable(link);
      res.json({
        account_name: link.account.name,
        organization_name: link.account.organization.name,
        label: link.label,
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async acceptPublic(req: Request, res: Response) {
    try {
      /*
        Quem se cadastra informa quem é e escolhe a senha. Matrícula e
        vínculo (externo) são da empresa: quem aprova é que define, porque
        marcar-se externo muda o próprio vínculo e matrícula é número que o
        RH atribui. [S1-M] [S1-Q]
      */
      const { name, email, password } = req.body as {
        name?: string;
        email?: string;
        password?: string;
      };
      const link = await prisma.accountInviteLink.findUnique({
        where: { token: req.params.token },
        include: {
          account: {
            select: { id: true, name: true, active: true, organizationId: true },
          },
        },
      });
      if (!link || !link.account.active) {
        throw httpError(404, "Convite não encontrado.");
      }
      assertInviteLinkUsable(link);

      const cleanName = name?.trim() ?? "";
      // O e-mail deixou de ser obrigatório: o portal não envia nem confirma
      // e-mail, e a planilha já dispensava. [OB-1]
      const cleanEmail = blank(email)?.toLowerCase() ?? null;
      if (!cleanName) {
        throw httpError(400, "Informe o seu nome.");
      }
      if (!password || password.length < 8) {
        throw httpError(400, "A senha deve ter pelo menos 8 caracteres.");
      }

      if (cleanEmail) {
        const existingMembership = await prisma.accountMembership.findFirst({
          where: { accountId: link.accountId, user: { email: cleanEmail } },
          select: { id: true },
        });
        if (existingMembership) {
          throw httpError(409, "Essa pessoa já está nesta conta.");
        }

        const existingUser = await prisma.user.findFirst({
          where: { email: cleanEmail },
          select: { id: true },
        });
        if (existingUser) {
          throw httpError(
            409,
            "Já existe uma conta com este e-mail. Entre pelo login.",
          );
        }

        const pendingSame = await prisma.accountJoinRequest.findFirst({
          where: {
            accountId: link.accountId,
            email: cleanEmail,
            status: "PENDING",
          },
          select: { id: true },
        });
        if (pendingSame) {
          throw httpError(409, "Já existe um pedido pendente com este e-mail.");
        }
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const request = await prisma.$transaction(async (tx) => {
        const fresh = await tx.accountInviteLink.findUnique({
          where: { id: link.id },
        });
        if (!fresh) throw httpError(404, "Convite não encontrado.");
        assertInviteLinkUsable(fresh);

        const created = await tx.accountJoinRequest.create({
          data: {
            accountId: link.accountId,
            inviteLinkId: link.id,
            name: cleanName,
            email: cleanEmail,
            passwordHash,
            // Quem aprova define os dois. [S1-M]
            registration: null,
            isExternal: false,
            status: "PENDING",
          },
        });
        await tx.accountInviteLink.update({
          where: { id: link.id },
          data: { usedCount: { increment: 1 } },
        });
        return created;
      });

      res.status(201).json({
        ok: true,
        pending: true,
        email: cleanEmail,
        account_name: link.account.name,
        request_id: request.id,
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async listJoinRequests(req: Request, res: Response) {
    try {
      const actor = (req as AuthRequest).actor!;
      if (!canDecideJoinRequests(actor)) {
        throw httpError(403, "Sem permissão para decidir pedidos.");
      }

      const rows = await prisma.accountJoinRequest.findMany({
        where: {
          status: "PENDING",
          account: {
            organizationId: actor.organizationId,
            active: true,
            ...(actor.isMaster || canManageInviteLinks(actor)
              ? {}
              : { id: actor.accountId }),
          },
        },
        orderBy: { createdAt: "asc" },
        include: {
          account: { select: { id: true, name: true } },
        },
      });

      const linkIds = [
        ...new Set(
          rows
            .map((r) => r.inviteLinkId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      const links =
        linkIds.length > 0
          ? await prisma.accountInviteLink.findMany({
              where: { id: { in: linkIds } },
              select: {
                id: true,
                roleMode: true,
                role: true,
                orgRole: true,
                label: true,
              },
            })
          : [];
      const linkById = new Map(links.map((l) => [l.id, l]));

      res.json({
        requests: rows.map((r) => {
          const link = r.inviteLinkId ? linkById.get(r.inviteLinkId) : undefined;
          return {
            id: r.id,
            account_id: r.accountId,
            account_name: r.account.name,
            name: r.name,
            email: r.email,
            registration: r.registration,
            is_external: r.isExternal,
            created_at: r.createdAt,
            invite_link_id: r.inviteLinkId,
            role_mode: link?.roleMode ?? InviteRoleMode.ON_APPROVE,
            suggested_org_role: link?.orgRole ?? null,
            invite_label: link?.label ?? null,
          };
        }),
        assignable: { org_roles: assignableOrgRoles(actor) },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async decideJoinRequest(req: Request, res: Response) {
    try {
      const actor = (req as AuthRequest).actor!;
      if (!canDecideJoinRequests(actor)) {
        throw httpError(403, "Sem permissão para decidir pedidos.");
      }

      const body = req.body as {
        action?: string;
        role?: string;
        org_role?: string;
        note?: string;
        /** Matrícula, definida por quem aprova. [S1-M] */
        registration?: string;
        /** Terceiro sem matrícula da empresa, definido por quem aprova. [S1-M] */
        is_external?: boolean;
        /** Fim do acesso do fiscal (AAAA-MM-DD). Vazio → 30 dias. */
        access_until?: string;
      };
      if (body.action !== "approve" && body.action !== "reject") {
        throw httpError(400, "action deve ser approve ou reject.");
      }

      const request = await prisma.accountJoinRequest.findFirst({
        where: {
          id: req.params.id,
          status: "PENDING",
          account: {
            organizationId: actor.organizationId,
            active: true,
          },
        },
        include: {
          account: {
            select: { id: true, organizationId: true, name: true },
          },
        },
      });
      if (!request) throw httpError(404, "Pedido não encontrado.");

      if (body.action === "reject") {
        await prisma.accountJoinRequest.update({
          where: { id: request.id },
          data: {
            status: "REJECTED",
            decidedById: actor.userId,
            decidedAt: new Date(),
            decisionNote: blank(body.note),
          },
        });
        await writeAudit({
          organizationId: actor.organizationId,
          actorId: actor.userId,
          action: "ACCOUNT_JOIN_REJECTED",
          entityType: "AccountJoinRequest",
          entityId: request.id,
          after: { email: request.email, accountId: request.accountId },
        });
        res.json({ ok: true, status: "REJECTED" });
        return;
      }

      const inviteLink = request.inviteLinkId
        ? await prisma.accountInviteLink.findUnique({
            where: { id: request.inviteLinkId },
            select: { roleMode: true, role: true, orgRole: true },
          })
        : null;

      /*
        Na aprovação também se escolhe um papel só: o da empresa. Era aqui que
        o Roberto entrava "Admin" na conta e "Técnico SST" na empresa, e o
        primeiro vencia sem ninguém ver. [OB-3] [S1-C]
      */
      /*
        O papel fixo no link é sugestão, não sentença: quem aprova pode
        revê-lo. Antes, link com papel fixo chegava à aprovação sem permitir
        mudança — e o que o link disse valia mesmo que a pessoa fosse outra
        coisa. [S1-P]
      */
      const papelSugerido =
        inviteLink?.roleMode === InviteRoleMode.FIXED
          ? inviteLink.orgRole
          : Role.COLABORADOR;
      let orgRole: Role =
        body.org_role && Object.values(Role).includes(body.org_role as Role)
          ? (body.org_role as Role)
          : papelSugerido;
      if (!canAssignOrgRole(actor, orgRole)) {
        throw httpError(403, "Você só pode conceder papéis abaixo do seu.");
      }
      const role: AccountRole = orgRoleToAccountRole(orgRole);

      const fiscalUntil =
        orgRole === Role.FISCAL ? resolveAccessUntil(body.access_until) : null;

      /*
        Matrícula e vínculo são decididos aqui, não por quem se cadastrou: é
        a empresa que atribui o número e que sabe quem é de fora. [S1-M]
      */
      const isExternal = body.is_external === true;
      const registration = isExternal ? null : blank(body.registration);

      await prisma.$transaction(async (tx) => {
        if (request.email) {
          const existingUser = await tx.user.findFirst({
            where: { email: request.email },
            select: { id: true },
          });
          if (existingUser) {
            throw httpError(409, "Já existe um usuário com este e-mail.");
          }
        }

        if (registration) {
          const taken = await tx.employeeProfile.findFirst({
            where: {
              organizationId: request.account.organizationId,
              registration,
            },
            select: { id: true },
          });
          if (taken) {
            throw httpError(
              /*
                Dizer que a matrícula existe entrega a lista de matrículas a
                quem tiver o link. A pessoa certa resolve com o RH. [CB-17]
              */
              409,
              "Não foi possível concluir o cadastro com estes dados. Fale com o RH da empresa.",
            );
          }
        }

        /*
          O login sai da matrícula quando há uma; senão do e-mail; senão do
          nome, porque o e-mail deixou de ser obrigatório. Seja qual for, a
          pessoa também entra pela matrícula e pelo CPF. [OB-1] [B2-1-F]
        */
        const loginBase =
          (registration &&
            registration.toLowerCase().replace(/[^a-z0-9._-]/g, "")) ||
          (request.email
            ? loginCandidateFromEmail(request.email)
            : loginCandidateFromName(request.name));
        const login = await allocateUniqueLogin(loginBase, tx);

        const user = await tx.user.create({
          data: {
            login,
            email: request.email,
            name: request.name,
            passwordHash: request.passwordHash,
            mustChangePassword: false,
          },
        });

        await tx.accountMembership.create({
          data: {
            accountId: request.accountId,
            userId: user.id,
            role,
          },
        });

        await tx.membership.create({
          data: {
            userId: user.id,
            organizationId: request.account.organizationId,
            role: orgRole,
            // O fiscal entra com prazo; os demais, sem. [S7-A]
            accessExpiresAt: fiscalUntil,
          },
        });

        // Fiscal não é funcionário: não ganha ficha de colaborador.
        if (orgRole !== Role.FISCAL) {
          await tx.employeeProfile.create({
            data: {
              organizationId: request.account.organizationId,
              userId: user.id,
              registration,
            },
          });
        }

        await tx.accountJoinRequest.update({
          where: { id: request.id },
          data: {
            status: "APPROVED",
            decidedRole: role,
            decidedOrgRole: orgRole,
            registration,
            isExternal,
            decidedById: actor.userId,
            decidedAt: new Date(),
            decisionNote: blank(body.note),
            passwordHash: "",
          },
        });
      });

      await writeAudit({
        organizationId: actor.organizationId,
        actorId: actor.userId,
        action: "ACCOUNT_JOIN_APPROVED",
        entityType: "AccountJoinRequest",
        entityId: request.id,
        after: {
          email: request.email,
          accountId: request.accountId,
          role,
          orgRole,
          ...(fiscalUntil ? { accessExpiresAt: fiscalUntil.toISOString() } : {}),
        },
      });

      res.json({
        ok: true,
        status: "APPROVED",
        role,
        org_role: orgRole,
        ...(fiscalUntil ? { access_expires_at: fiscalUntil.toISOString() } : {}),
      });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new AccountInviteController();

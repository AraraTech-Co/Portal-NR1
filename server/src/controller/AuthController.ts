import { Request, Response } from "express";
import bcrypt from "bcryptjs";
import prisma from "../model/prisma";
import { User } from "../model/schema/User/User";
import { Token } from "../model/schema/Token/Token";
import {
  hashToken,
  signToken,
  tokenExpiresAt,
} from "../model/lib/Auth";
import {
  listAccessibleAccounts,
  resolveAccountAccess,
} from "../helper/account-access";
import { effectivePermission } from "../helper/auth";
import { modulesForRole } from "../helper/module-access";
import type { AuthRequest } from "../types/auth";

/** Senhas provisórias da carga inicial — forçam troca no próximo acesso. */
const PROVISIONAL_PASSWORDS = new Set(["123456"]);

function publicUser(actor: NonNullable<AuthRequest["actor"]>) {
  return {
    id: actor.userId,
    login: actor.login,
    email: actor.email,
    name: actor.name,
    account_role: actor.accountRole,
    is_master: actor.isMaster,
    role: actor.role,
    permission: actor.permission,
    must_change_password: actor.mustChangePassword,
    modules: modulesForRole(actor.permission),
    organization: {
      id: actor.organizationId,
      name: actor.organizationName,
    },
    account: {
      id: actor.accountId,
      name: actor.accountName,
    },
  };
}

function sessionUserFromAccess(
  access: NonNullable<Awaited<ReturnType<typeof resolveAccountAccess>>>,
) {
  const permission = effectivePermission(access.orgRole, access.accountRole);
  return {
    id: access.user.id,
    login: access.user.login,
    email: access.user.email,
    name: access.user.name,
    account_role: access.accountRole,
    is_master: access.isMaster,
    role: access.orgRole,
    permission,
    must_change_password: access.user.mustChangePassword,
    modules: modulesForRole(permission),
    organization: {
      id: access.organizationId,
      name: access.organizationName,
    },
    account: {
      id: access.accountId,
      name: access.accountName,
    },
  };
}

class AuthController {
  /**
   * POST /api/auth — login.
   * Contas disponíveis = memberships + todas as contas das empresas onde é MASTER.
   */
  async signin(req: Request, res: Response) {
    const { login, password, account_id } = req.body as {
      login?: string;
      password?: string;
      account_id?: string;
    };

    if (!login?.trim() || !password) {
      res.status(400).json({ message: "Informe login e senha." });
      return;
    }

    const users = new User();
    const user = await users.custom.read.byLoginIdentifier(login);
    if (!user || !user.active) {
      res.status(401).json({ message: "Credenciais inválidas." });
      return;
    }

    const ok = await users.custom.auth.verifyPassword(user, password);
    if (!ok) {
      res.status(401).json({ message: "Credenciais inválidas." });
      return;
    }

    // Senha provisória da carga: marca troca obrigatória antes de emitir sessão.
    let mustChange = user.mustChangePassword;
    if (!mustChange && PROVISIONAL_PASSWORDS.has(password)) {
      await prisma.user.update({
        where: { id: user.id },
        data: { mustChangePassword: true },
      });
      mustChange = true;
    }

    const accounts = await listAccessibleAccounts(user.id);
    if (accounts.length === 0) {
      res.status(403).json({ message: "Usuário sem conta acessível." });
      return;
    }

    let chosen = accounts[0];
    if (account_id) {
      const match = accounts.find((a) => a.id === account_id);
      if (!match) {
        res.status(403).json({ message: "Conta não permitida." });
        return;
      }
      chosen = match;
    }

    const access = await resolveAccountAccess(user.id, chosen.id);
    if (!access) {
      const ended = await prisma.membership.findFirst({
        where: {
          userId: user.id,
          organizationId: chosen.organization.id,
          accessExpiresAt: { lte: new Date() },
        },
        select: { accessExpiresAt: true },
      });
      if (ended?.accessExpiresAt) {
        const day = ended.accessExpiresAt.toLocaleDateString("pt-BR", {
          timeZone: "America/Sao_Paulo",
        });
        res.status(403).json({
          message: `Seu acesso terminou em ${day}. Fale com a empresa para renovar.`,
          code: "ACCESS_ENDED",
        });
        return;
      }
      res.status(403).json({ message: "Conta não permitida." });
      return;
    }

    const rawToken = signToken({
      userId: user.id,
      organizationId: access.organizationId,
      accountId: access.accountId,
    });

    const tokens = new Token();
    await tokens.custom.create.save({
      userId: user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: tokenExpiresAt(),
    });

    const sessionUser = sessionUserFromAccess({
      ...access,
      user: { ...access.user, mustChangePassword: mustChange },
    });

    res.json({
      token: rawToken,
      user: sessionUser,
      accounts,
    });
  }

  async get(req: Request, res: Response) {
    const authReq = req as AuthRequest;
    if (!authReq.actor) {
      res.status(401).json({ message: "Não autenticado." });
      return;
    }

    const accounts = await listAccessibleAccounts(authReq.actor.userId);

    res.json({
      user: publicUser(authReq.actor),
      accounts,
    });
  }

  /**
   * POST /api/auth/password — troca senha (libera mustChangePassword).
   */
  async changePassword(req: Request, res: Response) {
    const authReq = req as AuthRequest;
    if (!authReq.actor) {
      res.status(401).json({ message: "Não autenticado." });
      return;
    }

    const { current_password, new_password } = req.body as {
      current_password?: string;
      new_password?: string;
    };

    if (!current_password || !new_password) {
      res.status(400).json({
        message: "Informe current_password e new_password.",
      });
      return;
    }
    if (new_password.length < 8) {
      res.status(400).json({
        message: "A nova senha deve ter pelo menos 8 caracteres.",
      });
      return;
    }
    if (new_password === current_password) {
      res.status(400).json({
        message: "A nova senha deve ser diferente da atual.",
      });
      return;
    }
    if (PROVISIONAL_PASSWORDS.has(new_password)) {
      res.status(400).json({
        message: "Escolha uma senha diferente da provisória.",
      });
      return;
    }

    const users = new User();
    const user = await users.read.one({ id: authReq.actor.userId });
    if (!user) {
      res.status(401).json({ message: "Não autenticado." });
      return;
    }

    const ok = await users.custom.auth.verifyPassword(user, current_password);
    if (!ok) {
      res.status(401).json({ message: "Senha atual incorreta." });
      return;
    }

    const passwordHash = await bcrypt.hash(new_password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustChangePassword: false },
    });

    const access = await resolveAccountAccess(
      authReq.actor.userId,
      authReq.actor.accountId,
    );
    if (!access) {
      res.status(403).json({ message: "Conta não permitida." });
      return;
    }

    res.json({
      user: sessionUserFromAccess({
        ...access,
        user: { ...access.user, mustChangePassword: false },
      }),
    });
  }

  /**
   * POST /api/auth/switch — troca a conta ativa (membro ou MASTER da empresa).
   */
  async switchAccount(req: Request, res: Response) {
    const authReq = req as AuthRequest;
    if (!authReq.actor || !authReq.token) {
      res.status(401).json({ message: "Não autenticado." });
      return;
    }

    const { account_id } = req.body as { account_id?: string };
    if (!account_id) {
      res.status(400).json({ message: "Informe account_id." });
      return;
    }

    const access = await resolveAccountAccess(
      authReq.actor.userId,
      account_id,
    );
    if (!access) {
      res.status(403).json({ message: "Conta não permitida." });
      return;
    }

    const tokens = new Token();
    await tokens.custom.delete.byHash(hashToken(authReq.token));

    const rawToken = signToken({
      userId: access.user.id,
      organizationId: access.organizationId,
      accountId: access.accountId,
    });

    await tokens.custom.create.save({
      userId: access.user.id,
      tokenHash: hashToken(rawToken),
      expiresAt: tokenExpiresAt(),
    });

    res.json({
      token: rawToken,
      user: sessionUserFromAccess(access),
    });
  }

  async signout(req: Request, res: Response) {
    const authReq = req as AuthRequest;
    if (authReq.token) {
      const tokens = new Token();
      await tokens.custom.delete.byHash(hashToken(authReq.token));
    }
    res.json({ ok: true });
  }
}

export default new AuthController();

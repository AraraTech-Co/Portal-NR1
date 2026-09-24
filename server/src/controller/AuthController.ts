import { Request, Response } from "express";
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
import type { AuthRequest } from "../types/auth";

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
    grants: actor.grants,
    must_change_password: actor.mustChangePassword,
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
    grants: access.grants,
    must_change_password: access.user.mustChangePassword,
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

    res.json({
      token: rawToken,
      user: sessionUserFromAccess(access),
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

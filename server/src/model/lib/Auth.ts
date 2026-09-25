import { createHash, randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { Token } from "../schema/Token/Token";
import { resolveAccountAccess } from "../../helper/account-access";
import { effectivePermission } from "../../helper/auth";
import { can } from "../../helper/permissions";
import type { AuthRequest, Actor } from "../../types/auth";

const TOKEN_DURATION_SEC = 60 * 60 * 8; // 8h

function tokenSecret(): string {
  const secret = process.env.TOKEN_SECRET;
  if (!secret) throw new Error("TOKEN_SECRET is not set");
  return secret;
}

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function signToken(payload: {
  userId: string;
  organizationId: string;
  accountId: string;
}): string {
  return jwt.sign(
    {
      ...payload,
      jti: randomUUID(),
    },
    tokenSecret(),
    {
      expiresIn: TOKEN_DURATION_SEC,
    },
  );
}

export function verifyJwt(raw: string): {
  userId: string;
  organizationId: string;
  accountId: string;
} {
  const decoded = jwt.verify(raw, tokenSecret()) as {
    userId?: string;
    organizationId?: string;
    accountId?: string;
  };
  if (!decoded.userId || !decoded.organizationId || !decoded.accountId) {
    throw new Error("Invalid token payload");
  }
  return {
    userId: decoded.userId,
    organizationId: decoded.organizationId,
    accountId: decoded.accountId,
  };
}

export function tokenExpiresAt(): Date {
  return new Date(Date.now() + TOKEN_DURATION_SEC * 1000);
}

/**
 * Bearer JWT + acesso à conta:
 * - MASTER da empresa → qualquer conta da org
 * - senão → AccountMembership (OWNER > ADMIN > USER)
 *
 * Hierarquia na matriz: master > owner > admin > user
 */
export function verify(permission: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization;

      if (!header) {
        if (permission === "public") return next();
        res.status(401).json({ message: "Não autenticado." });
        return;
      }

      const [type, raw] = header.split(" ");
      if (type !== "Bearer" || !raw) {
        res.status(401).json({ message: "Cabeçalho de autorização inválido." });
        return;
      }

      const payload = verifyJwt(raw);
      const tokens = new Token();
      const stored = await tokens.read.one({ tokenHash: hashToken(raw) });
      if (!stored || stored.expiresAt < new Date()) {
        res.status(401).json({ message: "Sessão expirada ou inválida." });
        return;
      }

      const access = await resolveAccountAccess(
        payload.userId,
        payload.accountId,
      );

      if (
        !access ||
        access.organizationId !== payload.organizationId ||
        !access.user.active
      ) {
        res.status(401).json({ message: "Acesso negado." });
        return;
      }

      const roleKey = effectivePermission(access.orgRole, access.accountRole);
      if (permission !== "public" && !can(roleKey, permission)) {
        res.status(403).json({
          message: "Você não tem permissão para esta ação.",
        });
        return;
      }

      const actor: Actor = {
        userId: access.user.id,
        organizationId: access.organizationId,
        accountId: access.accountId,
        accountRole: access.accountRole,
        isMaster: access.isMaster,
        role: access.orgRole,
        permission: roleKey,
        name: access.user.name,
        email: access.user.email,
        login: access.user.login,
        mustChangePassword: access.user.mustChangePassword,
        organizationName: access.organizationName,
        accountName: access.accountName,
      };

      const authReq = req as AuthRequest;
      authReq.actor = actor;
      authReq.token = raw;
      next();
    } catch {
      res.status(401).json({ message: "Não autenticado." });
    }
  };
}

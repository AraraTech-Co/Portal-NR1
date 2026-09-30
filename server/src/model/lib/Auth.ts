import { createHash, randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { Token } from "../schema/Token/Token";
import { resolveAccountAccess } from "../../helper/account-access";
import { effectivePermission } from "../../helper/auth";
import { can } from "../../helper/permissions";
import {
  canReadModule,
  canWriteModule,
  type AccessLevel,
} from "../../helper/module-access";
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

/** Rotas liberadas enquanto mustChangePassword = true. */
const ALLOWED_WHILE_MUST_CHANGE = new Set([
  "GET /api/auth",
  "DELETE /api/auth",
  "POST /api/auth/password",
]);

function isAllowedWhileMustChangePassword(method: string, path: string): boolean {
  return ALLOWED_WHILE_MUST_CHANGE.has(`${method.toUpperCase()} ${path}`);
}

type Gate =
  | { kind: "public" }
  | { kind: "legacy"; permission: string }
  | { kind: "module"; moduleId: string; level: AccessLevel };

async function authenticate(
  req: Request,
  res: Response,
  gate: Gate,
): Promise<boolean> {
  const header = req.headers.authorization;

  if (!header) {
    if (gate.kind === "public") return true;
    res.status(401).json({ message: "Não autenticado." });
    return false;
  }

  const [type, raw] = header.split(" ");
  if (type !== "Bearer" || !raw) {
    res.status(401).json({ message: "Cabeçalho de autorização inválido." });
    return false;
  }

  const payload = verifyJwt(raw);
  const tokens = new Token();
  const stored = await tokens.read.one({ tokenHash: hashToken(raw) });
  if (!stored || stored.expiresAt < new Date()) {
    res.status(401).json({ message: "Sessão expirada ou inválida." });
    return false;
  }

  const access = await resolveAccountAccess(payload.userId, payload.accountId);

  if (
    !access ||
    access.organizationId !== payload.organizationId ||
    !access.user.active
  ) {
    res.status(401).json({ message: "Acesso negado." });
    return false;
  }

  const roleKey = effectivePermission(access.orgRole, access.accountRole);

  if (gate.kind === "legacy" && gate.permission !== "public") {
    if (!can(roleKey, gate.permission)) {
      res.status(403).json({
        message: "Você não tem permissão para esta ação.",
      });
      return false;
    }
  }

  if (gate.kind === "module") {
    const ok =
      gate.level === "write"
        ? canWriteModule(roleKey, gate.moduleId)
        : canReadModule(roleKey, gate.moduleId);
    if (!ok) {
      res.status(403).json({
        message: "Você não tem permissão para este módulo.",
      });
      return false;
    }
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

  if (
    actor.mustChangePassword &&
    gate.kind !== "public" &&
    !isAllowedWhileMustChangePassword(req.method, req.path)
  ) {
    res.status(403).json({
      message: "É obrigatório alterar a senha antes de continuar.",
      code: "MUST_CHANGE_PASSWORD",
    });
    return false;
  }

  return true;
}

/**
 * Bearer JWT + acesso à conta.
 * `permission` legado: public | user | sst | rh | admin | master | owner.
 */
export function verify(permission: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const gate: Gate =
        permission === "public"
          ? { kind: "public" }
          : { kind: "legacy", permission };
      const ok = await authenticate(req, res, gate);
      if (ok) next();
    } catch {
      res.status(401).json({ message: "Não autenticado." });
    }
  };
}

/**
 * Autentica e exige nível read|write no módulo da matriz NR-1.
 * `read` cobre L e L/E; `write` exige L/E.
 */
export function verifyModule(moduleId: string, level: "read" | "write") {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ok = await authenticate(req, res, {
        kind: "module",
        moduleId,
        level,
      });
      if (ok) next();
    } catch {
      res.status(401).json({ message: "Não autenticado." });
    }
  };
}

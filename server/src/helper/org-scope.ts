import type { AuthRequest } from "../types/auth";

export function actorOrgId(req: AuthRequest): string {
  if (!req.actor?.organizationId) {
    throw Object.assign(new Error("Não autenticado."), { status: 401 });
  }
  return req.actor.organizationId;
}

export function actorUserId(req: AuthRequest): string {
  if (!req.actor?.userId) {
    throw Object.assign(new Error("Não autenticado."), { status: 401 });
  }
  return req.actor.userId;
}

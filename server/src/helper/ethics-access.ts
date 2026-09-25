import { can } from "./permissions";
import type { AuthRequest } from "../types/auth";
import type { Response, NextFunction, Request } from "express";

/**
 * Comitê de ética: MASTER da empresa ou papel efetivo com permissão admin
 * (OWNER/ADMIN da conta).
 */
export function requireEthicsCommittee(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const actor = (req as AuthRequest).actor;
  if (!actor) {
    res.status(401).json({ message: "Não autenticado." });
    return;
  }
  if (actor.isMaster || can(actor.permission, "admin")) {
    next();
    return;
  }
  res.status(403).json({
    message: "Acesso restrito ao comitê de ética.",
  });
}

import type { Response, NextFunction, Request } from "express";
import { ETHICS_COMMITTEE_GRANT } from "../constants";
import type { AuthRequest } from "../types/auth";

/**
 * Exige autenticação + grant `ethics_committee` (ou MASTER da empresa).
 * Usar depois de `verify("user")`.
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
  if (
    actor.isMaster ||
    actor.grants.includes(ETHICS_COMMITTEE_GRANT)
  ) {
    next();
    return;
  }
  res.status(403).json({
    message: "Acesso restrito ao comitê de ética.",
  });
}

import { canReadModule } from "./module-access";
import type { AuthRequest } from "../types/auth";
import type { Response, NextFunction, Request } from "express";

/**
 * Comitê de ética: quem tem L ou L/E no módulo `comite` (Master/Owner/RH no sheet).
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
  if (canReadModule(actor.permission, "comite")) {
    next();
    return;
  }
  res.status(403).json({
    message: "Acesso restrito ao comitê de ética.",
  });
}

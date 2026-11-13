import { Router } from "express";
import inspection from "../../controller/InspectionController";
import type { NextFunction, Request, Response } from "express";
import { moduleRead } from "./middleware";
import { canSeeInspectionPanel } from "../../helper/module-access";
import type { AuthRequest } from "../../types/auth";

/**
 * O painel da fiscalização lê o PGR inteiro, com as lacunas à mostra.
 * Quem lê os documentos do PGR lê o painel — inclusive o fiscal. [S7-B]
 */
const read = moduleRead("documentos_pgr");

/** Além de ler o PGR: só Master, Dono, SST, RH e fiscal (P-2). [C4-13] */
function painel(req: Request, res: Response, next: NextFunction) {
  if (!canSeeInspectionPanel((req as AuthRequest).actor!.permission)) {
    res.status(403).json({ message: "O painel da fiscalização é do SST, do RH e da direção." });
    return;
  }
  next();
}

const router = Router();

router.get("/api/fiscalizacao", read, painel, (req, res) =>
  inspection.overview(req, res),
);
router.get("/api/fiscalizacao/historico", read, painel, (req, res) =>
  inspection.history(req, res),
);

export default router;

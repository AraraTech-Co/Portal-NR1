import { Router } from "express";
import inspection from "../../controller/InspectionController";
import { moduleRead } from "./middleware";

/**
 * O painel da fiscalização lê o PGR inteiro, com as lacunas à mostra.
 * Quem lê os documentos do PGR lê o painel — inclusive o fiscal. [S7-B]
 */
const read = moduleRead("documentos_pgr");

const router = Router();

router.get("/api/fiscalizacao", read, (req, res) =>
  inspection.overview(req, res),
);
router.get("/api/fiscalizacao/historico", read, (req, res) =>
  inspection.history(req, res),
);

export default router;

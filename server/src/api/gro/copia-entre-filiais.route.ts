import { Router } from "express";
import copia from "../../controller/EstablishmentCopyController";
import { moduleWrite } from "./middleware";

/**
 * Cópia entre filiais. A guarda da rota é a escrita no Inventário; a regra
 * de quem copia (o SST e o Master, não o Dono) está no controlador. [C3-8]
 */
const write = moduleWrite("inventario");

const router = Router();

router.post("/api/establishments/:id/copia/previa", write, (req, res) => copia.preview(req, res));
router.post("/api/establishments/:id/copia", write, (req, res) => copia.copy(req, res));

export default router;

import { Router } from "express";
import { verifyModule } from "../../model/lib/Auth";
import feriados from "../../controller/HolidayController";

/**
 * Feriados do prazo da denúncia: Master, Dono e RH, pelo módulo "conta" com
 * escrita (é onde fica o Canal e comitê). [C4-11]
 */
const central = verifyModule("conta", "write");

const router = Router();

router.get("/api/feriados", central, (req, res) => feriados.list(req, res));
router.post("/api/feriados", central, (req, res) => feriados.create(req, res));
router.delete("/api/feriados/:id", central, (req, res) => feriados.remove(req, res));
router.patch("/api/feriados/filiais/:id", central, (req, res) => feriados.updateUnit(req, res));

export default router;

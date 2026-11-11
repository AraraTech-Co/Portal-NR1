import { Router } from "express";
import { verifyModule } from "../../model/lib/Auth";
import historico from "../../controller/HistoricoSemUnidadeController";

/**
 * Histórico sem unidade: listar com a proposta da ficha e classificar.
 * Só a central (Master, Dono e RH), pelo módulo "conta" com escrita. [C3-7]
 */
const central = verifyModule("conta", "write");

const router = Router();

router.get("/api/historico-sem-unidade", central, (req, res) => historico.list(req, res));
router.post("/api/historico-sem-unidade/classificar", central, (req, res) => historico.classify(req, res));

export default router;

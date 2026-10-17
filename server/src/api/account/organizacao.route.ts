import { Router } from "express";
import organization from "../../controller/OrganizationController";
import { verifyModule } from "../../model/lib/Auth";

/** Dados da empresa e responsável pelo PGR: quem cuida de Configurações. [B2-1-M] */
const read = verifyModule("configuracoes", "read");
const write = verifyModule("configuracoes", "write");

const router = Router();

router.get("/api/organizacao", read, (req, res) => organization.get(req, res));
router.patch("/api/organizacao", write, (req, res) =>
  organization.update(req, res),
);

export default router;

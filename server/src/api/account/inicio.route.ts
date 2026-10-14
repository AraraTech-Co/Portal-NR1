import { Router } from "express";
import home from "../../controller/HomeController";
import { verify } from "../../model/lib/Auth";

/**
 * O painel de início é de quem está logado: cada bloco se filtra pelo papel
 * dentro do controller. Basta estar autenticado. [S1-F] [S5-A] [S6-A] [S6-B]
 */
const autenticado = verify("user");

const router = Router();

router.get("/api/inicio", autenticado, (req, res) => home.overview(req, res));

export default router;

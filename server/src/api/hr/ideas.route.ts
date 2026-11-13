import { Router } from "express";
import ideas from "../../controller/IdeaController";
import { moduleManage, moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("ideias");
const write = moduleWrite("ideias");
const manage = moduleManage("ideias");

const router = Router();

router.get("/api/ideas", read, (req, res) => ideas.list(req, res));
/**
 * Enviar a própria ideia: quem lê o módulo, inclusive o SST (terceirizado),
 * que só lê. O controller grava sempre em nome de quem envia; editar e
 * decidir seguem com a escrita e com quem administra. Decisão P-0b do Léo
 * (só a ideia; o banco de horas não, porque o SST é terceirizado). [C4-16]
 */
router.post("/api/ideas", read, (req, res) => ideas.create(req, res));
router.get("/api/ideas/:id", read, (req, res) => ideas.get(req, res));
router.patch("/api/ideas/:id", write, (req, res) => ideas.update(req, res));
/** Decidir é do RH: o colaborador escreve só a própria ideia. */
router.post("/api/ideas/:id/decide", manage, (req, res) =>
  ideas.decide(req, res),
);

export default router;

import { Router } from "express";
import ideas from "../../controller/IdeaController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("ideias");
const write = moduleWrite("ideias");

const router = Router();

router.get("/api/ideas", read, (req, res) => ideas.list(req, res));
/** Criar/editar exige L/E (colaborador tem write no sheet). */
router.post("/api/ideas", write, (req, res) => ideas.create(req, res));
router.get("/api/ideas/:id", read, (req, res) => ideas.get(req, res));
router.patch("/api/ideas/:id", write, (req, res) => ideas.update(req, res));
router.post("/api/ideas/:id/decide", write, (req, res) =>
  ideas.decide(req, res),
);

export default router;

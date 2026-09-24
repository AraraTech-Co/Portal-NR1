import { Router } from "express";
import ideas from "../../controller/IdeaController";
import { read, writeRh } from "./middleware";

const router = Router();

router.get("/api/ideas", read, (req, res) => ideas.list(req, res));
router.post("/api/ideas", read, (req, res) => ideas.create(req, res));
router.get("/api/ideas/:id", read, (req, res) => ideas.get(req, res));
router.patch("/api/ideas/:id", read, (req, res) => ideas.update(req, res));
router.post("/api/ideas/:id/decide", writeRh, (req, res) =>
  ideas.decide(req, res),
);

export default router;

import { Router } from "express";
import aep from "../../controller/AepController";
import { moduleManage, moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("aep");
const write = moduleWrite("aep");
/** Concluir e levar perigo ao inventário é de quem administra. */
const manage = moduleManage("aep");

const router = Router();

router.get("/api/psychosocial-factors", read, (req, res) =>
  aep.listFactors(req, res),
);
router.get("/api/aeps", read, (req, res) => aep.list(req, res));
router.post("/api/aeps", write, (req, res) => aep.create(req, res));
router.get("/api/aeps/:id", read, (req, res) => aep.get(req, res));
router.patch("/api/aeps/:id", write, (req, res) => aep.update(req, res));
router.post("/api/aeps/:id/conclude", manage, (req, res) =>
  aep.conclude(req, res),
);
router.post("/api/aeps/:id/hazards", manage, (req, res) =>
  aep.addHazard(req, res),
);
router.post("/api/aeps/:id/evidences", write, (req, res) =>
  aep.addEvidence(req, res),
);

export default router;

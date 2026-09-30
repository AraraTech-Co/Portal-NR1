import { Router } from "express";
import participation from "../../controller/ParticipationController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("participacao");
const write = moduleWrite("participacao");

const router = Router();

router.get("/api/participations", read, (req, res) =>
  participation.list(req, res),
);
router.post("/api/participations", write, (req, res) =>
  participation.create(req, res),
);
router.get("/api/participations/:id", read, (req, res) =>
  participation.get(req, res),
);
router.patch("/api/participations/:id", write, (req, res) =>
  participation.update(req, res),
);
router.post("/api/participations/:id/evidences", write, (req, res) =>
  participation.addEvidence(req, res),
);

export default router;

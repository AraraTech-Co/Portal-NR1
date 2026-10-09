import { Router } from "express";
import risk from "../../controller/RiskController";
import actionEvidence from "../../controller/ActionEvidenceController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("acoes");
const write = moduleWrite("acoes");

const router = Router();

router.get("/api/actions", read, (req, res) => risk.listActions(req, res));
router.post("/api/actions", write, (req, res) => risk.createAction(req, res));
router.post("/api/actions/:id/complete", write, (req, res) =>
  actionEvidence.completeAction(req, res),
);
router.post("/api/actions/:id/review", write, (req, res) =>
  actionEvidence.reviewAction(req, res),
);

router.get("/api/evidences", read, (req, res) =>
  actionEvidence.listEvidences(req, res),
);
router.get("/api/evidences/:id/file", read, (req, res) =>
  actionEvidence.evidenceFile(req, res),
);
router.post("/api/evidences", write, (req, res) =>
  actionEvidence.createEvidence(req, res),
);

export default router;

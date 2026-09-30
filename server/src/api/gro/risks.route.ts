import { Router } from "express";
import risk from "../../controller/RiskController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("inventario");
const write = moduleWrite("inventario");

const router = Router();

router.get("/api/methodologies", read, (req, res) =>
  risk.listMethodologies(req, res),
);

router.get("/api/hazards", read, (req, res) => risk.listHazards(req, res));
router.post("/api/hazards", write, (req, res) => risk.createHazard(req, res));
router.patch("/api/hazards/:id", write, (req, res) =>
  risk.updateHazard(req, res),
);
router.delete("/api/hazards/:id", write, (req, res) =>
  risk.archiveHazard(req, res),
);

router.get("/api/risks", read, (req, res) => risk.listRisks(req, res));
router.post("/api/risks", write, (req, res) => risk.createRisk(req, res));
router.patch("/api/risks/:id", write, (req, res) => risk.updateRisk(req, res));
router.delete("/api/risks/:id", write, (req, res) =>
  risk.archiveRisk(req, res),
);

router.get("/api/assessments", read, (req, res) =>
  risk.listAssessments(req, res),
);
router.post("/api/assessments", write, (req, res) =>
  risk.createAssessment(req, res),
);
router.post("/api/assessments/:id/validate", write, (req, res) =>
  risk.validateAssessment(req, res),
);

router.get("/api/controls", read, (req, res) => risk.listControls(req, res));
router.post("/api/controls", write, (req, res) => risk.createControl(req, res));

export default router;

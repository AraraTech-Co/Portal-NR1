import { Router } from "express";
import { verify } from "../model/lib/Auth";
import workplace from "../controller/WorkplaceController";
import risk from "../controller/RiskController";
import actionEvidence from "../controller/ActionEvidenceController";
import documents from "../controller/DocumentController";
import aep from "../controller/AepController";
import survey from "../controller/PreliminarySurveyController";

const router = Router();

const read = verify("user");
const write = verify("sst");

// Workplace
router.get("/api/establishments", read, (req, res) =>
  workplace.listEstablishments(req, res),
);
router.post("/api/establishments", write, (req, res) =>
  workplace.createEstablishment(req, res),
);
router.patch("/api/establishments/:id", write, (req, res) =>
  workplace.updateEstablishment(req, res),
);
router.delete("/api/establishments/:id", write, (req, res) =>
  workplace.archiveEstablishment(req, res),
);

router.get("/api/sectors", read, (req, res) => workplace.listSectors(req, res));
router.post("/api/sectors", write, (req, res) =>
  workplace.createSector(req, res),
);
router.patch("/api/sectors/:id", write, (req, res) =>
  workplace.updateSector(req, res),
);
router.delete("/api/sectors/:id", write, (req, res) =>
  workplace.archiveSector(req, res),
);

router.get("/api/job-roles", read, (req, res) =>
  workplace.listJobRoles(req, res),
);
router.post("/api/job-roles", write, (req, res) =>
  workplace.createJobRole(req, res),
);
router.patch("/api/job-roles/:id", write, (req, res) =>
  workplace.updateJobRole(req, res),
);
router.delete("/api/job-roles/:id", write, (req, res) =>
  workplace.archiveJobRole(req, res),
);

router.get("/api/activities", read, (req, res) =>
  workplace.listActivities(req, res),
);
router.post("/api/activities", write, (req, res) =>
  workplace.createActivity(req, res),
);
router.patch("/api/activities/:id", write, (req, res) =>
  workplace.updateActivity(req, res),
);
router.delete("/api/activities/:id", write, (req, res) =>
  workplace.archiveActivity(req, res),
);

// Risks / GRO
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

router.get("/api/actions", read, (req, res) => risk.listActions(req, res));
router.post("/api/actions", write, (req, res) => risk.createAction(req, res));

router.get("/api/evidences", read, (req, res) =>
  actionEvidence.listEvidences(req, res),
);
router.post("/api/evidences", write, (req, res) =>
  actionEvidence.createEvidence(req, res),
);
router.post("/api/actions/:id/complete", write, (req, res) =>
  actionEvidence.completeAction(req, res),
);
router.post("/api/actions/:id/review", write, (req, res) =>
  actionEvidence.reviewAction(req, res),
);

// Inventário vivo + documentos PGR + mudanças
router.get("/api/inventory", read, (req, res) =>
  documents.getInventory(req, res),
);
router.get("/api/pgr-documents", read, (req, res) =>
  documents.listDocuments(req, res),
);
router.post("/api/pgr-documents", write, (req, res) =>
  documents.issueDocument(req, res),
);
router.get("/api/change-events", read, (req, res) =>
  documents.listChangeEvents(req, res),
);
router.post("/api/change-events", write, (req, res) =>
  documents.createChangeEvent(req, res),
);

// AEP — Avaliação Ergonômica Preliminar (NR-17)
router.get("/api/psychosocial-factors", read, (req, res) =>
  aep.listFactors(req, res),
);
router.get("/api/aeps", read, (req, res) => aep.list(req, res));
router.post("/api/aeps", write, (req, res) => aep.create(req, res));
router.get("/api/aeps/:id", read, (req, res) => aep.get(req, res));
router.patch("/api/aeps/:id", write, (req, res) => aep.update(req, res));
router.post("/api/aeps/:id/conclude", write, (req, res) =>
  aep.conclude(req, res),
);
router.post("/api/aeps/:id/hazards", write, (req, res) =>
  aep.addHazard(req, res),
);
router.post("/api/aeps/:id/evidences", write, (req, res) =>
  aep.addEvidence(req, res),
);

// Levantamento preliminar (NR-1 1.5.4.2)
router.get("/api/preliminary-surveys", read, (req, res) =>
  survey.list(req, res),
);
router.post("/api/preliminary-surveys", write, (req, res) =>
  survey.create(req, res),
);
router.get("/api/preliminary-surveys/:id", read, (req, res) =>
  survey.get(req, res),
);
router.post("/api/preliminary-surveys/:id/items", write, (req, res) =>
  survey.addItem(req, res),
);

export default router;

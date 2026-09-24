import { Router } from "express";
import emergency from "../../controller/EmergencyController";
import { read, write } from "./middleware";

const router = Router();

router.get("/api/emergency-procedures", read, (req, res) =>
  emergency.listProcedures(req, res),
);
router.post("/api/emergency-procedures", write, (req, res) =>
  emergency.createProcedure(req, res),
);
router.get("/api/emergency-procedures/:id", read, (req, res) =>
  emergency.getProcedure(req, res),
);
router.patch("/api/emergency-procedures/:id", write, (req, res) =>
  emergency.updateProcedure(req, res),
);
router.delete("/api/emergency-procedures/:id", write, (req, res) =>
  emergency.archiveProcedure(req, res),
);
router.post("/api/emergency-procedures/:id/drills", write, (req, res) =>
  emergency.addDrill(req, res),
);
router.get("/api/emergency-procedures/:id/drills/:drillId", read, (req, res) =>
  emergency.getDrill(req, res),
);
router.post(
  "/api/emergency-procedures/:id/drills/:drillId/evidences",
  write,
  (req, res) => emergency.addDrillEvidence(req, res),
);

export default router;

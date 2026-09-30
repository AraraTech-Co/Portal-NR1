import { Router } from "express";
import compliance from "../../controller/ComplianceController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("saude");
const writeRh = moduleWrite("saude");

const router = Router();

router.get("/api/job-role-requirements", read, (req, res) =>
  compliance.listRequirements(req, res),
);
router.post("/api/job-role-requirements", writeRh, (req, res) =>
  compliance.createRequirement(req, res),
);
router.get("/api/worker-certificates", read, (req, res) =>
  compliance.listCertificates(req, res),
);
router.post("/api/worker-certificates", read, (req, res) =>
  compliance.createCertificate(req, res),
);
router.post("/api/worker-certificates/:id/review", writeRh, (req, res) =>
  compliance.reviewCertificate(req, res),
);
router.get("/api/occupational-exams", read, (req, res) =>
  compliance.listExams(req, res),
);
router.post("/api/occupational-exams", writeRh, (req, res) =>
  compliance.createExam(req, res),
);

export default router;

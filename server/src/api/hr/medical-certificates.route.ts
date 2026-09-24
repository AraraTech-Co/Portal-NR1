import { Router } from "express";
import certificates from "../../controller/MedicalCertificateController";
import { read, writeRh } from "./middleware";

const router = Router();

router.get("/api/medical-certificates", read, (req, res) =>
  certificates.list(req, res),
);
router.post("/api/medical-certificates", read, (req, res) =>
  certificates.create(req, res),
);
router.post("/api/medical-certificates/:id/review", writeRh, (req, res) =>
  certificates.review(req, res),
);
router.post("/api/medical-certificates/:id/read", read, (req, res) =>
  certificates.markRead(req, res),
);

export default router;

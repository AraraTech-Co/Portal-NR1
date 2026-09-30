import { Router } from "express";
import certificates from "../../controller/MedicalCertificateController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("atestados");
const write = moduleWrite("atestados");

const router = Router();

router.get("/api/medical-certificates", read, (req, res) =>
  certificates.list(req, res),
);
/** Envio do próprio atestado: colaborador tem L/E no sheet. */
router.post("/api/medical-certificates", write, (req, res) =>
  certificates.create(req, res),
);
router.post("/api/medical-certificates/:id/review", write, (req, res) =>
  certificates.review(req, res),
);
router.post("/api/medical-certificates/:id/read", read, (req, res) =>
  certificates.markRead(req, res),
);

export default router;

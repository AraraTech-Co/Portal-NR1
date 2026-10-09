import { Router } from "express";
import certificates from "../../controller/MedicalCertificateController";
import { moduleManage, moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("atestados");
const write = moduleWrite("atestados");
/** Decidir sobre o atestado de alguém: escrita não basta. [S4-J] */
const manage = moduleManage("atestados");

const router = Router();

router.get("/api/medical-certificates", read, (req, res) =>
  certificates.list(req, res),
);
/** Envio do próprio atestado: colaborador tem L/E no sheet. */
router.post("/api/medical-certificates", write, (req, res) =>
  certificates.create(req, res),
);
router.post("/api/medical-certificates/:id/review", manage, (req, res) =>
  certificates.review(req, res),
);
router.get("/api/medical-certificates/:id/file", read, (req, res) =>
  certificates.file(req, res),
);
router.post("/api/medical-certificates/:id/read", read, (req, res) =>
  certificates.markRead(req, res),
);

export default router;

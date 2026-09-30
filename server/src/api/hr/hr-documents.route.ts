import { Router } from "express";
import docs from "../../controller/HrDocumentController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("documentos_rh");
const writeRh = moduleWrite("documentos_rh");

const router = Router();

router.get("/api/hr-documents", read, (req, res) => docs.list(req, res));
router.post("/api/hr-documents", writeRh, (req, res) => docs.create(req, res));
router.get("/api/hr-documents/:id", read, (req, res) => docs.get(req, res));
router.post("/api/hr-documents/:id/ack", read, (req, res) =>
  docs.acknowledge(req, res),
);

export default router;

import { Router } from "express";
import documents from "../../controller/DocumentController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("documentos_pgr");
const write = moduleWrite("documentos_pgr");

const router = Router();

router.get("/api/inventory", read, (req, res) =>
  documents.getInventory(req, res),
);
router.get("/api/pgr-documents", read, (req, res) =>
  documents.listDocuments(req, res),
);
router.get("/api/pgr-documents/:id", read, (req, res) =>
  documents.getDocument(req, res),
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

export default router;

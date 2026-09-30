import { Router } from "express";
import contractor from "../../controller/ContractorController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("terceiros");
const write = moduleWrite("terceiros");

const router = Router();

router.get("/api/contractors", read, (req, res) => contractor.list(req, res));
router.post("/api/contractors", write, (req, res) =>
  contractor.create(req, res),
);
router.get("/api/contractors/:id", read, (req, res) =>
  contractor.get(req, res),
);
router.patch("/api/contractors/:id", write, (req, res) =>
  contractor.update(req, res),
);
router.delete("/api/contractors/:id", write, (req, res) =>
  contractor.archive(req, res),
);
router.post("/api/contractors/:id/documents-received", write, (req, res) =>
  contractor.markDocumentsReceived(req, res),
);
router.post("/api/contractors/:id/risks-informed", write, (req, res) =>
  contractor.markRisksInformed(req, res),
);

export default router;

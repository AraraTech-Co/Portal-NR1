import { Router } from "express";
import occurrence from "../../controller/OccurrenceController";
import { moduleManage, moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("ocorrencias");
const write = moduleWrite("ocorrencias");
/** Analisar e abrir ação é de quem administra; registrar é de todos. */
const manage = moduleManage("ocorrencias");

const router = Router();

router.get("/api/occurrences", read, (req, res) =>
  occurrence.list(req, res),
);
router.post("/api/occurrences", write, (req, res) =>
  occurrence.create(req, res),
);
router.get("/api/occurrences/:id", read, (req, res) =>
  occurrence.get(req, res),
);
router.patch("/api/occurrences/:id", write, (req, res) =>
  occurrence.update(req, res),
);
router.post("/api/occurrences/:id/analyze", manage, (req, res) =>
  occurrence.analyze(req, res),
);
router.post("/api/occurrences/:id/actions", manage, (req, res) =>
  occurrence.addAction(req, res),
);
router.post("/api/occurrences/:id/evidences", write, (req, res) =>
  occurrence.addEvidence(req, res),
);

export default router;

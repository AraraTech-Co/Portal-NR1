import { Router } from "express";
import occurrence from "../../controller/OccurrenceController";
import { read, write } from "./middleware";

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
router.post("/api/occurrences/:id/analyze", write, (req, res) =>
  occurrence.analyze(req, res),
);
router.post("/api/occurrences/:id/actions", write, (req, res) =>
  occurrence.addAction(req, res),
);
router.post("/api/occurrences/:id/evidences", write, (req, res) =>
  occurrence.addEvidence(req, res),
);

export default router;

import { Router } from "express";
import trainings from "../../controller/TrainingController";
import { read, writeRh } from "./middleware";

const router = Router();

router.get("/api/trainings", read, (req, res) => trainings.list(req, res));
router.post("/api/trainings", writeRh, (req, res) => trainings.create(req, res));
router.get("/api/trainings/:id", read, (req, res) => trainings.get(req, res));
router.delete("/api/trainings/:id", writeRh, (req, res) =>
  trainings.archive(req, res),
);
router.post("/api/trainings/:id/enroll", read, (req, res) =>
  trainings.enroll(req, res),
);
router.post("/api/trainings/:id/start", read, (req, res) =>
  trainings.start(req, res),
);
router.post("/api/trainings/:id/complete", read, (req, res) =>
  trainings.complete(req, res),
);

export default router;

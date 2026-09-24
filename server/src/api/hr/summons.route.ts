import { Router } from "express";
import summons from "../../controller/SummonController";
import { read, writeRh } from "./middleware";

const router = Router();

router.get("/api/summons", read, (req, res) => summons.list(req, res));
router.post("/api/summons", writeRh, (req, res) => summons.create(req, res));
router.get("/api/summons/:id", read, (req, res) => summons.get(req, res));
router.post("/api/summons/:id/invite", writeRh, (req, res) =>
  summons.invite(req, res),
);
router.post("/api/summons/:id/attendance", read, (req, res) =>
  summons.updateAttendance(req, res),
);

export default router;

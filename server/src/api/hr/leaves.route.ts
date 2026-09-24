import { Router } from "express";
import leaves from "../../controller/LeaveController";
import { read, writeRh } from "./middleware";

const router = Router();

router.get("/api/leaves", read, (req, res) => leaves.list(req, res));
router.post("/api/leaves", read, (req, res) => leaves.create(req, res));
router.post("/api/leaves/:id/decide", writeRh, (req, res) =>
  leaves.decide(req, res),
);
router.post("/api/leaves/:id/cancel", read, (req, res) =>
  leaves.cancel(req, res),
);

export default router;

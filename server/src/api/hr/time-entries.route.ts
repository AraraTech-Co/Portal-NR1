import { Router } from "express";
import time from "../../controller/TimeEntryController";
import { read } from "./middleware";

const router = Router();

router.get("/api/time-entries", read, (req, res) => time.list(req, res));
router.post("/api/time-entries", read, (req, res) => time.upsert(req, res));

export default router;

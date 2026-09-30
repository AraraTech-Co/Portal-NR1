import { Router } from "express";
import time from "../../controller/TimeEntryController";
import { moduleRead } from "./middleware";

const read = moduleRead("ponto");

const router = Router();

router.get("/api/time-entries", read, (req, res) => time.list(req, res));
/**
 * Exceção self-service: sheet dá L ao colaborador; lançamento do próprio
 * ponto permanece em `read` (controller restringe escopo).
 */
router.post("/api/time-entries", read, (req, res) => time.upsert(req, res));

export default router;

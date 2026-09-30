import { Router } from "express";
import leaves from "../../controller/LeaveController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("ferias");
const write = moduleWrite("ferias");

const router = Router();

router.get("/api/leaves", read, (req, res) => leaves.list(req, res));
/**
 * Exceção self-service: sheet dá só L ao colaborador, mas o pedido próprio
 * permanece em `read` (controller limita ao próprio usuário).
 * Decisão RH exige write.
 */
router.post("/api/leaves", read, (req, res) => leaves.create(req, res));
router.post("/api/leaves/:id/decide", write, (req, res) =>
  leaves.decide(req, res),
);
router.post("/api/leaves/:id/cancel", read, (req, res) =>
  leaves.cancel(req, res),
);

export default router;

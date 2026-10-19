import { Router } from "express";
import time from "../../controller/TimeEntryController";
import { moduleManage, moduleRead } from "./middleware";

const read = moduleRead("ponto");
const cuidaDoPonto = moduleManage("ponto");

const router = Router();

router.get("/api/time-entries", read, (req, res) => time.list(req, res));
/**
 * Lançar é de quem cuida do ponto. O colaborador tem leitura no módulo, e a
 * rota ficava em `read`: dava para ele gravar o próprio saldo com o valor
 * que quisesse. [S5-O]
 */
router.post("/api/time-entries", cuidaDoPonto, (req, res) =>
  time.upsert(req, res),
);

export default router;

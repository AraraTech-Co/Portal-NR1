import { Router } from "express";
import serviceOrders from "../../controller/ServiceOrderController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("documentos_pgr");
const write = moduleWrite("documentos_pgr");

const router = Router();

router.get("/api/service-orders", read, (req, res) =>
  serviceOrders.list(req, res),
);
router.get("/api/service-orders/:id", read, (req, res) =>
  serviceOrders.get(req, res),
);
router.get("/api/service-orders/:id/ciencias", read, (req, res) =>
  serviceOrders.acknowledgements(req, res),
);
router.post("/api/service-orders", write, (req, res) =>
  serviceOrders.issue(req, res),
);
/**
 * Dar ciência é ato do próprio trabalhador sobre o que é dele — leitura no
 * módulo basta, e o controller confere se a função é a dele. Papel só de
 * consulta não grava: o bloqueio vale no `authenticate`. [S7-F]
 */
router.post("/api/service-orders/:id/ciencia", read, (req, res) =>
  serviceOrders.acknowledge(req, res),
);

export default router;

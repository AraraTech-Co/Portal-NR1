import { Router } from "express";
import queixas from "../../controller/ErgonomicComplaintController";
import { moduleManage, moduleRead, moduleWrite } from "./middleware";

/*
  A queixa é de quem trabalha: registrar pede escrita no módulo, que o
  colaborador tem. Responder — virar avaliação ou encerrar — é de quem
  administra. [P1]
*/
const read = moduleRead("aep");
const write = moduleWrite("aep");
const manage = moduleManage("aep");

const router = Router();

router.get("/api/queixas-ergonomicas", read, (req, res) =>
  queixas.list(req, res),
);
router.post("/api/queixas-ergonomicas", write, (req, res) =>
  queixas.create(req, res),
);
router.post("/api/queixas-ergonomicas/:id/avaliacao", manage, (req, res) =>
  queixas.evaluate(req, res),
);
router.post("/api/queixas-ergonomicas/:id/encerramento", manage, (req, res) =>
  queixas.close(req, res),
);

export default router;

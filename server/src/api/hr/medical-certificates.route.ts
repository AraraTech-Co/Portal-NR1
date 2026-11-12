import { Router } from "express";
import certificates from "../../controller/MedicalCertificateController";
import { moduleManage, moduleOwn, moduleOwnSend, moduleRead } from "./middleware";

const read = moduleRead("atestados");
/** Ver os próprios atestados e o arquivo, qualquer que seja o papel. [C2-1] */
const own = moduleOwn("atestados");
/** Decidir sobre o atestado de alguém: escrita não basta. [S4-J] */
const manage = moduleManage("atestados");

const router = Router();

router.get("/api/medical-certificates", own, (req, res) =>
  certificates.list(req, res),
);
/**
 * Envio do próprio atestado, qualquer papel com ficha ativa: a mesma regra
 * da consulta própria. O controller grava sempre em nome de quem envia;
 * aceitar ou recusar continua com quem administra o módulo. [C4-4]
 */
router.post("/api/medical-certificates", moduleOwnSend("atestados"), (req, res) =>
  certificates.create(req, res),
);
router.post("/api/medical-certificates/:id/review", manage, (req, res) =>
  certificates.review(req, res),
);
router.get("/api/medical-certificates/:id/file", own, (req, res) =>
  certificates.file(req, res),
);
router.post("/api/medical-certificates/:id/read", read, (req, res) =>
  certificates.markRead(req, res),
);

export default router;

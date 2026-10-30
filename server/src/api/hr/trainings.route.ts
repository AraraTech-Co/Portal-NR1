import { Router } from "express";
import trainings from "../../controller/TrainingController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("treinamentos");
const writeRh = moduleWrite("treinamentos");

const router = Router();

router.get("/api/trainings", read, (req, res) => trainings.list(req, res));
router.post("/api/trainings", writeRh, (req, res) => trainings.create(req, res));
/** O certificado como documento, para abrir e imprimir. [B2-3-C] */
router.get("/api/certificados/:enrollmentId", read, (req, res) =>
  trainings.certificate(req, res),
);
router.get("/api/trainings/:id/enrollments", read, (req, res) =>
  trainings.listEnrollments(req, res),
);
router.get("/api/trainings/:id", read, (req, res) => trainings.get(req, res));
/** Quem ministra e o responsável técnico, para o certificado. [B3-3-G] */
router.patch("/api/trainings/:id/certificado", writeRh, (req, res) =>
  trainings.updateCertificateData(req, res),
);
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
/** Turma presencial: registrar a aula dada e quem esteve. [S4-D] */
router.get("/api/trainings/:id/turmas", read, (req, res) =>
  trainings.listSessions(req, res),
);
/** A lista de presença de uma turma já marcada. [CB-34] */
router.post("/api/trainings/:id/turmas/:sessionId/presenca", writeRh, (req, res) =>
  trainings.recordAttendance(req, res),
);
router.post("/api/trainings/:id/turmas", writeRh, (req, res) =>
  trainings.createSession(req, res),
);
/** Local e qualificação de quem deu a aula, na turma já registrada. [B4-B] */
router.patch("/api/trainings/:id/turmas/:sessionId", writeRh, (req, res) =>
  trainings.updateSession(req, res),
);

export default router;

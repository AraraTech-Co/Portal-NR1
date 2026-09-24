import { Router } from "express";
import payslips from "../../controller/PayslipController";
import { read, writeRh } from "./middleware";

const router = Router();

router.get("/api/payslips", read, (req, res) => payslips.list(req, res));
router.post("/api/payslips", writeRh, (req, res) => payslips.create(req, res));
router.get("/api/payslips/:id", read, (req, res) => payslips.get(req, res));
router.post("/api/payslips/:id/questions", read, (req, res) =>
  payslips.askQuestion(req, res),
);
router.post(
  "/api/payslips/:id/questions/:questionId/answer",
  writeRh,
  (req, res) => payslips.answerQuestion(req, res),
);

export default router;

import { Router } from "express";
import ethicsReports from "./ethics-reports.route";

/** Canal de denúncia (Lei 14.457/2022) — fora do GRO. */
const router = Router();
router.use(ethicsReports);

export default router;

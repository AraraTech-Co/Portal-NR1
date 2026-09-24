import { Router } from "express";
import employeeProfiles from "./employee-profiles.route";

/** RH e engajamento (ADR-14) — separado do GRO. */
const router = Router();
router.use(employeeProfiles);

export default router;

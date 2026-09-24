import { Router } from "express";
import employeeProfiles from "./employee-profiles.route";
import ideas from "./ideas.route";
import announcements from "./announcements.route";

/** RH e engajamento (ADR-14) — separado do GRO. */
const router = Router();
router.use(employeeProfiles);
router.use(ideas);
router.use(announcements);

export default router;

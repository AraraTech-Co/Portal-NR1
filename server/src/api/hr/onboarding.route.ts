import { Router } from "express";
import onboarding from "../../controller/OnboardingController";
import { read, writeRh } from "./middleware";

const router = Router();

router.get("/api/onboarding-steps", read, (req, res) =>
  onboarding.listSteps(req, res),
);
router.post("/api/onboarding-steps", writeRh, (req, res) =>
  onboarding.createStep(req, res),
);
router.post("/api/onboarding-steps/:id/complete", read, (req, res) =>
  onboarding.completeStep(req, res),
);

export default router;

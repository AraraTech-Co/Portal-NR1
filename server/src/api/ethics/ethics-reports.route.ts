import { Router } from "express";
import { verify } from "../../model/lib/Auth";
import ethics from "../../controller/EthicsController";
import { requireEthicsCommittee } from "../../helper/ethics-access";

const router = Router();

const publicRoute = verify("public");
const committee = [verify("user"), requireEthicsCommittee];

// Público / acompanhamento (ADR-16)
router.get("/api/ethics-reports/meta", publicRoute, (req, res) =>
  ethics.listCategories(req, res),
);
router.post("/api/ethics-reports", publicRoute, (req, res) =>
  ethics.create(req, res),
);
router.post("/api/ethics-reports/track", publicRoute, (req, res) =>
  ethics.track(req, res),
);
router.post("/api/ethics-reports/messages", publicRoute, (req, res) =>
  ethics.addReporterMessage(req, res),
);

// Comitê (MASTER ou permissão admin da conta)
router.get("/api/ethics-reports", ...committee, (req, res) =>
  ethics.list(req, res),
);
router.get("/api/ethics-reports/:id", ...committee, (req, res) =>
  ethics.get(req, res),
);
router.patch("/api/ethics-reports/:id", ...committee, (req, res) =>
  ethics.updateStatus(req, res),
);
router.post("/api/ethics-reports/:id/messages", ...committee, (req, res) =>
  ethics.addCommitteeMessage(req, res),
);

export default router;

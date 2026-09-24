import { Router } from "express";
import workplace from "../../controller/WorkplaceController";
import { read, write } from "./middleware";

const router = Router();

router.get("/api/establishments", read, (req, res) =>
  workplace.listEstablishments(req, res),
);
router.post("/api/establishments", write, (req, res) =>
  workplace.createEstablishment(req, res),
);
router.patch("/api/establishments/:id", write, (req, res) =>
  workplace.updateEstablishment(req, res),
);
router.delete("/api/establishments/:id", write, (req, res) =>
  workplace.archiveEstablishment(req, res),
);

router.get("/api/sectors", read, (req, res) => workplace.listSectors(req, res));
router.post("/api/sectors", write, (req, res) =>
  workplace.createSector(req, res),
);
router.patch("/api/sectors/:id", write, (req, res) =>
  workplace.updateSector(req, res),
);
router.delete("/api/sectors/:id", write, (req, res) =>
  workplace.archiveSector(req, res),
);

router.get("/api/job-roles", read, (req, res) =>
  workplace.listJobRoles(req, res),
);
router.post("/api/job-roles", write, (req, res) =>
  workplace.createJobRole(req, res),
);
router.patch("/api/job-roles/:id", write, (req, res) =>
  workplace.updateJobRole(req, res),
);
router.delete("/api/job-roles/:id", write, (req, res) =>
  workplace.archiveJobRole(req, res),
);

router.get("/api/activities", read, (req, res) =>
  workplace.listActivities(req, res),
);
router.post("/api/activities", write, (req, res) =>
  workplace.createActivity(req, res),
);
router.patch("/api/activities/:id", write, (req, res) =>
  workplace.updateActivity(req, res),
);
router.delete("/api/activities/:id", write, (req, res) =>
  workplace.archiveActivity(req, res),
);

export default router;

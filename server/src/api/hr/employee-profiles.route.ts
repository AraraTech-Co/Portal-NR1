import { Router } from "express";
import profiles from "../../controller/EmployeeProfileController";
import { read, writeRh } from "./middleware";

const router = Router();

router.get("/api/employee-profiles/me", read, (req, res) =>
  profiles.getMine(req, res),
);
router.get("/api/employee-profiles", read, (req, res) =>
  profiles.list(req, res),
);
router.post("/api/employee-profiles", writeRh, (req, res) =>
  profiles.create(req, res),
);
router.get("/api/employee-profiles/:id", read, (req, res) =>
  profiles.get(req, res),
);
router.patch("/api/employee-profiles/:id", read, (req, res) =>
  profiles.update(req, res),
);
router.delete("/api/employee-profiles/:id", writeRh, (req, res) =>
  profiles.dismiss(req, res),
);

export default router;

import { Router } from "express";
import profiles from "../../controller/EmployeeProfileController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("colaboradores");
const writeRh = moduleWrite("colaboradores");

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
/** A ficha inteira da pessoa: a própria sempre; a dos outros, quem cuida. [S6-C] */
router.get("/api/employee-profiles/:id/ficha", read, (req, res) =>
  profiles.file(req, res),
);
router.patch("/api/employee-profiles/:id", read, (req, res) =>
  profiles.update(req, res),
);
router.delete("/api/employee-profiles/:id", writeRh, (req, res) =>
  profiles.dismiss(req, res),
);
/** Desligamento com data e motivo — e o acesso cai junto. [S5-H] */
router.post("/api/employee-profiles/:id/desligamento", writeRh, (req, res) =>
  profiles.dismiss(req, res),
);
router.post("/api/employee-profiles/:id/reverter-desligamento", writeRh, (req, res) =>
  profiles.reinstate(req, res),
);

export default router;

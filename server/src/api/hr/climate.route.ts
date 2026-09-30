import { Router } from "express";
import climate from "../../controller/ClimateController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("clima");
const writeRh = moduleWrite("clima");

const router = Router();

router.get("/api/climate-surveys", read, (req, res) => climate.list(req, res));
router.post("/api/climate-surveys", writeRh, (req, res) =>
  climate.create(req, res),
);
router.get("/api/climate-surveys/:id", read, (req, res) =>
  climate.get(req, res),
);
router.post("/api/climate-surveys/:id/open", writeRh, (req, res) =>
  climate.open(req, res),
);
router.post("/api/climate-surveys/:id/close", writeRh, (req, res) =>
  climate.close(req, res),
);
router.post("/api/climate-surveys/:id/respond", read, (req, res) =>
  climate.respond(req, res),
);

export default router;

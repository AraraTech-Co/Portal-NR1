import { Router } from "express";
import survey from "../../controller/PreliminarySurveyController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("inventario");
const write = moduleWrite("inventario");

const router = Router();

router.get("/api/preliminary-surveys", read, (req, res) =>
  survey.list(req, res),
);
router.post("/api/preliminary-surveys", write, (req, res) =>
  survey.create(req, res),
);
router.get("/api/preliminary-surveys/:id", read, (req, res) =>
  survey.get(req, res),
);
router.post("/api/preliminary-surveys/:id/items", write, (req, res) =>
  survey.addItem(req, res),
);

export default router;

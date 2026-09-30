import { Router } from "express";
import reviews from "../../controller/ReviewController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("colaboradores");
const writeRh = moduleWrite("colaboradores");

const router = Router();

router.get("/api/review-cycles", read, (req, res) =>
  reviews.listCycles(req, res),
);
router.post("/api/review-cycles", writeRh, (req, res) =>
  reviews.createCycle(req, res),
);
router.post("/api/review-cycles/:id/open", writeRh, (req, res) =>
  reviews.openCycle(req, res),
);
router.post("/api/review-cycles/:id/assignments", writeRh, (req, res) =>
  reviews.assign(req, res),
);
router.get("/api/review-assignments/mine", read, (req, res) =>
  reviews.myAssignments(req, res),
);
router.post("/api/review-assignments/:assignmentId/submit", read, (req, res) =>
  reviews.submit(req, res),
);

export default router;

import { Router } from "express";
import announcements from "../../controller/AnnouncementController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("mural");
const writeRh = moduleWrite("mural");

const router = Router();

router.get("/api/announcements", read, (req, res) =>
  announcements.list(req, res),
);
router.post("/api/announcements", writeRh, (req, res) =>
  announcements.create(req, res),
);
router.get("/api/announcements/:id", read, (req, res) =>
  announcements.get(req, res),
);
/** Quem leu e quem não leu — para quem publica. [S3-H] */
router.get("/api/announcements/:id/leituras", read, (req, res) =>
  announcements.readers(req, res),
);
router.post("/api/announcements/:id/read", read, (req, res) =>
  announcements.markRead(req, res),
);

export default router;

import { Router } from "express";
import game from "../../controller/GamificationController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("gamificacao");
const writeRh = moduleWrite("gamificacao");

const router = Router();

router.get("/api/point-rules", read, (req, res) =>
  game.listPointRules(req, res),
);
router.post("/api/point-rules", writeRh, (req, res) =>
  game.upsertPointRule(req, res),
);
router.post("/api/point-entries", writeRh, (req, res) =>
  game.grantPoints(req, res),
);
router.get("/api/points/balance", read, (req, res) =>
  game.myBalance(req, res),
);
router.get("/api/rewards", read, (req, res) => game.listRewards(req, res));
router.post("/api/rewards", writeRh, (req, res) =>
  game.createReward(req, res),
);
router.post("/api/rewards/:id/redeem", read, (req, res) =>
  game.redeem(req, res),
);
router.post("/api/reward-redemptions/:redemptionId/decide", writeRh, (req, res) =>
  game.decideRedemption(req, res),
);

export default router;

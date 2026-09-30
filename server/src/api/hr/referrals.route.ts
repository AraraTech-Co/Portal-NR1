import { Router } from "express";
import referrals from "../../controller/ReferralController";
import { moduleRead, moduleWrite } from "./middleware";

const read = moduleRead("talentos");
const write = moduleWrite("talentos");

const router = Router();

router.get("/api/referrals", read, (req, res) => referrals.list(req, res));
router.post("/api/referrals", write, (req, res) => referrals.create(req, res));
router.patch("/api/referrals/:id", write, (req, res) =>
  referrals.updateStatus(req, res),
);

export default router;

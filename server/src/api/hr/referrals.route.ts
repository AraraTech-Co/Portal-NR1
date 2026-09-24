import { Router } from "express";
import referrals from "../../controller/ReferralController";
import { read, writeRh } from "./middleware";

const router = Router();

router.get("/api/referrals", read, (req, res) => referrals.list(req, res));
router.post("/api/referrals", read, (req, res) => referrals.create(req, res));
router.patch("/api/referrals/:id", writeRh, (req, res) =>
  referrals.updateStatus(req, res),
);

export default router;

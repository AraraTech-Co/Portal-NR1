import { Router } from "express";
import invites from "./invites.route";

const router = Router();
router.use(invites);

export default router;

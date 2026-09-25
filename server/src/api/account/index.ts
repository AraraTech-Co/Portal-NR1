import { Router } from "express";
import invites from "./invites.route";
import orgMembers from "./org-members.route";

const router = Router();
router.use(invites);
router.use(orgMembers);

export default router;

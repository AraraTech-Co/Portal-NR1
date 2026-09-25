import { Router } from "express";
import { verify } from "../../model/lib/Auth";
import orgMembers from "../../controller/OrgMembersController";

const router = Router();

router.get("/api/org-members", verify("user"), (req, res) =>
  orgMembers.list(req, res),
);

export default router;

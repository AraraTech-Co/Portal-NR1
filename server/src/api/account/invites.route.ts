import { Router } from "express";
import { verify } from "../../model/lib/Auth";
import invites from "../../controller/AccountInviteController";

const router = Router();

const manage = verify("user");
const publicRoute = verify("public");

router.get("/api/invite-links", manage, (req, res) =>
  invites.listLinks(req, res),
);
router.post("/api/invite-links", manage, (req, res) =>
  invites.createLink(req, res),
);
router.patch("/api/invite-links/:id", manage, (req, res) =>
  invites.deactivateLink(req, res),
);

router.get("/api/join-requests", manage, (req, res) =>
  invites.listJoinRequests(req, res),
);
router.post("/api/join-requests/:id/decide", manage, (req, res) =>
  invites.decideJoinRequest(req, res),
);

router.get("/api/invites/:token", publicRoute, (req, res) =>
  invites.getPublic(req, res),
);
router.post("/api/invites/:token", publicRoute, (req, res) =>
  invites.acceptPublic(req, res),
);

export default router;

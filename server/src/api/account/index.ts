import { Router } from "express";
import invites from "./invites.route";
import orgMembers from "./org-members.route";
import consultaAcessos from "./consulta-acessos.route";

const router = Router();
router.use(invites);
router.use(orgMembers);
router.use(consultaAcessos);

export default router;

import { Router } from "express";
import invites from "./invites.route";
import orgMembers from "./org-members.route";
import consultaAcessos from "./consulta-acessos.route";
import pessoas from "./pessoas.route";
import notificacoes from "./notificacoes.route";
import inicio from "./inicio.route";
import organizacao from "./organizacao.route";
import historico from "./historico.route";
import feriados from "./feriados.route";

const router = Router();
router.use(invites);
router.use(orgMembers);
router.use(consultaAcessos);
router.use(pessoas);
router.use(notificacoes);
router.use(inicio);
router.use(organizacao);
router.use(historico);
router.use(feriados);

export default router;

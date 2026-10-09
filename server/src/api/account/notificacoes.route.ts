import { Router } from "express";
import { verify } from "../../model/lib/Auth";
import notifications from "../../controller/NotificationController";

/** Qualquer pessoa logada tem a sua caixa de avisos. */
const logado = verify("user");

const router = Router();

router.get("/api/notificacoes", logado, (req, res) => notifications.list(req, res));
router.post("/api/notificacoes/ler-todas", logado, (req, res) =>
  notifications.markAllRead(req, res),
);
router.post("/api/notificacoes/:id/lida", logado, (req, res) =>
  notifications.markRead(req, res),
);

export default router;

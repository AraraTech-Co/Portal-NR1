import { Router } from "express";
import authController from "../controller/AuthController";
import { verify } from "../model/lib/Auth";
import firstAccess from "../controller/FirstAccessController";

const router = Router();

router.post("/api/auth", (req, res) => authController.signin(req, res));
/** As filiais da tela de login: pública e sem parâmetro. [C3-2b] */
router.get("/api/auth/filiais", (req, res) =>
  authController.filiais(req, res).catch(() => {
    res.status(500).json({ message: "Erro interno." });
  }),
);
router.get("/api/auth", verify("user"), (req, res) =>
  authController.get(req, res),
);
router.post("/api/auth/password", verify("user"), (req, res) =>
  authController.changePassword(req, res),
);
router.post("/api/auth/switch", verify("user"), (req, res) =>
  authController.switchAccount(req, res),
);
router.delete("/api/auth", verify("user"), (req, res) =>
  authController.signout(req, res),
);

/**
 * Primeiro acesso por conferência de dados: sem sessão, como o login. [C1-7]
 */
router.post("/api/auth/primeiro-acesso", (req, res) =>
  firstAccess.verify(req, res).catch(() => {
    res.status(500).json({ message: "Erro interno." });
  }),
);
router.post("/api/auth/primeiro-acesso/senha", (req, res) =>
  firstAccess.setPassword(req, res).catch(() => {
    res.status(500).json({ message: "Erro interno." });
  }),
);

/** Rota só MASTER — usada para validar a hierarquia master > owner. */
router.get("/api/auth/as-master", verify("master"), (req, res) => {
  res.json({ ok: true });
});

export default router;

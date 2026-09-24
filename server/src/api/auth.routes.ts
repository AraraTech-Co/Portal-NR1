import { Router } from "express";
import authController from "../controller/AuthController";
import { verify } from "../model/lib/Auth";

const router = Router();

router.post("/api/auth", (req, res) => authController.signin(req, res));
router.get("/api/auth", verify("user"), (req, res) =>
  authController.get(req, res),
);
router.post("/api/auth/switch", verify("user"), (req, res) =>
  authController.switchAccount(req, res),
);
router.delete("/api/auth", verify("user"), (req, res) =>
  authController.signout(req, res),
);

/** Rota só MASTER — usada para validar a hierarquia master > owner. */
router.get("/api/auth/as-master", verify("master"), (req, res) => {
  res.json({ ok: true });
});

export default router;

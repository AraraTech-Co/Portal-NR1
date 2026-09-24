import { Router, Request, Response } from "express";

const router = Router();

router.get("/health", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    service: "portal-nr1",
    timestamp: new Date().toISOString(),
  });
});

export default router;

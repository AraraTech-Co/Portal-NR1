import { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import { MAX_EVIDENCE_BYTES } from "../constants";

/**
 * Rotas que recebem arquivo em base64 dentro do JSON.
 *
 * O arquivo pode ter até MAX_EVIDENCE_BYTES, mas em base64 ele cresce ~33%. Com
 * o limite geral de 2 MB, qualquer arquivo acima de ~1,5 MB era recusado antes
 * de chegar ao controller — e foto de celular passa disso. [S3-K]
 *
 * O limite maior vale só aqui; o resto da API continua com 2 MB.
 */
const UPLOAD_ROUTES = [
  "/api/evidences",
  "/api/actions",
  "/api/occurrences",
  "/api/aeps",
  "/api/participations",
  "/api/emergency-procedures",
  "/api/medical-certificates",
  "/api/worker-certificates",
  "/api/occupational-exams",
  "/api/hr-documents",
  "/api/payslips",
];

/** O maior arquivo aceito, em base64, mais folga para os outros campos do JSON. */
export const UPLOAD_JSON_LIMIT = Math.ceil((MAX_EVIDENCE_BYTES * 4) / 3) + 1024 * 1024;

export function bootHelmet(app: Express): void {
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
          "img-src": ["'self'", "data:", "blob:"],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'none'"],
        },
      },
    }),
  );
}

export function bootCors(app: Express): void {
  const origin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
  // Em produção o SPA e a API saem da mesma origem — CORS só cobre o caso
  // de CLIENT_ORIGIN apontar para outro host (dev / preview).
  app.use(
    cors({
      origin,
      credentials: true,
    }),
  );
}

export function bootConfig(app: Express): void {
  // Antes do parser geral: quem lê o corpo primeiro vence (o segundo pula).
  app.use(UPLOAD_ROUTES, express.json({ limit: UPLOAD_JSON_LIMIT }));
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
}

/**
 * Corpo grande demais vira resposta legível, em JSON — não a página HTML
 * padrão do Express, que a tela não sabe mostrar. [S3-K]
 */
export function bootBodyErrors(app: Express): void {
  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    const e = err as { type?: string; status?: number };
    if (e?.type === "entity.too.large" || e?.status === 413) {
      res.status(413).json({
        message: `Arquivo grande demais. O limite é ${Math.round(
          MAX_EVIDENCE_BYTES / (1024 * 1024),
        )} MB.`,
      });
      return;
    }
    next(err);
  });
}

import { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import express from "express";

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
  app.use(express.json({ limit: "2mb" }));
  app.use(express.urlencoded({ extended: true }));
}

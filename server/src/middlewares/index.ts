import { Express } from "express";
import cors from "cors";
import helmet from "helmet";
import express from "express";

export function bootHelmet(app: Express): void {
  app.use(helmet());
}

export function bootCors(app: Express): void {
  const origin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
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

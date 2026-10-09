import path from "path";
import fs from "fs";
import express, { Express } from "express";
import api from "./api";
import { bootBodyErrors, bootConfig, bootCors, bootHelmet } from "./middlewares";

function resolveClientDist(): string | null {
  const candidates = [
    process.env.CLIENT_DIST,
    path.resolve(process.cwd(), "client/dist"),
    path.resolve(process.cwd(), "../client/dist"),
    path.resolve(__dirname, "../../client/dist"),
  ].filter(Boolean) as string[];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

export function createApp(): Express {
  const app = express();
  [bootHelmet, bootCors, bootConfig].forEach((boot) => boot(app));
  app.use(api);
  bootBodyErrors(app);

  const clientDist = resolveClientDist();
  if (clientDist) {
    app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      res.sendFile(path.join(clientDist, "index.html"), (err) => {
        if (err) next(err);
      });
    });
  }

  return app;
}

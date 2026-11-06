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

/**
 * Quais proxies podem dizer o IP real de quem acessa (`X-Forwarded-For`).
 *
 * Sem `TRUST_PROXY`, nenhum: o IP é o da conexão, e o limite de tentativas
 * por IP fica desligado. Com ele — número de saltos ("1") ou lista de
 * endereços e faixas ("10.0.0.1, 172.16.0.0/12", "loopback") —, só esses
 * proxies são ouvidos. "true" (confiar em qualquer um) é recusado: deixaria
 * quem acessa escolher o próprio IP. [C1-7]
 */
export function trustProxySetting(raw: string | undefined): number | string | false {
  const v = raw?.trim();
  if (!v) return false;
  if (v.toLowerCase() === "true") {
    throw new Error("TRUST_PROXY=true confiaria em qualquer proxy: informe os saltos ou os endereços.");
  }
  return /^\d+$/.test(v) ? Number(v) : v;
}

export function createApp(): Express {
  const app = express();
  const proxy = trustProxySetting(process.env.TRUST_PROXY);
  if (proxy !== false) app.set("trust proxy", proxy);
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

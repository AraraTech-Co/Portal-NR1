import express, { Express } from "express";
import api from "./api";
import { bootConfig, bootCors, bootHelmet } from "./middlewares";

export function createApp(): Express {
  const app = express();
  [bootHelmet, bootCors, bootConfig].forEach((boot) => boot(app));
  app.use(api);
  return app;
}

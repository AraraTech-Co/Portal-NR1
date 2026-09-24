import "dotenv/config";
import express, { Express } from "express";
import api from "./api";
import { bootConfig, bootCors, bootHelmet } from "./middlewares";

const port = Number(process.env.PORT) || 8080;
const app: Express = express();

[bootHelmet, bootCors, bootConfig].forEach((boot) => boot(app));

app.use(api);

app.listen(port, () => {
  console.log(`portal-nr1 server listening on http://localhost:${port}`);
});

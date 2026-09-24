import { Router } from "express";
import health from "./health";

const api = Router();

api.use("/api", health);

export default api;

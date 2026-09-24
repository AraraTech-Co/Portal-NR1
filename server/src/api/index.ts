import { Router } from "express";
import health from "./health";
import authRoutes from "./auth.routes";

const api = Router();

api.use("/api", health);
api.use(authRoutes);

export default api;

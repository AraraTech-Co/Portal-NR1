import { Router } from "express";
import health from "./health";
import authRoutes from "./auth.routes";
import groRoutes from "./gro.routes";

const api = Router();

api.use("/api", health);
api.use(authRoutes);
api.use(groRoutes);

export default api;

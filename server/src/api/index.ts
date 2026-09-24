import { Router } from "express";
import health from "./health";
import authRoutes from "./auth.routes";
import groRoutes from "./gro";
import ethicsRoutes from "./ethics";
import hrRoutes from "./hr";

const api = Router();

api.use("/api", health);
api.use(authRoutes);
api.use(groRoutes);
api.use(ethicsRoutes);
api.use(hrRoutes);

export default api;

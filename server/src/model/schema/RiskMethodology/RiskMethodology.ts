import prisma from "../../prisma";
import Model from "../Model";
import { IRiskMethodology } from "./IRiskMethodology";

export class RiskMethodology extends Model<IRiskMethodology> {
  constructor() {
    super(prisma.riskMethodology as never);
  }
}

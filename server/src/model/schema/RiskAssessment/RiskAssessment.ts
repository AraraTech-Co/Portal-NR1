import prisma from "../../prisma";
import Model from "../Model";
import { IRiskAssessment } from "./IRiskAssessment";

export class RiskAssessment extends Model<IRiskAssessment> {
  constructor() {
    super(prisma.riskAssessment as never);
  }
}

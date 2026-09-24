import prisma from "../../prisma";
import Model from "../Model";
import { IRiskMethodologyVersion } from "./IRiskMethodologyVersion";

export class RiskMethodologyVersion extends Model<IRiskMethodologyVersion> {
  constructor() {
    super(prisma.riskMethodologyVersion as never);
  }
}

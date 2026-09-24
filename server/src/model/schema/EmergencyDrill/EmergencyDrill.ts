import prisma from "../../prisma";
import Model from "../Model";
import { IEmergencyDrill } from "./IEmergencyDrill";

export class EmergencyDrill extends Model<IEmergencyDrill> {
  constructor() {
    super(prisma.emergencyDrill as never);
  }
}

import prisma from "../../prisma";
import Model from "../Model";
import { IEmergencyProcedure } from "./IEmergencyProcedure";

export class EmergencyProcedure extends Model<IEmergencyProcedure> {
  constructor() {
    super(prisma.emergencyProcedure as never);
  }
}

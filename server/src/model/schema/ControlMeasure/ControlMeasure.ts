import prisma from "../../prisma";
import Model from "../Model";
import { IControlMeasure } from "./IControlMeasure";

export class ControlMeasure extends Model<IControlMeasure> {
  constructor() {
    super(prisma.controlMeasure as never);
  }
}

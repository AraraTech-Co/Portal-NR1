import prisma from "../../prisma";
import Model from "../Model";
import { IHazard } from "./IHazard";

export class Hazard extends Model<IHazard> {
  constructor() {
    super(prisma.hazard as never);
  }
}

import prisma from "../../prisma";
import Model from "../Model";
import { ISector } from "./ISector";

export class Sector extends Model<ISector> {
  constructor() {
    super(prisma.sector as never);
  }
}

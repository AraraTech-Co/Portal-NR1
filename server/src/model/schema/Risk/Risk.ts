import prisma from "../../prisma";
import Model from "../Model";
import { IRisk } from "./IRisk";

export class Risk extends Model<IRisk> {
  constructor() {
    super(prisma.risk as never);
  }
}

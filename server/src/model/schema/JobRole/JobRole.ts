import prisma from "../../prisma";
import Model from "../Model";
import { IJobRole } from "./IJobRole";

export class JobRole extends Model<IJobRole> {
  constructor() {
    super(prisma.jobRole as never);
  }
}

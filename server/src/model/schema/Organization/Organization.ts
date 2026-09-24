import prisma from "../../prisma";
import Model from "../Model";
import { IOrganization } from "./IOrganization";

export class Organization extends Model<IOrganization> {
  constructor() {
    super(prisma.organization as never);
  }
}

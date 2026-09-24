import prisma from "../../prisma";
import Model from "../Model";
import { IEmployeeProfile } from "./IEmployeeProfile";

export class EmployeeProfile extends Model<IEmployeeProfile> {
  constructor() {
    super(prisma.employeeProfile as never);
  }
}

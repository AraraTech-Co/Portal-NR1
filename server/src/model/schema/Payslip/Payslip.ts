import prisma from "../../prisma";
import Model from "../Model";
import { IPayslip } from "./IPayslip";

export class Payslip extends Model<IPayslip> {
  constructor() {
    super(prisma.payslip as never);
  }
}

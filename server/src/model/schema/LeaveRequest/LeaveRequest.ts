import prisma from "../../prisma";
import Model from "../Model";
import { ILeaveRequest } from "./ILeaveRequest";

export class LeaveRequest extends Model<ILeaveRequest> {
  constructor() {
    super(prisma.leaveRequest as never);
  }
}

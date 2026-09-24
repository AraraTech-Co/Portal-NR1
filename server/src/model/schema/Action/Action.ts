import prisma from "../../prisma";
import Model from "../Model";
import { IAction } from "./IAction";

export class Action extends Model<IAction> {
  constructor() {
    super(prisma.action as never);
  }
}

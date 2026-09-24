import prisma from "../../prisma";
import Model from "../Model";
import { IActivity } from "./IActivity";

export class Activity extends Model<IActivity> {
  constructor() {
    super(prisma.activity as never);
  }
}

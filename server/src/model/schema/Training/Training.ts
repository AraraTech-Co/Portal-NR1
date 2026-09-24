import prisma from "../../prisma";
import Model from "../Model";
import { ITraining } from "./ITraining";

export class Training extends Model<ITraining> {
  constructor() {
    super(prisma.training as never);
  }
}

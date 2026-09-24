import prisma from "../../prisma";
import Model from "../Model";
import { IOccurrence } from "./IOccurrence";

export class Occurrence extends Model<IOccurrence> {
  constructor() {
    super(prisma.occurrence as never);
  }
}

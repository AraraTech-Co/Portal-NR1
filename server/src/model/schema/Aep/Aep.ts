import prisma from "../../prisma";
import Model from "../Model";
import { IAep } from "./IAep";

export class Aep extends Model<IAep> {
  constructor() {
    super(prisma.aep as never);
  }
}

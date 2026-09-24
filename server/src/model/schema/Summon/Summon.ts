import prisma from "../../prisma";
import Model from "../Model";
import { ISummon } from "./ISummon";

export class Summon extends Model<ISummon> {
  constructor() {
    super(prisma.summon as never);
  }
}

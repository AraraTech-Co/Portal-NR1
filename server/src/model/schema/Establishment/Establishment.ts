import prisma from "../../prisma";
import Model from "../Model";
import { IEstablishment } from "./IEstablishment";

export class Establishment extends Model<IEstablishment> {
  constructor() {
    super(prisma.establishment as never);
  }
}

import prisma from "../../prisma";
import Model from "../Model";
import { IContractor } from "./IContractor";

export class Contractor extends Model<IContractor> {
  constructor() {
    super(prisma.contractor as never);
  }
}

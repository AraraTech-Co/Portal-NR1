import prisma from "../../prisma";
import Model from "../Model";
import { IHrDocument } from "./IHrDocument";

export class HrDocument extends Model<IHrDocument> {
  constructor() {
    super(prisma.hrDocument as never);
  }
}

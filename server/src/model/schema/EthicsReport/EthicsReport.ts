import prisma from "../../prisma";
import Model from "../Model";
import { IEthicsReport } from "./IEthicsReport";

export class EthicsReport extends Model<IEthicsReport> {
  constructor() {
    super(prisma.ethicsReport as never);
  }
}

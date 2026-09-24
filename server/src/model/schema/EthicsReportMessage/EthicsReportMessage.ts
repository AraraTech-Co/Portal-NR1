import prisma from "../../prisma";
import Model from "../Model";
import { IEthicsReportMessage } from "./IEthicsReportMessage";

export class EthicsReportMessage extends Model<IEthicsReportMessage> {
  constructor() {
    super(prisma.ethicsReportMessage as never);
  }
}

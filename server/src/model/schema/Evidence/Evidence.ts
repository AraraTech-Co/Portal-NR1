import prisma from "../../prisma";
import Model from "../Model";
import { IEvidence } from "./IEvidence";

export class Evidence extends Model<IEvidence> {
  constructor() {
    super(prisma.evidence as never);
  }
}

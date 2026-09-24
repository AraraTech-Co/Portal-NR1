import prisma from "../../prisma";
import Model from "../Model";
import { IParticipationRecord } from "./IParticipationRecord";

export class ParticipationRecord extends Model<IParticipationRecord> {
  constructor() {
    super(prisma.participationRecord as never);
  }
}

import prisma from "../../prisma";
import Model from "../Model";
import { IPreliminarySurvey } from "./IPreliminarySurvey";

export class PreliminarySurvey extends Model<IPreliminarySurvey> {
  constructor() {
    super(prisma.preliminarySurvey as never);
  }
}

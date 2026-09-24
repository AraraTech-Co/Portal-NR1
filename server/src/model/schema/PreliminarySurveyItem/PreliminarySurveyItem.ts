import prisma from "../../prisma";
import Model from "../Model";
import { IPreliminarySurveyItem } from "./IPreliminarySurveyItem";

export class PreliminarySurveyItem extends Model<IPreliminarySurveyItem> {
  constructor() {
    super(prisma.preliminarySurveyItem as never);
  }
}

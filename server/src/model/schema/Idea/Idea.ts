import prisma from "../../prisma";
import Model from "../Model";
import { IIdea } from "./IIdea";

export class Idea extends Model<IIdea> {
  constructor() {
    super(prisma.idea as never);
  }
}

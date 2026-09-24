import prisma from "../../prisma";
import Model from "../Model";
import { IAnnouncement } from "./IAnnouncement";

export class Announcement extends Model<IAnnouncement> {
  constructor() {
    super(prisma.announcement as never);
  }
}

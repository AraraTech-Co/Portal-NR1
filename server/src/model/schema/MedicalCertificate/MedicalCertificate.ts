import prisma from "../../prisma";
import Model from "../Model";
import { IMedicalCertificate } from "./IMedicalCertificate";

export class MedicalCertificate extends Model<IMedicalCertificate> {
  constructor() {
    super(prisma.medicalCertificate as never);
  }
}

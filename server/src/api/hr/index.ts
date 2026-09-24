import { Router } from "express";
import employeeProfiles from "./employee-profiles.route";
import ideas from "./ideas.route";
import announcements from "./announcements.route";
import hrDocuments from "./hr-documents.route";
import payslips from "./payslips.route";
import medicalCertificates from "./medical-certificates.route";
import leaves from "./leaves.route";

/** RH e engajamento (ADR-14) — separado do GRO. */
const router = Router();
router.use(employeeProfiles);
router.use(ideas);
router.use(announcements);
router.use(hrDocuments);
router.use(payslips);
router.use(medicalCertificates);
router.use(leaves);

export default router;

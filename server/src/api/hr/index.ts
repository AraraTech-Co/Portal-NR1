import { Router } from "express";
import employeeProfiles from "./employee-profiles.route";
import ideas from "./ideas.route";
import announcements from "./announcements.route";
import hrDocuments from "./hr-documents.route";
import payslips from "./payslips.route";
import medicalCertificates from "./medical-certificates.route";
import leaves from "./leaves.route";
import summons from "./summons.route";
import trainings from "./trainings.route";
import compliance from "./compliance.route";
import climate from "./climate.route";
import reviews from "./reviews.route";
import timeEntries from "./time-entries.route";
import gamification from "./gamification.route";
import referrals from "./referrals.route";
import onboarding from "./onboarding.route";

/** RH e engajamento (ADR-14) — separado do GRO. */
const router = Router();
router.use(employeeProfiles);
router.use(ideas);
router.use(announcements);
router.use(hrDocuments);
router.use(payslips);
router.use(medicalCertificates);
router.use(leaves);
router.use(summons);
router.use(trainings);
router.use(compliance);
router.use(climate);
router.use(reviews);
router.use(timeEntries);
router.use(gamification);
router.use(referrals);
router.use(onboarding);

export default router;

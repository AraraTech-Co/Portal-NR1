import { Router } from "express";
import workplaces from "./workplaces.route";
import risks from "./risks.route";
import actions from "./actions.route";
import documents from "./documents.route";
import aeps from "./aeps.route";
import preliminarySurveys from "./preliminary-surveys.route";
import occurrences from "./occurrences.route";
import emergencyProcedures from "./emergency-procedures.route";
import contractors from "./contractors.route";
import participations from "./participations.route";

/**
 * Agrega as rotas do domínio GRO / NR-1.
 * Cada recurso vive em `*.route.ts` — URLs públicas não mudam.
 */
const router = Router();

router.use(workplaces);
router.use(risks);
router.use(actions);
router.use(documents);
router.use(aeps);
router.use(preliminarySurveys);
router.use(occurrences);
router.use(emergencyProcedures);
router.use(contractors);
router.use(participations);

export default router;

import { Router } from "express";
import { verify, verifyModule } from "../../model/lib/Auth";
import ethics from "../../controller/EthicsController";
import { requireEthicsCommittee } from "../../helper/ethics-access";

const router = Router();

const publicRoute = verify("public");
const committee = [
  verifyModule("comite", "read"),
  requireEthicsCommittee,
];
const committeeWrite = [
  verifyModule("comite", "write"),
  requireEthicsCommittee,
];

// Público / acompanhamento — denúncia anônima permanece aberta (todos podem
// registrar; tratamento fica no módulo comite).
router.get("/api/ethics-reports/meta", publicRoute, (req, res) =>
  ethics.listCategories(req, res),
);
router.post("/api/ethics-reports", publicRoute, (req, res) =>
  ethics.create(req, res),
);
router.post("/api/ethics-reports/track", publicRoute, (req, res) =>
  ethics.track(req, res),
);
router.post("/api/ethics-reports/messages", publicRoute, (req, res) =>
  ethics.addReporterMessage(req, res),
);
/** Ciência do encerramento, pelo protocolo e código. [C1-5] */
router.post("/api/ethics-reports/acknowledge", publicRoute, (req, res) =>
  ethics.acknowledge(req, res),
);

/*
  Quem é o comitê é decisão de acesso: fica com quem cuida de Conta e
  usuários, como as outras. [CB-27]
*/
const cuidaDaConta = verifyModule("conta", "write");
router.get("/api/ethics-committee", cuidaDaConta, (req, res) =>
  ethics.listCommittee(req, res),
);
router.post("/api/ethics-committee", cuidaDaConta, (req, res) =>
  ethics.setCommittee(req, res),
);

// Comitê (matriz módulo comite)
router.get("/api/ethics-reports", ...committee, (req, res) =>
  ethics.list(req, res),
);
/*
  Antes de "/:id": sem isso, "pessoas" entraria como id de relato. [CB-27]
*/
router.get("/api/ethics-reports/pessoas", ...committee, (req, res) =>
  ethics.listPeople(req, res),
);
/** Os dados do PDF da lista, com o mesmo filtro da tela. [C1-6] */
router.get("/api/ethics-reports/export", ...committee, (req, res) =>
  ethics.exportList(req, res),
);
router.get("/api/ethics-reports/:id", ...committee, (req, res) =>
  ethics.get(req, res),
);
/** Os dados do PDF de uma denúncia. [C1-6] */
router.get("/api/ethics-reports/:id/export", ...committee, (req, res) =>
  ethics.exportOne(req, res),
);
router.patch("/api/ethics-reports/:id", ...committeeWrite, (req, res) =>
  ethics.updateStatus(req, res),
);
router.post("/api/ethics-reports/:id/messages", ...committeeWrite, (req, res) =>
  ethics.addCommitteeMessage(req, res),
);
/** Marcar quem a denúncia envolve — e tirar essa pessoa do caso. [CB-27] */
router.post("/api/ethics-reports/:id/citados", ...committeeWrite, (req, res) =>
  ethics.setCited(req, res),
);
/** Ajustar a gravidade, com justificativa. [C1-1] */
router.post("/api/ethics-reports/:id/gravidade", ...committeeWrite, (req, res) =>
  ethics.setSeverity(req, res),
);
/** Devolver ao comitê o caso que dizia envolver alguém dele. [B3-3-H] */
router.post("/api/ethics-reports/:id/triagem", ...committeeWrite, (req, res) =>
  ethics.triar(req, res),
);

export default router;

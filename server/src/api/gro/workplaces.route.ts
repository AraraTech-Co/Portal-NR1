import { Router } from "express";
import workplace from "../../controller/WorkplaceController";
import estrutura from "../../controller/PayrollStructureController";
import type { NextFunction, Request, Response } from "express";
import { moduleRead, moduleWrite } from "./middleware";
import { cuidaDaFilial } from "../../helper/module-access";
import type { AuthRequest } from "../../types/auth";

const read = moduleRead("operacao");
const write = moduleWrite("operacao");

/** Criar e arquivar filial: só Master e Dono. [C6-11] */
function filial(req: Request, res: Response, next: NextFunction) {
  if (cuidaDaFilial((req as AuthRequest).actor?.permission ?? "")) {
    next();
    return;
  }
  res.status(403).json({ message: "Só o Master e o Dono criam e arquivam filial." });
}

const router = Router();

router.get("/api/establishments", read, (req, res) =>
  workplace.listEstablishments(req, res),
);
router.post("/api/establishments", write, filial, (req, res) =>
  workplace.createEstablishment(req, res),
);
router.patch("/api/establishments/:id", write, (req, res) =>
  workplace.updateEstablishment(req, res),
);
/* Conferir antes de pedir confirmação. [B3-1-C] */
router.get("/api/establishments/:id/pode-arquivar", write, filial, workplace.canArchive("establishment"));
router.delete("/api/establishments/:id", write, filial, (req, res) =>
  workplace.archiveEstablishment(req, res),
);

router.get("/api/sectors", read, (req, res) => workplace.listSectors(req, res));
router.post("/api/sectors", write, (req, res) =>
  workplace.createSector(req, res),
);
router.patch("/api/sectors/:id", write, (req, res) =>
  workplace.updateSector(req, res),
);
router.get("/api/sectors/:id/pode-arquivar", write, workplace.canArchive("sector"));
router.delete("/api/sectors/:id", write, (req, res) =>
  workplace.archiveSector(req, res),
);

router.get("/api/job-roles", read, (req, res) =>
  workplace.listJobRoles(req, res),
);
router.post("/api/job-roles", write, (req, res) =>
  workplace.createJobRole(req, res),
);
/* Remover o apelido: a mesma regra de quem junta, Operação e Conta. [C6-4] */
router.delete("/api/job-roles/:id/apelidos/:aliasId", write, moduleWrite("conta"), (req, res) =>
  estrutura.removerApelido(req, res),
);
router.patch("/api/job-roles/:id", write, (req, res) =>
  workplace.updateJobRole(req, res),
);
/* Trocar a função de lugar na lista do setor. [S1-I] */
router.patch("/api/job-roles/:id/ordem", write, (req, res) =>
  workplace.moveJobRole(req, res),
);
router.get("/api/job-roles/:id/pode-arquivar", write, workplace.canArchive("job_role"));
router.delete("/api/job-roles/:id", write, (req, res) =>
  workplace.archiveJobRole(req, res),
);

router.get("/api/activities", read, (req, res) =>
  workplace.listActivities(req, res),
);
router.post("/api/activities", write, (req, res) =>
  workplace.createActivity(req, res),
);
router.patch("/api/activities/:id", write, (req, res) =>
  workplace.updateActivity(req, res),
);
router.get("/api/activities/:id/pode-arquivar", write, workplace.canArchive("activity"));
router.delete("/api/activities/:id", write, (req, res) =>
  workplace.archiveActivity(req, res),
);

export default router;

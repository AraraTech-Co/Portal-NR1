import { Router } from "express";
import { verifyModule } from "../../model/lib/Auth";
import people from "../../controller/PeopleAccessController";
import peopleImport from "../../controller/PeopleImportController";

/** Conta e usuários: só Master e RH, pela planilha de acessos. */
const conta = verifyModule("conta", "write");

const router = Router();

router.get("/api/pessoas-acessos", conta, (req, res) => people.list(req, res));
router.patch("/api/pessoas-acessos/:userId/papel", conta, (req, res) =>
  people.changeRole(req, res),
);
router.post("/api/pessoas-acessos/:userId/redefinir-senha", conta, (req, res) =>
  people.resetPassword(req, res),
);
/** Suspender e devolver o acesso sem inventar um desligamento. [CB-44] */
router.post("/api/pessoas-acessos/:userId/acesso", conta, (req, res) =>
  people.setAccess(req, res),
);
/** Cadastro em massa a partir de planilha colada. [S1-A] */
router.post("/api/pessoas-acessos/importar", conta, (req, res) =>
  peopleImport.importPeople(req, res),
);

export default router;

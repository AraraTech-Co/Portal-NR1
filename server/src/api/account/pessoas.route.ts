import { Router } from "express";
import { verifyModule } from "../../model/lib/Auth";
import people from "../../controller/PeopleAccessController";
import peopleImport from "../../controller/PeopleImportController";
import estrutura from "../../controller/PayrollStructureController";
import activation from "../../controller/AccountActivationController";
import managedUnits from "../../controller/ManagedUnitsController";

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
/**
 * Unidades sob responsabilidade de gerente, supervisor e ADM loja: Master,
 * Dono e RH definem; ninguém define as próprias. [C2-13]
 */
router.get("/api/pessoas-acessos/:userId/unidades", conta, (req, res) =>
  managedUnits.get(req, res),
);
router.put("/api/pessoas-acessos/:userId/unidades", conta, (req, res) =>
  managedUnits.set(req, res),
);
/** Cadastro em massa a partir de planilha colada. [S1-A] */
router.post("/api/pessoas-acessos/importar", conta, (req, res) =>
  peopleImport.importPeople(req, res),
);
/*
  Criar as funções que faltam a partir da prévia: mexe na Operação e no
  cadastro, então pede as duas — pela matriz, Master e Dono. [C6-3]
*/
router.post(
  "/api/pessoas-acessos/importar/estrutura",
  verifyModule("operacao", "write"),
  conta,
  (req, res) => estrutura.criar(req, res),
);

/*
  Painel de ativação: Master, Dono e RH veem e agem; o gerente só vê, a
  empresa toda. [C1-7]
*/
const ativacaoLer = verifyModule("ativacao", "read");
const ativacaoAgir = verifyModule("ativacao", "write");
router.get("/api/pessoas-acessos/ativacao", ativacaoLer, (req, res) =>
  activation.list(req, res),
);
router.post("/api/pessoas-acessos/:userId/reabrir-primeiro-acesso", ativacaoAgir, (req, res) =>
  activation.reopen(req, res),
);
router.post("/api/pessoas-acessos/:userId/classificar", ativacaoAgir, (req, res) =>
  activation.classify(req, res),
);

export default router;

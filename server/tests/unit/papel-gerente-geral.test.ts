import { describe, expect, it } from "vitest";
import { AccountRole, Role } from "@prisma/client";
import { effectivePermission, orgRoleToAccountRole } from "../../src/helper/auth";
import { assignableOrgRoles } from "../../src/helper/invite-access";
import {
  canChangePersonnelRecord,
  canManagePayrollData,
  canSeeAllInModule,
  modulesForRole,
} from "../../src/helper/module-access";
import { isCentral, isUnitScoped } from "../../src/helper/unit-scope";
import { lerLinhas } from "../../../client/src/lib/planilha";
import { ORG_ROLE_LABEL, PERMISSION_LABEL } from "../../../client/src/lib/labels";

/**
 * O papel "Gerente geral": acima do Gerente e abaixo do RH. Cadastra pessoas,
 * age na Ativação, cria funções e vê a empresa toda; grava e vê os dados da
 * folha; não corrige CPF e matrícula nem dá Fiscal. Decisões do Leonardo em
 * 17/11/2026. [GG]
 */
const ator = (role: Role) => ({ role, permission: effectivePermission(role) }) as Parameters<typeof assignableOrgRoles>[0];

describe("as traduções do papel", () => {
  it("permissão gerente_geral e papel ADMIN na conta (os dois switches têm default)", () => {
    expect(effectivePermission(Role.GERENTE_GERAL)).toBe("gerente_geral");
    expect(orgRoleToAccountRole(Role.GERENTE_GERAL)).toBe(AccountRole.ADMIN);
  });

  it("rótulo nos dois mapas da tela", () => {
    expect(ORG_ROLE_LABEL.GERENTE_GERAL).toBe("Gerente geral");
    expect(PERMISSION_LABEL.gerente_geral).toBe("Gerente geral");
  });
});

describe("a matriz: a do Gerente, com Conta e Ativação", () => {
  it("conta e ativacao escrevem; todo o resto igual ao Gerente", () => {
    const gerente = modulesForRole("gerente");
    const geral = modulesForRole("gerente_geral");
    expect(geral.conta).toBe("write");
    expect(geral.ativacao).toBe("write");
    const { conta: _c, ativacao: _a, ...resto } = geral;
    const { conta: _gc, ativacao: _ga, ...restoDoGerente } = gerente;
    expect(resto).toEqual(restoDoGerente);
  });

  it("a empresa toda, sem recorte por unidade, e sem ser a central", () => {
    expect(isUnitScoped("gerente_geral")).toBe(false);
    expect(isCentral("gerente_geral")).toBe(false);
  });

  it("grava e vê os dados da folha; não corrige CPF, matrícula nem desliga", () => {
    expect(canManagePayrollData("gerente_geral")).toBe(true);
    expect(canChangePersonnelRecord("gerente_geral")).toBe(false);
  });

  it("não vê o dado de saúde dos outros: ASO e atestado seguem só o próprio", () => {
    expect(canSeeAllInModule("gerente_geral", "saude")).toBe(false);
    expect(canSeeAllInModule("gerente_geral", "atestados")).toBe(false);
  });
});

describe("a hierarquia", () => {
  it("o Gerente geral dá Gerente e abaixo; nem Gerente geral, nem RH, nem Fiscal", () => {
    expect(assignableOrgRoles(ator(Role.GERENTE_GERAL)).sort()).toEqual(
      [Role.ADM_LOJA, Role.COLABORADOR, Role.GERENTE, Role.SUPERVISOR].sort(),
    );
  });

  it("o RH dá Gerente geral e Fiscal; o Gerente não dá Gerente geral", () => {
    const doRh = assignableOrgRoles(ator(Role.RH));
    expect(doRh).toContain(Role.GERENTE_GERAL);
    expect(doRh).toContain(Role.FISCAL);
    expect(assignableOrgRoles(ator(Role.GERENTE))).not.toContain(Role.GERENTE_GERAL);
  });
});

describe("a planilha", () => {
  it('"Gerente geral" vira GERENTE_GERAL e "Gerente" continua GERENTE', () => {
    const { rows, problems } = lerLinhas(
      "nome\tpapel\nAna\tGerente geral\nBia\tGerente\nCris\tgerente GERAL",
      [],
      [],
      { papeis: ORG_ROLE_LABEL, vinculos: { EMPLOYEE: "Empregado" } },
    );
    expect(problems).toEqual([]);
    expect(rows.map((r) => r.org_role)).toEqual(["GERENTE_GERAL", "GERENTE", "GERENTE_GERAL"]);
  });
});

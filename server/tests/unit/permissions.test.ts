import { describe, expect, it } from "vitest";
import permissions from "../../config/permissions.json";
import matriz from "../../config/module-access.json";
import {
  effectivePermission,
  orgRoleToAccountRole,
  isOrgMaster,
} from "../../src/helper/auth";
import { can } from "../../src/helper/permissions";

describe("permissions.json hierarchy", () => {
  it("owner does not have master", () => {
    expect(permissions.owner.master).toBe(false);
  });

  it("master has owner and master", () => {
    expect(permissions.master.master).toBe(true);
    expect(permissions.master.owner).toBe(true);
  });

  it("only master can(can, master)", () => {
    expect(can("master", "master")).toBe(true);
    expect(can("owner", "master")).toBe(false);
    expect(can("adm_loja", "master")).toBe(false);
    expect(can("colaborador", "master")).toBe(false);
  });

  it("owner can act as owner/admin/user but not master", () => {
    expect(can("owner", "owner")).toBe(true);
    expect(can("owner", "admin")).toBe(true);
    expect(can("owner", "user")).toBe(true);
    expect(can("owner", "master")).toBe(false);
  });

  it("new operational roles can read as user", () => {
    expect(can("supervisor", "user")).toBe(true);
    expect(can("gerente", "user")).toBe(true);
    expect(can("adm_loja", "user")).toBe(true);
    expect(can("colaborador", "user")).toBe(true);
  });
});

describe("effectivePermission: um papel só [OB-3] [S1-C]", () => {
  /*
    Antes a função recebia dois papéis e o da conta vencia o da empresa. Os
    casos abaixo eram "OWNER na conta → owner" e "ADMIN na conta → adm_loja",
    mesmo com RH ou SST na empresa. Agora só entra o papel da empresa.
  */
  it("cada papel da empresa vira a sua coluna da matriz", () => {
    expect(effectivePermission("MASTER")).toBe("master");
    expect(effectivePermission("FISCAL")).toBe("fiscal");
    expect(effectivePermission("RH")).toBe("rh");
    expect(effectivePermission("SST")).toBe("sst");
    expect(effectivePermission("SUPERVISOR")).toBe("supervisor");
    expect(effectivePermission("GERENTE")).toBe("gerente");
    expect(effectivePermission("ADM_LOJA")).toBe("adm_loja");
  });

  it("Admin (legado) continua valendo como gerente [OB-2]", () => {
    expect(effectivePermission("ADMIN")).toBe("gerente");
  });

  it("sem papel na empresa, é colaborador", () => {
    expect(effectivePermission("COLABORADOR")).toBe("colaborador");
    expect(effectivePermission(null)).toBe("colaborador");
    expect(effectivePermission(undefined)).toBe("colaborador");
  });

  it("o papel na conta acompanha o da empresa, não o contrário", () => {
    expect(orgRoleToAccountRole("MASTER")).toBe("OWNER");
    expect(orgRoleToAccountRole("RH")).toBe("ADMIN");
    expect(orgRoleToAccountRole("SST")).toBe("ADMIN");
    expect(orgRoleToAccountRole("GERENTE")).toBe("ADMIN");
    expect(orgRoleToAccountRole("ADM_LOJA")).toBe("ADMIN");
    expect(orgRoleToAccountRole("SUPERVISOR")).toBe("USER");
    expect(orgRoleToAccountRole("COLABORADOR")).toBe("USER");
    expect(orgRoleToAccountRole("FISCAL")).toBe("USER");
  });

  it("owner e master são a mesma coluna nos 28 módulos", () => {
    const modulos = Object.keys(matriz.master);
    expect(modulos.length).toBeGreaterThan(0);
    for (const m of modulos) {
      expect(matriz.owner[m as keyof typeof matriz.owner]).toBe(
        matriz.master[m as keyof typeof matriz.master],
      );
    }
  });
});

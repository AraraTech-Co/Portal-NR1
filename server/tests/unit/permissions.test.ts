import { describe, expect, it } from "vitest";
import permissions from "../../config/permissions.json";
import {
  effectivePermission,
  accountRoleToPermission,
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

describe("effectivePermission", () => {
  it("MASTER org role wins over account role", () => {
    expect(effectivePermission("MASTER", "USER")).toBe("master");
    expect(effectivePermission("MASTER", null)).toBe("master");
  });

  it("OWNER account maps to owner when not master", () => {
    expect(effectivePermission("ADMIN", "OWNER")).toBe("owner");
    expect(effectivePermission(null, "OWNER")).toBe("owner");
  });

  it("AccountRole.ADMIN maps to adm_loja", () => {
    expect(effectivePermission("COLABORADOR", "ADMIN")).toBe("adm_loja");
    expect(effectivePermission(null, "ADMIN")).toBe("adm_loja");
  });

  it("maps org RH/SST when account is USER", () => {
    expect(effectivePermission("RH", "USER")).toBe("rh");
    expect(effectivePermission("SST", "USER")).toBe("sst");
    expect(effectivePermission("RH", null)).toBe("rh");
  });

  it("maps new org roles", () => {
    expect(effectivePermission("SUPERVISOR", "USER")).toBe("supervisor");
    expect(effectivePermission("GERENTE", "USER")).toBe("gerente");
    expect(effectivePermission("ADM_LOJA", "USER")).toBe("adm_loja");
  });

  it("legacy org ADMIN maps to gerente", () => {
    expect(effectivePermission("ADMIN", "USER")).toBe("gerente");
  });

  it("account OWNER still beats org RH", () => {
    expect(effectivePermission("RH", "OWNER")).toBe("owner");
  });

  it("colaborador is the default employee key", () => {
    expect(effectivePermission("COLABORADOR", "USER")).toBe("colaborador");
    expect(effectivePermission(null, "USER")).toBe("colaborador");
    expect(effectivePermission(null, null)).toBe("colaborador");
  });

  it("accountRoleToPermission maps correctly", () => {
    expect(accountRoleToPermission("OWNER")).toBe("owner");
    expect(accountRoleToPermission("ADMIN")).toBe("adm_loja");
    expect(accountRoleToPermission("USER")).toBe("colaborador");
  });

  it("isOrgMaster", () => {
    expect(isOrgMaster("MASTER")).toBe(true);
    expect(isOrgMaster("ADMIN")).toBe(false);
  });
});

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
    expect(can("admin", "master")).toBe(false);
    expect(can("user", "master")).toBe(false);
  });

  it("owner can act as owner/admin/user but not master", () => {
    expect(can("owner", "owner")).toBe(true);
    expect(can("owner", "admin")).toBe(true);
    expect(can("owner", "user")).toBe(true);
    expect(can("owner", "master")).toBe(false);
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

  it("maps org RH/SST when account is USER", () => {
    expect(effectivePermission("RH", "USER")).toBe("rh");
    expect(effectivePermission("SST", "USER")).toBe("sst");
    expect(effectivePermission("RH", null)).toBe("rh");
  });

  it("account OWNER/ADMIN still beat org RH", () => {
    expect(effectivePermission("RH", "OWNER")).toBe("owner");
    expect(effectivePermission("SST", "ADMIN")).toBe("admin");
  });

  it("accountRoleToPermission maps correctly", () => {
    expect(accountRoleToPermission("OWNER")).toBe("owner");
    expect(accountRoleToPermission("ADMIN")).toBe("admin");
    expect(accountRoleToPermission("USER")).toBe("user");
  });

  it("isOrgMaster", () => {
    expect(isOrgMaster("MASTER")).toBe(true);
    expect(isOrgMaster("ADMIN")).toBe(false);
  });
});

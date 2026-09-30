import { describe, expect, it } from "vitest";
import {
  accessLevel,
  canReadModule,
  canWriteModule,
  modulesForRole,
} from "../../src/helper/module-access";

describe("module-access matrix (sheet NR-1)", () => {
  it("colaborador cannot see terceiros / talentos / conta", () => {
    expect(accessLevel("colaborador", "terceiros")).toBe("none");
    expect(accessLevel("colaborador", "talentos")).toBe("none");
    expect(accessLevel("colaborador", "conta")).toBe("none");
    expect(canReadModule("colaborador", "terceiros")).toBe(false);
  });

  it("sst cannot see holerites / comite / conta", () => {
    expect(accessLevel("sst", "holerites")).toBe("none");
    expect(accessLevel("sst", "comite")).toBe("none");
    expect(accessLevel("sst", "conta")).toBe("none");
  });

  it("rh has write on comite and conta", () => {
    expect(accessLevel("rh", "comite")).toBe("write");
    expect(canWriteModule("rh", "comite")).toBe(true);
    expect(accessLevel("rh", "conta")).toBe("write");
  });

  it("adm_loja has none on conta and write on holerites", () => {
    expect(accessLevel("adm_loja", "conta")).toBe("none");
    expect(accessLevel("adm_loja", "holerites")).toBe("write");
  });

  it("owner mirrors master full write", () => {
    expect(accessLevel("owner", "configuracoes")).toBe("write");
    expect(accessLevel("master", "configuracoes")).toBe("write");
    expect(accessLevel("owner", "inventario")).toBe("write");
  });

  it("colaborador can write atestados and denuncia", () => {
    expect(canWriteModule("colaborador", "atestados")).toBe(true);
    expect(canWriteModule("colaborador", "denuncia")).toBe(true);
  });

  it("supervisor reads inventario but cannot write", () => {
    expect(canReadModule("supervisor", "inventario")).toBe(true);
    expect(canWriteModule("supervisor", "inventario")).toBe(false);
  });

  it("user alias maps to colaborador", () => {
    expect(accessLevel("user", "terceiros")).toBe("none");
    expect(accessLevel("user", "holerites")).toBe("read");
  });

  it("modulesForRole omits none", () => {
    const mods = modulesForRole("colaborador");
    expect(mods.terceiros).toBeUndefined();
    expect(mods.holerites).toBe("read");
    expect(mods.atestados).toBe("write");
  });
});

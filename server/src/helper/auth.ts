import { AccountRole, Role } from "@prisma/client";

/** AccountRole → chave da matriz (OWNER = acesso total *naquela* conta). */
export function accountRoleToPermission(role: AccountRole): string {
  switch (role) {
    case "OWNER":
      return "owner";
    case "ADMIN":
      return "adm_loja";
    case "USER":
    default:
      return "colaborador";
  }
}

/**
 * Hierarquia de tenancy + papel operacional:
 *   MASTER (empresa) > OWNER (conta) > AccountRole.ADMIN → adm_loja
 *   > RH / SST / SUPERVISOR / GERENTE / ADM_LOJA (Membership)
 *   > Role.ADMIN legado → gerente
 *   > COLABORADOR / USER → colaborador
 *
 * Na matriz de módulos, OWNER usa a coluna Master; AccountRole.ADMIN usa ADM loja.
 */
export function effectivePermission(
  orgRole: Role | null | undefined,
  accountRole: AccountRole | null | undefined,
): string {
  if (orgRole === "MASTER") return "master";
  if (accountRole === "OWNER") return "owner";
  if (accountRole === "ADMIN") return "adm_loja";
  if (orgRole === "RH") return "rh";
  if (orgRole === "SST") return "sst";
  if (orgRole === "SUPERVISOR") return "supervisor";
  if (orgRole === "GERENTE") return "gerente";
  if (orgRole === "ADM_LOJA") return "adm_loja";
  if (orgRole === "ADMIN") return "gerente";
  if (accountRole === "USER") return "colaborador";
  return "colaborador";
}

export function isOrgMaster(orgRole: Role | null | undefined): boolean {
  return orgRole === "MASTER";
}

export type LoginIdentifier =
  | { kind: "email"; value: string }
  | { kind: "username"; value: string };

export function classifyLoginIdentifier(raw: string): LoginIdentifier {
  const value = raw.trim().toLowerCase();
  if (value.includes("@")) return { kind: "email", value };
  return { kind: "username", value };
}

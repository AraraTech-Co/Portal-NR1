import { AccountRole, Role } from "@prisma/client";

/** AccountRole → chave da matriz (OWNER = acesso total *naquela* conta). */
export function accountRoleToPermission(role: AccountRole): string {
  switch (role) {
    case "OWNER":
      return "owner";
    case "ADMIN":
      return "admin";
    case "USER":
    default:
      return "user";
  }
}

/**
 * Hierarquia:
 *   MASTER (empresa) > OWNER (conta) > ADMIN > RH/SST (papel na org) > USER
 * MASTER está no Membership da Organization — controla todas as contas dela.
 * RH/SST no Membership passam a valer quando a conta não é OWNER/ADMIN.
 */
export function effectivePermission(
  orgRole: Role | null | undefined,
  accountRole: AccountRole | null | undefined,
): string {
  if (orgRole === "MASTER") return "master";
  if (accountRole === "OWNER") return "owner";
  if (accountRole === "ADMIN") return "admin";
  if (orgRole === "RH") return "rh";
  if (orgRole === "SST") return "sst";
  if (accountRole === "USER") return "user";
  return "user";
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

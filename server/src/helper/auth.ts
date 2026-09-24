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
 *   MASTER (empresa) > OWNER (conta) > ADMIN > USER
 * MASTER está no Membership da Organization — controla todas as contas dela.
 */
export function effectivePermission(
  orgRole: Role | null | undefined,
  accountRole: AccountRole | null | undefined,
): string {
  if (orgRole === "MASTER") return "master";
  if (accountRole) return accountRoleToPermission(accountRole);
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

import { AccountRole, Role } from "@prisma/client";
import { isValidCpf } from "./cpf";

/**
 * O papel na empresa é o único que decide o que a pessoa vê e faz.
 *
 * Antes eram dois: o papel na conta (OWNER/ADMIN/USER) vencia o papel na
 * empresa em silêncio, e a mesma pessoa aparecia "Técnico SST" numa tela e
 * "ADM loja" noutra — sendo que o acesso real era o segundo. Decisão OB-3:
 * um papel só. O vínculo com a conta (`AccountMembership`) continua, porque é
 * ele que diz de quais contas a pessoa é membro; o que saiu foi o `role` dele
 * mandar no acesso. [OB-3] [S1-C] [B2-1-A]
 *
 * "owner" é a mesma coluna da matriz que "master" nos 28 módulos; quem era
 * OWNER na conta vira MASTER na empresa pela migração, sem perder nada.
 */
export function effectivePermission(orgRole: Role | null | undefined): string {
  switch (orgRole) {
    case Role.MASTER:
      return "master";
    // Dono da conta: a mesma coluna da matriz que master, mas o alcance é de
    // UMA conta — é o `isOrgMaster` que abre as outras. [OB-3]
    case Role.OWNER:
      return "owner";
    // Fiscal é sempre só consulta. [S7-A]
    case Role.FISCAL:
      return "fiscal";
    case Role.RH:
      return "rh";
    case Role.SST:
      return "sst";
    case Role.SUPERVISOR:
      return "supervisor";
    case Role.GERENTE:
      return "gerente";
    case Role.ADM_LOJA:
      return "adm_loja";
    // "Admin (legado)" não é mais oferecido, mas quem tem continua valendo
    // como gerente. [OB-2]
    case Role.ADMIN:
      return "gerente";
    default:
      return "colaborador";
  }
}

/**
 * O papel na conta deixa de ser escolhido à parte: ele acompanha o papel na
 * empresa, para que os dois nunca mais divirjam. [OB-3] [S1-C]
 */
export function orgRoleToAccountRole(orgRole: Role): AccountRole {
  switch (orgRole) {
    case Role.MASTER:
    case Role.OWNER:
      return AccountRole.OWNER;
    case Role.RH:
    case Role.SST:
    case Role.GERENTE:
    case Role.ADM_LOJA:
    case Role.ADMIN:
      return AccountRole.ADMIN;
    default:
      return AccountRole.USER;
  }
}

export function isOrgMaster(orgRole: Role | null | undefined): boolean {
  return orgRole === "MASTER";
}

export type LoginIdentifier =
  | { kind: "email"; value: string }
  | { kind: "cpf"; value: string }
  /** Login gerado (nome.sobrenome) ou matrícula da empresa. [B2-1-F] */
  | { kind: "username"; value: string };

/**
 * O que a pessoa digitou na entrada.
 *
 * Conviviam três padrões de login e quem entrou pela planilha precisava
 * decorar um "nome.sobrenome" que nunca viu, em vez da matrícula que usa na
 * fábrica. Agora o portal descobre o que foi digitado. [B2-1-F] [CB-4]
 */
export function classifyLoginIdentifier(raw: string): LoginIdentifier {
  const value = raw.trim().toLowerCase();
  if (value.includes("@")) return { kind: "email", value };
  const digitos = value.replace(/\D/g, "");
  if (digitos.length === 11 && isValidCpf(digitos)) {
    return { kind: "cpf", value: digitos };
  }
  return { kind: "username", value };
}

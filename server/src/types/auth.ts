import { AccountRole, Role } from "@prisma/client";

export type Actor = {
  userId: string;
  organizationId: string;
  accountId: string;
  /** Papel na conta; null se MASTER acessa conta sem ser membro dela. */
  accountRole: AccountRole | null;
  /** true se Membership.role === MASTER na empresa da conta ativa. */
  isMaster: boolean;
  /** Papel na Organization (MASTER = empresa; demais = operacional). */
  role: Role;
  /** Chave efetiva: master > owner > admin > user. */
  permission: string;
  name: string;
  email: string | null;
  login: string;
  mustChangePassword: boolean;
  organizationName: string;
  accountName: string;
};

export type AuthRequest = import("express").Request & {
  actor?: Actor;
  token?: string;
};

/** Conta acessível na lista de sessão (membro ou via MASTER da empresa). */
export type AccessibleAccount = {
  id: string;
  name: string;
  account_role: AccountRole | null;
  via_master: boolean;
  organization: { id: string; name: string };
};

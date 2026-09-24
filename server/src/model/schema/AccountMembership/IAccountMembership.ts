import {
  AccountMembership as PrismaAccountMembership,
  AccountRole,
} from "@prisma/client";

export type IAccountMembership = PrismaAccountMembership;

export type AccountMembershipWithRelations = IAccountMembership & {
  user: {
    id: string;
    login: string;
    email: string | null;
    name: string;
    active: boolean;
    mustChangePassword: boolean;
  };
  account: {
    id: string;
    name: string;
    active: boolean;
    organizationId: string;
    organization: {
      id: string;
      name: string;
      active: boolean;
    };
  };
};

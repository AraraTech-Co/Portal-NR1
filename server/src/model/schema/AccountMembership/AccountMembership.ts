import { AccountRole } from "@prisma/client";
import prisma from "../../prisma";
import Model from "../Model";
import {
  IAccountMembership,
  AccountMembershipWithRelations,
} from "./IAccountMembership";

const includeRelations = {
  user: {
    select: {
      id: true,
      login: true,
      email: true,
      name: true,
      active: true,
      mustChangePassword: true,
    },
  },
  account: {
    select: {
      id: true,
      name: true,
      active: true,
      organizationId: true,
      organization: {
        select: {
          id: true,
          name: true,
          active: true,
        },
      },
    },
  },
} as const;

export class AccountMembership extends Model<IAccountMembership> {
  constructor() {
    super(prisma.accountMembership as never);
  }

  public custom = {
    create: {
      link: async (input: {
        accountId: string;
        userId: string;
        role: AccountRole;
      }) => {
        return this.create.new({
          accountId: input.accountId,
          userId: input.userId,
          role: input.role,
        } as Partial<IAccountMembership>);
      },
    },
    read: {
      withAccount: async (query: {
        userId: string;
        accountId: string;
      }): Promise<AccountMembershipWithRelations | null> => {
        const row = await prisma.accountMembership.findFirst({
          where: {
            userId: query.userId,
            accountId: query.accountId,
          },
          include: includeRelations,
        });
        return row as AccountMembershipWithRelations | null;
      },
      byUser: async (
        userId: string,
      ): Promise<AccountMembershipWithRelations[]> => {
        const rows = await prisma.accountMembership.findMany({
          where: { userId },
          include: includeRelations,
          orderBy: { createdAt: "asc" },
        });
        return rows as AccountMembershipWithRelations[];
      },
      ownersOf: async (accountId: string) => {
        return prisma.accountMembership.findMany({
          where: { accountId, role: AccountRole.OWNER },
        });
      },
    },
    /**
     * Invariante: conta ativa não pode ficar sem OWNER.
     * Retorna false se a mudança removeria o último owner.
     */
    assert: {
      wouldKeepOwner: async (
        accountId: string,
        opts: { removingUserId?: string; demotingUserId?: string },
      ): Promise<boolean> => {
        const owners = await prisma.accountMembership.findMany({
          where: { accountId, role: AccountRole.OWNER },
        });
        const remaining = owners.filter((o) => {
          if (opts.removingUserId && o.userId === opts.removingUserId) {
            return false;
          }
          if (opts.demotingUserId && o.userId === opts.demotingUserId) {
            return false;
          }
          return true;
        });
        return remaining.length > 0;
      },
    },
  };
}

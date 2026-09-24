import prisma from "../../prisma";
import Model from "../Model";
import { IAccount } from "./IAccount";

export type AccountWithOrg = IAccount & {
  organization: {
    id: string;
    name: string;
    active: boolean;
  };
};

export class Account extends Model<IAccount> {
  constructor() {
    super(prisma.account as never);
  }

  public custom = {
    create: {
      underOrganization: async (input: {
        organizationId: string;
        name: string;
      }) => {
        return this.create.new({
          organizationId: input.organizationId,
          name: input.name.trim(),
          active: true,
        } as Partial<IAccount>);
      },
    },
    read: {
      withOrg: async (accountId: string): Promise<AccountWithOrg | null> => {
        const row = await prisma.account.findFirst({
          where: { id: accountId },
          include: {
            organization: {
              select: { id: true, name: true, active: true },
            },
          },
        });
        return row as AccountWithOrg | null;
      },
      activeByOrganization: async (
        organizationId: string,
      ): Promise<AccountWithOrg[]> => {
        const rows = await prisma.account.findMany({
          where: { organizationId, active: true },
          include: {
            organization: {
              select: { id: true, name: true, active: true },
            },
          },
          orderBy: { createdAt: "asc" },
        });
        return rows as AccountWithOrg[];
      },
    },
  };
}

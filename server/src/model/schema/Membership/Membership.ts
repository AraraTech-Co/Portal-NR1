import { Role } from "@prisma/client";
import prisma from "../../prisma";
import Model from "../Model";
import { IMembership, MembershipWithRelations } from "./IMembership";

export class Membership extends Model<IMembership> {
  constructor() {
    super(prisma.membership as never);
  }

  public custom = {
    create: {
      link: async (input: {
        userId: string;
        organizationId: string;
        role: Role;
        grants?: string[];
      }) => {
        return this.create.new({
          userId: input.userId,
          organizationId: input.organizationId,
          role: input.role,
          grants: input.grants ?? [],
        } as Partial<IMembership>);
      },
    },
    read: {
      withOrg: async (query: {
        userId: string;
        organizationId: string;
      }): Promise<MembershipWithRelations | null> => {
        const row = await prisma.membership.findFirst({
          where: {
            userId: query.userId,
            organizationId: query.organizationId,
          },
          include: {
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
            organization: {
              select: {
                id: true,
                name: true,
                active: true,
              },
            },
          },
        });
        return row as MembershipWithRelations | null;
      },
      byUser: async (userId: string): Promise<MembershipWithRelations[]> => {
        const rows = await prisma.membership.findMany({
          where: { userId },
          include: {
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
            organization: {
              select: {
                id: true,
                name: true,
                active: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        });
        return rows as MembershipWithRelations[];
      },
    },
  };
}

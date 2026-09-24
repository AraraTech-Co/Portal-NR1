import { Membership as PrismaMembership, Role } from "@prisma/client";

export type IMembership = PrismaMembership;

export type MembershipWithRelations = IMembership & {
  user: {
    id: string;
    login: string;
    email: string | null;
    name: string;
    active: boolean;
    mustChangePassword: boolean;
  };
  organization: {
    id: string;
    name: string;
    active: boolean;
  };
};

import bcrypt from "bcryptjs";
import prisma from "../../prisma";
import Model from "../Model";
import { IUser } from "./IUser";
import { classifyLoginIdentifier } from "../../../helper/auth";

export class User extends Model<IUser> {
  constructor() {
    super(prisma.user as never);
  }

  public custom = {
    create: {
      withPassword: async (input: {
        login: string;
        email?: string | null;
        name: string;
        password: string;
        mustChangePassword?: boolean;
      }) => {
        const passwordHash = await bcrypt.hash(input.password, 10);
        return this.create.new({
          login: input.login.toLowerCase().trim(),
          email: input.email?.toLowerCase().trim() || null,
          name: input.name.trim(),
          passwordHash,
          mustChangePassword: input.mustChangePassword ?? false,
          active: true,
        } as Partial<IUser>);
      },
    },
    read: {
      byLoginIdentifier: async (raw: string) => {
        const id = classifyLoginIdentifier(raw);
        if (id.kind === "email") {
          return this.read.one({ email: id.value });
        }
        return this.read.one({ login: id.value });
      },
    },
    auth: {
      verifyPassword: async (user: IUser, password: string) => {
        return bcrypt.compare(password, user.passwordHash);
      },
    },
  };
}

import prisma from "../../prisma";
import Model from "../Model";
import { IToken } from "./IToken";

export class Token extends Model<IToken> {
  constructor() {
    super(prisma.token as never);
  }

  public custom = {
    create: {
      save: async (input: {
        userId: string;
        tokenHash: string;
        expiresAt: Date;
      }) => {
        return this.create.new({
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        } as Partial<IToken>);
      },
    },
    delete: {
      byHash: async (tokenHash: string) => {
        return this.delete.one({ tokenHash });
      },
    },
  };
}

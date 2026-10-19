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
      /**
       * Quem pode ser a pessoa que digitou aquilo. [B2-1-F]
       *
       * Login e e-mail são únicos no portal inteiro e dão no máximo uma
       * pessoa. Matrícula e CPF são únicos DENTRO de uma empresa: a
       * matrícula 19 existe em várias, e é por isso que isto devolve uma
       * lista. Quem decide qual é a senha — nenhuma resposta muda conforme
       * o número de candidatos.
       */
      candidatesForLogin: async (raw: string): Promise<IUser[]> => {
        const id = classifyLoginIdentifier(raw);

        if (id.kind === "email") {
          const porEmail = await this.read.one({ email: id.value });
          return porEmail ? [porEmail] : [];
        }

        if (id.kind === "cpf") {
          return this.custom.read.byProfileField({ taxId: id.value });
        }

        const porLogin = await this.read.one({ login: id.value });
        if (porLogin) return [porLogin];
        // Não é login de ninguém: pode ser matrícula.
        return this.custom.read.byProfileField({
          registration: { equals: id.value, mode: "insensitive" },
        });
      },

      /** Pessoas com este campo na ficha, em qualquer empresa. [B2-1-F] */
      byProfileField: async (
        where: Record<string, unknown>,
      ): Promise<IUser[]> => {
        const perfis = await prisma.employeeProfile.findMany({
          where: { ...where, dismissedAt: null },
          select: { user: true },
          // Teto: a matrícula repetida entre empresas não pode virar um
          // caminho para fazer o portal conferir senha sem fim.
          take: 5,
          orderBy: { createdAt: "asc" },
        });
        const porId = new Map<string, IUser>();
        for (const p of perfis) porId.set(p.user.id, p.user as IUser);
        return Array.from(porId.values());
      },
    },
    auth: {
      verifyPassword: async (user: IUser, password: string) => {
        return bcrypt.compare(password, user.passwordHash);
      },
    },
  };
}

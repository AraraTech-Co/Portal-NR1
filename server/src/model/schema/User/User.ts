import bcrypt from "bcryptjs";
import prisma from "../../prisma";
import Model from "../Model";
import { IUser } from "./IUser";
import { classifyLoginIdentifier } from "../../../helper/auth";
import { canonicalRegistration } from "../../../helper/auth-attempts";
import type { FilialDoLogin } from "../../../helper/login-org";


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
       * Quem pode ser a pessoa que digitou aquilo, conforme a filial
       * escolhida na tela. [B2-1-F] [C3-2b]
       *
       * - Uma filial: matrícula ou CPF de ficha daquela filial. Login e
       *   e-mail não (vão por "Externo").
       * - "Externo": login, e-mail ou CPF. Só dígitos que não formam CPF
       *   valem como login quando existe um login exatamente assim (o
       *   convite usa a matrícula como login, e quem não tem filial na ficha
       *   entra por aqui); se não existe, é matrícula, e matrícula pede a
       *   filial. Decisão D4-1 do Léo, 12/11/2026. [C4-1]
       * - Filial inválida: ninguém.
       *
       * Quem decide entre vários é a senha; nenhuma resposta muda conforme o
       * número de candidatos.
       */
      candidatesForLogin: async (raw: string, filial: FilialDoLogin): Promise<IUser[]> => {
        const id = classifyLoginIdentifier(raw);
        if (filial.kind === "invalida") return [];

        if (filial.kind === "filial") {
          if (id.kind === "email") return [];
          if (id.kind === "cpf") {
            return this.custom.read.byProfileField({ taxId: id.value, establishmentId: filial.id });
          }
          // Matrícula na filial, pela forma canônica gravada pelo banco:
          // "74", "074" e "000074" dão na mesma. [C3-1] [C3-2]
          return this.custom.read.byProfileField({
            registrationKey: canonicalRegistration(id.value),
            establishmentId: filial.id,
          });
        }

        if (id.kind === "email") {
          const porEmail = await this.read.one({ email: id.value });
          return porEmail ? [porEmail] : [];
        }
        if (id.kind === "cpf") {
          return this.custom.read.byProfileField({ taxId: id.value });
        }
        /*
          Só dígitos e não é CPF: vale como login se existir um login
          exatamente assim; senão é matrícula, que pede a filial. A resposta
          de quem não acha é a mesma de senha errada. [C4-1]
        */
        const porLogin = await this.read.one({ login: id.value });
        return porLogin ? [porLogin] : [];
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

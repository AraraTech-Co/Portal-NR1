import bcrypt from "bcryptjs";
import { AccountRole, Prisma, Role, WorkerBond } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { canAssignOrgRole } from "../helper/invite-access";
import { isValidCpf, normalizeCpf } from "../helper/cpf";
import {
  allocateUniqueLogin,
  loginCandidateFromEmail,
  loginCandidateFromName,
} from "../helper/login-name";
import { randomBytes } from "crypto";
import { FIRST_ACCESS_WINDOW_DAYS, canonicalRegistration } from "../helper/auth-attempts";
import { parseBirthDate } from "../helper/birth-date";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

/** Uma leva por vez: a tela mostra o resultado linha a linha. */
const MAX_ROWS = 200;

type Entrada = {
  name?: unknown;
  registration?: unknown;
  tax_id?: unknown;
  email?: unknown;
  job_role_id?: unknown;
  /** Filial, quando a linha não tem função. [C3-2] */
  establishment_id?: unknown;
  admitted_at?: unknown;
  /** Nascimento: um dos três dados do primeiro acesso. [C1-7] */
  birth_date?: unknown;
  bond?: unknown;
  contractor_id?: unknown;
  org_role?: unknown;
};

type Resultado = {
  line: number;
  name: string;
  status: "created" | "completed" | "skipped" | "error";
  /** O que a planilha preencheu na ficha de quem já existia. [CB-2] */
  filled?: string[];
  /** Por que a linha não entrou, na língua de quem vai consertar a planilha. */
  message?: string;
  login?: string;
  /**
   * A conta nova nasce aguardando o primeiro acesso: nenhuma senha sai da
   * planilha, e a pessoa cria a própria conferindo matrícula, CPF e
   * nascimento. [C1-7]
   */
  awaiting_first_access?: boolean;
};

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function dataDeCalendario(raw: unknown, campo: string): Date | null {
  const value = texto(raw);
  if (!value) return null;
  const dia = value.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || Number.isNaN(Date.parse(`${dia}T00:00:00Z`))) {
    throw new Error(`${campo} inválida — use AAAA-MM-DD.`);
  }
  return new Date(`${dia}T00:00:00.000Z`);
}

/** Arroba, CPF, data ou comprimento de linha inteira num campo de nome. */
const CPF_SOLTO = /\d{3}[.\s]?\d{3}[.\s]?\d{3}[-.\s]?\d{2}/;
const DATA_SOLTA = /\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/;

export function pareceLinhaInteira(nome: string): boolean {
  return (
    nome.includes("@") ||
    CPF_SOLTO.test(nome) ||
    DATA_SOLTA.test(nome) ||
    nome.length > 80
  );
}

class PeopleImportController {
  /**
   * Completa a ficha de quem já está no portal com o que a planilha traz —
   * e só o que está em branco. Nunca sobrescreve: um arquivo velho não pode
   * desfazer uma correção feita à mão. Devolve, em português, o que mudou,
   * para o relatório dizer exatamente o que fez. [CB-2]
   */
  private async completarFicha(entrada: {
    orgId: string;
    profileId: string;
    atual: {
      taxId: string | null;
      registration: string | null;
      establishmentId: string | null;
      jobRoleId: string | null;
      admittedAt: Date | null;
      birthDate: Date | null;
    };
    daPlanilha: {
      taxId: string | null;
      matricula: string | null;
      establishmentId: string | null;
      jobRoleId: string | null;
      admittedAt: Date | null;
      birthDate: Date | null;
    };
    simulacao: boolean;
  }): Promise<string[]> {
    const { orgId, profileId, atual, daPlanilha, simulacao } = entrada;
    const dados: Record<string, unknown> = {};
    const mudou: string[] = [];

    /*
      CPF e matrícula são únicos dentro da empresa: se o número da planilha
      já é de OUTRA pessoa, completar criaria duas fichas com o mesmo número.
      Nesse caso a linha fica sem esse campo e o resto é completado.
    */
    if (!atual.taxId && daPlanilha.taxId) {
      const deOutro = await prisma.employeeProfile.findFirst({
        where: {
          organizationId: orgId,
          taxId: daPlanilha.taxId,
          id: { not: profileId },
        },
        select: { id: true },
      });
      if (!deOutro) {
        dados.taxId = daPlanilha.taxId;
        mudou.push("CPF");
      }
    }
    if (!atual.registration && daPlanilha.matricula) {
      /*
        A matrícula é única por filial (C3-2): a de outra pessoa conta só na
        filial que esta ficha terá. Sem filial conhecida, conta a empresa.
      */
      const filialFinal =
        atual.establishmentId ?? (atual.jobRoleId ? null : daPlanilha.establishmentId);
      const deOutro = await prisma.employeeProfile.findFirst({
        where: {
          organizationId: orgId,
          ...(filialFinal ? { establishmentId: filialFinal } : {}),
          registrationKey: canonicalRegistration(daPlanilha.matricula),
          id: { not: profileId },
        },
        select: { id: true },
      });
      if (!deOutro) {
        dados.registration = daPlanilha.matricula;
        mudou.push("matrícula");
      }
    }
    if (!atual.jobRoleId && daPlanilha.jobRoleId) {
      dados.jobRoleId = daPlanilha.jobRoleId;
      mudou.push("função");
    }
    /* Ficha sem filial e sem função: a filial da linha completa. [C3-2] */
    if (!atual.establishmentId && !atual.jobRoleId && !dados.jobRoleId && daPlanilha.establishmentId) {
      dados.establishmentId = daPlanilha.establishmentId;
      mudou.push("filial");
    }
    if (!atual.admittedAt && daPlanilha.admittedAt) {
      dados.admittedAt = daPlanilha.admittedAt;
      mudou.push("admissão");
    }
    /* Como o CPF: completa o que está em branco, nunca sobrescreve. [C1-7] */
    if (!atual.birthDate && daPlanilha.birthDate) {
      dados.birthDate = daPlanilha.birthDate;
      mudou.push("nascimento");
    }

    if (mudou.length > 0 && !simulacao) {
      await prisma.employeeProfile.update({ where: { id: profileId }, data: dados });
    }
    return mudou;
  }


  /**
   * Cadastra várias pessoas de uma vez, a partir de uma planilha colada.
   *
   * Cada linha é independente: o que já existe é pulado, o que está errado é
   * devolvido com o motivo, e o resto entra. Importação que aborta inteira no
   * primeiro CPF repetido obriga a conferir 200 linhas à mão. [S1-A]
   *
   * `dry_run` confere sem gravar nada — é o que a tela usa para a prévia.
   */
  async importPeople(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const actor = auth.actor!;
      const orgId = actorOrgId(auth);
      const body = req.body as { people?: Entrada[]; dry_run?: boolean };
      const linhas = Array.isArray(body.people) ? body.people : null;
      const simulacao = body.dry_run === true;

      if (!linhas || linhas.length === 0) {
        res.status(400).json({ message: "Nenhuma linha para importar." });
        return;
      }
      if (linhas.length > MAX_ROWS) {
        res.status(400).json({
          message: `São ${linhas.length} linhas e o limite é ${MAX_ROWS} por vez. Divida a planilha.`,
        });
        return;
      }

      const [funcoes, contratadas] = await Promise.all([
        prisma.jobRole.findMany({
          where: { organizationId: orgId, archivedAt: null },
          select: { id: true, sector: { select: { establishmentId: true } } },
        }),
        prisma.contractor.findMany({
          where: { organizationId: orgId, archivedAt: null },
          select: { id: true },
        }),
      ]);
      const funcaoValida = new Set(funcoes.map((f) => f.id));
      /* Filial de cada função: a ficha nasce na filial da função. [C3-2] */
      const filialDaFuncao = new Map(funcoes.map((f) => [f.id, f.sector.establishmentId]));
      const filiaisAtivas = await prisma.establishment.findMany({
        where: { organizationId: orgId, archivedAt: null },
        select: { id: true },
      });
      const filialValida = new Set(filiaisAtivas.map((f) => f.id));
      /* Uma filial só na empresa: é a de todos. */
      const filialUnica = filiaisAtivas.length === 1 ? filiaisAtivas[0].id : null;
      const contratadaValida = new Set(contratadas.map((c) => c.id));

      const resultados: Resultado[] = [];
      /** Repetição dentro da própria planilha, que o banco não pega na prévia. */
      const cpfsDaLeva = new Set<string>();
      const matriculasDaLeva = new Set<string>();
      const emailsDaLeva = new Set<string>();

      for (const [indice, linha] of linhas.entries()) {
        const numero = indice + 1;
        const nome = texto(linha.name);
        const registro: Resultado = {
          line: numero,
          name: nome ?? "",
          status: "error",
        };

        try {
          if (!nome) throw new Error("Informe o nome.");
          /*
            Linha colada sem separador caía inteira no nome, e entrava uma
            pessoa chamada "Paulo Ribeiro 10 444.444.444-44 paulo@… Torneiro
            15/10/2019". A tela já recusa na prévia; aqui é a mesma regra no
            lugar em que o registro nasce. [B2-1-L]

            A regra procura o que não cabe num nome — arroba, CPF, data,
            comprimento de linha inteira — e não um dígito solto: há quem se
            chame "Maria de Souza 2" na folha, e recusar isso seria trocar um
            problema por outro.
          */
          if (pareceLinhaInteira(nome)) {
            throw new Error(
              "O nome parece uma linha inteira caída na coluna do nome: tem arroba, CPF ou data dentro.",
            );
          }

          const matricula = texto(linha.registration);
          const email = texto(linha.email)?.toLowerCase() ?? null;
          const jobRoleId = texto(linha.job_role_id);
          const admittedAt = dataDeCalendario(linha.admitted_at, "Data de admissão");
          const birthDate = parseBirthDate(linha.birth_date);

          let taxId: string | null = null;
          const cpfBruto = texto(linha.tax_id);
          if (cpfBruto) {
            taxId = normalizeCpf(cpfBruto);
            if (!isValidCpf(taxId)) throw new Error("CPF inválido — confira os números.");
          }

          if (jobRoleId && !funcaoValida.has(jobRoleId)) {
            throw new Error("Função não existe nesta empresa.");
          }
          /*
            Filial da linha: a da função; sem função, a informada; sem as
            duas, a única da empresa, se houver uma só. A coluna da filial na
            tela vem na C3-3. [C3-2]
          */
          const filialInformada = texto(linha.establishment_id);
          if (filialInformada && !filialValida.has(filialInformada)) {
            throw new Error("Filial não existe nesta empresa.");
          }
          if (jobRoleId && filialInformada && filialDaFuncao.get(jobRoleId) !== filialInformada) {
            throw new Error("A função escolhida é de outra filial.");
          }
          const filial = jobRoleId
            ? filialDaFuncao.get(jobRoleId) ?? null
            : filialInformada ?? filialUnica;
          const chave = matricula ? canonicalRegistration(matricula) : null;

          const bond = (texto(linha.bond) ?? WorkerBond.EMPLOYEE) as WorkerBond;
          if (!Object.values(WorkerBond).includes(bond)) {
            throw new Error("Vínculo inválido.");
          }
          const contractorId = texto(linha.contractor_id);
          if (contractorId && !contratadaValida.has(contractorId)) {
            throw new Error("Empresa contratada não existe nesta empresa.");
          }
          if (contractorId && bond === WorkerBond.EMPLOYEE) {
            throw new Error("Empregado não pertence a empresa contratada.");
          }

          const orgRole = (texto(linha.org_role) ?? Role.COLABORADOR) as Role;
          if (!Object.values(Role).includes(orgRole)) {
            throw new Error("Papel inválido.");
          }
          if (!canAssignOrgRole(actor, orgRole)) {
            throw new Error("Você não pode dar este papel.");
          }
          /*
            O acesso do fiscal cai sozinho na data marcada, e a planilha não
            tem onde dizer a data: importar um fiscal criava acesso de
            consulta sem prazo nenhum. O caminho dele é o pedido de entrada,
            onde se informa "Acesso até". [S7-A] [B2-1-D]
          */
          if (orgRole === Role.FISCAL) {
            throw new Error(
              "Fiscal não entra por planilha: o acesso dele tem prazo, definido ao aprovar o pedido de entrada.",
            );
          }

          // Repetido dentro da própria planilha.
          if (taxId && cpfsDaLeva.has(taxId)) throw new Error("CPF repetido na planilha.");
          if (chave && matriculasDaLeva.has(`${filial ?? "-"}:${chave}`)) {
            throw new Error("Matrícula repetida na planilha.");
          }
          if (email && emailsDaLeva.has(email)) throw new Error("E-mail repetido na planilha.");

          // Já cadastrado: pular é o certo, não é erro de quem montou a planilha.
          const campos = {
            id: true,
            taxId: true,
            registration: true,
            establishmentId: true,
            jobRoleId: true,
            admittedAt: true,
            birthDate: true,
            user: { select: { name: true, login: true } },
          } as const;
          const [porCpf, porMatricula, porEmail] = await Promise.all([
            taxId
              ? prisma.employeeProfile.findFirst({
                  where: { organizationId: orgId, taxId },
                  select: campos,
                })
              : null,
            /*
              A mesma matrícula existe em filiais diferentes (C3-2): procura
              na filial da linha e nas fichas ainda sem filial (a pessoa pode
              ter entrado antes sem função). Sem filial na linha, procura na
              empresa. Só vale se achar uma ficha: com duas, não dá para
              saber qual.
            */
            chave
              ? prisma.employeeProfile
                  .findMany({
                    where: {
                      organizationId: orgId,
                      registrationKey: chave,
                      ...(filial
                        ? { OR: [{ establishmentId: filial }, { establishmentId: null }] }
                        : {}),
                    },
                    select: campos,
                    take: 2,
                  })
                  .then((achadas) => (achadas.length === 1 ? achadas[0] : null))
              : null,
            email
              ? prisma.employeeProfile.findFirst({
                  where: { organizationId: orgId, user: { email } },
                  select: campos,
                })
              : null,
          ]);
          /*
            Quem já existe deixa de ser pulado: a planilha completa o que
            está em branco na ficha e nunca sobrescreve o que já foi
            preenchido. Colar o quadro do RH não preenchia função nem CPF de
            quem já estava no portal. [CB-2] [S1-G]
          */
          const jaExiste = porCpf ?? porMatricula ?? porEmail;
          if (jaExiste) {
            const completado = await this.completarFicha({
              orgId,
              profileId: jaExiste.id,
              atual: jaExiste,
              daPlanilha: { taxId, matricula, establishmentId: filial, jobRoleId, admittedAt, birthDate },
              simulacao,
            });
            registro.login = jaExiste.user.login;
            if (completado.length > 0) {
              registro.status = "completed";
              registro.filled = completado;
              registro.message = `Já estava no portal; a planilha completou: ${completado.join(", ")}.`;
            } else {
              registro.status = "skipped";
              registro.message = `Já cadastrado (${jaExiste.user.name}); nada a completar.`;
            }
            if (!simulacao && completado.length > 0) {
              await writeAudit({
                organizationId: orgId,
                actorId: actor.userId,
                action: "employee_profile.update",
                entityType: "EmployeeProfile",
                entityId: jaExiste.id,
                after: { via: "import", filled: completado },
              });
            }
            resultados.push(registro);
            continue;
          }

          if (taxId) cpfsDaLeva.add(taxId);
          if (chave) matriculasDaLeva.add(`${filial ?? "-"}:${chave}`);
          if (email) emailsDaLeva.add(email);

          const base = matricula
            ? loginCandidateFromName(nome)
            : email
              ? loginCandidateFromEmail(email)
              : loginCandidateFromName(nome);

          if (simulacao) {
            registro.status = "created";
            registro.login = await allocateUniqueLogin(base, prisma);
            registro.message = "Pronto para entrar.";
            resultados.push(registro);
            continue;
          }

          /*
            Senha provisória em papel se perde e expõe. A conta nasce com uma
            senha que ninguém conhece (descartada aqui mesmo) e aguardando o
            primeiro acesso por 30 dias. [C1-7]
          */
          const senhaDescartada = randomBytes(32).toString("base64url");
          const liberadoAte = new Date(Date.now() + FIRST_ACCESS_WINDOW_DAYS * 24 * 3600_000);
          const criado = await prisma.$transaction(async (tx) => {
            const login = await allocateUniqueLogin(base, tx);
            const user = await tx.user.create({
              data: {
                login,
                email,
                name: nome,
                passwordHash: await bcrypt.hash(senhaDescartada, 10),
                mustChangePassword: false,
                activatedAt: null,
                firstAccessEligible: true,
                firstAccessUntil: liberadoAte,
              },
            });
            await tx.membership.create({
              data: { userId: user.id, organizationId: orgId, role: orgRole },
            });
            await tx.accountMembership.create({
              data: { accountId: actor.accountId, userId: user.id, role: AccountRole.USER },
            });
            await tx.employeeProfile.create({
              data: {
                organizationId: orgId,
                userId: user.id,
                registration: matricula,
                taxId,
                jobRoleId,
                establishmentId: filial,
                admittedAt,
                birthDate,
                bond,
                contractorId,
              },
            });
            return { id: user.id, login };
          });

          await writeAudit({
            organizationId: orgId,
            actorId: actor.userId,
            action: "employee_profile.create",
            entityType: "User",
            entityId: criado.id,
            after: { via: "import", registration: matricula, bond },
          });

          registro.status = "created";
          registro.login = criado.login;
          registro.awaiting_first_access = true;
          registro.message = birthDate && taxId && matricula
            ? "Aguardando primeiro acesso."
            : "Aguardando primeiro acesso — faltam dados (matrícula, CPF ou nascimento) para a pessoa entrar sozinha.";
          resultados.push(registro);
        } catch (err) {
          if (
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === "P2002"
          ) {
            registro.status = "skipped";
            registro.message = "Já existe alguém com este login, CPF, matrícula ou e-mail.";
          } else {
            registro.message =
              err instanceof Error ? err.message : "Não foi possível importar esta linha.";
          }
          resultados.push(registro);
        }
      }

      const criados = resultados.filter((r) => r.status === "created").length;
      if (!simulacao && criados > 0) {
        await writeAudit({
          organizationId: orgId,
          actorId: actor.userId,
          action: "people.import",
          entityType: "Organization",
          entityId: orgId,
          after: {
            rows: resultados.length,
            created: criados,
            completed: resultados.filter((r) => r.status === "completed").length,
            skipped: resultados.filter((r) => r.status === "skipped").length,
            errors: resultados.filter((r) => r.status === "error").length,
          },
        });
      }

      res.status(simulacao ? 200 : 201).json({
        dry_run: simulacao,
        rows: resultados.length,
        created: criados,
        completed: resultados.filter((r) => r.status === "completed").length,
        skipped: resultados.filter((r) => r.status === "skipped").length,
        errors: resultados.filter((r) => r.status === "error").length,
        results: resultados,
      });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new PeopleImportController();

import bcrypt from "bcryptjs";
import { AccessSuspensionReason, AccountRole, Prisma, Role, WorkerBond } from "@prisma/client";
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
import { MATRICULA_FORA_DO_PADRAO, matriculaNoPadrao } from "../helper/matricula";
import { avisoDeIdade, parseBirthDate } from "../helper/birth-date";
import { lerDataDeCalendario } from "../helper/data-de-calendario";
import type { AuthRequest } from "../types/auth";
import {
  DadoDaFolhaInvalido,
  camposQueMudam,
  lerDadosDaFolha,
  soPreenchidos,
  type DadosDaFolha,
} from "../helper/dados-da-folha";

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
  /** Os dados da planilha da folha que o portal guarda à parte. [PF-2] */
  payroll?: unknown;
  /** CBO do cargo, como a planilha da folha traz: vai para a função. [PF-2] */
  job_role_cbo2002?: unknown;
  job_role_cbo94?: unknown;
  /** O que o RH marcou, na prévia, para receber o valor da planilha. [PF-3] */
  aceitar?: unknown;
};

/**
 * O que a planilha traz diferente do portal para quem já existe. Não muda
 * sozinho: a prévia mostra lado a lado, e só o que o RH marcar muda. [PF-3]
 */
type Divergencia = {
  campo: "name" | "birth_date" | "admitted_at" | "job_role" | "cbo2002" | "cbo94" | "rescisao";
  rotulo: string;
  portal: string;
  planilha: string;
};

const ROTULO_DA_DIVERGENCIA: Record<Divergencia["campo"], string> = {
  name: "nome",
  birth_date: "nascimento",
  admitted_at: "admissão",
  job_role: "função",
  cbo2002: "CBO 2002 da função",
  cbo94: "CBO 94 da função",
  rescisao: "rescisão",
};

function dia(d: Date | null | undefined): string {
  if (!d) return "—";
  return d.toISOString().slice(0, 10).split("-").reverse().join("/");
}

/** "ANA  DA SILVA" e "Ana da Silva" são o mesmo nome: a folha escreve em maiúsculas. */
function mesmoNome(a: string, b: string): boolean {
  const n = (x: string) => x.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  return n(a) === n(b);
}

const CBO = /^[0-9][0-9.-]{0,9}$/;

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
  /** A filial em que a linha cai, para a prévia mostrar. [C3-3] */
  establishment?: { id: string; name: string } | null;
  /** Diferenças com o portal que ainda esperam o RH. [PF-3] */
  divergences?: Divergencia[];
};

function texto(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

function dataDeCalendario(raw: unknown, campo: string): Date | null {
  return lerDataDeCalendario(raw, campo);
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
   * Os dados da folha de quem já existe: a folha é a fonte, então o que veio
   * preenchido grava por cima; célula em branco não apaga; e uma folha de
   * competência mais velha que a guardada não mexe em nada. [PF-2]
   */
  private async aplicarDadosDaFolha(entrada: {
    orgId: string;
    profileId: string;
    atual: Record<string, unknown> | null;
    novos: DadosDaFolha;
    simulacao: boolean;
    actorId: string;
  }): Promise<{ mudou: string[]; antiga: string | null }> {
    const { orgId, profileId, atual, novos, simulacao, actorId } = entrada;
    if (Object.keys(novos).length === 0) return { mudou: [], antiga: null };
    const guardada = (atual?.competence as string | null | undefined) ?? null;
    const chegou = (novos.competence as string | null | undefined) ?? null;
    if (guardada && chegou && chegou < guardada) return { mudou: [], antiga: guardada };
    const mudou = camposQueMudam(atual, novos);
    if (mudou.length > 0 && !simulacao) {
      await prisma.employeePayrollData.upsert({
        where: { profileId },
        create: { organizationId: orgId, profileId, ...novos, updatedById: actorId },
        update: { ...novos, updatedById: actorId },
      });
    }
    return { mudou, antiga: null };
  }


  /** O que a planilha traz diferente do portal, campo a campo. [PF-3] */
  private divergencias(entrada: {
    jaExiste: {
      jobRoleId: string | null;
      birthDate: Date | null;
      admittedAt: Date | null;
      dismissedAt: Date | null;
      user: { name: string };
    };
    linha: {
      nome: string;
      birthDate: Date | null;
      admittedAt: Date | null;
      jobRoleId: string | null;
      cbo2002: string | null;
      cbo94: string | null;
    };
    daFolha: DadosDaFolha;
    nomeDaFuncao: Map<string, string>;
    cboDaFuncao: Map<string, { cbo2002: string | null; cbo94: string | null }>;
  }): Divergencia[] {
    const { jaExiste: p, linha: l, daFolha, nomeDaFuncao, cboDaFuncao } = entrada;
    const out: Divergencia[] = [];
    const add = (campo: Divergencia["campo"], portal: string, planilha: string) =>
      out.push({ campo, rotulo: ROTULO_DA_DIVERGENCIA[campo], portal, planilha });
    if (!mesmoNome(p.user.name, l.nome)) add("name", p.user.name, l.nome);
    if (p.birthDate && l.birthDate && p.birthDate.getTime() !== l.birthDate.getTime()) {
      add("birth_date", dia(p.birthDate), dia(l.birthDate));
    }
    if (p.admittedAt && l.admittedAt && p.admittedAt.getTime() !== l.admittedAt.getTime()) {
      add("admitted_at", dia(p.admittedAt), dia(l.admittedAt));
    }
    if (p.jobRoleId && l.jobRoleId && p.jobRoleId !== l.jobRoleId) {
      add("job_role", nomeDaFuncao.get(p.jobRoleId) ?? "outra função", nomeDaFuncao.get(l.jobRoleId) ?? "");
    }
    /* O CBO é da função que a pessoa terá: a da planilha, se for trocar; senão a dela. */
    const funcao = l.jobRoleId ?? p.jobRoleId;
    const cbo = funcao ? cboDaFuncao.get(funcao) : undefined;
    if (cbo?.cbo2002 && l.cbo2002 && cbo.cbo2002 !== l.cbo2002) add("cbo2002", cbo.cbo2002, l.cbo2002);
    if (cbo?.cbo94 && l.cbo94 && cbo.cbo94 !== l.cbo94) add("cbo94", cbo.cbo94, l.cbo94);
    const rescisao = daFolha.terminationDate as Date | null | undefined;
    if (rescisao && !p.dismissedAt) {
      const causa = (daFolha.terminationCause as string | null | undefined) ?? null;
      add("rescisao", "ativa no portal", `rescisão em ${dia(rescisao)}${causa ? ` (${causa})` : ""}: desligar`);
    }
    return out;
  }

  /**
   * Aplica só o que o RH marcou na prévia. Na prévia não grava; devolve o que
   * seria aplicado, para a linha dizer. [PF-3]
   */
  private async aplicarConfirmados(entrada: {
    orgId: string;
    actorId: string;
    jaExiste: { id: string; userId: string; admittedAt: Date | null };
    aceitas: Divergencia[];
    linha: {
      nome: string;
      birthDate: Date | null;
      admittedAt: Date | null;
      jobRoleId: string | null;
      cbo2002: string | null;
      cbo94: string | null;
    };
    daFolha: DadosDaFolha;
    simulacao: boolean;
    cboDaFuncao: Map<string, { cbo2002: string | null; cbo94: string | null }>;
  }): Promise<string[]> {
    const { orgId, actorId, jaExiste, aceitas, linha, daFolha, simulacao, cboDaFuncao } = entrada;
    if (aceitas.length === 0) return [];
    const campos = new Set(aceitas.map((d) => d.campo));
    const rescisao = (daFolha.terminationDate as Date | null | undefined) ?? null;
    if (campos.has("rescisao")) {
      if (jaExiste.userId === actorId) {
        throw new Error("A planilha traz a sua rescisão: outra pessoa do RH registra o seu desligamento.");
      }
      const admissao = campos.has("admitted_at") ? linha.admittedAt : jaExiste.admittedAt;
      if (rescisao && admissao && rescisao < admissao) {
        throw new Error("A rescisão da planilha é anterior à admissão: confira. Nada mudou.");
      }
    }
    if (simulacao) return [...campos];

    const ficha: Prisma.EmployeeProfileUncheckedUpdateInput = {};
    if (campos.has("birth_date")) ficha.birthDate = linha.birthDate;
    if (campos.has("admitted_at")) ficha.admittedAt = linha.admittedAt;
    if (campos.has("job_role")) ficha.jobRoleId = linha.jobRoleId;
    const funcao = linha.jobRoleId;
    const cbo: { cbo2002?: string; cbo94?: string } = {};
    if (campos.has("cbo2002") && linha.cbo2002) cbo.cbo2002 = linha.cbo2002;
    if (campos.has("cbo94") && linha.cbo94) cbo.cbo94 = linha.cbo94;
    const agora = new Date();

    try {
      await prisma.$transaction(async (tx) => {
        if (campos.has("name")) {
          await tx.user.update({ where: { id: jaExiste.userId }, data: { name: linha.nome } });
        }
        if (Object.keys(ficha).length > 0) {
          await tx.employeeProfile.update({ where: { id: jaExiste.id }, data: ficha });
        }
        if (funcao && Object.keys(cbo).length > 0) {
          await tx.jobRole.update({ where: { id: funcao }, data: cbo });
        }
        if (campos.has("rescisao") && rescisao) {
          /* O mesmo desligamento da ficha: a data, o motivo, e o acesso cai junto. [S5-H] */
          await tx.employeeProfile.update({
            where: { id: jaExiste.id },
            data: {
              dismissedAt: rescisao,
              dismissalReason: (daFolha.terminationCause as string | null | undefined) ?? "Rescisão na folha",
              dismissedById: actorId,
            },
          });
          await tx.membership.updateMany({
            where: { userId: jaExiste.userId, organizationId: orgId },
            data: {
              suspendedAt: agora,
              suspensionReason: AccessSuspensionReason.DISMISSAL,
              suspendedById: actorId,
            },
          });
          await tx.token.deleteMany({ where: { userId: jaExiste.userId } });
        }
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        throw new Error(
          "Na filial da nova função já existe outra pessoa com esta matrícula: confira. Nada mudou.",
        );
      }
      throw err;
    }
    if (funcao && Object.keys(cbo).length > 0) {
      const atual = cboDaFuncao.get(funcao) ?? { cbo2002: null, cbo94: null };
      cboDaFuncao.set(funcao, { ...atual, ...cbo });
    }
    const desligou = campos.has("rescisao");
    await writeAudit({
      organizationId: orgId,
      actorId,
      action: desligou ? "employee_profile.dismiss" : "employee_profile.update",
      entityType: "EmployeeProfile",
      entityId: jaExiste.id,
      after: { via: "import", confirmed: [...campos], ...(campos.has("rescisao") ? { dismissedAt: rescisao } : {}) },
    });
    return [...campos];
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
          select: {
            id: true,
            name: true,
            cbo2002: true,
            cbo94: true,
            sector: { select: { establishmentId: true } },
          },
        }),
        prisma.contractor.findMany({
          where: { organizationId: orgId, archivedAt: null },
          select: { id: true },
        }),
      ]);
      const funcaoValida = new Set(funcoes.map((f) => f.id));
      /*
        CBO de cada função como está agora, e como fica depois desta
        planilha: a primeira linha que traz o CBO de uma função sem CBO
        preenche; as seguintes já o encontram. [PF-2]
      */
      const cboDaFuncao = new Map(
        funcoes.map((f) => [f.id, { cbo2002: f.cbo2002, cbo94: f.cbo94 }]),
      );
      const preencherCbo = async (
        jobRoleId: string | null,
        cbo2002: string | null,
        cbo94: string | null,
      ): Promise<string[]> => {
        if (!jobRoleId) return [];
        const atual = cboDaFuncao.get(jobRoleId);
        if (!atual) return [];
        const dados: { cbo2002?: string; cbo94?: string } = {};
        if (!atual.cbo2002 && cbo2002) dados.cbo2002 = cbo2002;
        if (!atual.cbo94 && cbo94) dados.cbo94 = cbo94;
        const feitos = Object.keys(dados).map((k) => (k === "cbo2002" ? "CBO 2002 da função" : "CBO 94 da função"));
        if (feitos.length === 0) return [];
        cboDaFuncao.set(jobRoleId, { ...atual, ...dados });
        if (!simulacao) {
          await prisma.jobRole.update({ where: { id: jobRoleId }, data: dados });
          await writeAudit({
            organizationId: orgId,
            actorId: actor.userId,
            action: "job_role.update",
            entityType: "JobRole",
            entityId: jobRoleId,
            after: { via: "import", ...dados },
          });
        }
        return feitos;
      };
      /* Filial de cada função: a ficha nasce na filial da função. [C3-2] */
      const filialDaFuncao = new Map(funcoes.map((f) => [f.id, f.sector.establishmentId]));
      const nomeDaFuncao = new Map(funcoes.map((f) => [f.id, f.name]));
      const filiaisAtivas = await prisma.establishment.findMany({
        where: { organizationId: orgId, archivedAt: null },
        select: { id: true, name: true },
      });
      const filialValida = new Set(filiaisAtivas.map((f) => f.id));
      const nomeDaFilial = new Map(filiaisAtivas.map((f) => [f.id, f.name]));
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
          establishment: null,
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
          if (matricula && !matriculaNoPadrao(matricula)) throw new Error(MATRICULA_FORA_DO_PADRAO);
          const email = texto(linha.email)?.toLowerCase() ?? null;
          const jobRoleId = texto(linha.job_role_id);
          const admittedAt = dataDeCalendario(linha.admitted_at, "Data de admissão");
          const birthDate = parseBirthDate(linha.birth_date);
          /* Aviso, não bloqueio: a idade fora de 14 a 100 anos pede conferência. [C4-8] */
          const aviso = avisoDeIdade(birthDate);
          const daFolha = soPreenchidos(lerDadosDaFolha(linha.payroll));
          const cbo2002 = texto(linha.job_role_cbo2002);
          const cbo94 = texto(linha.job_role_cbo94);
          for (const [rotulo, cbo] of [["CBO 2002", cbo2002], ["CBO 94", cbo94]] as const) {
            if (cbo && !CBO.test(cbo)) throw new Error(`${rotulo} inválido: use os números do código, como 5211-25.`);
          }

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
            duas, a única da empresa, se houver uma só. [C3-2]

            Com mais de uma filial, a linha precisa dizer qual: a filial é o
            que separa a matrícula 153 da loja da 153 da AG. A função já diz
            a dela; sem função, a coluna é obrigatória. A tela pede a coluna
            em toda linha. [C3-3]
          */
          const filialInformada = texto(linha.establishment_id);
          if (!filialInformada && !jobRoleId && filiaisAtivas.length > 1) {
            throw new Error("Informe a filial da linha: a empresa tem mais de uma.");
          }
          if (filialInformada && !filialValida.has(filialInformada)) {
            throw new Error("Filial não existe nesta empresa.");
          }
          if (jobRoleId && filialInformada && filialDaFuncao.get(jobRoleId) !== filialInformada) {
            throw new Error("A função escolhida é de outra filial.");
          }
          const filial = jobRoleId
            ? filialDaFuncao.get(jobRoleId) ?? null
            : filialInformada ?? filialUnica;
          registro.establishment = filial
            ? { id: filial, name: nomeDaFilial.get(filial) ?? "" }
            : null;
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
            userId: true,
            dismissedAt: true,
            user: { select: { name: true, login: true } },
            payrollData: true,
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
          /*
            CPF e matrícula dizem quem é a pessoa, e a planilha nunca os troca.
            Se apontam para pessoas diferentes, ou se a pessoa achada tem outro
            CPF ou outra matrícula no portal, a linha vai para o RH conferir e
            nada muda. [PF-3]
          */
          if (porCpf && porMatricula && porCpf.id !== porMatricula.id) {
            throw new Error(
              `O CPF é de ${porCpf.user.name} e a matrícula é de ${porMatricula.user.name}: confira a planilha. Nada mudou.`,
            );
          }
          const jaExiste = porCpf ?? porMatricula ?? porEmail;
          if (jaExiste && taxId && jaExiste.taxId && jaExiste.taxId !== taxId) {
            throw new Error(
              `${jaExiste.user.name} tem outro CPF no portal: confira a planilha. Nada mudou.`,
            );
          }
          if (
            jaExiste &&
            matricula &&
            jaExiste.registration &&
            canonicalRegistration(jaExiste.registration) !== canonicalRegistration(matricula)
          ) {
            throw new Error(
              `${jaExiste.user.name} tem a matrícula ${jaExiste.registration} no portal, e a planilha diz ${matricula}: confira. Nada mudou.`,
            );
          }
          if (jaExiste) {
            const completado = await this.completarFicha({
              orgId,
              profileId: jaExiste.id,
              atual: jaExiste,
              daPlanilha: { taxId, matricula, establishmentId: filial, jobRoleId, admittedAt, birthDate },
              simulacao,
            });
            const folha = await this.aplicarDadosDaFolha({
              orgId,
              profileId: jaExiste.id,
              atual: jaExiste.payrollData as Record<string, unknown> | null,
              novos: daFolha,
              simulacao,
              actorId: actor.userId,
            });
            /* O CBO é do cargo da planilha; sem cargo na linha, da função que a pessoa tem. */
            const cboFeito = await preencherCbo(jobRoleId ?? jaExiste.jobRoleId, cbo2002, cbo94);
            const divergencias = this.divergencias({
              jaExiste,
              linha: { nome, birthDate, admittedAt, jobRoleId, cbo2002, cbo94 },
              daFolha,
              nomeDaFuncao,
              cboDaFuncao,
            });
            const aceitar = new Set(
              Array.isArray(linha.aceitar) ? linha.aceitar.filter((c): c is string => typeof c === "string") : [],
            );
            const confirmados = await this.aplicarConfirmados({
              orgId,
              actorId: actor.userId,
              jaExiste,
              aceitas: divergencias.filter((d) => aceitar.has(d.campo)),
              linha: { nome, birthDate, admittedAt, jobRoleId, cbo2002, cbo94 },
              daFolha,
              simulacao,
              cboDaFuncao,
            });
            const pendentes = divergencias.filter((d) => !confirmados.includes(d.campo));
            if (pendentes.length > 0) registro.divergences = pendentes;
            registro.login = jaExiste.user.login;
            const tudo = [
              ...confirmados.map((c) => `${ROTULO_DA_DIVERGENCIA[c as Divergencia["campo"]]} (confirmado pelo RH)`),
              ...completado,
              ...(folha.mudou.length > 0 ? [`dados da folha (${folha.mudou.join(", ")})`] : []),
              ...cboFeito,
            ];
            if (tudo.length > 0) {
              registro.status = "completed";
              registro.filled = tudo;
              registro.message = `Já estava no portal; a planilha completou: ${tudo.join(", ")}.`;
            } else {
              registro.status = "skipped";
              registro.message =
                pendentes.length > 0
                  ? `Já cadastrado (${jaExiste.user.name}); a planilha traz ${pendentes.length === 1 ? "um dado diferente" : `${pendentes.length} dados diferentes`} do portal.`
                  : `Já cadastrado (${jaExiste.user.name}); nada a completar.`;
            }
            if (aviso) registro.message += ` ${aviso}`;
            if (folha.antiga) {
              const [a, m] = folha.antiga.split("-");
              registro.message += ` Os dados da folha do portal são de ${m}/${a}, mais novos que os desta planilha: ficaram como estavam.`;
            }
            if (!simulacao && folha.mudou.length > 0) {
              /* A trilha diz o que mudou e de que folha, sem os valores. */
              await writeAudit({
                organizationId: orgId,
                actorId: actor.userId,
                action: "employee_payroll_data.update",
                entityType: "EmployeeProfile",
                entityId: jaExiste.id,
                after: { via: "import", fields: folha.mudou, competence: daFolha.competence ?? null },
              });
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

          await preencherCbo(jobRoleId, cbo2002, cbo94);
          if (simulacao) {
            registro.status = "created";
            registro.login = await allocateUniqueLogin(base, prisma);
            registro.message = aviso ? `Pronto para entrar. ${aviso}` : "Pronto para entrar.";
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
            const ficha = await tx.employeeProfile.create({
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
            if (Object.keys(daFolha).length > 0) {
              await tx.employeePayrollData.create({
                data: { organizationId: orgId, profileId: ficha.id, ...daFolha, updatedById: actor.userId },
              });
            }
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
          if (aviso) registro.message += ` ${aviso}`;
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
              err instanceof DadoDaFolhaInvalido || err instanceof Error
                ? err.message
                : "Não foi possível importar esta linha.";
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

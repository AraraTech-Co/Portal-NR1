import { Prisma } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import type { AuthRequest } from "../types/auth";

/**
 * Histórico sem unidade: a central classifica, a partir da ficha. [C3-7]
 *
 * Os registros individuais anteriores à unidade gravada (C2-13) ficam com
 * `establishmentId` nulo, e só a central os vê. Esta tela lista esses
 * registros com uma PROPOSTA de unidade (a filial da ficha ativa da pessoa
 * hoje), e o RH confirma ou corrige. Só a coluna da unidade é gravada, com
 * trilha por registro.
 *
 * A guarda é a da rota: o módulo "conta" com escrita, que a matriz dá a
 * Master, Dono e RH, exatamente a central.
 *
 * Só registro AINDA sem unidade é classificado: o que já tem unidade não é
 * reclassificado aqui, nem por corrida entre duas pessoas classificando ao
 * mesmo tempo (o `updateMany` exige a unidade nula).
 */

export const TIPOS = ["holerite", "ferias", "ponto", "atestado", "documento_rh", "exame", "certificado"] as const;
export type Tipo = (typeof TIPOS)[number];

const POR_PAGINA = 200;
const MAX_LOTE = 200;

const PAYSLIP_KIND: Record<string, string> = {
  MONTHLY: "mensal",
  ADVANCE: "de adiantamento",
  VACATION: "de férias",
  THIRTEENTH: "de 13º salário",
  TERMINATION: "de rescisão",
};
const LEAVE_KIND: Record<string, string> = { VACATION: "Férias", LEAVE: "Licença", DAY_OFF: "Folga" };
const EXAM_KIND: Record<string, string> = {
  ADMISSIONAL: "admissional",
  PERIODIC: "periódico",
  RETURN_TO_WORK: "de retorno ao trabalho",
  ROLE_CHANGE: "de mudança de função",
  DISMISSAL: "demissional",
};
const HR_KIND: Record<string, string> = {
  CONTRACT: "Contrato",
  WARNING: "Advertência",
  NOTICE: "Comunicado",
  RECEIPT: "Recibo",
  TERM: "Termo",
  OTHER: "Documento",
};

/** dd/mm/aaaa do dia gravado (as datas de calendário são meia-noite UTC). */
function dia(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

/**
 * Uma linha da lista. A descrição é neutra: tipo e data. A data também
 * separa os registros iguais da mesma pessoa (dois certificados "CNH D"). Nada de CID,
 * motivo, nota ou arquivo — quem classifica escolhe a unidade, não lê o
 * conteúdo.
 */
type Linha = { id: string; userId: string; userName: string; data: Date; descricao: string };

type Db = Prisma.TransactionClient | typeof prisma;

type Definicao = {
  /** O nome do modelo na trilha. */
  entidade: string;
  contar: (orgId: string) => Promise<number>;
  listar: (orgId: string, offset: number) => Promise<Linha[]>;
  /** Dono dos registros pedidos, entre os ainda sem unidade da empresa. */
  donos: (db: Db, orgId: string, ids: string[]) => Promise<Map<string, string>>;
  /** Grava a unidade só se o registro é da empresa e ainda não tem unidade. */
  gravar: (db: Db, orgId: string, id: string, unidade: string) => Promise<number>;
};

const usuario = { select: { id: true, name: true } } as const;
const pagina = (offset: number) => ({ skip: offset, take: POR_PAGINA });
const semUnidade = (orgId: string) => ({ organizationId: orgId, establishmentId: null });
/** Só o documento pessoal: o geral é da empresa inteira e não tem unidade. */
const docPessoal = (orgId: string) => ({ ...semUnidade(orgId), targetUserId: { not: null } });

const mapa = (linhas: { id: string; userId: string | null }[]) =>
  new Map(linhas.filter((l) => l.userId).map((l) => [l.id, l.userId as string]));

const DEF: Record<Tipo, Definicao> = {
  holerite: {
    entidade: "Payslip",
    contar: (orgId) => prisma.payslip.count({ where: semUnidade(orgId) }),
    listar: async (orgId, offset) =>
      (
        await prisma.payslip.findMany({
          where: semUnidade(orgId),
          orderBy: [{ referenceYear: "desc" }, { referenceMonth: "desc" }, { id: "asc" }],
          ...pagina(offset),
          select: { id: true, kind: true, referenceMonth: true, referenceYear: true, user: usuario },
        })
      ).map((r) => ({
        id: r.id,
        userId: r.user.id,
        userName: r.user.name,
        data: new Date(Date.UTC(r.referenceYear, r.referenceMonth - 1, 1)),
        descricao: `Holerite ${PAYSLIP_KIND[r.kind] ?? ""} de ${String(r.referenceMonth).padStart(2, "0")}/${r.referenceYear}`,
      })),
    donos: async (db, orgId, ids) =>
      mapa(await db.payslip.findMany({ where: { ...semUnidade(orgId), id: { in: ids } }, select: { id: true, userId: true } })),
    gravar: async (db, orgId, id, unidade) =>
      (await db.payslip.updateMany({ where: { ...semUnidade(orgId), id }, data: { establishmentId: unidade } })).count,
  },
  ferias: {
    entidade: "LeaveRequest",
    contar: (orgId) => prisma.leaveRequest.count({ where: semUnidade(orgId) }),
    listar: async (orgId, offset) =>
      (
        await prisma.leaveRequest.findMany({
          where: semUnidade(orgId),
          orderBy: [{ startDate: "desc" }, { id: "asc" }],
          ...pagina(offset),
          select: { id: true, kind: true, startDate: true, endDate: true, user: usuario },
        })
      ).map((r) => ({
        id: r.id,
        userId: r.user.id,
        userName: r.user.name,
        data: r.startDate,
        descricao: `${LEAVE_KIND[r.kind] ?? "Afastamento"} de ${dia(r.startDate)} a ${dia(r.endDate)}`,
      })),
    donos: async (db, orgId, ids) =>
      mapa(await db.leaveRequest.findMany({ where: { ...semUnidade(orgId), id: { in: ids } }, select: { id: true, userId: true } })),
    gravar: async (db, orgId, id, unidade) =>
      (await db.leaveRequest.updateMany({ where: { ...semUnidade(orgId), id }, data: { establishmentId: unidade } })).count,
  },
  ponto: {
    entidade: "TimeEntry",
    contar: (orgId) => prisma.timeEntry.count({ where: semUnidade(orgId) }),
    listar: async (orgId, offset) =>
      (
        await prisma.timeEntry.findMany({
          where: semUnidade(orgId),
          orderBy: [{ day: "desc" }, { id: "asc" }],
          ...pagina(offset),
          select: { id: true, day: true, user: usuario },
        })
      ).map((r) => ({
        id: r.id,
        userId: r.user.id,
        userName: r.user.name,
        data: r.day,
        descricao: `Ponto de ${dia(r.day)}`,
      })),
    donos: async (db, orgId, ids) =>
      mapa(await db.timeEntry.findMany({ where: { ...semUnidade(orgId), id: { in: ids } }, select: { id: true, userId: true } })),
    gravar: async (db, orgId, id, unidade) =>
      (await db.timeEntry.updateMany({ where: { ...semUnidade(orgId), id }, data: { establishmentId: unidade } })).count,
  },
  atestado: {
    entidade: "MedicalCertificate",
    contar: (orgId) => prisma.medicalCertificate.count({ where: semUnidade(orgId) }),
    listar: async (orgId, offset) =>
      (
        await prisma.medicalCertificate.findMany({
          where: semUnidade(orgId),
          orderBy: [{ startDate: "desc" }, { id: "asc" }],
          ...pagina(offset),
          /* Sem CID e sem motivo: dado de saúde. */
          select: { id: true, startDate: true, user: usuario },
        })
      ).map((r) => ({
        id: r.id,
        userId: r.user.id,
        userName: r.user.name,
        data: r.startDate,
        descricao: `Atestado de ${dia(r.startDate)}`,
      })),
    donos: async (db, orgId, ids) =>
      mapa(
        await db.medicalCertificate.findMany({ where: { ...semUnidade(orgId), id: { in: ids } }, select: { id: true, userId: true } }),
      ),
    gravar: async (db, orgId, id, unidade) =>
      (await db.medicalCertificate.updateMany({ where: { ...semUnidade(orgId), id }, data: { establishmentId: unidade } }))
        .count,
  },
  documento_rh: {
    entidade: "HrDocument",
    contar: (orgId) => prisma.hrDocument.count({ where: docPessoal(orgId) }),
    listar: async (orgId, offset) =>
      (
        await prisma.hrDocument.findMany({
          where: docPessoal(orgId),
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          ...pagina(offset),
          select: { id: true, kind: true, title: true, createdAt: true, target: usuario },
        })
      ).map((r) => ({
        id: r.id,
        userId: r.target!.id,
        userName: r.target!.name,
        data: r.createdAt,
        descricao: `${HR_KIND[r.kind] ?? "Documento"}: ${r.title}, de ${dia(r.createdAt)}`,
      })),
    donos: async (db, orgId, ids) =>
      mapa(
        (
          await db.hrDocument.findMany({
            where: { ...docPessoal(orgId), id: { in: ids } },
            select: { id: true, targetUserId: true },
          })
        ).map((r) => ({ id: r.id, userId: r.targetUserId })),
      ),
    gravar: async (db, orgId, id, unidade) =>
      (await db.hrDocument.updateMany({ where: { ...docPessoal(orgId), id }, data: { establishmentId: unidade } })).count,
  },
  exame: {
    entidade: "OccupationalExam",
    contar: (orgId) => prisma.occupationalExam.count({ where: semUnidade(orgId) }),
    listar: async (orgId, offset) =>
      (
        await prisma.occupationalExam.findMany({
          where: semUnidade(orgId),
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          ...pagina(offset),
          select: { id: true, kind: true, performedAt: true, dueAt: true, createdAt: true, user: usuario },
        })
      ).map((r) => {
        const quando = r.performedAt ?? r.dueAt;
        return {
          id: r.id,
          userId: r.user.id,
          userName: r.user.name,
          data: quando ?? r.createdAt,
          descricao: `Exame ${EXAM_KIND[r.kind] ?? ""}${quando ? ` de ${dia(quando)}` : ""}`,
        };
      }),
    donos: async (db, orgId, ids) =>
      mapa(
        await db.occupationalExam.findMany({ where: { ...semUnidade(orgId), id: { in: ids } }, select: { id: true, userId: true } }),
      ),
    gravar: async (db, orgId, id, unidade) =>
      (await db.occupationalExam.updateMany({ where: { ...semUnidade(orgId), id }, data: { establishmentId: unidade } }))
        .count,
  },
  certificado: {
    entidade: "WorkerCertificate",
    contar: (orgId) => prisma.workerCertificate.count({ where: semUnidade(orgId) }),
    listar: async (orgId, offset) =>
      (
        await prisma.workerCertificate.findMany({
          where: semUnidade(orgId),
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          ...pagina(offset),
          select: { id: true, name: true, issuedAt: true, createdAt: true, user: usuario },
        })
      ).map((r) => ({
        id: r.id,
        userId: r.user.id,
        userName: r.user.name,
        data: r.issuedAt ?? r.createdAt,
        descricao: `Certificado: ${r.name}, ${r.issuedAt ? `emitido em ${dia(r.issuedAt)}` : `enviado em ${dia(r.createdAt)}`}`,
      })),
    donos: async (db, orgId, ids) =>
      mapa(
        await db.workerCertificate.findMany({ where: { ...semUnidade(orgId), id: { in: ids } }, select: { id: true, userId: true } }),
      ),
    gravar: async (db, orgId, id, unidade) =>
      (await db.workerCertificate.updateMany({ where: { ...semUnidade(orgId), id }, data: { establishmentId: unidade } }))
        .count,
  },
};

function ehTipo(valor: unknown): valor is Tipo {
  return typeof valor === "string" && (TIPOS as readonly string[]).includes(valor);
}

/**
 * A proposta de cada pessoa: a filial da ficha ativa, se a filial é da
 * empresa e não está arquivada. A mesma regra de `currentUnitOf`, que grava
 * a unidade na criação, em uma consulta só.
 */
async function propostas(db: Db, orgId: string, userIds: string[]): Promise<Map<string, string>> {
  if (!userIds.length) return new Map();
  const fichas = await db.employeeProfile.findMany({
    where: { organizationId: orgId, userId: { in: [...new Set(userIds)] }, dismissedAt: null },
    select: { userId: true, establishment: { select: { id: true, organizationId: true, archivedAt: true } } },
  });
  const saida = new Map<string, string>();
  for (const f of fichas) {
    const u = f.establishment;
    if (u && u.organizationId === orgId && !u.archivedAt) saida.set(f.userId, u.id);
  }
  return saida;
}

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

class HistoricoSemUnidadeController {
  async list(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const tipo = req.query.tipo ?? "holerite";
      if (!ehTipo(tipo)) {
        res.status(400).json({ message: "Tipo de registro inválido." });
        return;
      }
      const offset = Math.max(0, Math.floor(Number(req.query.offset) || 0));

      const [contagens, linhas, unidades] = await Promise.all([
        Promise.all(TIPOS.map((t) => DEF[t].contar(orgId))),
        DEF[tipo].listar(orgId, offset),
        prisma.establishment.findMany({
          where: { organizationId: orgId, archivedAt: null },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
      ]);
      const proposta = await propostas(
        prisma,
        orgId,
        linhas.map((l) => l.userId),
      );
      const nomeDa = new Map(unidades.map((u) => [u.id, u.name]));

      res.json({
        tipo,
        totais: Object.fromEntries(TIPOS.map((t, i) => [t, contagens[i]])),
        itens: linhas.map((l) => {
          const unidade = proposta.get(l.userId) ?? null;
          return {
            id: l.id,
            pessoa: { id: l.userId, nome: l.userName },
            descricao: l.descricao,
            data: l.data.toISOString(),
            proposta: unidade ? { id: unidade, name: nomeDa.get(unidade) ?? "" } : null,
          };
        }),
        unidades,
        por_pagina: POR_PAGINA,
        offset,
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async classify(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const actorId = actorUserId(auth);
      const { tipo, itens } = (req.body ?? {}) as { tipo?: unknown; itens?: unknown };
      if (!ehTipo(tipo)) {
        res.status(400).json({ message: "Tipo de registro inválido." });
        return;
      }
      if (
        !Array.isArray(itens) ||
        itens.length === 0 ||
        itens.length > MAX_LOTE ||
        itens.some(
          (i) =>
            !i ||
            typeof (i as { id?: unknown }).id !== "string" ||
            typeof (i as { establishment_id?: unknown }).establishment_id !== "string",
        )
      ) {
        res.status(400).json({ message: `Informe de 1 a ${MAX_LOTE} registros, cada um com a unidade.` });
        return;
      }
      const pedidos = (itens as { id: string; establishment_id: string }[]).map((i) => ({
        id: i.id,
        unidade: i.establishment_id,
      }));
      if (new Set(pedidos.map((p) => p.id)).size !== pedidos.length) {
        res.status(400).json({ message: "Um registro aparece mais de uma vez." });
        return;
      }

      /* Unidade de outra empresa, arquivada ou inexistente: a mesma resposta. */
      const unidadesPedidas = [...new Set(pedidos.map((p) => p.unidade))];
      const validas = await prisma.establishment.count({
        where: { id: { in: unidadesPedidas }, organizationId: orgId, archivedAt: null },
      });
      if (validas !== unidadesPedidas.length) {
        res.status(400).json({ message: "Unidade inválida." });
        return;
      }

      const def = DEF[tipo];
      const resultado = await prisma.$transaction(
        async (tx) => {
          const donos = await def.donos(
            tx,
            orgId,
            pedidos.map((p) => p.id),
          );
          const proposta = await propostas(tx, orgId, [...donos.values()]);
          const classificados: string[] = [];
          const ignorados: string[] = [];
          const trilha: Prisma.AuditEventCreateManyInput[] = [];
          for (const p of pedidos) {
            const gravou = await def.gravar(tx, orgId, p.id, p.unidade);
            if (gravou !== 1) {
              ignorados.push(p.id);
              continue;
            }
            classificados.push(p.id);
            const sugerida = proposta.get(donos.get(p.id) ?? "") ?? null;
            trilha.push({
              organizationId: orgId,
              actorId,
              action: "history.classify",
              entityType: def.entidade,
              entityId: p.id,
              before: { establishmentId: null },
              after: { establishmentId: p.unidade },
              context: { tipo, proposta: sugerida, conforme_proposta: sugerida === p.unidade },
            });
          }
          if (trilha.length) await tx.auditEvent.createMany({ data: trilha });
          return { classificados: classificados.length, ignorados };
        },
        { timeout: 30_000 },
      );

      res.json(resultado);
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new HistoricoSemUnidadeController();

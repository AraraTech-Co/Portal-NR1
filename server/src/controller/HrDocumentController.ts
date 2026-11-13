import fs from "fs";
import { Request, Response } from "express";
import { NotificationKind, Prisma } from "@prisma/client";
import prisma from "../model/prisma";
import { HrDocument } from "../model/schema/HrDocument/HrDocument";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { notify } from "../helper/notify";
import {
  currentUnitOf,
  managesPerson,
  profileScope,
  scopeOfRequest,
  type UnitScope,
} from "../helper/unit-scope";
import {
  canChangePersonnelRecord,
  canManageModule,
  isReadOnlyRole,
} from "../helper/module-access";
import {
  assertSize,
  buildPrivateStoragePath,
  resolveStoragePath,
  writeEvidenceFile,
} from "../helper/uploads";
import {
  HR_DOCUMENT_KIND_DEFAULT,
  HR_DOCUMENT_KIND_VALUES,
  isHrDocumentKind,
} from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function blank(v?: string | null) {
  return v && v.trim() !== "" ? v.trim() : null;
}

function isRh(req: AuthRequest): boolean {
  return Boolean(req.actor && canManageModule(req.actor.permission, "documentos_rh"));
}

/**
 * A consulta (fiscal) vê os documentos GERAIS — onde fica a ordem de serviço
 * de segurança — e quem deu ciência. Documento de uma pessoa (contrato,
 * advertência) não é assunto dela. [S7-A]
 */
function isAuditor(req: AuthRequest): boolean {
  return Boolean(req.actor && isReadOnlyRole(req.actor.permission));
}

/**
 * Quem baixa o arquivo (decisão do Léo, 12/11): a pessoa a quem o documento
 * se destina e o RH, com Master e Dono. Documento geral se destina a todos.
 * A consulta (fiscal) vê o documento geral e quem deu ciência, mas não é
 * destinatária: não baixa (hoje o módulo nem abre para ela; a regra fica
 * aqui para quando abrir). Documento pessoal só sai para RH, Master e Dono —
 * a gerência que vê a linha não leva o arquivo. O alcance da ficha é
 * conferido antes, por quem chama: a lista só traz o que se alcança e o
 * download responde "não encontrado" fora dele.
 */
function podeBaixar(auth: AuthRequest, doc: { targetUserId: string | null }): boolean {
  if (isAuditor(auth)) return false;
  const userId = actorUserId(auth);
  if (doc.targetUserId === null || doc.targetUserId === userId) return true;
  return Boolean(auth.actor && canChangePersonnelRecord(auth.actor.permission));
}

/**
 * Quem vê o documento — a mesma regra na lista, no detalhe, no download e
 * na ciência. Há três destinos: a empresa (sem pessoa e sem filial), uma
 * filial (sem pessoa, com a filial) e uma pessoa. [Item 10, 13/11]
 *
 * - O RH, o Master e o Dono, que veem a empresa inteira: todos.
 * - O RH com recorte (ADM loja): os gerais que alcança, os seus e os
 *   registros das filiais que gere. [C2-13]
 * - A gestão central sem o módulo de pessoal (SST) e a consulta: todo
 *   geral, de qualquer filial — a fiscalização pede o que cada filial recebeu.
 * - Os demais: o geral da empresa, o da filial onde trabalham ou que geram,
 *   os seus, e o geral de outra filial que já abriram ou em que deram ciência
 *   — a leitura é a prova do recebimento e não some quando a pessoa muda de
 *   filial.
 */
function documentosVisiveis(auth: AuthRequest, escopo: UnitScope): Prisma.HrDocumentWhereInput {
  const userId = actorUserId(auth);
  if (isAuditor(auth)) return { targetUserId: null };
  if (isRh(auth) && escopo.wholeOrg) return {};
  if (escopo.wholeOrg) return { OR: [{ targetUserId: null }, { targetUserId: userId }] };
  const unidades = [...new Set([...(escopo.work ? [escopo.work] : []), ...escopo.managed])];
  const visiveis: Prisma.HrDocumentWhereInput[] = [
    { targetUserId: null, establishmentId: null },
    ...(unidades.length ? [{ targetUserId: null, establishmentId: { in: unidades } }] : []),
    { targetUserId: userId },
    { targetUserId: null, acks: { some: { userId } } },
  ];
  if (isRh(auth) && escopo.managed.length) {
    visiveis.push({ establishmentId: { in: escopo.managed } });
  }
  return { OR: visiveis };
}

/**
 * A pessoa RECEBE o documento: é dela, é da empresa inteira, ou é da filial
 * onde ela trabalha. Ver não basta — quem gere a filial, a central e quem já
 * saiu da filial veem o documento sem ser destinatários. A ciência é prova
 * de recebimento: a lista (`can_ack`) e a rota de ciência usam esta mesma
 * regra.
 */
function recebe(
  auth: AuthRequest,
  escopo: UnitScope,
  doc: { targetUserId: string | null; establishmentId: string | null },
): boolean {
  if (isAuditor(auth)) return false;
  if (doc.targetUserId !== null) return doc.targetUserId === actorUserId(auth);
  return doc.establishmentId === null || doc.establishmentId === escopo.work;
}

/** O tipo do arquivo pelo conteúdo, não pelo que o navegador declara. */
function tipoPeloConteudo(data: Buffer): string | null {
  if (data.length >= 4 && data.subarray(0, 4).toString("latin1") === "%PDF") return "application/pdf";
  if (data.length >= 4 && data[0] === 0x89 && data.subarray(1, 4).toString("latin1") === "PNG") return "image/png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return "image/jpeg";
  return null;
}

class HrDocumentController {
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const kind = req.query.kind as string | undefined;
      const escopo = await scopeOfRequest(auth);

      const rows = await prisma.hrDocument.findMany({
        where: {
          organizationId: orgId,
          ...(kind && isHrDocumentKind(kind) ? { kind } : {}),
          AND: [documentosVisiveis(auth, escopo)],
        },
        orderBy: { createdAt: "desc" },
        /* O caminho interno do arquivo não sai do servidor. [C2-13] */
        omit: { storagePath: true },
        include: {
          publishedBy: { select: { id: true, name: true } },
          target: { select: { id: true, name: true } },
          /* O destino "uma filial" mostra qual. */
          establishment: { select: { id: true, name: true } },
          acks: {
            where: { userId },
            select: { readAt: true, acknowledgedAt: true },
          },
          _count: { select: { acks: true } },
        },
      });

      res.json({
        documents: rows.map((d) => ({
          ...d,
          my_ack: d.acks[0] ?? null,
          acks: undefined,
          /* A tela mostra "Baixar" só onde o arquivo sai. */
          can_download: podeBaixar(auth, d),
          /*
            "Dar ciência" só para quem recebe: o documento é dela, da
            empresa inteira ou da filial onde ela trabalha.
          */
          can_ack: d.requiresAck && recebe(auth, escopo, d),
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async get(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const escopo = await scopeOfRequest(auth);
      const doc = await prisma.hrDocument.findFirst({
        where: { id: req.params.id, organizationId: orgId, AND: [documentosVisiveis(auth, escopo)] },
        omit: { storagePath: true },
        include: {
          publishedBy: { select: { id: true, name: true } },
          target: { select: { id: true, name: true } },
          acks: isRh(auth) || isAuditor(auth)
            ? {
                /* A ciência de quem está fora das unidades geridas não aparece. [C2-13] */
                ...(escopo.wholeOrg
                  ? {}
                  : {
                      where: {
                        user: { employeeProfiles: { some: { organizationId: orgId, ...profileScope(escopo) } } },
                      },
                    }),
                include: {
                  user: { select: { id: true, name: true } },
                },
              }
            : { where: { userId } },
        },
      });
      /* Fora do alcance responde como inexistente. [C2-13] */
      if (!doc) {
        res.status(404).json({ message: "Documento não encontrado." });
        return;
      }

      // A consulta só olha: não deixa marca de leitura em nome de ninguém.
      if (isAuditor(auth)) {
        res.json({ document: doc });
        return;
      }

      // Marca leitura ao abrir.
      await prisma.hrDocumentAck.upsert({
        where: {
          documentId_userId: { documentId: doc.id, userId },
        },
        create: { documentId: doc.id, userId },
        update: {},
      });

      res.json({ document: doc });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * O arquivo do documento. Pessoal fora do alcance responde como
   * inexistente, como na leitura [C2-13]; visível e sem direito ao arquivo,
   * diz quem baixa. Quem não é o destinatário e baixa um documento pessoal
   * fica na auditoria.
   */
  async download(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const escopo = await scopeOfRequest(auth);
      const doc = await prisma.hrDocument.findFirst({
        where: { id: req.params.id, organizationId: orgId, AND: [documentosVisiveis(auth, escopo)] },
        select: {
          id: true,
          targetUserId: true,
          establishmentId: true,
          storagePath: true,
          fileName: true,
        },
      });
      const deOutraPessoa = Boolean(doc && doc.targetUserId !== null && doc.targetUserId !== userId);
      if (!doc) {
        res.status(404).json({ message: "Documento não encontrado." });
        return;
      }
      if (!podeBaixar(auth, doc)) {
        res.status(403).json({
          message: "O arquivo sai só para a pessoa a quem o documento se destina e para o RH.",
        });
        return;
      }
      const abs = resolveStoragePath(doc.storagePath);
      if (!fs.existsSync(abs)) {
        res.status(404).json({ message: "Arquivo não encontrado." });
        return;
      }
      if (deOutraPessoa) {
        await writeAudit({
          organizationId: orgId,
          actorId: userId,
          action: "hr_document.download",
          entityType: "HrDocument",
          entityId: doc.id,
        });
      } else {
        /* Baixar é ler: a pessoa fica com a leitura marcada, como ao abrir. */
        await prisma.hrDocumentAck.upsert({
          where: { documentId_userId: { documentId: doc.id, userId } },
          create: { documentId: doc.id, userId },
          update: {},
        });
      }
      res.download(abs, doc.fileName);
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Publica para uma pessoa, uma filial ou a empresa inteira. [Item 10, 13/11]
   *
   * - Pessoal e de toda a empresa: só RH, Master e Dono. O ADM loja publica
   *   só o geral de uma filial que gere — o "geral" sem filial chegaria a
   *   todas as filiais, o alcance mais largo para quem tem o mais estreito.
   * - O arquivo é obrigatório e o tipo é conferido pelo conteúdo.
   * - Quem recebe é avisado: a pessoa, quem tem ficha ativa na filial ou na
   *   empresa — de uma vez, sem quem publicou.
   */
  async create(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const {
        kind,
        title,
        description,
        requires_ack,
        target_user_id,
        establishment_id,
        file_name,
        content_base64,
      } = req.body as {
        kind?: string;
        title?: string;
        description?: string;
        requires_ack?: boolean;
        target_user_id?: string;
        establishment_id?: string;
        file_name?: string;
        content_base64?: string;
      };

      if (!title?.trim() || !file_name?.trim()) {
        res.status(400).json({ message: "Informe o título e o arquivo do documento." });
        return;
      }

      const resolvedKind = kind
        ? isHrDocumentKind(kind)
          ? kind
          : null
        : HR_DOCUMENT_KIND_DEFAULT;
      if (!resolvedKind) {
        res.status(400).json({
          message: `kind inválido. Use: ${HR_DOCUMENT_KIND_VALUES.join(", ")}.`,
        });
        return;
      }
      if (target_user_id && establishment_id) {
        res.status(400).json({ message: "Escolha uma pessoa ou uma filial, não as duas." });
        return;
      }

      const escopo = await scopeOfRequest(auth);
      const daEmpresaInteira = Boolean(auth.actor && canChangePersonnelRecord(auth.actor.permission));
      if (target_user_id && !daEmpresaInteira) {
        res.status(403).json({ message: "Documento pessoal só o RH, o Master ou o Dono publicam." });
        return;
      }
      if (!target_user_id && !establishment_id && !(daEmpresaInteira && escopo.wholeOrg)) {
        res.status(403).json({
          message: "Escolha a filial: você publica só para as filiais que gere.",
        });
        return;
      }

      if (target_user_id) {
        const m = await prisma.membership.findFirst({
          where: { userId: target_user_id, organizationId: orgId },
        });
        /* Fora da gestão de quem publica responde como destinatário inexistente. [C2-13] */
        if (!m || !(await managesPerson(escopo, target_user_id))) {
          res.status(400).json({ message: "Destinatário inválido." });
          return;
        }
      }
      if (establishment_id) {
        const filial = await prisma.establishment.findFirst({
          where: { id: establishment_id, organizationId: orgId, archivedAt: null },
          select: { id: true },
        });
        if (!filial || !(escopo.wholeOrg || escopo.managed.includes(filial.id))) {
          res.status(400).json({ message: "Filial inválida." });
          return;
        }
      }

      const data = content_base64 ? Buffer.from(content_base64, "base64") : Buffer.alloc(0);
      if (data.length === 0) {
        res.status(400).json({ message: "Anexe o arquivo do documento." });
        return;
      }
      assertSize(data.length);
      /* O tipo declarado pelo navegador não prova nada: vale o conteúdo. */
      const mimeType = tipoPeloConteudo(data);
      if (!mimeType) {
        res.status(400).json({ message: "O arquivo precisa ser PDF, PNG ou JPG." });
        return;
      }
      const { storagePath, absolutePath } = buildPrivateStoragePath(orgId, "hr-documents", mimeType);
      writeEvidenceFile(absolutePath, data);

      const document = await new HrDocument().create.new({
        organizationId: orgId,
        kind: resolvedKind,
        title: title.trim(),
        description: blank(description),
        storagePath,
        fileName: file_name.trim(),
        mimeType,
        sizeBytes: data.length,
        requiresAck: Boolean(requires_ack),
        targetUserId: target_user_id ?? null,
        /*
          Pessoal: a unidade do destinatário quando nasce [C2-13]. Geral de
          uma filial: a filial. Geral da empresa: sem unidade.
        */
        establishmentId: target_user_id
          ? await currentUnitOf(orgId, target_user_id)
          : (establishment_id ?? null),
        publishedById: userId,
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "hr_document.create",
        entityType: "HrDocument",
        entityId: document.id,
      });

      const aviso = {
        organizationId: orgId,
        kind: NotificationKind.HR_DOCUMENT_PUBLISHED,
        title: document.requiresAck ? "Documento do RH para dar ciência" : "Documento novo do RH",
        body: document.title,
        link: "/documentos-rh",
        entityType: "HrDocument",
        entityId: document.id,
      };
      if (target_user_id) {
        if (target_user_id !== userId) await notify({ ...aviso, userId: target_user_id });
      } else {
        try {
          const fichas = await prisma.employeeProfile.findMany({
            where: {
              organizationId: orgId,
              dismissedAt: null,
              userId: { not: userId },
              ...(establishment_id ? { establishmentId: establishment_id } : {}),
              user: { memberships: { some: { organizationId: orgId } } },
            },
            select: { userId: true },
          });
          await prisma.notification.createMany({
            data: [...new Set(fichas.map((f) => f.userId))].map((uid) => ({ ...aviso, userId: uid })),
            skipDuplicates: true,
          });
        } catch {
          /* um aviso que falha não desfaz a publicação */
        }
      }

      const { storagePath: _interno, ...publico } = document;
      res.status(201).json({ document: publico });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Ciência formal quando requiresAck. */
  async acknowledge(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const escopo = await scopeOfRequest(auth);
      const doc = await prisma.hrDocument.findFirst({
        where: {
          id: req.params.id,
          organizationId: orgId,
          AND: [documentosVisiveis(auth, escopo)],
        },
        select: { id: true, targetUserId: true, establishmentId: true, requiresAck: true },
      });
      if (!doc) {
        res.status(404).json({ message: "Documento não encontrado." });
        return;
      }
      /* Ver não é receber: a ciência é só de quem recebe, como o botão. */
      if (!recebe(auth, escopo, doc)) {
        res.status(403).json({ message: "Documento não é para você." });
        return;
      }
      if (!doc.requiresAck) {
        res.status(400).json({
          message: "Este documento não exige ciência formal.",
        });
        return;
      }

      const ack = await prisma.hrDocumentAck.upsert({
        where: {
          documentId_userId: { documentId: doc.id, userId },
        },
        create: {
          documentId: doc.id,
          userId,
          acknowledgedAt: new Date(),
        },
        update: { acknowledgedAt: new Date() },
      });

      res.json({ ack });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new HrDocumentController();

import fs from "fs";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { HrDocument } from "../model/schema/HrDocument/HrDocument";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import {
  currentUnitOf,
  managesPerson,
  managesPersonRecord,
  profileScope,
  scopeOfRequest,
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
          ...(isAuditor(auth)
            ? { targetUserId: null }
            : !isRh(auth)
              ? {
                  OR: [{ targetUserId: null }, { targetUserId: userId }],
                }
              : escopo.wholeOrg
                ? {}
                : /* Pessoal de terceiro: só das unidades geridas. [C2-13] */
                  {
                    OR: [
                      { targetUserId: null },
                      { targetUserId: userId },
                      { establishmentId: { in: escopo.managed } },
                    ],
                  }),
        },
        orderBy: { createdAt: "desc" },
        /* O caminho interno do arquivo não sai do servidor. [C2-13] */
        omit: { storagePath: true },
        include: {
          publishedBy: { select: { id: true, name: true } },
          target: { select: { id: true, name: true } },
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
        where: { id: req.params.id, organizationId: orgId },
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
      if (!doc) {
        res.status(404).json({ message: "Documento não encontrado." });
        return;
      }
      const deOutraPessoa = doc.targetUserId !== null && doc.targetUserId !== userId;
      const alcanca =
        !deOutraPessoa || (isRh(auth) && !isAuditor(auth) && managesPersonRecord(escopo, doc));
      /* Documento pessoal fora do alcance responde como inexistente. [C2-13] */
      if (!alcanca) {
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
        where: { id: req.params.id, organizationId: orgId },
        select: {
          id: true,
          targetUserId: true,
          establishmentId: true,
          storagePath: true,
          fileName: true,
        },
      });
      const deOutraPessoa = Boolean(doc && doc.targetUserId !== null && doc.targetUserId !== userId);
      const ve =
        doc !== null &&
        (!deOutraPessoa || (isRh(auth) && !isAuditor(auth) && managesPersonRecord(escopo, doc)));
      if (!doc || !ve) {
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
        file_name,
        mime_type,
        content_base64,
      } = req.body as {
        kind?: string;
        title?: string;
        description?: string;
        requires_ack?: boolean;
        target_user_id?: string;
        file_name?: string;
        mime_type?: string;
        content_base64?: string;
      };

      if (!title?.trim() || !file_name?.trim() || !mime_type) {
        res.status(400).json({
          message: "Informe title, file_name e mime_type.",
        });
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

      if (target_user_id) {
        const m = await prisma.membership.findFirst({
          where: { userId: target_user_id, organizationId: orgId },
        });
        /* Fora da gestão de quem publica responde como destinatário inexistente. [C2-13] */
        if (!m || !(await managesPerson(await scopeOfRequest(auth), target_user_id))) {
          res.status(400).json({ message: "Destinatário inválido." });
          return;
        }
      }

      const data = content_base64
        ? Buffer.from(content_base64, "base64")
        : Buffer.alloc(0);
      assertSize(data.length || 0);
      const { storagePath, absolutePath } = buildPrivateStoragePath(
        orgId,
        "hr-documents",
        mime_type,
      );
      writeEvidenceFile(absolutePath, data);

      const document = await new HrDocument().create.new({
        organizationId: orgId,
        kind: resolvedKind,
        title: title.trim(),
        description: blank(description),
        storagePath,
        fileName: file_name.trim(),
        mimeType: mime_type,
        sizeBytes: data.length,
        requiresAck: Boolean(requires_ack),
        targetUserId: target_user_id ?? null,
        /* Pessoal: a unidade do destinatário quando nasce. Geral: sem unidade. [C2-13] */
        establishmentId: target_user_id ? await currentUnitOf(orgId, target_user_id) : null,
        publishedById: userId,
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "hr_document.create",
        entityType: "HrDocument",
        entityId: document.id,
      });

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
      const doc = await new HrDocument().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!doc) {
        res.status(404).json({ message: "Documento não encontrado." });
        return;
      }
      if (doc.targetUserId && doc.targetUserId !== userId) {
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

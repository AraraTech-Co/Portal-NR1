import { Prisma } from "@prisma/client";
import fs from "fs";
import { NotificationKind } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Payslip } from "../model/schema/Payslip/Payslip";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { notify } from "../helper/notify";
import { canManageModule } from "../helper/module-access";
import { randomUUID } from "crypto";
import { PDFDocument } from "pdf-lib";
import { checkPayslip, podeJustificar, sameRegistration } from "../helper/payslip-check";
import { splitBatchPages } from "../helper/payslip-batch";
import { extractPdfPages, extractPdfText, MAX_BATCH_PAGES } from "../helper/pdf-text";
import {
  assertSize,
  buildPrivateStoragePath,
  resolveStoragePath,
  writeEvidenceFile,
} from "../helper/uploads";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({
      message: "Já existe holerite para este colaborador neste mês/ano.",
    });
    return;
  }
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

function isRh(req: AuthRequest): boolean {
  return Boolean(req.actor && canManageModule(req.actor.permission, "holerites"));
}

/**
 * Grava um holerite já conferido: arquivo, versão anterior quando é
 * substituição, trilha e aviso à pessoa. O envio individual e a folha em lote
 * passam por aqui, para que publicar de um jeito ou de outro dê o mesmo
 * resultado. [B4-F]
 */
async function gravarHolerite(input: {
  orgId: string;
  publisherId: string;
  userId: string;
  referenceMonth: number;
  referenceYear: number;
  fileName: string;
  mimeType: string;
  data: Buffer;
  overrideReason: string | null;
}) {
  const { storagePath, absolutePath } = buildPrivateStoragePath(
    input.orgId,
    "payslips",
    input.mimeType,
  );
  writeEvidenceFile(absolutePath, input.data);

  const existing = await prisma.payslip.findFirst({
    where: {
      organizationId: input.orgId,
      userId: input.userId,
      referenceMonth: input.referenceMonth,
      referenceYear: input.referenceYear,
    },
  });

  let payslip;
  if (existing) {
    /*
      A versão de antes deixa de ser apagada: ela vira histórico, com o
      arquivo no lugar e a data em que a pessoa a abriu. É o que prova o
      que foi entregue antes da correção. [S5-F]
    */
    payslip = await prisma.$transaction(async (tx) => {
      await tx.payslipVersion.create({
        data: {
          payslipId: existing.id,
          storagePath: existing.storagePath,
          fileName: existing.fileName,
          publishedById: existing.publishedById,
          publishedAt: existing.publishedAt,
          viewedAt: existing.viewedAt,
          replacedById: input.publisherId,
        },
      });
      return tx.payslip.update({
        where: { id: existing.id },
        data: {
          storagePath,
          fileName: input.fileName,
          publishedById: input.publisherId,
          publishedAt: new Date(),
          viewedAt: null,
          overrideReason: input.overrideReason,
          overriddenById: input.overrideReason ? input.publisherId : null,
        },
      });
    });
    await writeAudit({
      organizationId: input.orgId,
      actorId: input.publisherId,
      action: "payslip.replace",
      entityType: "Payslip",
      entityId: payslip.id,
      before: { fileName: existing.fileName, viewedAt: existing.viewedAt },
      after: { fileName: payslip.fileName },
    });
  } else {
    payslip = await new Payslip().create.new({
      organizationId: input.orgId,
      userId: input.userId,
      referenceMonth: input.referenceMonth,
      referenceYear: input.referenceYear,
      storagePath,
      fileName: input.fileName,
      publishedById: input.publisherId,
      overrideReason: input.overrideReason,
      overriddenById: input.overrideReason ? input.publisherId : null,
    });
    await writeAudit({
      organizationId: input.orgId,
      actorId: input.publisherId,
      action: "payslip.create",
      entityType: "Payslip",
      entityId: payslip.id,
    });
  }

  // Holerite publicado e ninguém sabia: a pessoa tinha de entrar na
  // tela para descobrir. [CB-29]
  await notify({
    organizationId: input.orgId,
    userId: input.userId,
    kind: NotificationKind.PAYSLIP_PUBLISHED,
    title: `Holerite de ${String(input.referenceMonth).padStart(2, "0")}/${input.referenceYear}`,
    body: existing
      ? "O holerite foi corrigido e está disponível."
      : "Seu holerite está disponível.",
    link: "/holerites",
    entityType: "Payslip",
    entityId: payslip.id,
  });

  return { payslip, replaced: Boolean(existing) };
}

/** Como cada parte da folha sai da conferência. [B4-F] */
type SituacaoDaParte =
  | "CONFERE"
  | "SEM_CADASTRO"
  | "NAO_CONFERE"
  | "SEM_FUNCIONARIO"
  | "VARIAS_PESSOAS"
  | "REPETIDA";

type ParteDoLote = {
  pages: number[];
  registration: string | null;
  document_name: string | null;
  situacao: SituacaoDaParte;
  user_id: string | null;
  user_name: string | null;
  /** Já há holerite dessa pessoa nessa competência: publicar substitui. */
  substitui: boolean;
  motivos: string[];
  avisos: string[];
};

type LoteLido = { parts: ParteDoLote[]; totalPages: number };

class ErroDoLote extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const MOTIVO_DO_PROBLEMA: Record<string, string> = {
  SEM_FUNCIONARIO: "Página sem matrícula e nome de funcionário.",
  VARIAS_PESSOAS: "Mais de uma pessoa na mesma página.",
  REPETIDA:
    "A mesma matrícula aparece em outro trecho do arquivo. Publique essa pessoa pelo envio individual.",
};

/**
 * Lê o arquivo da folha, separa por pessoa e confere cada parte como o envio
 * individual confere — mesma `checkPayslip`, com a pessoa achada pela
 * matrícula do cadastro. Não grava nada. [B4-F]
 *
 * No lote não existe "publicar assim mesmo": a parte que não confere fica de
 * fora, e o RH a publica pelo envio individual, onde a justificativa vale só
 * para o que não se conseguiu ler. [S5-G] [B3-3-A]
 */
async function lerLote(
  orgId: string,
  data: Buffer,
  referenceMonth: number,
  referenceYear: number,
): Promise<LoteLido> {
  const pages = await extractPdfPages(data, MAX_BATCH_PAGES + 1);
  if (!pages || pages.length === 0) {
    throw new ErroDoLote(422, "Não foi possível ler este PDF. Envie o arquivo gerado pela folha.");
  }
  if (pages.length > MAX_BATCH_PAGES) {
    throw new ErroDoLote(
      422,
      `O arquivo passa de ${MAX_BATCH_PAGES} páginas. Divida a folha em mais de um arquivo.`,
    );
  }

  const fichas = await prisma.employeeProfile.findMany({
    where: {
      organizationId: orgId,
      registration: { not: null },
      user: { memberships: { some: { organizationId: orgId } } },
    },
    select: {
      userId: true,
      registration: true,
      admittedAt: true,
      user: { select: { name: true } },
    },
  });

  const split = splitBatchPages(pages);
  const parts: ParteDoLote[] = split.map((part) => {
    const base = {
      pages: part.pages,
      registration: part.registration,
      document_name: part.name,
      user_id: null,
      user_name: null,
      substitui: false,
      avisos: [] as string[],
    };
    if (part.problem || !part.registration) {
      return {
        ...base,
        situacao: (part.problem ?? "SEM_FUNCIONARIO") as SituacaoDaParte,
        motivos: [MOTIVO_DO_PROBLEMA[part.problem ?? "SEM_FUNCIONARIO"]],
      };
    }
    const registration = part.registration;
    const donos = fichas.filter(
      (ficha) => ficha.registration && sameRegistration(ficha.registration, registration),
    );
    if (donos.length === 0) {
      return {
        ...base,
        situacao: "SEM_CADASTRO" as const,
        motivos: [`Nenhum colaborador com a matrícula ${registration} no cadastro.`],
      };
    }
    if (donos.length > 1) {
      return {
        ...base,
        situacao: "NAO_CONFERE" as const,
        motivos: [`A matrícula ${registration} está em mais de um cadastro.`],
      };
    }
    const [dono] = donos;
    const conferencia = checkPayslip(part.text, {
      registration: dono.registration!,
      name: dono.user.name,
      referenceMonth,
      referenceYear,
      admittedAt: dono.admittedAt ?? null,
    });
    return {
      ...base,
      user_id: dono.userId,
      user_name: dono.user.name,
      situacao: conferencia.ok ? ("CONFERE" as const) : ("NAO_CONFERE" as const),
      motivos: conferencia.blockers,
      avisos: conferencia.warnings,
    };
  });

  const conferem = parts.filter((part) => part.situacao === "CONFERE");
  const jaPublicados = await prisma.payslip.findMany({
    where: {
      organizationId: orgId,
      referenceMonth,
      referenceYear,
      userId: { in: conferem.map((part) => part.user_id!) },
    },
    select: { userId: true },
  });
  const comHolerite = new Set(jaPublicados.map((row) => row.userId));
  for (const part of conferem) part.substitui = comHolerite.has(part.user_id!);

  return { parts, totalPages: pages.length };
}

/** Os campos do lote, conferidos; `null` quando já respondeu com erro. */
function pedidoDoLote(req: Request, res: Response) {
  const { reference_month, reference_year, file_name, mime_type, content_base64 } =
    req.body as {
      reference_month?: number;
      reference_year?: number;
      file_name?: string;
      mime_type?: string;
      content_base64?: string;
    };
  if (!reference_month || !reference_year || !file_name?.trim() || !content_base64) {
    res.status(400).json({
      message: "Informe reference_month, reference_year, file_name e content_base64.",
    });
    return null;
  }
  if (reference_month < 1 || reference_month > 12) {
    res.status(400).json({ message: "reference_month deve ser 1–12." });
    return null;
  }
  if (mime_type !== "application/pdf") {
    res.status(400).json({ message: "O arquivo da folha precisa ser PDF." });
    return null;
  }
  const data = Buffer.from(content_base64, "base64");
  assertSize(data.length || 0);
  return {
    referenceMonth: reference_month,
    referenceYear: reference_year,
    fileName: file_name.trim(),
    data,
  };
}

function resumoDoLote(parts: ParteDoLote[]) {
  const conferem = parts.filter((part) => part.situacao === "CONFERE");
  return {
    conferem: conferem.length,
    substituem: conferem.filter((part) => part.substitui).length,
    de_fora: parts.filter(
      (part) => part.situacao !== "CONFERE" && part.situacao !== "SEM_FUNCIONARIO",
    ).length,
    paginas_sem_funcionario: parts
      .filter((part) => part.situacao === "SEM_FUNCIONARIO")
      .reduce((total, part) => total + part.pages.length, 0),
  };
}

function falhaDoLote(res: Response, err: unknown) {
  if (err instanceof ErroDoLote) {
    res.status(err.status).json({ message: err.message });
    return;
  }
  fail(res, err);
}

class PayslipController {
  async listRecipients(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      if (!isRh(auth)) {
        res.status(403).json({ message: "Sem permissão." });
        return;
      }
      const orgId = actorOrgId(auth);
      const rows = await prisma.membership.findMany({
        where: {
          organizationId: orgId,
          user: { active: true },
        },
        include: {
          user: { select: { id: true, name: true, login: true } },
        },
      });
      const recipients = rows
        .map((r) => r.user)
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      res.json({ recipients });
    } catch (err) {
      fail(res, err);
    }
  }

  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const year = req.query.year ? Number(req.query.year) : undefined;

      const rows = await prisma.payslip.findMany({
        where: {
          organizationId: orgId,
          ...(!isRh(auth) ? { userId } : {}),
          ...(req.query.user_id && isRh(auth)
            ? { userId: String(req.query.user_id) }
            : {}),
          ...(year ? { referenceYear: year } : {}),
        },
        orderBy: [{ referenceYear: "desc" }, { referenceMonth: "desc" }],
        include: {
          user: { select: { id: true, name: true } },
          publishedBy: { select: { id: true, name: true } },
          _count: { select: { questions: true } },
          questions: {
            where: { answer: null },
            select: { id: true },
          },
        },
      });
      res.json({
        payslips: rows.map((r) => {
          const { storagePath: _storagePath, questions: _questions, ...rest } = r;
          return {
            ...rest,
            open_questions: r.questions.length,
          };
        }),
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
      const payslip = await prisma.payslip.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        include: {
          user: { select: { id: true, name: true } },
          publishedBy: { select: { id: true, name: true } },
          questions: {
            orderBy: { createdAt: "asc" },
            include: {
              askedBy: { select: { id: true, name: true } },
              answeredBy: { select: { id: true, name: true } },
            },
          },
          /** As versões anteriores, que deixaram de ser apagadas. [S5-F] */
          versions: {
            orderBy: { replacedAt: "desc" },
            select: {
              id: true,
              fileName: true,
              publishedAt: true,
              viewedAt: true,
              replacedAt: true,
              replacedBy: { select: { id: true, name: true } },
            },
          },
          overriddenBy: { select: { id: true, name: true } },
        },
      });
      if (!payslip) {
        res.status(404).json({ message: "Holerite não encontrado." });
        return;
      }
      if (payslip.userId !== userId) {
        res.status(403).json({
          message: "Só o titular pode abrir o holerite.",
        });
        return;
      }
      /*
        "Visto" era marcado ao abrir o detalhe: entrar na tela e voltar sem
        abrir o arquivo já contava como visto. O que prova entrega é abrir o
        documento, e isso acontece no download. [S4-E]
      */
      res.json({ payslip });
    } catch (err) {
      fail(res, err);
    }
  }

  async download(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const payslip = await prisma.payslip.findFirst({
        where: { id: req.params.id, organizationId: orgId },
      });
      if (!payslip) {
        res.status(404).json({ message: "Holerite não encontrado." });
        return;
      }
      if (payslip.userId !== userId) {
        res.status(403).json({
          message: "Só o titular pode baixar o holerite.",
        });
        return;
      }
      const abs = resolveStoragePath(payslip.storagePath);
      if (!fs.existsSync(abs)) {
        res.status(404).json({ message: "Arquivo não encontrado." });
        return;
      }
      if (!payslip.viewedAt) {
        await prisma.payslip.update({
          where: { id: payslip.id },
          data: { viewedAt: new Date() },
        });
      }
      res.download(abs, payslip.fileName);
    } catch (err) {
      fail(res, err);
    }
  }

  /** Dúvidas em aberto — RH responde sem abrir o arquivo do holerite. */
  async listOpenQuestions(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      if (!isRh(auth)) {
        res.status(403).json({ message: "Sem permissão." });
        return;
      }
      const orgId = actorOrgId(auth);
      const rows = await prisma.payslipQuestion.findMany({
        where: {
          answer: null,
          payslip: { organizationId: orgId },
        },
        orderBy: { createdAt: "asc" },
        include: {
          askedBy: { select: { id: true, name: true } },
          payslip: {
            select: {
              id: true,
              referenceMonth: true,
              referenceYear: true,
              fileName: true,
              user: { select: { id: true, name: true } },
            },
          },
        },
      });
      res.json({
        questions: rows.map((q) => ({
          id: q.id,
          body: q.body,
          created_at: q.createdAt,
          asked_by: q.askedBy,
          payslip_id: q.payslip.id,
          reference_month: q.payslip.referenceMonth,
          reference_year: q.payslip.referenceYear,
          file_name: q.payslip.fileName,
          user: q.payslip.user,
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async create(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const publisherId = actorUserId(auth);
      const {
        user_id,
        reference_month,
        reference_year,
        file_name,
        mime_type,
        content_base64,
        override_reason,
      } = req.body as {
        user_id?: string;
        reference_month?: number;
        reference_year?: number;
        file_name?: string;
        mime_type?: string;
        content_base64?: string;
        /** Por que publicar apesar de o documento não conferir. [CB-28] */
        override_reason?: string;
      };

      if (
        !user_id ||
        !reference_month ||
        !reference_year ||
        !file_name?.trim() ||
        !mime_type
      ) {
        res.status(400).json({
          message:
            "Informe user_id, reference_month, reference_year, file_name e mime_type.",
        });
        return;
      }
      if (reference_month < 1 || reference_month > 12) {
        res.status(400).json({ message: "reference_month deve ser 1–12." });
        return;
      }
      if (!content_base64) {
        res.status(400).json({ message: "Informe content_base64." });
        return;
      }

      const membership = await prisma.membership.findFirst({
        where: { userId: user_id, organizationId: orgId },
      });
      if (!membership) {
        res.status(400).json({ message: "Colaborador inválido." });
        return;
      }

      const data = Buffer.from(content_base64, "base64");
      assertSize(data.length || 0);

      /*
        Confere o DOCUMENTO antes de publicar: o nome do arquivo e a escolha da
        pessoa na tela não provam de quem é o holerite. Três travas lidas do
        PDF — matrícula, nome e competência — e a admissão como confirmação.
        [S5-G]
      */
      const destinatario = await prisma.user.findFirst({
        where: { id: user_id },
        select: {
          name: true,
          employeeProfiles: {
            where: { organizationId: orgId },
            select: { registration: true, admittedAt: true },
            take: 1,
          },
        },
      });
      const ficha = destinatario?.employeeProfiles?.[0];
      if (!destinatario || !ficha?.registration) {
        res.status(422).json({
          message:
            "Sem matrícula no cadastro não dá para conferir o holerite. Complete o cadastro do colaborador antes de publicar.",
        });
        return;
      }

      const conferencia = checkPayslip(await extractPdfText(data), {
        registration: ficha.registration,
        name: destinatario.name,
        referenceMonth: reference_month,
        referenceYear: reference_year,
        admittedAt: ficha.admittedAt ?? null,
      });
      /*
        A conferência pegou um erro real e não pode cair. Mas holerite correto
        de outra contabilidade, ou digitalizado, travava o RH para sempre:
        agora dá para publicar assim mesmo dizendo por quê, e quem publicou e
        o motivo ficam gravados. A tela mostra o que não conferiu, em vez de
        só "não confere". [CB-28] [B2-3-B]
      */
      /*
        O motivo só vale — e só fica gravado — quando a conferência de fato
        recusou. Mandar um motivo num holerite que confere não pode marcar o
        documento como exceção.
      */
      /*
        A exceção nasceu para holerite CERTO em layout que o portal não lê, e
        passou a valer para qualquer recusa: com uma frase qualquer, o holerite
        de um trabalhador ia para outro. A justificativa agora cobre só o que
        não se conseguiu ler. [B3-3-A] [S5-G]
      */
      const aceitaMotivo = podeJustificar(conferencia);
      if (conferencia.fatalBlockers.length > 0) {
        res.status(422).json({
          message:
            "Este documento não é da pessoa ou da competência escolhida. Confira o arquivo e a competência — não há como publicar assim mesmo.",
          code: "PAYSLIP_DOCUMENT_MISMATCH",
          reasons: conferencia.blockers,
          /** A tela não oferece justificativa quando ela não vale. */
          can_override: false,
        });
        return;
      }

      const motivoForaDoPadrao = aceitaMotivo
        ? override_reason?.trim() || null
        : null;
      if (!conferencia.ok && !motivoForaDoPadrao) {
        res.status(422).json({
          message: "O documento não confere com a pessoa escolhida.",
          code: "PAYSLIP_CHECK_FAILED",
          reasons: conferencia.blockers,
          can_override: true,
        });
        return;
      }

      const { payslip, replaced } = await gravarHolerite({
        orgId,
        publisherId,
        userId: user_id,
        referenceMonth: reference_month,
        referenceYear: reference_year,
        fileName: file_name.trim(),
        mimeType: mime_type,
        data,
        overrideReason: motivoForaDoPadrao,
      });

      res.status(replaced ? 200 : 201).json({
        warnings: conferencia.warnings,
        /** O que não conferiu, quando foi publicado assim mesmo. [CB-28] */
        overridden_reasons: motivoForaDoPadrao ? conferencia.blockers : [],
        payslip,
        replaced,
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * A prévia da folha do mês: quem confere, quem fica de fora e por quê, e
   * quem já tem holerite nessa competência. Não grava nada. [B4-F]
   */
  async previewBatch(req: Request, res: Response) {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const pedido = pedidoDoLote(req, res);
      if (!pedido) return;
      const lote = await lerLote(orgId, pedido.data, pedido.referenceMonth, pedido.referenceYear);
      res.json({
        total_pages: lote.totalPages,
        resumo: resumoDoLote(lote.parts),
        parts: lote.parts,
      });
    } catch (err) {
      falhaDoLote(res, err);
    }
  }

  /**
   * Publica a folha do mês: o arquivo é conferido de novo aqui — a prévia que
   * volta da tela não decide nada — e só as partes que conferem saem, cada
   * uma num PDF com as páginas daquela pessoa. O arquivo inteiro não é
   * guardado: ninguém alcança a página de outro. [B4-F]
   */
  async publishBatch(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const publisherId = actorUserId(auth);
      const pedido = pedidoDoLote(req, res);
      if (!pedido) return;
      const lote = await lerLote(orgId, pedido.data, pedido.referenceMonth, pedido.referenceYear);
      const conferem = lote.parts.filter((part) => part.situacao === "CONFERE");
      if (conferem.length === 0) {
        res.status(422).json({
          message: "Nenhuma parte do arquivo confere. Nada foi publicado.",
          resumo: resumoDoLote(lote.parts),
          parts: lote.parts,
        });
        return;
      }

      let origem: PDFDocument;
      try {
        origem = await PDFDocument.load(pedido.data);
      } catch {
        res.status(422).json({ message: "Não foi possível dividir este PDF." });
        return;
      }

      const competencia = `${String(pedido.referenceMonth).padStart(2, "0")}-${pedido.referenceYear}`;
      const publicados: { user_id: string; payslip_id: string; substituiu: boolean }[] = [];
      for (const part of conferem) {
        const destino = await PDFDocument.create();
        const paginas = await destino.copyPages(
          origem,
          part.pages.map((page) => page - 1),
        );
        for (const pagina of paginas) destino.addPage(pagina);
        const bytes = Buffer.from(await destino.save());

        const { payslip, replaced } = await gravarHolerite({
          orgId,
          publisherId,
          userId: part.user_id!,
          referenceMonth: pedido.referenceMonth,
          referenceYear: pedido.referenceYear,
          fileName: `holerite-${competencia}-${part.registration}.pdf`,
          mimeType: "application/pdf",
          data: bytes,
          overrideReason: null,
        });
        publicados.push({ user_id: part.user_id!, payslip_id: payslip.id, substituiu: replaced });
      }

      const resumo = resumoDoLote(lote.parts);
      await writeAudit({
        organizationId: orgId,
        actorId: publisherId,
        action: "payslip.batch",
        entityType: "PayslipBatch",
        entityId: randomUUID(),
        after: {
          fileName: pedido.fileName,
          referenceMonth: pedido.referenceMonth,
          referenceYear: pedido.referenceYear,
          totalPages: lote.totalPages,
          published: publicados.length,
          replaced: publicados.filter((row) => row.substituiu).length,
          refused: resumo.de_fora,
        },
      });

      res.status(201).json({
        publicados: publicados.length,
        substituidos: publicados.filter((row) => row.substituiu).length,
        resumo,
        parts: lote.parts,
      });
    } catch (err) {
      falhaDoLote(res, err);
    }
  }

  /** Baixar a versão que foi substituída — a que a pessoa viu antes. [S5-F] */
  async downloadVersion(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const versao = await prisma.payslipVersion.findFirst({
        where: { id: req.params.versionId, payslip: { organizationId: orgId } },
        include: { payslip: { select: { userId: true } } },
      });
      if (!versao) {
        res.status(404).json({ message: "Versão não encontrada." });
        return;
      }
      if (versao.payslip.userId !== userId) {
        res.status(403).json({ message: "Só o titular pode baixar o holerite." });
        return;
      }
      const abs = resolveStoragePath(versao.storagePath);
      if (!fs.existsSync(abs)) {
        res.status(404).json({ message: "Arquivo não encontrado." });
        return;
      }
      res.download(abs, versao.fileName);
    } catch (err) {
      fail(res, err);
    }
  }

  async askQuestion(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const payslip = await new Payslip().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!payslip) {
        res.status(404).json({ message: "Holerite não encontrado." });
        return;
      }
      if (payslip.userId !== userId) {
        res.status(403).json({
          message: "Só o titular do holerite pode perguntar.",
        });
        return;
      }
      const { body } = req.body as { body?: string };
      if (!body?.trim()) {
        res.status(400).json({ message: "Informe body." });
        return;
      }
      const question = await prisma.payslipQuestion.create({
        data: {
          payslipId: payslip.id,
          askedById: userId,
          body: body.trim(),
        },
        include: {
          askedBy: { select: { id: true, name: true } },
          answeredBy: { select: { id: true, name: true } },
        },
      });
      res.status(201).json({ question });
    } catch (err) {
      fail(res, err);
    }
  }

  async answerQuestion(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const question = await prisma.payslipQuestion.findFirst({
        where: {
          id: req.params.questionId,
          payslipId: req.params.id,
          payslip: { organizationId: orgId },
        },
      });
      if (!question) {
        res.status(404).json({ message: "Pergunta não encontrada." });
        return;
      }
      const { answer } = req.body as { answer?: string };
      if (!answer?.trim()) {
        res.status(400).json({ message: "Informe answer." });
        return;
      }
      const updated = await prisma.payslipQuestion.update({
        where: { id: question.id },
        data: {
          answer: answer.trim(),
          answeredById: userId,
          answeredAt: new Date(),
        },
        include: {
          askedBy: { select: { id: true, name: true } },
          answeredBy: { select: { id: true, name: true } },
        },
      });
      // Quem perguntou precisa saber que foi respondido. [S5-E] [CB-29]
      if (question.askedById !== userId) {
        await notify({
          organizationId: orgId,
          userId: question.askedById,
          kind: NotificationKind.PAYSLIP_ANSWERED,
          title: "O RH respondeu a sua dúvida do holerite",
          body: answer.trim().slice(0, 140),
          link: "/holerites",
          entityType: "PayslipQuestion",
          entityId: question.id,
        });
      }

      res.json({ question: updated });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new PayslipController();

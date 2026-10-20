import { Request, Response } from "express";
import prisma from "../model/prisma";
import { Announcement } from "../model/schema/Announcement/Announcement";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { notifyMany } from "../helper/notify";
import { canManageModule } from "../helper/module-access";
import {
  announcementAudience,
  announcementEstablishmentIds,
  announcementVisibility,
} from "../helper/announcement-audience";
import {
  ANNOUNCEMENT_KIND_DEFAULT,
  ANNOUNCEMENT_KIND_VALUES,
  isAnnouncementKind,
} from "../constants";
import type { AuthRequest } from "../types/auth";

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

class AnnouncementController {
  async list(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const kind = req.query.kind as string | undefined;
      const includeExpired = req.query.include_expired === "true";
      const now = new Date();

      /*
        Quem cuida do mural vê tudo; os demais veem o que é para a sua
        unidade e o que é para a empresa toda. [CB-33]
      */
      const podeGerir = Boolean(
        auth.actor && canManageModule(auth.actor.permission, "mural"),
      );
      const recorte = await announcementVisibility(orgId, userId, podeGerir);

      const rows = await prisma.announcement.findMany({
        where: {
          organizationId: orgId,
          ...recorte,
          /*
            Aviso retirado sai do mural de quem o recebeu; para quem cuida do
            mural ele continua à vista, marcado, porque o registro é prova de
            comunicação. [S3-I]
          */
          ...(podeGerir ? {} : { withdrawnAt: null }),
          ...(kind && isAnnouncementKind(kind) ? { kind } : {}),
          ...(includeExpired
            ? {}
            : {
                AND: [
                  { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
                ],
              }),
        },
        orderBy: { createdAt: "desc" },
        include: {
          publishedBy: { select: { id: true, name: true } },
          editedBy: { select: { id: true, name: true } },
          withdrawnBy: { select: { id: true, name: true } },
          reads: {
            where: { userId },
            select: { readAt: true },
          },
          establishments: {
            select: { establishment: { select: { id: true, name: true } } },
          },
        },
      });

      /*
        "12 leituras" contava qualquer pessoa que tivesse aberto o aviso,
        inclusive quem não era do público — e discordava do "x de y" de quem
        leu. A contagem da lista passa a ser a mesma: sobre o público. [CB-36]
      */
      const porChave = new Map<string, string[]>();
      for (const a of rows) {
        const ids = a.establishments.map((e) => e.establishment.id).sort();
        porChave.set(ids.join(","), ids);
      }
      const publicoPorChave = new Map<string, Set<string>>();
      for (const [chave, ids] of porChave) {
        publicoPorChave.set(chave, new Set(await announcementAudience(orgId, ids)));
      }
      const leituras = await prisma.announcementRead.findMany({
        where: { announcementId: { in: rows.map((a) => a.id) } },
        select: { announcementId: true, userId: true },
      });
      const quemLeu = new Map<string, string[]>();
      for (const l of leituras) {
        quemLeu.set(l.announcementId, [
          ...(quemLeu.get(l.announcementId) ?? []),
          l.userId,
        ]);
      }

      res.json({
        announcements: rows.map((a) => {
          const chave = a.establishments
            .map((e) => e.establishment.id)
            .sort()
            .join(",");
          const publico = publicoPorChave.get(chave) ?? new Set<string>();
          const leram = (quemLeu.get(a.id) ?? []).filter((id) => publico.has(id));
          return {
            ...a,
            read_at: a.reads[0]?.readAt ?? null,
            reads: undefined,
            establishments: a.establishments.map((e) => e.establishment),
            /** Quantas pessoas do público leram, e quantas são. [CB-36] */
            read_count: leram.length,
            audience_count: publico.size,
          };
        }),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Quem leu e quem ainda não leu o aviso. O mural mostrava só a contagem,
   * e "12 leituras" não diz a quem cobrar. [S3-H]
   */
  async readers(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      if (!auth.actor || !canManageModule(auth.actor.permission, "mural")) {
        res.status(403).json({ message: "Sem permissão para ver quem leu." });
        return;
      }
      const announcement = await prisma.announcement.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        select: {
          id: true,
          title: true,
          establishments: {
            select: { establishment: { select: { id: true, name: true } } },
          },
        },
      });
      if (!announcement) {
        res.status(404).json({ message: "Aviso não encontrado." });
        return;
      }
      /*
        A base é quem devia receber o aviso, não "todo usuário ativo da
        organização". Antes, "2 de 19 leram" contava como não lido o fiscal,
        o desligado e as outras unidades. [CB-36]
      */
      const unidades = announcement.establishments.map((e) => e.establishment.id);
      const publico = await announcementAudience(orgId, unidades);
      const [nomes, leituras] = await Promise.all([
        prisma.user.findMany({
          where: { id: { in: publico } },
          select: { id: true, name: true },
        }),
        prisma.announcementRead.findMany({
          where: { announcementId: announcement.id },
          select: { userId: true, readAt: true },
        }),
      ]);
      const quando = new Map(leituras.map((l) => [l.userId, l.readAt]));
      const pessoas = nomes
        .map((u) => ({
          id: u.id,
          name: u.name,
          read_at: quando.get(u.id) ?? null,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
      res.json({
        announcement: {
          id: announcement.id,
          title: announcement.title,
          establishments: announcement.establishments.map((e) => e.establishment),
        },
        readers: pessoas,
        read: pessoas.filter((p) => p.read_at).length,
        pending: pessoas.filter((p) => !p.read_at).length,
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
      // O mesmo recorte da lista: abrir pelo link não contorna a unidade. [CB-33]
      const podeGerir = Boolean(
        auth.actor && canManageModule(auth.actor.permission, "mural"),
      );
      const recorte = await announcementVisibility(orgId, userId, podeGerir);
      const announcement = await prisma.announcement.findFirst({
        where: {
          id: req.params.id,
          organizationId: orgId,
          ...recorte,
          // Abrir pelo link não traz de volta o aviso retirado. [S3-I]
          ...(podeGerir ? {} : { withdrawnAt: null }),
        },
        include: {
          publishedBy: { select: { id: true, name: true } },
          editedBy: { select: { id: true, name: true } },
          withdrawnBy: { select: { id: true, name: true } },
          /** O texto de antes de cada correção, do mais novo ao mais velho. */
          revisions: {
            orderBy: { replacedAt: "desc" },
            select: {
              id: true,
              title: true,
              body: true,
              happensAt: true,
              replacedAt: true,
              replacedBy: { select: { id: true, name: true } },
            },
          },
          reads: {
            where: { userId },
            select: { readAt: true },
          },
          establishments: {
            select: { establishment: { select: { id: true, name: true } } },
          },
          _count: { select: { reads: true } },
        },
      });
      if (!announcement) {
        res.status(404).json({ message: "Aviso não encontrado." });
        return;
      }
      res.json({
        announcement: {
          ...announcement,
          read_at: announcement.reads[0]?.readAt ?? null,
          reads: undefined,
          establishments: announcement.establishments.map((e) => e.establishment),
        },
      });
    } catch (err) {
      fail(res, err);
    }
  }

  async create(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const { kind, title, body, happens_at, expires_at, establishment_ids } =
        req.body as {
          kind?: string;
          title?: string;
          body?: string;
          happens_at?: string;
          expires_at?: string;
          /** Vazio ou ausente: o aviso vai para a empresa toda. [CB-33] */
          establishment_ids?: string[];
        };

      if (!title?.trim() || !body?.trim()) {
        res.status(400).json({ message: "Informe title e body." });
        return;
      }

      const resolvedKind = kind
        ? isAnnouncementKind(kind)
          ? kind
          : null
        : ANNOUNCEMENT_KIND_DEFAULT;
      if (!resolvedKind) {
        res.status(400).json({
          message: `kind inválido. Use: ${ANNOUNCEMENT_KIND_VALUES.join(", ")}.`,
        });
        return;
      }

      /*
        As unidades escolhidas têm de ser desta empresa e estar ativas —
        senão o aviso nasce com um público que não existe. [CB-33]
      */
      const pedidas = [...new Set(establishment_ids ?? [])].filter(Boolean);
      if (pedidas.length > 0) {
        const validas = await prisma.establishment.findMany({
          where: { id: { in: pedidas }, organizationId: orgId, archivedAt: null },
          select: { id: true },
        });
        if (validas.length !== pedidas.length) {
          res.status(400).json({
            message: "Escolha unidades desta empresa que estejam ativas.",
          });
          return;
        }
      }

      const announcement = await new Announcement().create.new({
        organizationId: orgId,
        kind: resolvedKind,
        title: title.trim(),
        body: body.trim(),
        happensAt: happens_at ? new Date(happens_at) : null,
        expiresAt: expires_at ? new Date(expires_at) : null,
        publishedById: userId,
      });

      if (pedidas.length > 0) {
        await prisma.announcementEstablishment.createMany({
          data: pedidas.map((establishmentId) => ({
            announcementId: announcement.id,
            establishmentId,
          })),
        });
      }

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "announcement.create",
        entityType: "Announcement",
        entityId: announcement.id,
        after: { kind: announcement.kind, establishmentIds: pedidas },
      });

      /*
        Quem é do público fica sabendo sem precisar procurar [S3-G] [S4-G] —
        e só quem é do público: nem o fiscal, nem quem foi desligado, nem as
        outras unidades. [CB-33]
      */
      const publico = await announcementAudience(orgId, pedidas);
      await notifyMany(
        publico.filter((id) => id !== userId),
        {
          organizationId: orgId,
          kind: "ANNOUNCEMENT_PUBLISHED",
          title: announcement.title,
          body: "Novo aviso no mural.",
          link: `/mural?open=${announcement.id}`,
          entityType: "Announcement",
          entityId: announcement.id,
        },
      );

      res.status(201).json({
        announcement: { ...announcement, establishmentIds: pedidas },
        /** Quantas pessoas receberam, para a tela dizer na hora. [CB-33] */
        notified: publico.filter((id) => id !== userId).length,
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Corrigir o texto de um aviso publicado.
   *
   * O aviso saía na hora e não tinha conserto: um erro de digitação ficava
   * para sempre. Corrigir mexe em prova de comunicação de risco, então o
   * texto anterior fica guardado, a troca fica assinada e o mural passa a
   * dizer que houve correção. O público não muda: trocar quem recebeu
   * mudaria a quem a empresa comunicou. [S3-I]
   */
  async update(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const { title, body, happens_at, establishment_ids } = req.body as {
        title?: string;
        body?: string;
        happens_at?: string | null;
        establishment_ids?: string[];
      };

      if (establishment_ids !== undefined) {
        res.status(400).json({
          message:
            "As unidades de um aviso publicado não mudam. Retire este aviso e publique outro.",
          code: "AUDIENCE_IS_FIXED",
        });
        return;
      }
      if (title !== undefined && !title.trim()) {
        res.status(400).json({ message: "O título não pode ficar vazio." });
        return;
      }
      if (body !== undefined && !body.trim()) {
        res.status(400).json({ message: "O conteúdo não pode ficar vazio." });
        return;
      }
      if (title === undefined && body === undefined && happens_at === undefined) {
        res.status(400).json({ message: "Nada para corrigir." });
        return;
      }

      const atual = await prisma.announcement.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        select: {
          id: true,
          title: true,
          body: true,
          happensAt: true,
          withdrawnAt: true,
        },
      });
      if (!atual) {
        res.status(404).json({ message: "Aviso não encontrado." });
        return;
      }
      if (atual.withdrawnAt) {
        res.status(409).json({
          message: "Este aviso foi retirado do mural e não se corrige mais.",
          code: "ALREADY_WITHDRAWN",
        });
        return;
      }

      const announcement = await prisma.$transaction(async (tx) => {
        await tx.announcementRevision.create({
          data: {
            announcementId: atual.id,
            title: atual.title,
            body: atual.body,
            happensAt: atual.happensAt,
            replacedById: userId,
          },
        });
        return tx.announcement.update({
          where: { id: atual.id },
          data: {
            ...(title !== undefined ? { title: title.trim() } : {}),
            ...(body !== undefined ? { body: body.trim() } : {}),
            ...(happens_at !== undefined
              ? { happensAt: happens_at ? new Date(happens_at) : null }
              : {}),
            editedAt: new Date(),
            editedById: userId,
          },
        });
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "announcement.edit",
        entityType: "Announcement",
        entityId: announcement.id,
        before: { title: atual.title, body: atual.body, happensAt: atual.happensAt },
        after: {
          title: announcement.title,
          body: announcement.body,
          happensAt: announcement.happensAt,
        },
      });

      res.json({ announcement });
    } catch (err) {
      fail(res, err);
    }
  }

  /**
   * Retirar o aviso do mural. O registro fica, com o motivo e quem retirou:
   * apagar a comunicação é pior que o erro que levou a retirá-la. [S3-I]
   */
  async withdraw(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const motivo = (req.body as { reason?: string }).reason;
      if (!motivo?.trim()) {
        res.status(400).json({
          message: "Diga por que o aviso está sendo retirado.",
        });
        return;
      }

      const atual = await prisma.announcement.findFirst({
        where: { id: req.params.id, organizationId: orgId },
        select: { id: true, title: true, withdrawnAt: true },
      });
      if (!atual) {
        res.status(404).json({ message: "Aviso não encontrado." });
        return;
      }
      if (atual.withdrawnAt) {
        res.status(409).json({
          message: "Este aviso já foi retirado do mural.",
          code: "ALREADY_WITHDRAWN",
        });
        return;
      }

      const announcement = await prisma.$transaction(async (tx) => {
        const row = await tx.announcement.update({
          where: { id: atual.id },
          data: {
            withdrawnAt: new Date(),
            withdrawnById: userId,
            withdrawalReason: motivo.trim(),
          },
        });
        /*
          O sino deixa de apontar para um aviso que saiu do mural: quem
          clicasse no aviso não encontraria nada. Mesmo motivo de deixar de
          avisar sobre módulo fechado. [S3-I]
        */
        await tx.notification.updateMany({
          where: {
            entityType: "Announcement",
            entityId: row.id,
            readAt: null,
          },
          data: { readAt: new Date() },
        });
        return row;
      });

      await writeAudit({
        organizationId: orgId,
        actorId: userId,
        action: "announcement.withdraw",
        entityType: "Announcement",
        entityId: announcement.id,
        after: { reason: announcement.withdrawalReason },
      });

      res.json({ announcement });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Confirma leitura — prova de comunicação (NR-1 / Lei 14.457). */
  async markRead(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const userId = actorUserId(auth);
      const announcement = await new Announcement().read.one({
        id: req.params.id,
        organizationId: orgId,
      });
      if (!announcement) {
        res.status(404).json({ message: "Aviso não encontrado." });
        return;
      }

      /*
        O sino e o Início discordavam: ler no mural tirava do Início e
        deixava no sino. São a mesma pendência. [B2-3-A] [S4-G]
      */
      await prisma.notification.updateMany({
        where: {
          userId,
          entityType: "Announcement",
          entityId: announcement.id,
          readAt: null,
        },
        data: { readAt: new Date() },
      });

      const read = await prisma.announcementRead.upsert({
        where: {
          announcementId_userId: {
            announcementId: announcement.id,
            userId,
          },
        },
        create: {
          announcementId: announcement.id,
          userId,
        },
        update: {},
      });

      res.json({ read });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new AnnouncementController();

import { Router, Request, Response } from "express";
import prisma from "../../model/prisma";
import { verifyModule } from "../../model/lib/Auth";
import { Role } from "@prisma/client";
import { actorOrgId, actorUserId } from "../../helper/org-scope";
import { accessEnded, resolveAccessUntil } from "../../helper/access-period";
import { writeAudit } from "../../helper/audit";
import {
  lerCaminho,
  nomesDosRegistros,
} from "../../helper/telas-consultadas";
import type { AuthRequest } from "../../types/auth";

const router = Router();

/** Um dia de calendário em Brasília, do primeiro ao último instante. */
function diaDeBrasilia(iso: string): { de: Date; ate: Date } {
  return {
    de: new Date(`${iso}T00:00:00.000-03:00`),
    ate: new Date(`${iso}T23:59:59.999-03:00`),
  };
}

/** Teto de segurança: a lista agrupa, mas a leitura do banco precisa de fim. */
const TETO = 5000;

/** Os dias com consulta de fiscal, do mais recente para trás. */
async function diasComConsulta(organizationId: string): Promise<string[]> {
  const rows = await prisma.auditEvent.findMany({
    where: { organizationId, action: "consulta.view" },
    orderBy: { createdAt: "desc" },
    take: 5000,
    select: { createdAt: true },
  });
  const dias = new Set<string>();
  for (const r of rows) {
    dias.add(
      new Date(r.createdAt.getTime() - 3 * 3_600_000).toISOString().slice(0, 10),
    );
  }
  return [...dias];
}

/** O último dia em que algum fiscal abriu alguma coisa. */
async function ultimoDiaComConsulta(organizationId: string): Promise<string | null> {
  const ultima = await prisma.auditEvent.findFirst({
    where: { organizationId, action: "consulta.view" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!ultima) return null;
  return new Date(ultima.createdAt.getTime() - 3 * 3_600_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * O que a consulta (fiscal) abriu no portal.
 *
 * Uma linha por tela, com o nome do registro que foi aberto e a entrada no
 * portal. As consultas que a tela faz sozinha — sino, lista de unidades,
 * lista de pessoas — ficam de fora, salvo quando se pede `tudo=true`.
 * Antes eram 147 linhas por sessão, 35 delas "Outra consulta", com o
 * endereço interno embaixo. [B2-4-H]
 *
 * Quem dá o acesso — Conta e usuários — é quem vê. [S7-A]
 */
router.get(
  "/api/consulta-acessos",
  verifyModule("conta", "write"),
  async (req: Request, res: Response) => {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const dia = typeof req.query.day === "string" ? req.query.day.slice(0, 10) : null;
      const deQuem = typeof req.query.user_id === "string" ? req.query.user_id : null;
      const tudo = req.query.tudo === "true";

      if (dia && !/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
        res.status(400).json({ message: "Dia inválido. Use AAAA-MM-DD." });
        return;
      }
      /*
        Sem dia escolhido, o último em que houve consulta: a pergunta nasce
        depois da fiscalização, e abrir a tela num dia vazio não responde
        nada. [B2-4-H]
      */
      const diaUsado = dia ?? (await ultimoDiaComConsulta(orgId));
      if (!diaUsado) {
        res.json({ acessos: [], day: null, truncated: false, days: [] });
        return;
      }
      const janela = diaDeBrasilia(diaUsado);

      const rows = await prisma.auditEvent.findMany({
        where: {
          organizationId: orgId,
          /*
            A entrada no portal entra junto: sem ela, a lista começa no meio
            do que o fiscal fez. [B2-4-H] [OB-5]
          */
          action: { in: ["consulta.view", "session.signin"] },
          createdAt: { gte: janela.de, lte: janela.ate },
          ...(deQuem ? { actorId: deQuem } : {}),
        },
        orderBy: { createdAt: "asc" },
        take: TETO,
        select: {
          id: true,
          action: true,
          entityId: true,
          createdAt: true,
          actor: { select: { id: true, name: true } },
        },
      });

      /*
        Só quem é (ou foi) fiscal: a entrada no portal é gravada para todo
        mundo, e esta tela responde "o que o fiscal viu".
      */
      const fiscais = new Set(
        (
          await prisma.membership.findMany({
            where: { organizationId: orgId, role: Role.FISCAL },
            select: { userId: true },
          })
        ).map((m) => m.userId),
      );

      const lidas = rows
        .filter((r) => r.actor && fiscais.has(r.actor.id))
        .map((r) => ({
          ...r,
          entrada: r.action === "session.signin",
          consulta: lerCaminho(r.entityId),
        }))
        .filter((r) => r.entrada || tudo || !r.consulta.auxiliary);

      const nomes = await nomesDosRegistros(
        orgId,
        lidas.map((r) => r.consulta),
      );

      /*
        Abrir a mesma tela três vezes seguidas é uma linha, com a contagem.
        Quem lê quer a sequência do que foi visto, não o número de requisições.
      */
      const acessos: {
        id: string;
        kind: "entrada" | "tela";
        screen: string;
        record: string | null;
        path: string;
        user: { id: string; name: string } | null;
        at: Date;
        until: Date;
        times: number;
      }[] = [];
      for (const r of lidas) {
        const record = r.consulta.entityId
          ? (nomes.get(r.consulta.entityId) ?? "registro não encontrado")
          : null;
        const anterior = acessos[acessos.length - 1];
        const mesma =
          anterior &&
          !r.entrada &&
          anterior.kind === "tela" &&
          anterior.user?.id === r.actor?.id &&
          anterior.screen === (r.entrada ? "Entrou no portal" : r.consulta.screen) &&
          anterior.record === record;
        if (mesma && anterior) {
          anterior.times += 1;
          anterior.until = r.createdAt;
          continue;
        }
        acessos.push({
          id: r.id,
          kind: r.entrada ? "entrada" : "tela",
          screen: r.entrada ? "Entrou no portal" : r.consulta.screen,
          record,
          path: r.consulta.path,
          user: r.actor,
          at: r.createdAt,
          until: r.createdAt,
          times: 1,
        });
      }

      res.json({
        acessos: acessos.reverse(),
        day: diaUsado,
        /** Dias com consulta de fiscal, para a tela oferecer a escolha. */
        days: await diasComConsulta(orgId),
        /** Verdadeiro quando o teto de leitura foi atingido. */
        truncated: rows.length === TETO,
      });
    } catch (err) {
      fail(res, err);
    }
  },
);

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

/** Quem tem acesso de fiscal e até quando. [S7-A] */
router.get(
  "/api/fiscais",
  verifyModule("conta", "write"),
  async (req: Request, res: Response) => {
    try {
      const orgId = actorOrgId(req as AuthRequest);
      const rows = await prisma.membership.findMany({
        where: { organizationId: orgId, role: Role.FISCAL },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          accessExpiresAt: true,
          createdAt: true,
          user: { select: { id: true, name: true, email: true } },
        },
      });
      res.json({
        fiscais: rows.map((m) => ({
          id: m.id,
          user: m.user,
          access_expires_at: m.accessExpiresAt,
          active: !accessEnded(m.accessExpiresAt),
          since: m.createdAt,
        })),
      });
    } catch (err) {
      fail(res, err);
    }
  },
);

/**
 * Muda o fim do acesso do fiscal: nova data (`access_until`, AAAA-MM-DD) ou
 * encerrar agora (`end_now: true`). Fica na trilha de auditoria.
 */
router.patch(
  "/api/fiscais/:id",
  verifyModule("conta", "write"),
  async (req: Request, res: Response) => {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const current = await prisma.membership.findFirst({
        where: { id: req.params.id, organizationId: orgId, role: Role.FISCAL },
        select: { id: true, accessExpiresAt: true },
      });
      if (!current) {
        res.status(404).json({ message: "Fiscal não encontrado." });
        return;
      }
      const body = req.body as { access_until?: string; end_now?: boolean };
      const until = body.end_now === true ? new Date() : resolveAccessUntil(body.access_until);
      const updated = await prisma.membership.update({
        where: { id: current.id },
        data: { accessExpiresAt: until },
        select: { id: true, accessExpiresAt: true },
      });
      await writeAudit({
        organizationId: orgId,
        actorId: actorUserId(auth),
        action: body.end_now === true ? "fiscal.access_ended" : "fiscal.access_changed",
        entityType: "Membership",
        entityId: current.id,
        before: { accessExpiresAt: current.accessExpiresAt },
        after: { accessExpiresAt: updated.accessExpiresAt },
      });
      res.json({
        fiscal: {
          id: updated.id,
          access_expires_at: updated.accessExpiresAt,
          active: !accessEnded(updated.accessExpiresAt),
        },
      });
    } catch (err) {
      fail(res, err);
    }
  },
);

export default router;

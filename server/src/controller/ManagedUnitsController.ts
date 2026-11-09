import { Role } from "@prisma/client";
import { Request, Response } from "express";
import prisma from "../model/prisma";
import { actorOrgId, actorUserId } from "../helper/org-scope";
import { writeAudit } from "../helper/audit";
import { NOT_FOUND_BODY } from "../helper/unit-scope";
import type { AuthRequest } from "../types/auth";

/**
 * Unidades sob a responsabilidade de um gerente, supervisor ou ADM loja.
 * [C2-13]
 *
 * Só Master, Dono e RH definem (a rota exige Conta e usuários). A unidade é
 * atribuída expressamente — nada é deduzido da função, da cidade ou do nome
 * — e ninguém mexe no próprio vínculo. Pessoa ou unidade fora da empresa
 * respondem como inexistentes.
 */

/** Papéis que recebem unidades. "Admin (legado)" vale como gerente (OB-2). */
const PAPEIS_RECORTADOS: readonly Role[] = [Role.GERENTE, Role.SUPERVISOR, Role.ADM_LOJA, Role.ADMIN];

function fail(res: Response, err: unknown) {
  const e = err as { status?: number; message?: string };
  res.status(e.status || 500).json({ message: e.message || "Erro interno." });
}

async function vinculoDaPessoa(orgId: string, userId: string) {
  return prisma.membership.findUnique({
    where: { userId_organizationId: { userId, organizationId: orgId } },
    select: {
      id: true,
      role: true,
      managedEstablishments: {
        where: { organizationId: orgId, establishment: { organizationId: orgId } },
        select: { establishment: { select: { id: true, name: true, archivedAt: true } } },
      },
    },
  });
}

function unidadesPublicas(
  linhas: { establishment: { id: string; name: string; archivedAt: Date | null } }[],
) {
  return linhas
    .map((l) => ({
      id: l.establishment.id,
      name: l.establishment.name,
      archived: l.establishment.archivedAt !== null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

class ManagedUnitsController {
  async get(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const vinculo = await vinculoDaPessoa(orgId, req.params.userId);
      if (!vinculo) {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      res.json({
        role: vinculo.role,
        receives_units: PAPEIS_RECORTADOS.includes(vinculo.role),
        units: unidadesPublicas(vinculo.managedEstablishments),
      });
    } catch (err) {
      fail(res, err);
    }
  }

  /** Define o conjunto inteiro de unidades da pessoa (substitui o anterior). */
  async set(req: Request, res: Response) {
    try {
      const auth = req as AuthRequest;
      const orgId = actorOrgId(auth);
      const actorId = actorUserId(auth);
      const userId = req.params.userId;

      if (userId === actorId) {
        res.status(403).json({ message: "As suas próprias unidades são definidas por outra pessoa." });
        return;
      }

      const corpo = req.body as { establishment_ids?: unknown };
      const ids = corpo?.establishment_ids;
      if (!Array.isArray(ids) || ids.some((i) => typeof i !== "string") || ids.length > 200) {
        res.status(400).json({ message: "Informe a lista de unidades (establishment_ids)." });
        return;
      }
      const pedidas = [...new Set(ids as string[])];

      const vinculo = await vinculoDaPessoa(orgId, userId);
      if (!vinculo) {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }
      if (!PAPEIS_RECORTADOS.includes(vinculo.role)) {
        res.status(400).json({
          message: "Só gerente, supervisor e ADM loja recebem unidades sob responsabilidade.",
          code: "ROLE_NOT_UNIT_SCOPED",
        });
        return;
      }

      // Unidade de outra empresa, arquivada ou inexistente: a mesma resposta.
      const validas = await prisma.establishment.findMany({
        where: { id: { in: pedidas }, organizationId: orgId, archivedAt: null },
        select: { id: true },
      });
      if (validas.length !== pedidas.length) {
        res.status(404).json(NOT_FOUND_BODY);
        return;
      }

      const antes = vinculo.managedEstablishments.map((l) => l.establishment.id).sort();
      await prisma.$transaction([
        prisma.managedEstablishment.deleteMany({
          where: { membershipId: vinculo.id, establishmentId: { notIn: pedidas } },
        }),
        ...pedidas
          .filter((id) => !antes.includes(id))
          .map((establishmentId) =>
            prisma.managedEstablishment.create({
              data: { organizationId: orgId, membershipId: vinculo.id, establishmentId, createdById: actorId },
            }),
          ),
      ]);

      await writeAudit({
        organizationId: orgId,
        actorId,
        action: "managed_units.set",
        entityType: "membership",
        entityId: vinculo.id,
        before: { establishment_ids: antes },
        after: { establishment_ids: [...pedidas].sort() },
        context: { user_id: userId },
      });

      const depois = await vinculoDaPessoa(orgId, userId);
      res.json({ units: unidadesPublicas(depois?.managedEstablishments ?? []) });
    } catch (err) {
      fail(res, err);
    }
  }
}

export default new ManagedUnitsController();
